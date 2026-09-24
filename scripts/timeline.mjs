// 1 回のシミュレーションを進めながら、決まった時刻ごとにスクリーンショットを撮る。
// 使い方: node scripts/timeline.mjs <sim-id> <query> <撮るステップ数（カンマ区切り）>
//   例: node scripts/timeline.mjs galaxy "scenario=antennae&n=4096" 1000,3000,6000
// 画像は shots/<sim-id>-<ステップ>.png。query の substeps は 1 回の step() で進むステップ数。
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [id, query = '', marks = '100'] = process.argv.slice(2);
const base = process.env.SIM_URL ?? 'http://localhost:5173/';
const executablePath =
  process.env.CHROMIUM_PATH ??
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
const browser = await chromium.launch({
  executablePath,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--use-angle=swiftshader',
  ],
});
const [vw, vh] = (process.env.SHOT_VIEWPORT ?? '1280x800').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
page.on('pageerror', (e) => console.error('pageerror:', e.message));

const params = new URLSearchParams(query);
params.set('paused', '1');
const substeps = Number(params.get('substeps') ?? 1);
await page.goto(`${base}?${params}#/${id}`);
await page.waitForFunction(() => window.__sim !== undefined, null, { timeout: 60000 });
await mkdir('shots', { recursive: true });

let done = 0;
for (const mark of marks.split(',').map(Number)) {
  const ticks = Math.round((mark - done) / substeps);
  // 一度に大量に積むと GPU のコマンドが溜まりすぎるので、少しずつ進める
  for (let left = ticks; left > 0; left -= 20) {
    await page.evaluate(
      async (k) => {
        window.__sim.step(k);
        await window.__sim.instance.gpu?.readPositions();
      },
      Math.min(20, left),
    );
  }
  done += ticks * substeps;
  await page.waitForTimeout(1200);
  const path = `shots/${id}-${mark}.png`;
  await page.screenshot({ path });
  const stats = await page.evaluate(() => window.__sim.instance.stats?.());
  console.log(path, JSON.stringify(stats));
}
await browser.close();
