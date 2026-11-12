import { useCallback, useEffect, useRef, useState } from "react";
import { langOf } from "../core/i18n";
import { useChartLocale } from "../theme/context";
import { normalizeData, parseCSV, pluck } from "./parse";

export type DataSource = string | URL | Request | ((signal: AbortSignal) => Promise<unknown> | unknown) | null | undefined;

export interface UseChartDataOptions<T> {
  /** Turns the received value into an array of rows. Default normalizeData */
  transform?: (raw: unknown) => T[];
  /** Path to a nested array in the JSON. Example: "data.items" */
  select?: string;
  /** "auto" decides from content-type and the extension. Default "auto" */
  parse?: "auto" | "json" | "csv" | "text";
  /** Refetch periodically (ms) */
  refreshMs?: number;
  /** fetch options (headers, auth and so on) */
  init?: RequestInit;
  /** When false, nothing is fetched */
  enabled?: boolean;
  /** Keeps the previous data while refetching. Default true */
  keepPrevious?: boolean;
  /** Refetches when these change (dependencies of a function source) */
  deps?: readonly unknown[];
  /** Locale of error messages. "ko" gives Korean. When omitted, useChartData uses the ThemeProvider's locale, then "en-US"; fetchChartData uses English */
  locale?: string;
}

export type ChartDataStatus = "idle" | "loading" | "success" | "error";

export interface ChartDataState<T> {
  data: T[];
  status: ChartDataStatus;
  loading: boolean;
  error: Error | null;
  /** Loaded, but with 0 rows */
  empty: boolean;
  /** Time of the last successful fetch */
  updatedAt: number | null;
  reload: () => void;
}

/** Reads the response body according to its format */
export async function readResponse(res: Response, mode: "auto" | "json" | "csv" | "text" = "auto", url = "", locale?: string): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (mode === "text") return text;
  // Static hosting often returns 200 and index.html even for a missing file. Read as CSV, it becomes a nonsense table
  if (ct.includes("text/html") || /^\s*<(!doctype html|html[\s>])/i.test(text)) {
    throw new Error(langOf(locale) === "ko" ? `데이터 대신 HTML 페이지를 받았어요. 주소를 확인해 주세요${url ? `: ${url}` : "."}` : `Got an HTML page instead of data${url ? ` (${url})` : ""}. Check the URL.`);
  }
  if (mode === "csv") return parseCSV(text);
  // A response declared as JSON is read as JSON even when the URL contains csv (/api/csv, ?format=csv)
  if (mode === "json" || ct.includes("json")) return JSON.parse(text);
  if (ct.includes("csv") || /[./]csv(\?|#|$)|output=csv|format=csv|tqx=out:csv/i.test(url)) return parseCSV(text);
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
  return parseCSV(text);
}

/** Fetches data once from a URL or source (without a hook) */
export async function fetchChartData<T = Record<string, unknown>>(source: Exclude<DataSource, null | undefined>, options: Omit<UseChartDataOptions<T>, "refreshMs" | "enabled" | "keepPrevious" | "deps"> & { signal?: AbortSignal } = {}): Promise<T[]> {
  const signal = options.signal ?? new AbortController().signal;
  let raw: unknown;
  if (typeof source === "function") raw = await source(signal);
  else {
    const url = source instanceof Request ? source.url : String(source);
    // A Request with a body can be read only once, so each reload sends a clone
    const res = await fetch(source instanceof Request ? source.clone() : url, { ...options.init, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
    raw = await readResponse(res, options.parse, url, options.locale);
  }
  if (options.select) raw = pluck(raw, options.select);
  return (options.transform ? options.transform(raw) : normalizeData(raw)) as T[];
}

/**
 * Fetches data from a URL (JSON, CSV) or an async function.
 * Returns the loading, error and empty-data states along with a reload.
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
  // Error messages use the language set by the option, then ThemeProvider, then the default locale
  const locale = useChartLocale(options.locale);
  const opt = useRef(options);
  opt.current = { ...options, locale };
  const src = useRef(source);
  src.current = source;
  const key = typeof source === "function" ? "fn" : source instanceof Request ? source.url : source ? String(source) : "";
  const deps = options.deps ?? [];
  const depKey = JSON.stringify(deps.map((d) => (typeof d === "object" ? JSON.stringify(d) : String(d))));
  const inFlight = useRef(false);

  useEffect(() => {
    const s = src.current;
    // If fetching is turned off or the source goes away mid-fetch, the earlier request was canceled. Go to idle so the state does not stay at loading
    if (!s || !enabled) {
      setState((prev) => (prev.status === "loading" ? { ...prev, status: "idle" } : prev));
      return undefined;
    }
    const ctrl = new AbortController();
    let alive = true;
    inFlight.current = true;
    setState((prev) => ({ ...prev, data: keepPrevious ? prev.data : [], status: "loading", error: null }));
    fetchChartData<T>(s, { ...opt.current, signal: ctrl.signal })
      .then((data) => {
        if (alive) setState({ data, status: "success", error: null, updatedAt: Date.now() });
      })
      .catch((e: unknown) => {
        if (!alive || ctrl.signal.aborted) return;
        setState((prev) => ({ ...prev, status: "error", error: e instanceof Error ? e : new Error(String(e)) }));
      })
      .finally(() => {
        if (alive) inFlight.current = false;
      });
    return () => {
      alive = false;
      inFlight.current = false;
      ctrl.abort();
    };
  }, [key, enabled, tick, depKey, keepPrevious]);

  useEffect(() => {
    if (!refreshMs || !enabled) return undefined;
    // If responses are slower than refreshMs, each tick would cancel the previous request and data would never arrive. Skip this tick while a fetch is in progress
    const id = setInterval(() => {
      if (!inFlight.current) setTick((v) => v + 1);
    }, refreshMs);
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
