import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isBrowser, useIsoLayoutEffect } from "./env";

export interface UseInViewOptions {
  /** 보이는 비율 기준. 기본 0.25 */
  threshold?: number;
  /** false면 관찰하지 않고 바로 true */
  enabled?: boolean;
  rootMargin?: string;
}

/** 화면보다 몇 배 큰 요소도 잡히게 잘게 나눈 기준 */
function thresholdsUpTo(t: number): number[] {
  return [...new Set([0, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, t].filter((v) => v <= t))].sort((a, b) => a - b);
}

/**
 * 기준 비율만큼 보이거나, 보이는 높이가 화면 절반 또는 enoughPx 이상이면 보이는 걸로 쳐요.
 * enoughPx가 있으면 화면보다 작아도 키가 큰 차트(타일 지도, 트리)가 위쪽 띠만 보여도 시작해요
 */
export function isShown(e: Pick<IntersectionObserverEntry, "isIntersecting" | "intersectionRatio" | "intersectionRect" | "rootBounds">, threshold: number, enoughPx = Infinity): boolean {
  const rootH = e.rootBounds?.height ?? window.innerHeight;
  return e.isIntersecting && (e.intersectionRatio >= threshold || e.intersectionRect.height >= Math.min(rootH * 0.5, enoughPx));
}

/**
 * 차트 등장 기준: 차트의 4분의 1이나 96px 중 작은 쪽이 화면에 보이면 시작해요.
 * 화면 아래 띠는 빼지 않아요. 빼면 카드 위쪽만 보이는 키 큰 차트가 보이는 채로 비어 있었어요
 */
export const CHART_VIEW = { threshold: 0.25, enoughPx: 96, rootMargin: "0px" } as const;

/** 요소가 한 번이라도 화면에 들어왔는지 */
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
 * 지금 보이는지(visible, CHART_VIEW 기준)와 곧 보일지(near, 위아래 240px 안)를 계속 따라가요.
 * near는 화면 밖 차트의 다시 재생을 미뤄 두었다가 들어오기 직전에 준비할 때 써요.
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
        // 화면보다 몇 배 큰 차트는 25%가 한 번에 안 보여요
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
 * 요소와 그 폭. 요소가 붙는 순간(ref 콜백) 재서 그리기 전에 딱 한 번 다시 그려요.
 * 폭이 null이면 아직 안 쟀고, 0이면 숨겨진 요소(또는 jsdom)예요.
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
    // 붙을 때 ref 콜백에서 이미 쟀고, 관찰자도 그리기 전에 첫 폭을 한 번 알려줘요. 여기서 다시 재면 레이아웃을 한 번 더 강제해요
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

/** 서버 HTML을 하이드레이트하는 첫 렌더와 서버에서는 false */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

const QUERY = "(prefers-reduced-motion: reduce)";

/** OS 동작 줄이기 설정. prop이 boolean이면 그대로 */
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

/** 다시 재생 버튼용 카운터 */
export function useReplay(): [number, () => void] {
  const [n, setN] = useState(0);
  const replay = useCallback(() => setN((v) => v + 1), []);
  return [n, replay];
}

/** 최신 값을 ref로 */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}
