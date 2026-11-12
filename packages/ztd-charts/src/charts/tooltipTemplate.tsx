import type { ReactNode } from "react";
import { DEFAULT_LOCALE, TEMPLATE_SLOT, formatDate, makeFormatter } from "../core/format";
import type { ChartEvent } from "../core/types";

/**
 * Turns a spec's tooltip template (options.tooltip.template) into a tooltip function.
 * {label}, {value} and {series} come from the pointed item; any other {name} reads the row's column of that name. Each line break starts a new line,
 * and lines with an empty slot (a missing column, null, an empty string, NaN, or no row because the item is computed) are dropped. When every line is dropped, the default tooltip is used.
 * Numbers use the chart's default number format, and dates are written as year, month and day. In React, use tooltip={templateTooltip("…")}
 */
export function templateTooltip(template: string, locale: string = DEFAULT_LOCALE): (e: ChartEvent<unknown>) => ReactNode {
  const num = makeFormatter(undefined, locale);
  const lines = template.split("\n");
  const slot = (e: ChartEvent<unknown>, name: string): string | null => {
    if (name === "label") return e.label;
    if (name === "value") return e.formatted ?? (e.value === null ? null : num(e.value));
    if (name === "series") return e.series ?? null;
    const v = e.datum && typeof e.datum === "object" ? (e.datum as Record<string, unknown>)[name] : undefined;
    if (v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v))) return null;
    if (typeof v === "number") return num(v);
    return v instanceof Date ? formatDate(v, { locale, year: "numeric", month: "short", day: "numeric" }) : String(v);
  };
  return (e) => {
    const out: string[] = [];
    for (const line of lines) {
      let missing = false;
      const text = line.replace(TEMPLATE_SLOT, (_, name: string) => slot(e, name.trim()) ?? ((missing = true), ""));
      if (!missing) out.push(text);
    }
    return out.length ? out.map((text, i) => <div key={i}>{text}</div>) : null;
  };
}
