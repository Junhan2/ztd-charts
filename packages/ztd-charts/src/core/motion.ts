/**
 * 차트 애니메이션 엔진.
 * 도형마다 숫자 벡터(각도, 좌표, 크기 등)를 목표값으로 보간해요.
 * - spring: 임계 감쇠 스프링의 해석해. 프레임률과 무관하고, 중간에 목표가 바뀌어도 속도를 이어가요.
 * - easeOut / easeInOut / linear: 시간 기반 보간
 */
export type EasingName = "spring" | "easeOut" | "easeInOut" | "linear";

export interface Mark<M = unknown> {
  /** 데이터가 바뀌어도 같은 항목이면 같은 key */
  key: string;
  /** 목표값 */
  to: number[];
  /** 첫 등장(그리고 다시 재생)의 시작값. 없으면 to (움직이지 않음) */
  from?: number[];
  /** 데이터가 바뀌어 새로 생긴 항목의 시작값. 없으면 from */
  enter?: number[];
  /** 사라질 때 값. 없으면 enter */
  exit?: number[];
  /** 등장 지연(ms) */
  delay?: number;
  /** to가 여러 구간으로 이어져 있으면 구간 길이들. 예: [1, 점 수, 점 수]. 점 수가 바뀔 때 구간마다 따로 늘여요 */
  parts?: number[];
  /** 그릴 때 쓰는 나머지 정보 */
  data: M;
}

export interface MotionItem<M> {
  key: string;
  v: number[];
  data: M;
  exiting: boolean;
  /** 0이면 시작 전, 1이면 도착 */
  progress: number;
}

interface Track<M> {
  key: string;
  data: M;
  from: number[];
  vel: number[];
  to: number[];
  appear: number[];
  enter: number[];
  exit: number[];
  delay: number;
  t0: number;
  cur: number[];
  curVel: number[];
  done: boolean;
  exiting: boolean;
  order: number;
  progress: number;
  parts?: number[];
}

export function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}
export function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}
function easeFn(name: EasingName): (p: number) => number {
  if (name === "easeInOut") return easeInOutCubic;
  if (name === "linear") return (p) => p;
  return easeOutCubic;
}
function easeDeriv(name: EasingName, p: number): number {
  if (name === "linear") return 1;
  if (name === "easeInOut") return p < 0.5 ? 12 * p * p : 3 * Math.pow(-2 * p + 2, 2);
  return 3 * Math.pow(1 - p, 2);
}

/** 길이가 다른 벡터를 목표 길이에 맞춰 선형 보간으로 다시 뽑아요 */
export function resample(src: number[], n: number): number[] {
  if (src.length === n) return src.slice();
  if (!src.length) return new Array<number>(n).fill(0);
  if (src.length === 1 || n === 1) return new Array<number>(n).fill(src[0]);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * (src.length - 1);
    const a = Math.floor(f);
    const b = Math.min(src.length - 1, a + 1);
    out[i] = src[a] + (src[b] - src[a]) * (f - a);
  }
  return out;
}

/** NaN끼리는 같고 NaN과 숫자는 달라요 (값이 비었다가 생기는 변화도 그려야 해서) */
function sameVec(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    // 둘 다 NaN이면 Math.abs(NaN)도 NaN이라 다르다고 하지 않아요
    if (Number.isNaN(x) !== Number.isNaN(y) || Math.abs(x - y) > 1e-6) return false;
  }
  return true;
}

/** 비어 있던(NaN) 칸은 목표에서 바로 시작해요. 사이값이 없으니 보간하면 NaN만 나와요 */
function fillGaps(from: number[], vel: number[], to: number[]): void {
  for (let i = 0; i < to.length; i++) {
    if (!Number.isFinite(from[i]) || !Number.isFinite(to[i])) {
      from[i] = to[i];
      vel[i] = 0;
    }
  }
}

/** parts(구간 길이)가 있으면 구간마다 따로 늘이거나 줄여요. 진행도, y값, 바닥선이 서로 섞이지 않게 */
function resampleParts(src: number[], fromParts: readonly number[] | undefined, toParts: readonly number[] | undefined, n: number): number[] {
  if (!fromParts || !toParts || fromParts.length !== toParts.length) return resample(src, n);
  const out: number[] = [];
  let at = 0;
  for (let p = 0; p < toParts.length; p++) {
    const seg = src.slice(at, at + fromParts[p]);
    at += fromParts[p];
    for (const v of resample(seg, toParts[p])) out.push(v);
  }
  return out.length === n ? out : resample(src, n);
}

export class MotionEngine<M> {
  private tracks = new Map<string, Track<M>>();
  private seq = 0;
  easing: EasingName = "spring";
  duration = 900;
  private omega = 8.2;
  animating = false;
  /** 등장 시작 시각(ms). 등장 중이 아니면 -1 */
  entranceStart = -1;
  private maxDelay = 0;

  configure(easing: EasingName, duration: number): void {
    this.easing = easing;
    this.duration = Math.max(1, duration);
    // (1 + wt)e^-wt 가 duration에 0.6% 남도록
    this.omega = 7.4 / (this.duration / 1000);
  }

  /** 마지막으로 받은 목표들과 같은지 */
  sameTargets(marks: Mark<M>[]): boolean {
    let live = 0;
    for (const t of this.tracks.values()) if (!t.exiting) live++;
    if (live !== marks.length) return false;
    for (const m of marks) {
      const t = this.tracks.get(m.key);
      if (!t || t.exiting || !sameVec(t.to, m.to)) return false;
    }
    return true;
  }

  /** 렌더 정보만 바꿔요 (값은 그대로) */
  refreshData(marks: Mark<M>[]): void {
    for (const m of marks) {
      const t = this.tracks.get(m.key);
      if (t) t.data = m.data;
    }
  }

  private make(m: Mark<M>, cur: number[], t0: number, delay: number): Track<M> {
    const appear = m.from ?? m.to;
    const enter = m.enter ?? appear;
    return {
      key: m.key,
      data: m.data,
      from: cur.slice(),
      vel: new Array<number>(m.to.length).fill(0),
      to: m.to.slice(),
      appear: appear.slice(),
      enter: enter.slice(),
      exit: (m.exit ?? enter).slice(),
      delay,
      t0,
      cur: cur.slice(),
      curVel: new Array<number>(m.to.length).fill(0),
      done: false,
      exiting: false,
      order: this.seq++,
      progress: 0,
      parts: m.parts,
    };
  }

  /** 애니메이션 없이 바로 목표로 */
  snap(marks: Mark<M>[]): void {
    const next = new Map<string, Track<M>>();
    for (const m of marks) {
      const old = this.tracks.get(m.key);
      const tr = this.make(m, m.to, 0, 0);
      if (old) tr.order = old.order;
      tr.done = true;
      tr.progress = 1;
      next.set(m.key, tr);
    }
    this.tracks = next;
    this.animating = false;
    this.entranceStart = -1;
  }

  /** 등장 전 상태로 세워 둬요 */
  hold(marks: Mark<M>[]): void {
    const next = new Map<string, Track<M>>();
    let maxDelay = 0;
    for (const m of marks) {
      const old = this.tracks.get(m.key);
      const tr = this.make(m, m.from ?? m.to, Infinity, m.delay ?? 0);
      if (old) tr.order = old.order;
      maxDelay = Math.max(maxDelay, m.delay ?? 0);
      next.set(m.key, tr);
    }
    this.maxDelay = maxDelay;
    this.tracks = next;
    this.animating = false;
    this.entranceStart = -1;
  }

  /** 세워 둔 상태에서 등장 시작 */
  start(now: number): void {
    for (const t of this.tracks.values()) {
      t.t0 = now + t.delay;
      t.from = t.appear.slice();
      t.vel.fill(0);
      fillGaps(t.from, t.vel, t.to);
      t.cur = t.from.slice();
      t.curVel = t.vel.slice();
      t.done = sameVec(t.from, t.to);
      if (t.done) t.progress = 1;
    }
    this.entranceStart = now;
    this.animating = true;
  }

  /** 지금 값에서 새 목표로. 새 항목은 enter에서, 빠진 항목은 exit로 */
  update(marks: Mark<M>[], now: number, stagger = 0): void {
    this.step(now);
    const seen = new Set<string>();
    let i = 0;
    for (const m of marks) {
      seen.add(m.key);
      const old = this.tracks.get(m.key);
      const delay = stagger > 0 ? Math.min(i * stagger, 240) : 0;
      if (old) {
        const len = m.to.length;
        old.from = resampleParts(old.cur, old.parts, m.parts, len);
        old.vel = resampleParts(old.curVel, old.parts, m.parts, len);
        old.parts = m.parts;
        old.to = m.to.slice();
        fillGaps(old.from, old.vel, old.to);
        // 지금 값은 곧 시작값이에요. 빈 칸을 채웠거나 길이가 바뀌었으면 여기서 맞춰야 도착 판정 뒤에도 옛 값이 남지 않아요
        old.cur = old.from.slice();
        old.curVel = old.vel.slice();
        old.appear = (m.from ?? m.to).slice();
        old.enter = (m.enter ?? old.appear).slice();
        old.exit = (m.exit ?? old.enter).slice();
        old.data = m.data;
        old.exiting = false;
        old.t0 = now + (old.t0 > now ? Math.max(0, old.t0 - now) : delay);
        old.done = sameVec(old.from, old.to) && old.vel.every((v) => Math.abs(v) < 1e-6);
        old.progress = old.done ? 1 : 0;
      } else {
        const tr = this.make(m, m.enter ?? m.from ?? m.to, now + delay, 0);
        tr.done = sameVec(tr.from, tr.to);
        this.tracks.set(m.key, tr);
      }
      i++;
    }
    for (const t of this.tracks.values()) {
      if (seen.has(t.key) || t.exiting) continue;
      t.from = t.cur.slice();
      t.vel = t.curVel.slice();
      t.to = resample(t.exit, t.cur.length);
      t.t0 = now;
      t.exiting = true;
      t.done = false;
      t.progress = 0;
    }
    this.animating = true;
  }

  /** now 시각의 값을 계산. 아직 움직이는 중이면 true */
  step(now: number): boolean {
    if (!this.animating) return false;
    let moving = false;
    const ease = easeFn(this.easing);
    const D = this.duration / 1000;
    const w = this.omega;
    const removed: string[] = [];
    for (const t of this.tracks.values()) {
      if (t.done) continue;
      const dt = (now - t.t0) / 1000;
      const n = t.to.length;
      if (t.from.length !== n) t.from = resample(t.from, n);
      if (t.vel.length !== n) t.vel = resample(t.vel, n);
      if (t.cur.length !== n) {
        t.cur = new Array<number>(n).fill(0);
        t.curVel = new Array<number>(n).fill(0);
      }
      if (!(dt > 0)) {
        for (let i = 0; i < n; i++) {
          t.cur[i] = t.from[i];
          t.curVel[i] = 0;
        }
        t.progress = 0;
        moving = true;
        continue;
      }
      let finished: boolean;
      if (this.easing === "spring") {
        const e = Math.exp(-w * dt);
        // 남은 거리와 속도(1/w초에 갈 거리)가 0.15 아래로 줄면 멈춰요. 시간만 보면 먼 거리는 마지막 0.3%를 건너뛰었어요
        // 8 전에는 멈추지 않아요 (0~1 값의 마지막 0.3%는 보이지 않아요). 20이면 NaN이 있어도 끝내요. 그래서 남은 거리는 그 사이에만 재요
        const check = w * dt >= 8 && w * dt < 20;
        let far = 0;
        for (let i = 0; i < n; i++) {
          const A = t.from[i] - t.to[i];
          const B = t.vel[i] + w * A;
          t.cur[i] = t.to[i] + (A + B * dt) * e;
          t.curVel[i] = (t.vel[i] - w * B * dt) * e;
          if (check && far < 0.15) far = Math.max(far, Math.abs(t.cur[i] - t.to[i]), Math.abs(t.curVel[i] / w));
        }
        finished = w * dt >= 20 || (check && far < 0.15);
        t.progress = Math.min(1, 1 - (1 + w * dt) * e);
      } else {
        const p = Math.min(1, dt / D);
        const k = ease(p);
        const dk = easeDeriv(this.easing, p) / D;
        for (let i = 0; i < n; i++) {
          t.cur[i] = t.from[i] + (t.to[i] - t.from[i]) * k;
          t.curVel[i] = (t.to[i] - t.from[i]) * dk;
        }
        finished = p >= 1;
        t.progress = k;
      }
      if (finished) {
        for (let i = 0; i < n; i++) {
          t.cur[i] = t.to[i];
          t.curVel[i] = 0;
        }
        t.done = true;
        t.progress = 1;
        if (t.exiting) removed.push(t.key);
      } else moving = true;
    }
    for (const k of removed) this.tracks.delete(k);
    this.animating = moving;
    if (!moving) this.entranceStart = -1;
    return moving;
  }

  /** 등장 시작 후 지난 시간(ms). 등장 중이 아니면 Infinity */
  elapsed(now: number): number {
    return this.entranceStart < 0 ? Infinity : now - this.entranceStart;
  }

  /** 등장 전체 길이 추정(ms) */
  get entranceLength(): number {
    return this.duration + this.maxDelay;
  }

  get(key: string): number[] | undefined {
    return this.tracks.get(key)?.cur;
  }

  items(): MotionItem<M>[] {
    return [...this.tracks.values()].sort((a, b) => a.order - b.order).map((t) => ({ key: t.key, v: t.cur, data: t.data, exiting: t.exiting, progress: t.progress }));
  }

  get size(): number {
    return this.tracks.size;
  }
}

type TickFn = (now: number) => boolean;
const subscribers = new Set<TickFn>();
let rafId = 0;

function loop(t: number) {
  rafId = 0;
  const list = Array.from(subscribers);
  for (const fn of list) {
    let keep: boolean;
    try {
      keep = fn(t);
    } catch {
      keep = false;
    }
    if (!keep) subscribers.delete(fn);
  }
  if (subscribers.size && typeof requestAnimationFrame !== "undefined") rafId = requestAnimationFrame(loop);
}

/** 모든 차트가 같이 쓰는 requestAnimationFrame 루프 */
export function subscribeTick(fn: TickFn): () => void {
  subscribers.add(fn);
  if (!rafId && typeof requestAnimationFrame !== "undefined") rafId = requestAnimationFrame(loop);
  return () => {
    subscribers.delete(fn);
  };
}
