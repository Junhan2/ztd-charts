import { useEffect, useLayoutEffect } from "react";

export const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

/** useEffect on the server, useLayoutEffect in the browser */
export const useIsoLayoutEffect = isBrowser ? useLayoutEffect : useEffect;

export function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

let uid = 0;
/** When a short id must stay stable under SSR too, React.useId is used; this counter covers everything else */
export function nextId(prefix = "ztd"): string {
  uid += 1;
  return `${prefix}${uid}`;
}
