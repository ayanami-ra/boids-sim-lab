import { lookAt, mat4, multiply, perspective } from '../../core/mat4';

/**
 * 原点を中心に回る軌道カメラ。
 * 1 本指/マウスのドラッグで回転、2 本指のピンチ・ホイールでズーム。
 * 触っていないときはゆっくり自動で回る。
 */
export class OrbitCamera {
  yaw = 0.6;
  pitch: number;
  distance: number;
  readonly fovY = (45 * Math.PI) / 180;
  readonly viewProj = mat4();
  private readonly proj = mat4();
  private readonly view = mat4();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchStart = 0;
  private distanceAtPinch = 0;
  private idleUntil = 0;
  private readonly cleanup: () => void;

  constructor(el: HTMLElement, pitchDeg: number, distance: number) {
    this.pitch = (pitchDeg * Math.PI) / 180;
    this.distance = distance;

    const down = (e: PointerEvent) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        this.pinchStart = this.pinchDistance();
        this.distanceAtPinch = this.distance;
      }
      this.touch();
    };
    const move = (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 1) {
        this.yaw -= (cur.x - prev.x) * 0.006;
        this.pitch = clamp(this.pitch + (cur.y - prev.y) * 0.006, -1.55, 1.55);
      } else if (this.pointers.size === 2 && this.pinchStart > 0) {
        this.distance = clamp(
          (this.distanceAtPinch * this.pinchStart) / this.pinchDistance(),
          5,
          600,
        );
      }
      this.touch();
    };
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinchStart = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.distance = clamp(this.distance * Math.exp(e.deltaY * 0.001), 5, 600);
      this.touch();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    this.cleanup = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }

  private pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) || 1 : 1;
  }

  private touch() {
    this.idleUntil = performance.now() + 4000;
  }

  /** 自動回転を進めて行列を更新する。焦点距離（ピクセル）を返す */
  /**
   * offsetY: 画面の中心を上にずらす量（NDC、画面の高さ = 2）。下のパネルに隠れないようにする
   */
  update(
    width: number,
    height: number,
    autoRotate: boolean,
    frameSeconds: number,
    offsetY = 0,
  ): number {
    if (autoRotate && performance.now() > this.idleUntil) this.yaw += frameSeconds * 0.04;
    const cp = Math.cos(this.pitch);
    const eye = [
      this.distance * cp * Math.cos(this.yaw),
      this.distance * cp * Math.sin(this.yaw),
      this.distance * Math.sin(this.pitch),
    ];
    perspective(this.proj, this.fovY, width / height, 0.5, 5000);
    lookAt(this.view, eye, [0, 0, 0], [0, 0, 1]);
    multiply(this.viewProj, this.proj, this.view);
    // クリップ座標で y += offsetY * w（射影行列の 4 行目を足し込む）
    for (let c = 0; c < 4; c++) this.viewProj[c * 4 + 1]! += offsetY * this.viewProj[c * 4 + 3]!;
    return height / 2 / Math.tan(this.fovY / 2);
  }

  dispose() {
    this.cleanup();
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
