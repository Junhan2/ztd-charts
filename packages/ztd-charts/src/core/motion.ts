/**
 * Chart animation engine.
 * Interpolates each shape's number vector (angles, coordinates, sizes and so on) toward its target values.
 * - spring: the analytic solution of a critically damped spring. Independent of frame rate, and it keeps its velocity when the target changes midway.
 * - easeOut / easeInOut / linear: time-based interpolation
 */
export type EasingName = "spring" | "easeOut" | "easeInOut" | "linear";

export interface Mark<M = unknown> {
  /** The same item keeps the same key even when the data changes */
  key: string;
  /** Target values */
  to: number[];
  /** Start values of the first entrance (and of a replay). Defaults to to (no motion) */
  from?: number[];
  /** Start values of an item newly added by a data change. Defaults to from */
  enter?: number[];
  /** Values on exit. Defaults to enter */
  exit?: number[];
  /** Entrance delay (ms) */
  delay?: number;
  /** Segment lengths when to is made of several segments, e.g. [1, point count, point count]. When the point count changes, each segment is stretched separately */
  parts?: number[];
  /** Other information used for drawing */
  data: M;
}

export interface MotionItem<M> {
  key: string;
  v: number[];
  data: M;
  exiting: boolean;
  /** 0 before the start, 1 on arrival */
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

/** Resamples a vector of a different length to the target length by linear interpolation */
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

/** NaN equals NaN, and NaN differs from a number (a value appearing where there was none must be drawn too) */
function sameVec(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    // When both are NaN, Math.abs(NaN) is NaN too, so they are not reported as different
    if (Number.isNaN(x) !== Number.isNaN(y) || Math.abs(x - y) > 1e-6) return false;
  }
  return true;
}

/** Slots that were empty (NaN) start right at the target. There is nothing in between, so interpolating would yield only NaN */
function fillGaps(from: number[], vel: number[], to: number[]): void {
  for (let i = 0; i < to.length; i++) {
    if (!Number.isFinite(from[i]) || !Number.isFinite(to[i])) {
      from[i] = to[i];
      vel[i] = 0;
    }
  }
}

/** With parts (segment lengths), each segment is stretched or shrunk separately, so progress, y values and baselines do not mix */
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
  /** Entrance start time (ms). -1 when no entrance is running */
  entranceStart = -1;
  private maxDelay = 0;

  configure(easing: EasingName, duration: number): void {
    this.easing = easing;
    this.duration = Math.max(1, duration);
    // So that (1 + wt)e^-wt has 0.6% left at duration
    this.omega = 7.4 / (this.duration / 1000);
  }

  /** Whether these match the last targets received */
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

  /** Updates only the render information (values stay as they are) */
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

  /** Jumps straight to the targets without animation */
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

  /** Holds the marks in their pre-entrance state */
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

  /** Starts the entrance from the held state */
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

  /** Moves from the current values to new targets. New items start from enter; removed items go to exit */
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
        // The current values are the start values. If empty slots were filled or the length changed, they must be synced here so no old values remain after arrival is detected
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

  /** Computes the values at time now. true while still moving */
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
        // Stops once the remaining distance and the velocity (distance covered in 1/w seconds) drop below 0.15. Judged by time alone, long distances skipped their last 0.3%
        // It never stops before 8 (the last 0.3% of a 0 to 1 value is invisible). At 20 it ends even with NaN present. So the remaining distance is measured only in between
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

  /** Time elapsed since the entrance started (ms). Infinity when no entrance is running */
  elapsed(now: number): number {
    return this.entranceStart < 0 ? Infinity : now - this.entranceStart;
  }

  /** Estimated total length of the entrance (ms) */
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

/** requestAnimationFrame loop shared by all charts */
export function subscribeTick(fn: TickFn): () => void {
  subscribers.add(fn);
  if (!rafId && typeof requestAnimationFrame !== "undefined") rafId = requestAnimationFrame(loop);
  return () => {
    subscribers.delete(fn);
  };
}
