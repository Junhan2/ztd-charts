import { useState } from "react";
import { darkTheme } from "../theme/tokens";

/** 인라인 스타일로 못 하는 규칙(포커스 링, 전환, 동작 줄이기)만 모은 CSS. 변수가 없으면 기본(다크) 테마 값을 써요 */
export const baseCss = `
.ztd-root{position:relative;-webkit-tap-highlight-color:transparent}
.ztd-root:focus{outline:none}
.ztd-root:focus-visible{outline:2px solid var(--ztd-accent,${darkTheme.accent});outline-offset:3px;border-radius:6px}
.ztd-svg{display:block;overflow:visible;user-select:none;-webkit-user-select:none}
.ztd-mark{transition:opacity .18s ease,fill .18s ease,stroke .18s ease,stroke-width .18s ease}
.ztd-tip{animation:ztd-fade .14s ease-out;transition:left .2s cubic-bezier(.22,1,.36,1),top .2s cubic-bezier(.22,1,.36,1)}
.ztd-guide{transition:transform .2s cubic-bezier(.22,1,.36,1)}
.ztd-still .ztd-tip,.ztd-still .ztd-guide{transition:none;animation:none}
.ztd-btn{appearance:none;font:inherit;cursor:pointer;transition:background .14s,color .14s,border-color .14s}
.ztd-btn:focus{outline:none}
.ztd-btn:focus-visible{outline:2px solid var(--ztd-accent,${darkTheme.accent});outline-offset:2px}
.ztd-card{transition:border-color .16s ease}
.ztd-card:hover{border-color:var(--ztd-dim,${darkTheme.dim})}
@media (prefers-reduced-motion: reduce){.ztd-mark,.ztd-tip,.ztd-guide,.ztd-btn,.ztd-card{transition:none;animation:none}}
@keyframes ztd-pop{from{opacity:0;transform:scale(.45)}to{opacity:1;transform:none}}
@keyframes ztd-fade{from{opacity:0}to{opacity:1}}
.ztd-pop{transform-box:fill-box;transform-origin:center}
@keyframes ztd-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.ztd-skeleton{animation:ztd-pulse 1.4s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.ztd-skeleton{animation:none}}
`;

/**
 * 칸이 아주 많은 차트(와플, 캘린더)는 등장을 CSS 애니메이션으로 해요. 프레임마다 React가 일하지 않아요.
 * fill-mode backwards라서 끝난 뒤에는 opacity 속성(호버 흐림)이 그대로 먹어요.
 */
export function cssEntrance(enabled: boolean, waiting: boolean, kind: "pop" | "fade", delay: number, duration: number): Record<string, string | number> | undefined {
  if (!enabled) return undefined;
  if (waiting) return { opacity: 0 };
  return { animation: `ztd-${kind} ${Math.round(duration)}ms cubic-bezier(.22,.9,.3,1) ${Math.round(delay)}ms backwards` };
}

/**
 * cssEntrance를 켤지. 서버 HTML에 없는 등장 스타일을 하이드레이트 전에 넣지 않아요.
 * 움직임 없이 처음 그린 차트(서버 그림을 이어받은 대화형 HTML, 동작 줄이기)는 다시 재생할 때만 등장해요
 */
export function useCssEntrance(c: { motion: { enabled: boolean }; hydrated: boolean }, m: { waiting: boolean; generation: number }): boolean {
  const [startedOff] = useState(!c.motion.enabled);
  return c.motion.enabled && c.hydrated && (!startedOff || m.waiting || m.generation > 0);
}

let injected = false;

/** 브라우저에서 한 번만 <style id="ztd-base">를 넣어요 */
export function ensureBaseStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  if (document.getElementById("ztd-base")) return;
  const el = document.createElement("style");
  el.id = "ztd-base";
  el.textContent = baseCss;
  document.head.appendChild(el);
}
