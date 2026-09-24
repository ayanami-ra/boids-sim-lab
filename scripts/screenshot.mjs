// 使い方: npm run shot -- <sim-id> [steps] [query]
//   例: npm run shot -- boids 300 "seed=demo&n=3000"
// dev サーバ (npm run dev) を起動した状態で実行する。shots/<sim-id>.png に保存。
// 停止状態で開始し、指定ステップだけ決定的に進めてから撮るので、毎回同じ絵になる。
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [id = 'boids', steps = '240', query = ''] = process.argv.slice(2);
const base = process.env.SIM_URL ?? 'http://localhost:5173/';
const executablePath =
  process.env.CHROMIUM_PATH ??
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()} (${m.location().url})`));

const params = new URLSearchParams(query);
params.set('paused', '1');
await page.goto(`${base}?${params}#/${id}`);
await page.waitForFunction(() => window.__sim !== undefined, null, { timeout: 15000 });
await page.evaluate((n) => window.__sim.step(n), Number(steps));

await mkdir('shots', { recursive: true });
const path = `shots/${id}.png`;
await page.locator('canvas').screenshot({ path });
await browser.close();

console.log(`saved ${path}`);
if (errors.length) {
  console.error('ページでエラーが出ました:\n' + errors.join('\n'));
  process.exit(1);
}
