import type { Painter } from "../theme/context";
import { Txt } from "./ChartFrame";
import { formatNumber, type ValueFormatter } from "./format";
import { textWidth } from "./text";

export const AXIS_FONT = 10.5;

/** 눈금 글자. 짧게 줄인 글자가 겹치면(10만, 10만, 10.1만) 그 축만 전체 숫자로 써요. locale은 그때 쓰는 로캘(차트의 c.locale) */
export function tickLabels(ticks: readonly number[], fmt: ValueFormatter, locale?: string): string[] {
  const out = ticks.map(fmt);
  if (new Set(out).size === out.length) return out;
  return ticks.map((t) => formatNumber(t, { locale, maximumFractionDigits: 2 }));
}

export function yAxisWidth(ticks: number[], fmt: ValueFormatter, locale?: string): number {
  let w = 18;
  for (const l of tickLabels(ticks, fmt, locale)) w = Math.max(w, textWidth(l, AXIS_FONT));
  return Math.ceil(w + 8);
}

export function GridY(props: { p: Painter; ticks: number[]; y: (v: number) => number; x0: number; x1: number; fmt: ValueFormatter; labels?: boolean; zero?: boolean; opacity?: number; side?: "left" | "right"; locale?: string }) {
  const { p, ticks, y, x0, x1, fmt } = props;
  const right = props.side === "right";
  const labels = props.labels === false ? null : tickLabels(ticks, fmt, props.locale);
  return (
    <g aria-hidden="true" opacity={props.opacity}>
      {ticks.map((t, i) => {
        const yy = Math.round(y(t)) + 0.5;
        const zero = t === 0 && props.zero !== false;
        return (
          <g key={t}>
            <line x1={x0} x2={x1} y1={yy} y2={yy} stroke={p.paint(zero ? "dim" : "line")} strokeWidth={1} shapeRendering="crispEdges" opacity={zero ? 0.7 : 1} />
            {labels ? (
              <Txt x={right ? x1 + 6 : x0 - 6} y={yy} anchor={right ? "start" : "end"} size={AXIS_FONT} fill={p.paint("muted")}>
                {labels[i]}
              </Txt>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/** 가운데 정렬 x 눈금 글자 중 앞 글자와 8px 안으로 붙거나 [lo, hi] 밖으로 나가는 것을 빼요 */
export function fitTickLabels<T extends { x: number; label: string }>(ticks: readonly T[], lo: number, hi: number): T[] {
  const keep: T[] = [];
  let lastR = -Infinity;
  for (const t of ticks) {
    const w = textWidth(t.label, AXIS_FONT);
    const l = Math.max(t.x - w / 2, 0);
    if (l < lastR + 8 || t.x - w / 2 < lo || t.x + w / 2 > hi) continue;
    keep.push(t);
    lastR = l + w;
  }
  return keep;
}

/**
 * 칸 라벨을 겹치지 않게 솎아요. 보여줄 인덱스 목록.
 * keep(폭포 차트의 합계, 강조 항목)은 늘 남기고 나머지를 그 둘레에서 솎아요
 */
export function thinLabels(centers: number[], labels: string[], size = AXIS_FONT, gap = 8, weight = 400, keep?: ReadonlySet<number>): number[] {
  const n = labels.length;
  if (n <= 1) return labels.map((_, i) => i);
  const widths = labels.map((l) => textWidth(l, size, weight));
  const near = (a: number, b: number) => Math.abs(centers[b] - centers[a]) < (widths[a] + widths[b]) / 2 + gap;
  // keep 끼리 겹치면 앞의 것만 남겨요. 겹친 채로 두면 어떤 간격으로도 풀리지 않아 keep 까지 모두 버려졌어요
  const must: number[] = [];
  for (const k of keep ?? []) if (!must.some((m) => near(m, k))) must.push(k);
  const free = (i: number) => !must.some((m) => near(m, i));
  for (let step = 1; step <= n; step++) {
    const idx = must.slice();
    for (let i = 0; i < n; i += step) if (free(i)) idx.push(i);
    if (step > 1 && (n - 1) % step > step / 2 && free(n - 1)) idx.push(n - 1);
    idx.sort((a, b) => a - b);
    if (idx.every((b, k) => !k || !near(idx[k - 1], b))) return idx;
  }
  return [0, n - 1];
}

export function AxisXBand(props: {
  p: Painter;
  labels: string[];
  centers: number[];
  y: number;
  strong?: ReadonlySet<number>;
  sub?: string[];
  size?: number;
  maxWidth?: number;
}) {
  const { p, labels, centers, y } = props;
  const size = props.size ?? AXIS_FONT;
  const show = thinLabels(centers, labels, size, 6, 600, props.strong);
  return (
    <g aria-hidden="true">
      {show.map((i) => {
        const strong = props.strong?.has(i);
        return (
          <g key={i}>
            <Txt x={centers[i]} y={y} anchor="middle" size={size} weight={strong ? 700 : 500} fill={p.paint(strong ? "ink" : "muted")}>
              {labels[i]}
            </Txt>
            {props.sub?.[i] ? (
              <Txt x={centers[i]} y={y + size + 3} anchor="middle" size={size - 1} fill={p.paint("muted")}>
                {props.sub[i]}
              </Txt>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}
