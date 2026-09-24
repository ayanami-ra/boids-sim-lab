import type { GpuContext } from '../../core/gpu';
import type { Particles } from './model';
import { energyFromStep } from './nbody-cpu';
import { DRAW_WGSL, STEP_WGSL, TONEMAP_WGSL, WORKGROUP_SIZE } from './shaders';

export interface CameraUniform {
  viewProj: Float32Array;
  width: number;
  height: number;
  focalPx: number;
  starRadius: number;
  brightness: number;
  showDarkMatter: boolean;
}

const HDR_FORMAT: GPUTextureFormat = 'rgba16float';

/**
 * GPU 上の N 体シミュレーション。位置バッファを 2 本持ち、
 * ステップごとに読み書きを入れ替える（ピンポン）。
 */
export class GpuNBody {
  readonly n: number;
  /** 起動からのステップ数 */
  steps = 0;
  private readonly device: GPUDevice;
  private readonly masses: Float32Array;
  private readonly pos: [GPUBuffer, GPUBuffer];
  private readonly vel: GPUBuffer;
  private readonly accPhi: GPUBuffer;
  private readonly stepParams: GPUBuffer;
  private readonly primeParams: GPUBuffer;
  private readonly stepPipeline: GPUComputePipeline;
  /** [params 種別][現在の位置バッファ] */
  private readonly stepGroups: GPUBindGroup[][];
  private current = 0;

  private readonly cameraBuffer: GPUBuffer;
  private readonly drawPipeline: GPURenderPipeline;
  private readonly drawGroups: GPUBindGroup[];
  private readonly tonemapPipeline: GPURenderPipeline;
  private hdr: GPUTexture | null = null;
  private tonemapGroup: GPUBindGroup | null = null;

  private readonly readVel: GPUBuffer;
  private readonly readAcc: GPUBuffer;
  private reading = false;

  constructor(
    private readonly gpu: GpuContext,
    particles: Particles,
    eps: number,
    private readonly dt: number,
  ) {
    const { device } = gpu;
    this.device = device;
    this.n = particles.count;
    const bytes = this.n * 16;
    this.masses = particles.pos.filter((_, i) => i % 4 === 3);

    const storage = (data?: Float32Array, extra = 0) => {
      const b = device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | extra,
      });
      if (data) device.queue.writeBuffer(b, 0, data as Float32Array<ArrayBuffer>);
      return b;
    };
    this.pos = [storage(particles.pos), storage(particles.pos)];
    this.vel = storage(particles.vel);
    this.accPhi = storage();

    const params = (kick: number, drift: number) => {
      const b = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const data = new ArrayBuffer(32);
      new Uint32Array(data, 0, 1)[0] = this.n;
      new Float32Array(data, 4, 4).set([dt, eps * eps, kick, drift]);
      device.queue.writeBuffer(b, 0, data);
      return b;
    };
    this.stepParams = params(1, 1);
    this.primeParams = params(0.5, 0);

    this.stepPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: STEP_WGSL }), entryPoint: 'main' },
    });
    const layout = this.stepPipeline.getBindGroupLayout(0);
    this.stepGroups = [this.stepParams, this.primeParams].map((u) =>
      [0, 1].map((from) =>
        device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: u } },
            { binding: 1, resource: { buffer: this.pos[from]! } },
            { binding: 2, resource: { buffer: this.pos[1 - from]! } },
            { binding: 3, resource: { buffer: this.vel } },
            { binding: 4, resource: { buffer: this.accPhi } },
          ],
        }),
      ),
    );

    this.cameraBuffer = device.createBuffer({
      size: 112,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const drawModule = device.createShaderModule({ code: DRAW_WGSL });
    const additive: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    };
    this.drawPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: drawModule, entryPoint: 'vs' },
      fragment: {
        module: drawModule,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: additive }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.drawGroups = [0, 1].map((i) =>
      device.createBindGroup({
        layout: this.drawPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.cameraBuffer } },
          { binding: 1, resource: { buffer: this.pos[i]! } },
          { binding: 2, resource: { buffer: this.vel } },
        ],
      }),
    );

    const toneModule = device.createShaderModule({ code: TONEMAP_WGSL });
    this.tonemapPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: toneModule, entryPoint: 'vs' },
      fragment: { module: toneModule, entryPoint: 'fs', targets: [{ format: gpu.format }] },
      primitive: { topology: 'triangle-list' },
    });

    const readback = () =>
      device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
    this.readVel = readback();
    this.readAcc = readback();

    // 速度を半ステップずらす（リープフロッグの初期化）
    const enc = device.createCommandEncoder();
    this.encodeSteps(enc, 1, true);
    device.queue.submit([enc.finish()]);
  }

  /** count ステップぶんの計算をコマンドに積む */
  encodeSteps(encoder: GPUCommandEncoder, count: number, prime = false): void {
    if (count <= 0) return;
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.stepPipeline);
    const groups = this.stepGroups[prime ? 1 : 0]!;
    const workgroups = Math.ceil(this.n / WORKGROUP_SIZE);
    for (let s = 0; s < count; s++) {
      pass.setBindGroup(0, groups[this.current]!);
      pass.dispatchWorkgroups(workgroups);
      this.current = 1 - this.current;
    }
    pass.end();
    if (!prime) this.steps += count;
  }

  private ensureTarget(width: number, height: number) {
    if (this.hdr && this.hdr.width === width && this.hdr.height === height) return;
    this.hdr?.destroy();
    this.hdr = this.device.createTexture({
      size: [width, height],
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.tonemapGroup = this.device.createBindGroup({
      layout: this.tonemapPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: this.hdr.createView() }],
    });
  }

  encodeDraw(encoder: GPUCommandEncoder, cam: CameraUniform): void {
    const data = new Float32Array(28);
    data.set(cam.viewProj, 0);
    data.set(
      [
        cam.width,
        cam.height,
        cam.focalPx,
        cam.starRadius,
        cam.brightness,
        cam.showDarkMatter ? 1 : 0,
      ],
      16,
    );
    this.device.queue.writeBuffer(this.cameraBuffer, 0, data);
    this.ensureTarget(cam.width, cam.height);

    const hdrPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.hdr!.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    hdrPass.setPipeline(this.drawPipeline);
    hdrPass.setBindGroup(0, this.drawGroups[this.current]!);
    hdrPass.draw(6, this.n);
    hdrPass.end();

    const screen = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpu.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    screen.setPipeline(this.tonemapPipeline);
    screen.setBindGroup(0, this.tonemapGroup!);
    screen.draw(3);
    screen.end();
  }

  /**
   * 全エネルギーを読み出す（直前のステップの値から計算）。
   * 前回の読み出しが終わっていなければ null。
   */
  async readEnergy(): Promise<{ kinetic: number; potential: number; total: number } | null> {
    if (this.reading || this.steps === 0) return null;
    this.reading = true;
    try {
      const enc = this.device.createCommandEncoder();
      enc.copyBufferToBuffer(this.vel, 0, this.readVel, 0, this.n * 16);
      enc.copyBufferToBuffer(this.accPhi, 0, this.readAcc, 0, this.n * 16);
      this.device.queue.submit([enc.finish()]);
      await Promise.all([
        this.readVel.mapAsync(GPUMapMode.READ),
        this.readAcc.mapAsync(GPUMapMode.READ),
      ]);
      const vel = new Float32Array(this.readVel.getMappedRange().slice(0));
      const acc = new Float32Array(this.readAcc.getMappedRange().slice(0));
      this.readVel.unmap();
      this.readAcc.unmap();
      return energyFromStep(vel, acc, this.masses, this.dt);
    } finally {
      this.reading = false;
    }
  }

  /** 現在の位置を読み出す（テスト・デバッグ用） */
  async readPositions(): Promise<Float32Array> {
    const read = this.device.createBuffer({
      size: this.n * 16,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.pos[this.current]!, 0, read, 0, this.n * 16);
    this.device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(read.getMappedRange().slice(0));
    read.destroy();
    return out;
  }

  dispose(): void {
    for (const b of [...this.pos, this.vel, this.accPhi, this.stepParams, this.primeParams])
      b.destroy();
    for (const b of [this.cameraBuffer, this.readVel, this.readAcc]) b.destroy();
    this.hdr?.destroy();
  }
}
