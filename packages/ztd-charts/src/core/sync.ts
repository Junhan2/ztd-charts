import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ChartCtx } from "./useChart";

/** 같은 이름으로 묶은 차트들이 짚은 x를 함께 보여 줘요. ChartGrid sync가 이 값을 내려 줘요 */
export const SyncContext = createContext<string | undefined>(undefined);

/** 짚은 자리. 키가 같은 차트끼리 맞추고, 키 꼴이 다르면(날짜 x와 글자 범주) 화면 이름표로 맞춰요 */
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

/** 받은 자리의 인덱스. 이름표로 찾는 건 1,000칸까지만 (긴 날짜 이름표는 읽을 때 만들어서 다 훑으면 느려요) */
export function syncIndex(keys: readonly string[], labels: readonly string[], at: SyncPoint): number {
  const i = keys.indexOf(at.key);
  if (i >= 0 || labels.length > 1000) return i;
  return labels.indexOf(at.label);
}

/**
 * x가 있는 차트(라인, 영역, 막대, 캔들스틱)가 불러요. syncId나 ChartGrid sync가 있을 때만 짚은 자리를 주고받아요.
 * keys, labels는 events 인덱스 순서예요. 이 코드는 부르는 차트에만 실려요 (다른 차트의 크기는 그대로)
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
