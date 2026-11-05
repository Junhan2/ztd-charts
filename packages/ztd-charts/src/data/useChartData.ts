import { useCallback, useEffect, useRef, useState } from "react";
import { langOf } from "../core/i18n";
import { useChartLocale } from "../theme/context";
import { normalizeData, parseCSV, pluck } from "./parse";

export type DataSource = string | URL | Request | ((signal: AbortSignal) => Promise<unknown> | unknown) | null | undefined;

export interface UseChartDataOptions<T> {
  /** 받은 값을 행 배열로 바꿔요. 기본은 normalizeData */
  transform?: (raw: unknown) => T[];
  /** JSON 안쪽 배열 경로. 예: "data.items" */
  select?: string;
  /** "auto"면 content-type과 확장자로 판단. 기본 "auto" */
  parse?: "auto" | "json" | "csv" | "text";
  /** 주기적으로 다시 가져오기(ms) */
  refreshMs?: number;
  /** fetch 옵션 (헤더, 인증 등) */
  init?: RequestInit;
  /** false면 가져오지 않아요 */
  enabled?: boolean;
  /** 다시 가져오는 동안 이전 데이터를 유지. 기본 true */
  keepPrevious?: boolean;
  /** 바뀌면 다시 가져와요 (함수 소스의 의존 값) */
  deps?: readonly unknown[];
  /** 오류 문구의 로캘. "ko"면 한국어. useChartData는 없으면 ThemeProvider의 locale, 그다음 "en-US"이고 fetchChartData는 영어예요 */
  locale?: string;
}

export type ChartDataStatus = "idle" | "loading" | "success" | "error";

export interface ChartDataState<T> {
  data: T[];
  status: ChartDataStatus;
  loading: boolean;
  error: Error | null;
  /** 불러왔는데 행이 0개 */
  empty: boolean;
  /** 마지막으로 성공한 시각 */
  updatedAt: number | null;
  reload: () => void;
}

/** 응답 본문을 형식에 맞게 읽어요 */
export async function readResponse(res: Response, mode: "auto" | "json" | "csv" | "text" = "auto", url = "", locale?: string): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (mode === "text") return text;
  // 정적 호스팅은 없는 파일에도 200과 index.html을 돌려주곤 해요. CSV로 읽으면 엉뚱한 표가 돼요
  if (ct.includes("text/html") || /^\s*<(!doctype html|html[\s>])/i.test(text)) {
    throw new Error(langOf(locale) === "ko" ? `데이터 대신 HTML 페이지를 받았어요. 주소를 확인해 주세요${url ? `: ${url}` : "."}` : `Got an HTML page instead of data${url ? ` (${url})` : ""}. Check the URL.`);
  }
  if (mode === "csv") return parseCSV(text);
  // JSON이라고 알려 준 응답은 주소에 csv가 있어도(/api/csv, ?format=csv) JSON으로 읽어요
  if (mode === "json" || ct.includes("json")) return JSON.parse(text);
  if (ct.includes("csv") || /[./]csv(\?|#|$)|output=csv|format=csv|tqx=out:csv/i.test(url)) return parseCSV(text);
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
  return parseCSV(text);
}

/** URL이나 소스에서 데이터를 한 번 가져와요 (훅 없이) */
export async function fetchChartData<T = Record<string, unknown>>(source: Exclude<DataSource, null | undefined>, options: Omit<UseChartDataOptions<T>, "refreshMs" | "enabled" | "keepPrevious" | "deps"> & { signal?: AbortSignal } = {}): Promise<T[]> {
  const signal = options.signal ?? new AbortController().signal;
  let raw: unknown;
  if (typeof source === "function") raw = await source(signal);
  else {
    const url = source instanceof Request ? source.url : String(source);
    // 본문이 있는 Request는 한 번 읽으면 끝나서, 다시 불러올 때마다 복사본을 보내요
    const res = await fetch(source instanceof Request ? source.clone() : url, { ...options.init, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
    raw = await readResponse(res, options.parse, url, options.locale);
  }
  if (options.select) raw = pluck(raw, options.select);
  return (options.transform ? options.transform(raw) : normalizeData(raw)) as T[];
}

/**
 * URL(JSON, CSV) 또는 비동기 함수에서 데이터를 가져와요.
 * 로딩, 오류, 빈 데이터 상태와 다시 불러오기를 함께 돌려줘요.
 */
export function useChartData<T = Record<string, unknown>>(source: DataSource, options: UseChartDataOptions<T> = {}): ChartDataState<T> {
  const { refreshMs, enabled = true, keepPrevious = true } = options;
  const [state, setState] = useState<{ data: T[]; status: ChartDataStatus; error: Error | null; updatedAt: number | null }>(() => ({
    data: [],
    status: source && enabled ? "loading" : "idle",
    error: null,
    updatedAt: null,
  }));
  const [tick, setTick] = useState(0);
  // 오류 문구는 옵션, ThemeProvider, 기본 로캘 순서로 정한 언어로
  const locale = useChartLocale(options.locale);
  const opt = useRef(options);
  opt.current = { ...options, locale };
  const src = useRef(source);
  src.current = source;
  const key = typeof source === "function" ? "fn" : source instanceof Request ? source.url : source ? String(source) : "";
  const deps = options.deps ?? [];
  const depKey = JSON.stringify(deps.map((d) => (typeof d === "object" ? JSON.stringify(d) : String(d))));

  useEffect(() => {
    const s = src.current;
    // 가져오는 중에 꺼지거나 소스가 없어지면 앞 요청은 취소됐어요. loading에 머물지 않게 idle로
    if (!s || !enabled) {
      setState((prev) => (prev.status === "loading" ? { ...prev, status: "idle" } : prev));
      return undefined;
    }
    const ctrl = new AbortController();
    let alive = true;
    setState((prev) => ({ ...prev, data: keepPrevious ? prev.data : [], status: "loading", error: null }));
    fetchChartData<T>(s, { ...opt.current, signal: ctrl.signal })
      .then((data) => {
        if (alive) setState({ data, status: "success", error: null, updatedAt: Date.now() });
      })
      .catch((e: unknown) => {
        if (!alive || ctrl.signal.aborted) return;
        setState((prev) => ({ ...prev, status: "error", error: e instanceof Error ? e : new Error(String(e)) }));
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [key, enabled, tick, depKey, keepPrevious]);

  useEffect(() => {
    if (!refreshMs || !enabled) return undefined;
    const id = setInterval(() => setTick((v) => v + 1), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, enabled]);

  const reload = useCallback(() => setTick((v) => v + 1), []);
  return {
    data: state.data,
    status: state.status,
    loading: state.status === "loading",
    error: state.error,
    empty: state.status === "success" && state.data.length === 0,
    updatedAt: state.updatedAt,
    reload,
  };
}
