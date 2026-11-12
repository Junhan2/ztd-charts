import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ChartCtx } from "./useChart";

/** Charts linked under the same name show the pointed x together. ChartGrid sync provides this value */
export const SyncContext = createContext<string | undefined>(undefined);

/** The pointed position. Charts with the same keys match by key; when the key forms differ (a date x and text categories), they match by the on-screen label */
export interface SyncPoint {
  key: string;
  label: string;
}

type Listener = (at: SyncPoint | null, from: object) => void;
const groups = new Map<string, Set<Listener>>();

export function joinSync(id: string, fn: Listener): () => void {
  let set = groups.get(id);
  if (!set) groups.set(id, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) groups.delete(id);
  };
}

export function sendSync(id: string, at: SyncPoint | null, from: object): void {
  groups.get(id)?.forEach((fn) => fn(at, from));
}

/** Index of the received position. Lookup by label covers only up to 1,000 cells (long date labels are built on read, so scanning them all is slow) */
export function syncIndex(keys: readonly string[], labels: readonly string[], at: SyncPoint): number {
  const i = keys.indexOf(at.key);
  if (i >= 0 || labels.length > 1000) return i;
  return labels.indexOf(at.label);
}

/**
 * Called by charts with an x (line, area, bar, candlestick). Pointed positions are exchanged only with a syncId or ChartGrid sync.
 * keys and labels follow the events index order. This code ships only with the charts that call it (other charts' size is unchanged)
 */
export function useSync<T>(c: ChartCtx<T>, syncId: string | undefined, keys: readonly string[], labels: readonly string[]): void {
  const group = useContext(SyncContext);
  const id = syncId ?? group;
  const [self] = useState(() => ({}));
  const at = useRef({ keys, labels });
  at.current = { keys, labels };
  c.publish.current = id ? (i) => sendSync(id, i === null || at.current.keys[i] === undefined ? null : { key: at.current.keys[i], label: at.current.labels[i] }, self) : null;
  const apply = c.applySync;
  useEffect(() => {
    if (!id) return undefined;
    return joinSync(id, (p, from) => {
      if (from === self) return;
      const i = p ? syncIndex(at.current.keys, at.current.labels, p) : -1;
      apply(i < 0 ? null : i);
    });
  }, [id, self, apply]);
}
