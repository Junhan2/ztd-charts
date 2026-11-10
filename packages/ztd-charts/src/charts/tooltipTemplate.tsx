import type { ReactNode } from "react";
import { DEFAULT_LOCALE, TEMPLATE_SLOT, formatDate, makeFormatter } from "../core/format";
import type { ChartEvent } from "../core/types";

/**
 * 스펙의 툴팁 틀(options.tooltip.template)을 툴팁 함수로 바꿔요.
 * {label}, {value}, {series}는 짚은 항목에서, 다른 {이름}은 그 행의 열에서 읽어요. 줄바꿈마다 한 줄이고,
 * 빈 칸(없는 열, null, 빈 글자, NaN, 계산한 항목이라 행이 없음)이 든 줄은 빼요. 모든 줄이 빠지면 기본 툴팁이에요.
 * 수는 차트의 기본 수 표기, 날짜는 연월일로 써요. React로 쓸 때는 tooltip={templateTooltip("…")}
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
