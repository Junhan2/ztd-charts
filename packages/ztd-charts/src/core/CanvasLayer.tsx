import { useEffect, useRef, useState } from "react";

export interface CanvasLayerProps {
  width: number;
  height: number;
  /** 그리기. 진행도 t(0~1)와 실제 색을 읽는 함수를 받아요 */
  draw: (ctx: CanvasRenderingContext2D, t: number, color: (cssVar: string, fallback: string) => string) => void;
  /** 0~1 등장 진행도 */
  progress: number;
  /** 바뀌면 다시 그려요 */
  version: unknown;
  /** 오른쪽을 이만큼(px) 가려요. 한 번 그린 그림을 CSS로 드러낼 때 (프레임마다 다시 그리지 않아요) */
  clipRight?: number;
  /** 그리기 전에 전체를 지우지 않아요. 바뀐 부분만 다시 그리는 draw용 (크기가 바뀌면 캔버스는 어차피 비워져요) */
  manualClear?: boolean;
}

/**
 * 점이 아주 많을 때 쓰는 캔버스 바닥층. SVG(축, 라벨) 아래에 깔려요.
 * CSS 변수 색은 그릴 때 계산된 값으로 읽어요. React가 다시 렌더하지 않는 변화(CSS만으로 바꾼 테마, 화면 배율)에도 다시 그려요.
 */
export function CanvasLayer(props: CanvasLayerProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // 마지막 그림이 읽은 CSS 변수와 그 값. 테마가 바뀌었는지는 이 변수만 다시 읽어 봐요
  const used = useRef(new Map<string, string>());
  // 올리면 다시 그려요
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
    // 쓰던 색이 달라졌을 때만 다시 그려요. 테마와 상관없는 속성이 바뀌면 변수 몇 개만 읽고 끝나요
    const check = () => {
      const cs = getComputedStyle(cv);
      for (const [v, c] of used.current) if (cs.getPropertyValue(v).trim() !== c) return redraw();
    };
    // 배율 쿼리는 지금 배율에만 맞아서, 바뀌면 새 배율로 다시 걸어요 (다른 모니터로 옮기기, 브라우저 확대)
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
    // 테마 전환은 html, body나 감싼 요소의 속성(class, data-theme, data-bs-theme, style 등)을 바꿔요. 이름이 제각각이라 조상의 속성을 다 봐요
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
