import { toDate } from "../core/format";
import type { Accessor } from "../core/types";

/**
 * Whether the row has that field. Names inherited from Object.prototype (constructor, toString) are not fields,
 * while getters of class instances (which live on the prototype) are
 */
export function hasField(o: object, k: string): boolean {
  return Object.hasOwn(o, k) || (k in o && !(k in {}));
}

function field(d: unknown, k: string): unknown {
  if (d === null || d === undefined) return undefined;
  if (typeof d !== "object") return undefined;
  const o = d as Record<string, unknown>;
  if (hasField(o, k)) return o[k];
  if (k.includes(".")) {
    let cur: unknown = o;
    for (const p of k.split(".")) {
      if (cur === null || typeof cur !== "object" || !hasField(cur, p)) return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  }
  return undefined;
}

/**
 * Turns strings such as "1,234", "12%", "₩5,000", " 3.5 " into numbers too. NaN when unreadable ("$" and "1,2,3" too).
 * Infinity is NaN (a missing value) as well. Same rule as the string "Infinity", so it cannot break sums and ratios and put NaN in the drawing
 */
export function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const s = v.trim();
    const neg = /^\(.*\)$/.test(s);
    const body = s.replace(/[()\s%₩$€£¥원명건개회]/g, "").replace(/^\+/, "");
    // Not a number when the numeric part is empty or the thousands separators are wrong (1,2,3). Same rule as coerceCell
    if (!body || (body.includes(",") && !/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(body))) return NaN;
    const n = Number(body.replace(/,/g, ""));
    return Number.isFinite(n) ? (neg ? -n : n) : NaN;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === "boolean") return v ? 1 : 0;
  return NaN;
}

export function getter<T>(a: Accessor<T, unknown> | undefined, def: string): (d: T, i: number) => unknown {
  if (typeof a === "function") return a;
  const k = a ?? def;
  return (d) => field(d, k);
}

export function numGetter<T>(a: Accessor<T, unknown> | undefined, def: string): (d: T, i: number) => number {
  const g = getter(a, def);
  return (d, i) => toNumber(g(d, i));
}

export function strGetter<T>(a: Accessor<T, unknown> | undefined, def: string): (d: T, i: number) => string {
  const g = getter(a, def);
  return (d, i) => {
    const v = g(d, i);
    if (v === undefined || v === null) return "";
    // As a local date. toISOString is UTC, so midnight in Korea would become the previous day; shift by the time zone offset before reading
    if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    return String(v);
  };
}

export function dateGetter<T>(a: Accessor<T, unknown> | undefined, def: string): (d: T, i: number) => Date | null {
  const g = getter(a, def);
  return (d, i) => toDate(g(d, i));
}

/** Returns the field name when the accessor points to a field missing from the data (for validation) */
export function missingField<T>(a: Accessor<T, unknown> | undefined, def: string, data: readonly T[]): string | null {
  if (typeof a === "function" || !data.length) return null;
  const k = a ?? def;
  const sample = data.slice(0, 20);
  return sample.some((d) => field(d, k) !== undefined) ? null : k;
}

/** Unique values in order of first appearance */
export function uniq(xs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs)
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  return out;
}
