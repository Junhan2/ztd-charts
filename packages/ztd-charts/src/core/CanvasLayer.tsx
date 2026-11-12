import { useEffect, useRef, useState } from "react";

export interface CanvasLayerProps {
  width: number;
  height: number;
  /** Draw callback. Receives the progress t (0 to 1) and a function that reads the actual color */
  draw: (ctx: CanvasRenderingContext2D, t: number, color: (cssVar: string, fallback: string) => string) => void;
  /** Entrance progress, 0 to 1 */
  progress: number;
  /** Redraws when this changes */
  version: unknown;
  /** Hides this many px on the right. For revealing a drawing made once through CSS (no redraw on every frame) */
  clipRight?: number;
  /** Skips clearing the whole canvas before drawing. For a draw that redraws only the changed parts (a resize clears the canvas anyway) */
  manualClear?: boolean;
}

/**
 * Canvas base layer for charts with very many points. It sits under the SVG (axes, labels).
 * CSS variable colors are read as computed values at draw time. It also redraws on changes React does not re-render for (a theme switched by CSS alone, the screen's pixel ratio).
 */
export function CanvasLayer(props: CanvasLayerProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // The CSS variables the last drawing read, with their values. A theme change is detected by re-reading only these variables
  const used = useRef(new Map<string, string>());
  // Incrementing this redraws
  const [tick, setTick] = useState(0);
  const { width, height, draw, progress, version, clipRight, manualClear } = props;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(width * dpr));
    const H = Math.max(1, Math.round(height * dpr));
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!manualClear) ctx.clearRect(0, 0, width, height);
    const cs = getComputedStyle(cv);
    const cache = new Map<string, string>();
    const color = (v: string, fb: string) => {
      let c = cache.get(v);
      if (c === undefined) {
        c = cs.getPropertyValue(v).trim();
        cache.set(v, c);
      }
      return c || fb;
    };
    draw(ctx, progress, color);
    used.current = cache;
  }, [width, height, draw, progress, version, manualClear, tick]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || typeof matchMedia !== "function") return undefined;
    const ac = new AbortController();
    const redraw = () => setTick((n) => n + 1);
    // Redraws only when a color in use has changed. A change to an attribute unrelated to the theme costs only a few variable reads
    const check = () => {
      const cs = getComputedStyle(cv);
      for (const [v, c] of used.current) if (cs.getPropertyValue(v).trim() !== c) return redraw();
    };
    // The resolution query matches only the current ratio, so it is registered again for the new ratio when that changes (moving to another monitor, browser zoom)
    const watchDpr = () => {
      matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener?.(
        "change",
        () => {
          watchDpr();
          redraw();
        },
        { once: true, signal: ac.signal },
      );
    };
    watchDpr();
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", check, { signal: ac.signal });
    // A theme switch changes attributes (class, data-theme, data-bs-theme, style and so on) on html, body or a wrapping element. The names vary, so every attribute of the ancestors is watched
    const mo = new MutationObserver(check);
    for (let el = cv.parentElement; el; el = el.parentElement) mo.observe(el, { attributes: true });
    return () => {
      ac.abort();
      mo.disconnect();
    };
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "auto", aspectRatio: `${width} / ${height}`, pointerEvents: "none", clipPath: clipRight ? `inset(0 ${((clipRight / Math.max(1, width)) * 100).toFixed(3)}% 0 0)` : undefined }}
    />
  );
}
