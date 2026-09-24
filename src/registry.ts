import type { SimDefinition } from './core/sim';
import { boids } from './sims/boids';

/** ギャラリーに表示するシミュレーション。新しいものはここに追加する */
export const sims: SimDefinition[] = [boids];
