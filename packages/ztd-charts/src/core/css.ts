import { useState } from "react";
import { darkTheme } from "../theme/tokens";

/** CSS holding only the rules inline styles cannot express (focus ring, transitions, reduced motion). Without the variables, it uses the default (dark) theme values */
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
 * Charts with very many cells (waffle, calendar) run their entrance as a CSS animation, so React does no work per frame.
 * With fill-mode backwards, the opacity attribute (hover dimming) applies as is once it ends.
 */
export function cssEntrance(enabled: boolean, waiting: boolean, kind: "pop" | "fade", delay: number, duration: number): Record<string, string | number> | undefined {
  if (!enabled) return undefined;
  if (waiting) return { opacity: 0 };
  return { animation: `ztd-${kind} ${Math.round(duration)}ms cubic-bezier(.22,.9,.3,1) ${Math.round(delay)}ms backwards` };
}

/**
 * Whether to turn on cssEntrance. Entrance styles absent from the server HTML are not added before hydration.
 * A chart first drawn without motion (interactive HTML taking over a server drawing, reduced motion) runs its entrance only on replay
 */
export function useCssEntrance(c: { motion: { enabled: boolean }; hydrated: boolean }, m: { waiting: boolean; generation: number }): boolean {
  const [startedOff] = useState(!c.motion.enabled);
  return c.motion.enabled && c.hydrated && (!startedOff || m.waiting || m.generation > 0);
}

let injected = false;

/** Inserts <style id="ztd-base"> once in the browser */
export function ensureBaseStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  if (document.getElementById("ztd-base")) return;
  const el = document.createElement("style");
  el.id = "ztd-base";
  el.textContent = baseCss;
  document.head.appendChild(el);
}
