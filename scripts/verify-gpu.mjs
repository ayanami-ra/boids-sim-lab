// GPU 版の N 体計算が CPU 版（ユニットテスト済み）と同じ結果になるかをブラウザで確かめる。
// 使い方: dev サーバ起動中に node scripts/verify-gpu.mjs
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.SIM_URL ?? 'http://localhost:5173/';
const executablePath =
  process.env.CHROMIUM_PATH ??
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
const browser = await chromium.launch({
  executablePath,
  // ヘッドレスで WebGPU の canvas 出力を動かすには Vulkan を SwiftShader に向ける必要がある
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--use-angle=swiftshader',
  ],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto(base);

const result = await page.evaluate(async () => {
  const { initWebGPU } = await import('/src/core/gpu.ts');
  const { createRng } = await import('/src/core/rng.ts');
  const { SCENARIOS, buildScenario } = await import('/src/sims/galaxy/model.ts');
  const { leapfrogStep, energyFromStep } = await import('/src/sims/galaxy/nbody-cpu.ts');
  const { GpuNBody } = await import('/src/sims/galaxy/gpu-nbody.ts');

  const canvas = document.createElement('canvas');
  const gpu = await initWebGPU(canvas);
  if (!gpu) return { error: 'WebGPU が使えません' };
  // WORKGROUP_SIZE の倍数でない粒子数で、端数タイルの処理も確かめる
  const n = 1000;
  const eps = 0.3;
  const dt = 0.03;
  const steps = 40;
  const cpu = buildScenario(SCENARIOS[0], n, eps, createRng('verify'));
  const sim = new GpuNBody(gpu, cpu, eps, dt);

  const acc = new Float32Array(n * 4);
  leapfrogStep(cpu, eps, dt, acc, 0.5, 0);
  for (let i = 0; i < steps; i++) leapfrogStep(cpu, eps, dt, acc);

  const enc = gpu.device.createCommandEncoder();
  sim.encodeSteps(enc, steps);
  gpu.device.queue.submit([enc.finish()]);
  const gpuPos = await sim.readPositions();
  const gpuEnergy = await sim.readEnergy();
  const masses = cpu.pos.filter((_, i) => i % 4 === 3);
  const cpuEnergy = energyFromStep(cpu.vel, acc, masses, dt);

  let maxDiff = 0;
  let scale = 0;
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < 3; d++) {
      maxDiff = Math.max(maxDiff, Math.abs(gpuPos[i * 4 + d] - cpu.pos[i * 4 + d]));
      scale = Math.max(scale, Math.abs(cpu.pos[i * 4 + d]));
    }
  }
  return { n, steps, maxDiff, scale, gpuEnergy, cpuEnergy };
});
await browser.close();

console.log(JSON.stringify(result, null, 2));
if (result.error) process.exit(1);
const energyGap =
  Math.abs(result.gpuEnergy.total - result.cpuEnergy.total) / Math.abs(result.cpuEnergy.total);
const ok = result.maxDiff < 1e-3 * result.scale && energyGap < 1e-4;
console.log(ok ? 'OK: GPU と CPU の結果が一致' : 'NG: GPU と CPU の結果が食い違う');
process.exit(ok ? 0 : 1);
