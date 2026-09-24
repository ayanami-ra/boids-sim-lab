import type { SimDefinition } from './core/sim';
import { boids } from './sims/boids';
import { galaxy } from './sims/galaxy';

/** ギャラリーに表示するシミュレーション。新しいものはここに追加する */
export const sims: SimDefinition[] = [galaxy, boids];
