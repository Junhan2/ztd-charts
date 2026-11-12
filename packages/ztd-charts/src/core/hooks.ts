import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isBrowser, useIsoLayoutEffect } from "./env";

export interface UseInViewOptions {
  /** Visible ratio threshold. Default 0.25 */
  threshold?: number;
  /** When false, nothing is observed and the result is true at once */
  enabled?: boolean;
  rootMargin?: string;
}

/** Finely divided thresholds so that elements several times larger than the screen are caught too */
function thresholdsUpTo(t: number): number[] {
  return [...new Set([0, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, t].filter((v) => v <= t))].sort((a, b) => a - b);
}

/**
 * Counts as shown when the threshold ratio is visible, or when the visible height is at least half the screen or enoughPx.
 * With enoughPx, a tall chart (tile map, tree) starts once its top strip is visible, even when it is smaller than the screen
 */
export function isShown(e: Pick<IntersectionObserverEntry, "isIntersecting" | "intersectionRatio" | "intersectionRect" | "rootBounds">, threshold: number, enoughPx = Infinity): boolean {
  const rootH = e.rootBounds?.height ?? window.innerHeight;
  return e.isIntersecting && (e.intersectionRatio >= threshold || e.intersectionRect.height >= Math.min(rootH * 0.5, enoughPx));
}

/**
 * Chart entrance threshold: starts when a quarter of the chart or 96px, whichever is smaller, is on screen.
 * The strip at the bottom of the screen is not excluded. Excluding it left tall charts with only the top of the card in view visible but empty
 */
export const CHART_VIEW = { threshold: 0.25, enoughPx: 96, rootMargin: "0px" } as const;

/** Whether the element has entered the screen at least once */
export function useInView<T extends Element>(el: T | null, options: UseInViewOptions = {}): boolean {
  const { threshold = 0.25, enabled = true, rootMargin = "0px 0px -8% 0px" } = options;
  const [seen, setSeen] = useState(!enabled);
  useEffect(() => {
    if (!enabled) {
      setSeen(true);
      return undefined;
    }
    if (seen || !el) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => isShown(e, threshold))) setSeen(true);
      },
      { threshold: thresholdsUpTo(threshold), rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, enabled, seen, threshold, rootMargin]);
  return seen;
}

/**
 * Keeps tracking whether the element is visible now (visible, by CHART_VIEW) and whether it soon will be (near, within 240px above or below).
 * near is used to hold off the replay of an off-screen chart and prepare it just before it enters.
 */
export function useViewport<T extends Element>(el: T | null, enabled = true): { visible: boolean; near: boolean } {
  const [state, setState] = useState({ visible: !enabled, near: !enabled });
  useEffect(() => {
    if (!enabled) {
      setState({ visible: true, near: true });
      return undefined;
    }
    if (!el) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setState({ visible: true, near: true });
      return undefined;
    }
    const vis = new IntersectionObserver(
      (entries) => {
        // For a chart several times larger than the screen, 25% is never visible at once
        const on = isShown(entries[entries.length - 1], CHART_VIEW.threshold, CHART_VIEW.enoughPx);
        setState((s) => (s.visible === on ? s : { ...s, visible: on, near: s.near || on }));
      },
      { threshold: thresholdsUpTo(CHART_VIEW.threshold), rootMargin: CHART_VIEW.rootMargin },
    );
    const near = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        setState((s) => (s.near === e.isIntersecting ? s : { ...s, near: e.isIntersecting }));
      },
      { threshold: 0, rootMargin: "240px 0px 240px 0px" },
    );
    vis.observe(el);
    near.observe(el);
    return () => {
      vis.disconnect();
      near.disconnect();
    };
  }, [el, enabled]);
  return state;
}

function readWidth(el: Element): number {
  const r = el.getBoundingClientRect().width;
  return r > 0 ? Math.round(r * 10) / 10 : 0;
}

/**
 * The element and its width. Measured the moment the element attaches (ref callback), with exactly one re-render before paint.
 * A null width means not measured yet; 0 means a hidden element (or jsdom).
 */
export function useMeasuredNode<T extends HTMLElement>(fixed?: number): [T | null, (el: T | null) => void, number | null] {
  const [node, setNode] = useState<T | null>(null);
  const [w, setW] = useState<number | null>(fixed ?? null);
  const ref = useCallback(
    (el: T | null) => {
      setNode(el);
      if (el && fixed === undefined) setW(readWidth(el));
    },
    [fixed],
  );
  useIsoLayoutEffect(() => {
    if (fixed !== undefined) {
      setW(fixed);
      return undefined;
    }
    if (!node) return undefined;
    const apply = (r: number) => setW((prev) => (prev !== null && Math.abs(prev - r) < 0.5 ? prev : r));
    const read = () => apply(readWidth(node));
    if (typeof ResizeObserver === "undefined") {
      read();
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    // The ref callback already measured on attach, and the observer also reports the first width once before paint. Measuring again here would force one more layout
    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) apply(box.width > 0 ? Math.round(box.width * 10) / 10 : 0);
      else read();
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [node, fixed]);
  return [node, ref, w];
}

const subscribeNothing = () => () => {};

/** false on the server and in the first render that hydrates the server HTML */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

const QUERY = "(prefers-reduced-motion: reduce)";

/** The OS reduced-motion setting. A boolean prop is used as is */
export function useReducedMotion(pref: "auto" | boolean | undefined = "auto"): boolean {
  const [os, setOs] = useState(() => (isBrowser && typeof window.matchMedia === "function" ? window.matchMedia(QUERY).matches : false));
  useEffect(() => {
    if (pref !== "auto" || !isBrowser || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(QUERY);
    const on = () => setOs(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [pref]);
  if (pref === true) return true;
  if (pref === false) return false;
  return os;
}

/** Counter for the replay button */
export function useReplay(): [number, () => void] {
  const [n, setN] = useState(0);
  const replay = useCallback(() => setN((v) => v + 1), []);
  return [n, replay];
}

/** Keeps the latest value in a ref */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}
