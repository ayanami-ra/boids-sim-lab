import { SpatialHash } from '../../core/spatial-hash';
import type { SimDefinition } from '../../core/sim';

/**
 * 参照実装: Canvas2D の Boids。新しいシミュレーションを作るときの雛形。
 * 状態は Float32Array の SoA（x[], y[], vx[], vy[]）で持ち、GC を発生させない。
 * ドラッグすると捕食者として群れを散らす。
 */
export const boids: SimDefinition = {
  id: 'boids',
  title: 'Boids',
  description: '分離・整列・結合の 3 規則だけで生まれる群れ。ドラッグで捕食者になる。',
  dt: 1 / 60,
  create({ canvas, width, height, dpr, rng, params }) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D が使えません');

    const n = Number(params.get('n') ?? 1500);
    const radius = 28;
    const maxSpeed = 140;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    const vx = new Float32Array(n);
    const vy = new Float32Array(n);
    let w = width;
    let h = height;
    let scale = dpr;
    const grid = new SpatialHash(radius, w, h);
    const predator = { x: 0, y: 0, active: false };

    for (let i = 0; i < n; i++) {
      x[i] = rng.range(0, w);
      y[i] = rng.range(0, h);
      const a = rng.range(0, Math.PI * 2);
      vx[i] = Math.cos(a) * maxSpeed * 0.5;
      vy[i] = Math.sin(a) * maxSpeed * 0.5;
    }

    return {
      step(dt) {
        grid.build(x, y, n);
        for (let i = 0; i < n; i++) {
          const xi = x[i]!;
          const yi = y[i]!;
          let cx = 0,
            cy = 0,
            ax = 0,
            ay = 0,
            sx = 0,
            sy = 0,
            count = 0;
          grid.query(xi, yi, radius, (j) => {
            if (j === i) return;
            const dx = x[j]! - xi;
            const dy = y[j]! - yi;
            const d2 = dx * dx + dy * dy;
            if (d2 > radius * radius || d2 === 0) return;
            count++;
            cx += dx;
            cy += dy;
            ax += vx[j]!;
            ay += vy[j]!;
            if (d2 < 100) {
              sx -= dx / d2;
              sy -= dy / d2;
            }
          });
          let fx = 0,
            fy = 0;
          if (count > 0) {
            fx += (cx / count) * 0.9 + (ax / count - vx[i]!) * 1.6 + sx * 900;
            fy += (cy / count) * 0.9 + (ay / count - vy[i]!) * 1.6 + sy * 900;
          }
          if (predator.active) {
            const dx = xi - predator.x;
            const dy = yi - predator.y;
            const d2 = dx * dx + dy * dy + 1;
            if (d2 < 120 * 120) {
              fx += (dx / d2) * 40000;
              fy += (dy / d2) * 40000;
            }
          }
          let nvx = vx[i]! + fx * dt;
          let nvy = vy[i]! + fy * dt;
          const sp = Math.hypot(nvx, nvy);
          const target = Math.min(maxSpeed * 1.8, Math.max(maxSpeed * 0.4, sp));
          if (sp > 0) {
            nvx = (nvx / sp) * target;
            nvy = (nvy / sp) * target;
          }
          vx[i] = nvx;
          vy[i] = nvy;
        }
        for (let i = 0; i < n; i++) {
          x[i] = (x[i]! + vx[i]! * dt + w) % w;
          y[i] = (y[i]! + vy[i]! * dt + h) % h;
        }
      },

      render() {
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.fillStyle = 'rgba(8, 10, 16, 0.35)';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < n; i++) {
          const sp = Math.hypot(vx[i]!, vy[i]!) || 1;
          const ux = vx[i]! / sp;
          const uy = vy[i]! / sp;
          const hue = 190 + (sp / maxSpeed) * 60;
          ctx.strokeStyle = `hsl(${hue} 90% 65%)`;
          ctx.beginPath();
          ctx.moveTo(x[i]! - ux * 5, y[i]! - uy * 5);
          ctx.lineTo(x[i]! + ux * 3, y[i]! + uy * 3);
          ctx.stroke();
        }
        if (predator.active) {
          ctx.strokeStyle = 'rgba(255, 120, 90, 0.8)';
          ctx.beginPath();
          ctx.arc(predator.x, predator.y, 12, 0, Math.PI * 2);
          ctx.stroke();
        }
      },

      resize(nw, nh, ndpr) {
        w = nw;
        h = nh;
        scale = ndpr;
        grid.resize(w, h);
      },

      pointer(e) {
        predator.x = e.x;
        predator.y = e.y;
        predator.active = e.down;
      },

      stats: () => ({ boids: n }),
    };
  },
};
