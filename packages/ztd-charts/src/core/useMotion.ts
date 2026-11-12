import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isBrowser, now, useIsoLayoutEffect } from "./env";
import { MotionEngine, subscribeTick, type EasingName, type Mark, type MotionItem } from "./motion";

export interface UseMotionOptions {
  /** Whether to animate (animate && !reducedMotion) */
  enabled: boolean;
  /** Whether the chart is on screen now. The entrance starts when it turns true */
  active: boolean;
  /** Whether it will be visible soon (near the top or bottom of the screen). A replay received off screen is prepared at that point. Default true */
  near?: boolean;
  /** Replays from the start when this changes */
  replayKey?: unknown;
  /** Data signature. A change runs the transition animation; when it is unchanged (only the size changed), marks snap into place */
  dataKey?: unknown;
  easing?: EasingName;
  duration?: number;
  /** Delay between items during data transitions (ms) */
  stagger?: number;
}

export interface MotionState<M> {
  items: MotionItem<M>[];
  get: (key: string) => number[] | undefined;
  /** Time since the entrance started (ms). Infinity when it has finished or is off */
  elapsed: number;
  /** During the entrance, goes from 0 to 1 over len (ms) starting at delay (ms). 1 once finished */
  fade: (delay: number, len?: number) => number;
  /** The entrance has not started yet (off screen) */
  waiting: boolean;
  animating: boolean;
  /** Increases by 1 each time an entrance starts. Used as a key to restart CSS animations */
  generation: number;
}

type Phase = "init" | "idle" | "running" | "done";

/**
 * Appends "#2", "#3" from the second occurrence of a duplicate key, so two items with the same name (pie slices, Sankey links) do not merge into one.
 * Without duplicate keys, the given array is returned as is (the same array is taken to mean nothing changed)
 */
function uniqueMarkKeys<M>(marks: Mark<M>[]): Mark<M>[] {
  const seen = new Map<string, number>();
  let dup = false;
  for (const m of marks) {
    const n = (seen.get(m.key) ?? 0) + 1;
    seen.set(m.key, n);
    if (n > 1) dup = true;
  }
  if (!dup) return marks;
  seen.clear();
  return marks.map((m) => {
    const n = (seen.get(m.key) ?? 0) + 1;
    seen.set(m.key, n);
    return n > 1 ? { ...m, key: `${m.key}#${n}` } : m;
  });
}

export function useMotion<M>(input: Mark<M>[], opts: UseMotionOptions): MotionState<M> {
  // The same marks array must yield the same result array, or the "did it change" check below goes wrong
  const marks = useMemo(() => uniqueMarkKeys(input), [input]);
  const { enabled, active, near = true, replayKey, dataKey, easing = "spring", duration = 900, stagger = 0 } = opts;
  const engineRef = useRef<MotionEngine<M> | null>(null);
  const phase = useRef<Phase>("init");
  const lastMarks = useRef<Mark<M>[] | null>(null);
  const lastData = useRef<unknown>(dataKey);
  const lastReplay = useRef<unknown>(replayKey);
  // Charts far from the screen postpone their replay (on a replay-all, only visible charts do any work)
  const pendingReplay = useRef(false);
  const generation = useRef(0);
  const [, setFrame] = useState(0);
  const unsub = useRef<(() => void) | null>(null);
  const alive = useRef(true);

  if (!engineRef.current) {
    engineRef.current = new MotionEngine<M>();
    engineRef.current.configure(easing, duration);
    engineRef.current.snap(marks);
    lastMarks.current = marks;
  }
  const engine = engineRef.current;
  engine.configure(easing, duration);

  if (lastMarks.current !== marks) {
    const p = phase.current;
    const dataChanged = !Object.is(lastData.current, dataKey);
    if (!engine.sameTargets(marks)) {
      if (!enabled || p === "init") engine.snap(marks);
      else if (p === "idle") engine.hold(marks);
      else if (p === "running" || dataChanged) engine.update(marks, now(), stagger);
      else engine.snap(marks);
    } else engine.refreshData(marks);
    lastMarks.current = marks;
    lastData.current = dataKey;
  }

  const tick = useRef<(t: number) => boolean>(() => false);
  tick.current = (t: number) => {
    if (!alive.current) return false;
    const moving = engine.step(t);
    if (!moving && phase.current === "running") phase.current = "done";
    setFrame((f) => (f + 1) % 1e9);
    if (!moving) unsub.current = null;
    return moving;
  };

  const ensureTicking = useCallback(() => {
    if (!isBrowser || unsub.current || !engine.animating) return;
    const fn = (t: number) => tick.current(t);
    unsub.current = subscribeTick(fn);
  }, [engine]);

  useIsoLayoutEffect(() => {
    const replayChanged = !Object.is(lastReplay.current, replayKey);
    lastReplay.current = replayKey;
    if (!enabled) {
      if (phase.current !== "done" || engine.animating) {
        engine.snap(lastMarks.current ?? marks);
        phase.current = "done";
        setFrame((f) => f + 1);
      }
      return;
    }
    if (phase.current === "init" || (replayChanged && near)) {
      engine.hold(lastMarks.current ?? marks);
      phase.current = "idle";
      pendingReplay.current = false;
      setFrame((f) => f + 1);
    } else if (replayChanged) pendingReplay.current = true;
    // marks is read through lastMarks. It is set up again only when replayKey/enabled changes
  }, [enabled, replayKey]);

  useIsoLayoutEffect(() => {
    if (!enabled || !near || !pendingReplay.current) return;
    pendingReplay.current = false;
    engine.hold(lastMarks.current ?? marks);
    phase.current = "idle";
    setFrame((f) => f + 1);
    // Only when near turns true
  }, [near, enabled]);

  useEffect(() => {
    if (enabled && active && phase.current === "idle") {
      engine.start(now());
      generation.current += 1;
      phase.current = "running";
      ensureTicking();
      setFrame((f) => f + 1);
    }
  }, [enabled, active, replayKey, engine, ensureTicking]);

  useEffect(() => {
    if (engine.animating) ensureTicking();
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      unsub.current?.();
      unsub.current = null;
    };
  }, []);

  const t = now();
  const elapsed = engine.elapsed(t);
  const waiting = enabled && phase.current === "idle";
  return {
    items: engine.items(),
    get: (key) => engine.get(key),
    elapsed: waiting ? 0 : elapsed,
    fade: (delay, len = 320) => {
      if (waiting) return 0;
      if (!Number.isFinite(elapsed)) return 1;
      return Math.max(0, Math.min(1, (elapsed - delay) / len));
    },
    waiting,
    animating: engine.animating,
    generation: generation.current,
  };
}
