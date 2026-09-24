import type { GpuContext } from '../../core/gpu';
import { FADE_WGSL, LINES_WGSL, MAP_WGSL, STEP_WGSL, TONEMAP_WGSL, WORKGROUP } from './shaders';

const HDR: GPUTextureFormat = 'rgba16float';

/**
 * たくさんの三重振り子を GPU で同時に積分する。
 * 描き方は 2 通り: 線で重ねて残像を残す（fan）か、一回転までの時間で色を塗る（map）。
 */
export class GpuPendulums {
  readonly n: number;
  private readonly device: GPUDevice;
  private readonly angles: GPUBuffer;
  private readonly vels: GPUBuffer;
  private readonly params: GPUBuffer;
  private readonly stepPipeline: GPUComputePipeline;
  private readonly stepGroup: GPUBindGroup;

  private readonly viewBuffer: GPUBuffer;
  private readonly linesPipeline: GPURenderPipeline;
  private readonly linesGroup: GPUBindGroup;
  private readonly fadePipeline: GPURenderPipeline;
  private readonly mapPipeline: GPURenderPipeline;
  private readonly mapGroup: GPUBindGroup;
  private readonly tonemapPipeline: GPURenderPipeline;
  private hdr: GPUTexture | null = null;
  private tonemapGroup: GPUBindGroup | null = null;
  private clearNext = true;
  /** シミュレーション内の経過時間（秒） */
  time = 0;

  constructor(
    private readonly gpu: GpuContext,
    initial: Float32Array,
  ) {
    const { device } = gpu;
    this.device = device;
    this.n = initial.length / 6;
    const size = this.n * 16;
    const storage = () =>
      device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
    this.angles = storage();
    this.vels = storage();
    this.upload(initial);

    this.params = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.stepPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: STEP_WGSL }), entryPoint: 'main' },
    });
    this.stepGroup = device.createBindGroup({
      layout: this.stepPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: this.angles } },
        { binding: 2, resource: { buffer: this.vels } },
      ],
    });

    this.viewBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const linesModule = device.createShaderModule({ code: LINES_WGSL });
    this.linesPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: linesModule, entryPoint: 'vs' },
      fragment: {
        module: linesModule,
        entryPoint: 'fs',
        targets: [
          {
            format: HDR,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'line-list' },
    });
    this.linesGroup = device.createBindGroup({
      layout: this.linesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.viewBuffer } },
        { binding: 1, resource: { buffer: this.angles } },
      ],
    });

    const fadeModule = device.createShaderModule({ code: FADE_WGSL });
    this.fadePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: fadeModule, entryPoint: 'vs' },
      fragment: {
        module: fadeModule,
        entryPoint: 'fs',
        targets: [
          {
            format: HDR,
            blend: {
              color: { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' },
              alpha: { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' },
            },
          },
        ],
      },
    });

    const mapModule = device.createShaderModule({ code: MAP_WGSL });
    this.mapPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mapModule, entryPoint: 'vs' },
      fragment: { module: mapModule, entryPoint: 'fs', targets: [{ format: gpu.format }] },
    });
    this.mapGroup = device.createBindGroup({
      layout: this.mapPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.viewBuffer } },
        { binding: 1, resource: { buffer: this.vels } },
      ],
    });

    const toneModule = device.createShaderModule({ code: TONEMAP_WGSL });
    this.tonemapPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: toneModule, entryPoint: 'vs' },
      fragment: { module: toneModule, entryPoint: 'fs', targets: [{ format: gpu.format }] },
    });
  }

  /** 初期状態（θ1, θ2, θ3, ω1, ω2, ω3 を n 本ぶん）を書き込む */
  upload(initial: Float32Array) {
    const a = new Float32Array(this.n * 4);
    const v = new Float32Array(this.n * 4);
    for (let i = 0; i < this.n; i++) {
      a.set(initial.subarray(i * 6, i * 6 + 3), i * 4);
      v.set(initial.subarray(i * 6 + 3, i * 6 + 6), i * 4);
    }
    this.device.queue.writeBuffer(this.angles, 0, a);
    this.device.queue.writeBuffer(this.vels, 0, v);
    this.time = 0;
    this.clearNext = true;
  }

  /** substeps 回 × dt 秒ぶん進める */
  encodeStep(encoder: GPUCommandEncoder, substeps: number, dt: number, g: number) {
    const data = new ArrayBuffer(32);
    new Uint32Array(data, 0, 2).set([this.n, substeps]);
    new Float32Array(data, 8, 3).set([dt, g, this.time]);
    this.device.queue.writeBuffer(this.params, 0, data);
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.stepPipeline);
    pass.setBindGroup(0, this.stepGroup);
    pass.dispatchWorkgroups(Math.ceil(this.n / WORKGROUP));
    pass.end();
    this.time += substeps * dt;
  }

  private target(width: number, height: number) {
    if (this.hdr && this.hdr.width === width && this.hdr.height === height) return this.hdr;
    this.hdr?.destroy();
    this.hdr = this.device.createTexture({
      size: [width, height],
      format: HDR,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.tonemapGroup = this.device.createBindGroup({
      layout: this.tonemapPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: this.hdr.createView() }],
    });
    this.clearNext = true;
    return this.hdr;
  }

  /** 振り子を線で描く。trail（0〜1）は前のフレームをどれだけ残すか */
  encodeFan(
    encoder: GPUCommandEncoder,
    view: {
      pivotX: number;
      pivotY: number;
      scale: number;
      width: number;
      height: number;
      intensity: number;
      trail: number;
    },
  ) {
    const data = new Float32Array([
      view.pivotX,
      view.pivotY,
      view.scale,
      this.n,
      view.width,
      view.height,
      view.intensity,
      0,
    ]);
    this.device.queue.writeBuffer(this.viewBuffer, 0, data);
    const hdr = this.target(view.width, view.height);
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: hdr.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: this.clearNext ? 'clear' : 'load',
          storeOp: 'store',
        },
      ],
    });
    this.clearNext = false;
    pass.setPipeline(this.fadePipeline);
    pass.setBlendConstant([view.trail, view.trail, view.trail, view.trail]);
    pass.draw(3);
    pass.setPipeline(this.linesPipeline);
    pass.setBindGroup(0, this.linesGroup);
    pass.draw(6, this.n);
    pass.end();

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

  /** 一回転までの時間のマップを描く（n は res × res） */
  encodeMap(
    encoder: GPUCommandEncoder,
    view: {
      x: number;
      y: number;
      size: number;
      res: number;
      width: number;
      height: number;
      maxTime: number;
    },
  ) {
    const data = new Float32Array([
      view.x,
      view.y,
      view.size,
      view.res,
      view.width,
      view.height,
      view.maxTime,
      0,
    ]);
    this.device.queue.writeBuffer(this.viewBuffer, 0, data);
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpu.context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.025, b: 0.045, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.mapPipeline);
    pass.setBindGroup(0, this.mapGroup);
    pass.draw(3);
    pass.end();
  }

  /** 現在の状態を読み出す（θ, ω, 一回転の時刻）。テスト・確認用 */
  async read(): Promise<{ angles: Float32Array; vels: Float32Array }> {
    const staging = () =>
      this.device.createBuffer({
        size: this.n * 16,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
    const a = staging();
    const v = staging();
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.angles, 0, a, 0, this.n * 16);
    enc.copyBufferToBuffer(this.vels, 0, v, 0, this.n * 16);
    this.device.queue.submit([enc.finish()]);
    await Promise.all([a.mapAsync(GPUMapMode.READ), v.mapAsync(GPUMapMode.READ)]);
    const out = {
      angles: new Float32Array(a.getMappedRange().slice(0)),
      vels: new Float32Array(v.getMappedRange().slice(0)),
    };
    a.destroy();
    v.destroy();
    return out;
  }

  dispose() {
    for (const b of [this.angles, this.vels, this.params, this.viewBuffer]) b.destroy();
    this.hdr?.destroy();
  }
}
