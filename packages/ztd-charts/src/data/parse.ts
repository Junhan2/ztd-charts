import { toNumber } from "./accessor";

export type Cell = string | number | null;
export type CsvRow = Record<string, Cell>;

export interface ParseCSVOptions {
  /** 구분자. 없으면 첫 줄을 보고 , \t ; 중에서 골라요 */
  delimiter?: string;
  /** 숫자처럼 보이는 칸을 number로. 기본 true */
  typed?: boolean;
  /** 첫 줄이 머리글. 기본 true */
  header?: boolean;
}

function detectDelimiter(src: string): string {
  const firstLine: string[] = [];
  let q = false;
  for (let i = 0; i < src.length && i < 4000; i++) {
    const c = src[i];
    if (c === '"') q = !q;
    else if (!q && (c === "\n" || c === "\r")) break;
    firstLine.push(q ? "" : c);
  }
  const line = firstLine.join("");
  const count = (d: string) => line.split(d).length - 1;
  const cands = [",", "\t", ";", "|"];
  let best = ",";
  let bc = 0;
  for (const d of cands) {
    const c = count(d);
    if (c > bc) {
      bc = c;
      best = d;
    }
  }
  return best;
}

const NUMERIC = /^[-+(]?[₩$€£¥]?\s?\d[\d,]*(\.\d+)?([eE][-+]?\d+)?\)?\s?(%|원|명|건|개|회)?$/;

/** 문자열 칸 하나를 타입 있는 값으로 */
export function coerceCell(s: string): Cell {
  const t = s.trim();
  if (t === "") return null;
  // 앞자리 0이 있는 코드(우편번호 등)는 문자열로 둬요
  if (/^-?0\d/.test(t)) return t;
  if (NUMERIC.test(t) || /^[-+]?\.\d+$/.test(t)) {
    // 천 단위 쉼표가 틀리면(1,2,3) toNumber가 NaN이라 글자로 남아요
    const n = toNumber(t);
    if (Number.isFinite(n)) return n;
  }
  return t;
}

/** RFC 4180 CSV 파서. 따옴표, 칸 안 줄바꿈, BOM, CRLF를 지원해요 */
export function parseCSV(text: string, options: ParseCSVOptions = {}): CsvRow[] {
  const { typed = true, header = true } = options;
  const src = text.replace(/^\uFEFF/, "");
  if (!src.trim()) return [];
  const delim = options.delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"' && !cell.trim()) {
      // 칸 처음의 따옴표는 앞 공백(a, "b, c")이 있어도 따옴표 칸이에요
      q = true;
      cell = "";
    }
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const clean = rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  if (!clean.length) return [];
  const conv = (s: string): Cell => (typed ? coerceCell(s) : s);
  if (!header) return clean.map((r) => Object.fromEntries(r.map((v, i) => [String(i), conv(v)])));
  const keys: string[] = [];
  const used = new Set<string>();
  clean[0].forEach((k, i) => {
    const base = k.trim() || `col${i + 1}`;
    let name = base;
    // 겹치면 _2, _3 … 중 아직 없는 이름 (a,a,a_2가 a_2 둘이 되어 열을 잃지 않게)
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    keys.push(name);
  });
  return clean.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, conv(r[i] ?? "")])));
}

/** 객체 배열을 CSV 문자열로 */
export function toCSV(rows: readonly Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(esc).join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

/**
 * 2차원 배열을 객체 배열로. 첫 줄이 머리글이에요.
 * Google Sheets API(values), SQL 결과(rows + fields) 같은 모양에 써요.
 */
export function fromRows(rows: readonly (readonly unknown[])[], columns?: readonly string[], options: { typed?: boolean } = {}): Record<string, unknown>[] {
  if (!rows.length) return [];
  const { typed = true } = options;
  const head = (columns ?? rows[0]).map((k, i) => String(k ?? "").trim() || `col${i + 1}`);
  const body = columns ? rows : rows.slice(1);
  return body.map((r) => Object.fromEntries(head.map((k, i) => [k, typed && typeof r[i] === "string" ? coerceCell(r[i] as string) : r[i] ?? null])));
}

/**
 * 객체를 객체 배열로.
 * - { "1월": 10, "2월": 12 } -> [{ label: "1월", value: 10 }, ...]
 * - { 월: ["1월","2월"], 매출: [10,12] } (열 모음) -> [{ 월: "1월", 매출: 10 }, ...]
 */
export function fromObjects(obj: Record<string, unknown>, options: { labelKey?: string; valueKey?: string } = {}): Record<string, unknown>[] {
  const { labelKey = "label", valueKey = "value" } = options;
  const vals = Object.values(obj);
  if (vals.length && vals.every((v) => Array.isArray(v))) {
    const cols = Object.keys(obj);
    const n = Math.max(...vals.map((v) => (v as unknown[]).length));
    return Array.from({ length: n }, (_, i) => Object.fromEntries(cols.map((c) => [c, (obj[c] as unknown[])[i] ?? null])));
  }
  return Object.entries(obj).map(([k, v]) => ({ [labelKey]: k, [valueKey]: v }));
}

/** 넓은 표(열마다 계열)를 긴 표(series, value)로 */
export function melt(rows: readonly Record<string, unknown>[], idKeys: readonly string[], options: { seriesKey?: string; valueKey?: string; valueKeys?: readonly string[] } = {}): Record<string, unknown>[] {
  const { seriesKey = "series", valueKey = "value" } = options;
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const keys = options.valueKeys ?? Object.keys(r).filter((k) => !idKeys.includes(k));
    const base = Object.fromEntries(idKeys.map((id) => [id, r[id]]));
    for (const k of keys) out.push({ ...base, [seriesKey]: k, [valueKey]: r[k] });
  }
  return out;
}

/** 경로("data.items")로 안쪽 배열 꺼내기 */
export function pluck(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split(".").filter(Boolean)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * 아무 모양의 입력을 객체 배열로.
 * CSV 문자열, JSON 문자열, 2차원 배열, 숫자 배열, 객체 배열,
 * { data: [...] }, { rows, columns }, { values: [[...]] }(Google Sheets), 키-값 맵
 */
export function normalizeData(input: unknown): Record<string, unknown>[] {
  if (input === null || input === undefined) return [];
  if (typeof input === "string") {
    const s = input.trim();
    if (!s) return [];
    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        return normalizeData(JSON.parse(s));
      } catch {
        /* CSV로 읽어요 */
      }
    }
    return parseCSV(s);
  }
  if (Array.isArray(input)) {
    if (!input.length) return [];
    if (Array.isArray(input[0])) return fromRows(input as unknown[][]);
    if (typeof input[0] === "number") return (input as number[]).map((v, i) => ({ label: String(i + 1), value: v }));
    return input.filter((r) => r && typeof r === "object") as Record<string, unknown>[];
  }
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (Array.isArray(o.data)) return normalizeData(o.data);
    if (Array.isArray(o.rows) && Array.isArray(o.columns)) return fromRows(o.rows as unknown[][], (o.columns as unknown[]).map((c) => (typeof c === "object" && c && "name" in c ? String((c as { name: unknown }).name) : String(c))));
    if (Array.isArray(o.rows) && Array.isArray(o.fields)) return normalizeData(o.rows);
    if (Array.isArray(o.rows)) return normalizeData(o.rows);
    if (Array.isArray(o.values)) return fromRows(o.values as unknown[][]);
    if (Array.isArray(o.items)) return normalizeData(o.items);
    if (Array.isArray(o.results)) return normalizeData(o.results);
    return fromObjects(o);
  }
  return [];
}

/** 데이터 변경 감지용 서명. 큰 배열은 표본만 봐요 */
export function dataSignature(data: unknown): string {
  if (!Array.isArray(data)) {
    try {
      return JSON.stringify(data ?? null) ?? "";
    } catch {
      return String(data);
    }
  }
  const n = data.length;
  const safe = (v: unknown) => {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  if (n <= 300) return safe(data);
  const step = Math.ceil(n / 60);
  const sample: unknown[] = [];
  for (let i = 0; i < n; i += step) sample.push(data[i]);
  sample.push(data[n - 1]);
  return `${n}:${safe(sample)}`;
}

/** Largest-Triangle-Three-Buckets. 선 모양을 지키면서 점 수를 줄여요 */
export function lttb<P extends { x: number; y: number }>(pts: readonly P[], threshold: number): P[] {
  const n = pts.length;
  if (threshold >= n || threshold < 3) return pts.slice();
  const out: P[] = [pts[0]];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const s = Math.floor((i + 1) * every) + 1;
    const e = Math.min(Math.floor((i + 2) * every) + 1, n);
    let ax = 0;
    let ay = 0;
    for (let j = s; j < e; j++) {
      ax += pts[j].x;
      ay += pts[j].y;
    }
    const len = Math.max(1, e - s);
    ax /= len;
    ay /= len;
    const rs = Math.floor(i * every) + 1;
    const re = Math.floor((i + 1) * every) + 1;
    let best = rs;
    let max = -1;
    for (let j = rs; j < re; j++) {
      const area = Math.abs((pts[a].x - ax) * (pts[j].y - pts[a].y) - (pts[a].x - pts[j].x) * (ay - pts[a].y));
      if (area > max) {
        max = area;
        best = j;
      }
    }
    out.push(pts[best]);
    a = best;
  }
  out.push(pts[n - 1]);
  return out;
}
