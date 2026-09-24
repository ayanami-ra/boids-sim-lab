import type { SimDefinition } from './core/sim';
import { boids } from './sims/boids';
import { forest } from './sims/forest';
import { galaxy } from './sims/galaxy';
import { lightning } from './sims/lightning';

/** ギャラリーに表示するシミュレーション。新しいものはここに追加する */
export const sims: SimDefinition[] = [galaxy, forest, lightning, boids];
