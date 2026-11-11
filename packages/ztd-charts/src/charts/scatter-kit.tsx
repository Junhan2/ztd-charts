import { Tag, tagBox } from "../core/annotations";
import { Txt } from "../core/ChartFrame";
import { argMin, linearFit, type LinearFit } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import { canvasColor, categoricalDots, type Swatch } from "../core/palette";
import { overlaps, textWidth, truncate, type Box } from "../core/text";
import type { Highlight } from "../core/types";
import { uniq } from "../data/accessor";
import type { Painter } from "../theme/context";
import { HEX_KIT } from "./scatter-hex";

/*
 * 산점도만 쓰는 계산, 글, 그리기. bubble.tsx의 ScatterChart만 이 묶음(SCATTER_KIT)을 넘겨서
 * BubbleChart만 가져오는 번들에는 들어가지 않아요. 점과 축을 그리는 본체는 bubble.tsx의 PointChart를 같이 써요
 */

const en = {
  /** 계열마다 점 수. 예: " 3 series: Large 18 points, Small 9 points." */
  seriesCounts: (list: [string, number][]) => ` ${plural(list.length, "series", "series")}: ${list.map(([s, k]) => `${s} ${plural(k, "point")}`).join(", ")}.`,
  /** 상관 방향. sign이 1이면 오름, -1이면 내림, 0이면 뚜렷하지 않음 */
  trend: (sign: number, x: string, y: string, r2: string) =>
    sign > 0 ? ` ${y} rises as ${x} rises, R² ${r2}.` : sign < 0 ? ` ${y} falls as ${x} rises, R² ${r2}.` : ` No clear straight-line relationship between ${x} and ${y}, R² ${r2}.`,
  refs: (parts: string[]) => ` Reference ${parts.length > 1 ? "lines" : "line"} at ${parts.join(" and ")}.`,
  quadrants: (list: [string, number][]) => ` Quadrants: ${list.map(([q, k]) => `${q} ${k}`).join("; ")}.`,
  slope: "Trend slope",
  trendTag: "Trend",
  /** 고정 범위(xDomain, yDomain) 안에 점이 하나도 없을 때 */
  outOfRange: "No points in this range.",
};
const TEXT: Record<ChartLang, typeof en> = {
  en,
  ko: {
    seriesCounts: (list) => ` 계열 ${list.length}개: ${list.map(([s, k]) => `${s} ${k}개`).join(", ")}.`,
    // 축 이름 뒤에 "값"을 붙여서 조사가 이름 끝 글자에 따라 틀어지지 않아요
    trend: (sign, x, y, r2) =>
      sign > 0 ? ` ${x} 값이 클수록 ${y} 값도 커요(R² ${r2}).` : sign < 0 ? ` ${x} 값이 클수록 ${y} 값은 작아요(R² ${r2}).` : ` ${x} 값과 ${y} 값 사이에 뚜렷한 직선 관계가 없어요(R² ${r2}).`,
    refs: (parts) => ` 기준선 ${parts.join(", ")}.`,
    quadrants: (list) => ` 사분면: ${list.map(([q, k]) => `${q} ${k}개`).join(", ")}.`,
    slope: "추세 기울기",
    trendTag: "추세",
    outOfRange: "이 범위에는 점이 없어요.",
  },
};

/** 그림 영역: 축 안쪽 */
export interface PlotBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 사분면 이름표 하나 */
export interface PlacedTag {
  text: string;
  x: number;
  y: number;
  anchor: "start" | "end";
  box: Box;
}

/** 계열 이름표: 색 점과 계열 이름. y는 줄 가운데예요 */
export interface SeriesLabel {
  si: number;
  y: number;
  box: Box;
}

/** PointChart의 점 하나 (화면 좌표). si는 계열 순번이고 계열이 없으면 -1 */
interface DotAt {
  x: number;
  y: number;
  r: number;
  hi: boolean;
  si: number;
}

/** 화살표 키의 화면 방향(아래가 +y). 화살표가 아니면 null */
function arrowStep(key: string): readonly [number, number] | null {
  switch (key) {
    case "ArrowRight":
      return [1, 0];
    case "ArrowLeft":
      return [-1, 0];
    case "ArrowDown":
      return [0, 1];
    case "ArrowUp":
      return [0, -1];
    default:
      return null;
  }
}

/**
 * 화살표 방향의 가장 가까운 점. from에서 그 방향 반평면(오른쪽 키면 x가 더 큰 쪽) 안의 점만 보고 픽셀 거리가 가장 짧은 점을 골라요.
 * 같은 자리에 겹친 점은 오른쪽, 아래 키로 뒤 번호, 왼쪽, 위 키로 앞 번호로 가요. 그 방향에 점이 없으면 null
 */
export function nearestInDirection(pts: readonly { x: number; y: number }[], from: number, step: readonly [number, number]): number | null {
  const o = pts[from];
  const forward = step[0] + step[1] > 0;
  let best: number | null = null;
  let bd = Infinity;
  for (let k = 0; k < pts.length; k++) {
    if (k === from) continue;
    const dx = pts[k].x - o.x;
    const dy = pts[k].y - o.y;
    const ahead = dx * step[0] + dy * step[1] > 0 || (dx === 0 && dy === 0 && (forward ? k > from : k < from));
    if (!ahead) continue;
    const d = dx * dx + dy * dy;
    if (d < bd || (d === bd && best !== null && Math.abs(k - from) < Math.abs(best - from))) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** 첫 화살표 키가 갈 점: 강조 점(없으면 모든 점) 가운데 키 반대쪽 끝. 오른쪽 키면 가장 왼쪽 점에서 시작해요 */
function entryPoint(pts: readonly DotAt[], step: readonly [number, number]): number | null {
  const anyHi = pts.some((q) => q.hi);
  const k = argMin(pts.map((q) => (anyHi && !q.hi ? Infinity : q.x * step[0] + q.y * step[1])));
  return k < 0 ? null : k;
}

/** 씨앗과 행 번호로 정한 0 이상 1 미만 값. Math.random을 쓰지 않아 서버와 브라우저, 몇 번을 그려도 같아요 */
function seededUnit(seed: number, i: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 서로 다른 x 값 사이 가장 좁은 간격. 값이 모두 같으면 1 */
function smallestGap(xs: readonly number[]): number {
  const s = [...new Set(xs)].sort((a, b) => a - b);
  let g = Infinity;
  for (let k = 1; k < s.length; k++) g = Math.min(g, s[k] - s[k - 1]);
  return Number.isFinite(g) ? g : 1;
}

/** 계열 강조. 이름, 인덱스, 배열, "first"(기본)는 계열로 찾고, 판별 함수는 그 계열의 행 하나라도 맞으면 그 계열을 강조해요. 카드 범례(autoLegend)도 이걸 써요 */
export function seriesHighlight<T>(h: Highlight<T> | undefined, data: readonly T[], names: readonly string[], seriesOf: (d: T, i: number) => string): Set<number> {
  if (typeof h !== "function") return resolveHighlight(h, names, names, names.map(() => 0), "first");
  const index = new Map(names.map((s, k) => [s, k]));
  const out = new Set<number>();
  data.forEach((d, i) => {
    const k = index.get(seriesOf(d, i));
    if (k !== undefined && h(d, i)) out.add(k);
  });
  return out;
}

/** 추세선의 데이터 끝점 [x0, y0, x1, y1]. 점의 x 범위에서 그리고 y 축 범위 밖은 잘라요. 남는 선이 없으면 null */
function fitSegment(fit: LinearFit, x0: number, x1: number, [ylo, yhi]: readonly [number, number]): [number, number, number, number] | null {
  let a = x0;
  let b = x1;
  if (fit.slope) {
    const xa = x0 + (ylo - fit.at(x0)) / fit.slope;
    const xb = x0 + (yhi - fit.at(x0)) / fit.slope;
    a = Math.max(a, Math.min(xa, xb));
    b = Math.min(b, Math.max(xa, xb));
  } else if (fit.at(x0) < ylo || fit.at(x0) > yhi) return null;
  return b > a ? [a, fit.at(a), b, fit.at(b)] : null;
}

/**
 * 추세선 이름표 자리: 오른쪽 끝 위, 오른쪽 끝 아래, 왼쪽 끝 위, 왼쪽 끝 아래 순서로 avoid(사분면 이름)와 겹치지 않는 첫 자리.
 * 이름표 바깥 끝을 선 끝보다 2px 더 나가게 둬요. 선이 그림 위쪽 끝에서 끝나 이름표가 선 옆으로 내려와도 선 끝이 이름표 밖으로 삐져나오지 않아요
 */
function fitTagSpot(line: { x1: number; y1: number; x2: number; y2: number }, text: string, avoid: readonly Box[], b: PlotBox): { x: number; y: number; anchor: "start" | "end" } {
  const clampY = (v: number) => Math.max(b.y0 + 9, Math.min(b.y1 - 9, v));
  const tries: { x: number; y: number; anchor: "start" | "end" }[] = [
    { x: line.x2 + 2, y: clampY(line.y2 - 11), anchor: "end" },
    { x: line.x2 + 2, y: clampY(line.y2 + 11), anchor: "end" },
    { x: line.x1 - 2, y: clampY(line.y1 - 11), anchor: "start" },
    { x: line.x1 - 2, y: clampY(line.y1 + 11), anchor: "start" },
  ];
  return tries.find((t) => !avoid.some((q) => overlaps(q, tagBox(text, t.x, t.y, t.anchor), 2))) ?? tries[0];
}

/** 사분면 이름표: 위 두 칸은 그림 위쪽, 아래 두 칸은 가로 기준선 바로 아래의 바깥 모서리에 붙여요. 칸이 좁으면 줄이거나 빼요 */
function quadrantTags(names: readonly string[], xr: number, yr: number, b: PlotBox): PlacedTag[] {
  const cells: { x: number; y: number; w: number; h: number; anchor: "start" | "end" }[] = [
    { x: b.x0 + 4, y: b.y0 + 10, w: xr - b.x0, h: yr - b.y0, anchor: "start" },
    { x: b.x1 - 4, y: b.y0 + 10, w: b.x1 - xr, h: yr - b.y0, anchor: "end" },
    { x: b.x0 + 4, y: yr + 10, w: xr - b.x0, h: b.y1 - yr, anchor: "start" },
    { x: b.x1 - 4, y: yr + 10, w: b.x1 - xr, h: b.y1 - yr, anchor: "end" },
  ];
  const out: PlacedTag[] = [];
  cells.forEach((q, k) => {
    const name = names[k];
    if (!name || q.h < 22 || q.w < 40) return;
    const text = truncate(name, q.w - 16, 10.5, 500);
    out.push({ text, x: q.x, y: q.y, anchor: q.anchor, box: tagBox(text, q.x, q.y, q.anchor) });
  });
  return out;
}

/** 계열 이름표 한 줄: 색 점 + 4px + 글자 */
const SERIES_LABEL_SIZE = 11;
const seriesLabelWeight = (hi: boolean) => (hi ? 700 : 600);

/**
 * 계열 이름표 자리: 무게중심에 가까운 실제 점부터 그 옆(오른쪽, 왼쪽, 위, 아래)에서 점, 자리 잡아 둔 상자, 다른 이름표, 그림 밖과 겹치지 않는 첫 자리.
 * 빈 곳에 색 점과 이름을 띄우면 없는 데이터처럼 보여서, 이름은 그 계열의 실제 점 바로 옆에 붙여요.
 * 보이는 계열이 4개를 넘거나 자리가 없으면 빼요 (범례와 툴팁에 이름이 있어요)
 */
function placeSeriesLabels(
  dots: readonly DotAt[],
  names: readonly string[],
  hiSeries: ReadonlySet<number>,
  around: { box: PlotBox; reserved: readonly Box[]; grid: { g: Map<string, number[]>; cell: number } },
): SeriesLabel[] {
  const sums = names.map(() => ({ x: 0, y: 0, n: 0 }));
  for (const d of dots) {
    const s = sums[d.si];
    if (!s) continue;
    s.x += d.x;
    s.y += d.y;
    s.n++;
  }
  if (sums.filter((s) => s.n).length > 4) return [];
  const { box, reserved, grid } = around;
  const isFree = (b: Box) => {
    if (b.x < box.x0 + 2 || b.x + b.w > box.x1 - 2 || b.y < box.y0 || b.y + b.h > box.y1 - 2) return false;
    if (reserved.some((q) => overlaps(q, b, 2))) return false;
    for (let gx = Math.floor(b.x / grid.cell); gx <= Math.floor((b.x + b.w) / grid.cell); gx++)
      for (let gy = Math.floor(b.y / grid.cell); gy <= Math.floor((b.y + b.h) / grid.cell); gy++)
        for (const k of grid.g.get(`${gx},${gy}`) ?? []) {
          const d = dots[k];
          const nx = Math.max(b.x, Math.min(d.x, b.x + b.w));
          const ny = Math.max(b.y, Math.min(d.y, b.y + b.h));
          if (Math.hypot(d.x - nx, d.y - ny) < d.r + 1.5) return false;
        }
    return true;
  };
  const out: SeriesLabel[] = [];
  sums.forEach((s, si) => {
    if (!s.n) return;
    const w = textWidth(names[si], SERIES_LABEL_SIZE, seriesLabelWeight(hiSeries.has(si)));
    const h = 14;
    const cx = s.x / s.n;
    const cy = s.y / s.n;
    const near = dots.filter((d) => d.si === si).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    for (const d of near.slice(0, 40)) {
      const gap = d.r + 4;
      const tries = [
        { x: d.x + gap, y: d.y - h / 2, w, h },
        { x: d.x - gap - w, y: d.y - h / 2, w, h },
        { x: d.x - w / 2, y: d.y - gap - h, w, h },
        { x: d.x - w / 2, y: d.y + gap, w, h },
      ];
      const b = tries.find((t) => isFree(t) && !out.some((l) => overlaps(l.box, t, 2)));
      if (!b) continue;
      out.push({ si, y: b.y + h / 2, box: b });
      return;
    }
  });
  return out;
}

/** 산점도 옵션이 그림을 바꿀 때 기본 설명 뒤에 붙이는 문장: 계열마다 점 수, 상관 방향과 R², 기준선, 사분면마다 점 수 */
function describeScatter(
  text: typeof en,
  o: {
    points: readonly { x: number; y: number; si: number }[];
    seriesNames: readonly string[];
    fit: LinearFit | null;
    xName: string;
    yName: string;
    refs: string[];
    refX?: number;
    refY?: number;
    quadrants: readonly string[];
  },
): string {
  let s = "";
  if (o.seriesNames.length) {
    const counts = o.seriesNames.map((name): [string, number] => [name, 0]);
    for (const q of o.points) if (counts[q.si]) counts[q.si][1]++;
    const shown = counts.filter(([, k]) => k > 0);
    if (shown.length) s += text.seriesCounts(shown);
  }
  // R²가 0.1보다 작으면(상관계수 약 0.3 미만) 방향을 말하지 않아요
  if (o.fit) s += text.trend(o.fit.r2 < 0.1 ? 0 : Math.sign(o.fit.slope), o.xName, o.yName, o.fit.r2.toFixed(2));
  if (o.refs.length) s += text.refs(o.refs);
  const { refX, refY } = o;
  if (o.quadrants.length && refX !== undefined && refY !== undefined) {
    const counts = [0, 0, 0, 0];
    // 선 위의 점은 오른쪽, 위쪽 칸으로 세요
    for (const q of o.points) counts[(q.y >= refY ? 0 : 2) + (q.x >= refX ? 1 : 0)]++;
    const named = o.quadrants.slice(0, 4).map((q, k): [string, number] => [q, counts[k]]).filter(([q]) => q);
    if (named.length) s += text.quadrants(named);
  }
  return s;
}

/** 캔버스에서 한 번에 칠하는 점 묶음. fill은 그릴 때 CSS 변수 값을 읽어 실제 색을 정해요 */
export interface CanvasGroup {
  ks: readonly number[];
  isHi: boolean;
  fill: (read: (cssVar: string, fallback: string) => string) => string;
}

/** 계열마다 캔버스 칠하기 묶음: 강조 아닌 계열을 먼저 옅게, 강조 계열을 나중에 칠해요 */
function seriesCanvasGroups(dots: readonly DotAt[], colors: readonly Swatch[], hi: ReadonlySet<number>): CanvasGroup[] {
  const ks: number[][] = colors.map(() => []);
  dots.forEach((d, k) => ks[d.si]?.push(k));
  return [...ks.keys()].sort((a, b) => Number(hi.has(a)) - Number(hi.has(b))).map((si) => ({ ks: ks[si], isHi: hi.has(si), fill: (read) => canvasColor(colors[si], read) }));
}

/** 기준선: 점 아래에 깔아요 (라인 차트 referenceLines와 같은 꼴) */
function RefLines({ p, x, y, box }: { p: Painter; x: number | null; y: number | null; box: PlotBox }) {
  return (
    <g aria-hidden="true" pointerEvents="none">
      {x !== null ? <line x1={x} x2={x} y1={box.y0} y2={box.y1} stroke={p.paint("dim")} strokeDasharray="3 3" /> : null}
      {y !== null ? <line x1={box.x0} x2={box.x1} y1={y} y2={y} stroke={p.paint("dim")} strokeDasharray="3 3" /> : null}
    </g>
  );
}

/** 점 위에 올리는 산점도 이름표: 추세선과 그 이름, 사분면 이름, 계열 이름. fade는 등장 뒤 나타나는 불투명도예요 */
function Overlay(props: {
  p: Painter;
  fade: number;
  trendTag: string;
  fitLine: { x1: number; y1: number; x2: number; y2: number } | null;
  fitTag: { x: number; y: number; anchor: "start" | "end" } | null;
  quads: readonly PlacedTag[];
  seriesLabels: readonly SeriesLabel[];
  seriesNames: readonly string[];
  colors: readonly Swatch[] | null;
  hiSeries: ReadonlySet<number> | null;
}) {
  const { p, fade, fitLine, fitTag, quads, colors, hiSeries } = props;
  return (
    <>
      {fitLine && fitTag ? (
        <g aria-hidden="true" pointerEvents="none" opacity={fade}>
          <line {...fitLine} stroke={p.paint("muted")} strokeWidth={1.5} strokeDasharray="6 4" strokeLinecap="round" />
          <Tag p={p} x={fitTag.x} y={fitTag.y} text={props.trendTag} anchor={fitTag.anchor} />
        </g>
      ) : null}
      {quads.length ? (
        <g aria-hidden="true" pointerEvents="none">
          {quads.map((q) => (
            <Tag key={`${q.anchor}${q.y}`} p={p} x={q.x} y={q.y} text={q.text} anchor={q.anchor} />
          ))}
        </g>
      ) : null}
      {colors && hiSeries
        ? props.seriesLabels.map((l) => {
            const isHi = hiSeries.has(l.si);
            return (
              <g key={`s${l.si}`} aria-hidden="true" pointerEvents="none" opacity={fade}>
                <Txt x={l.box.x} y={l.y} size={SERIES_LABEL_SIZE} weight={seriesLabelWeight(isHi)} fill={p.paint(isHi ? "ink" : "muted")}>
                  {props.seriesNames[l.si]}
                </Txt>
              </g>
            );
          })
        : null}
    </>
  );
}

/** 점이 있는데 고정 범위 [x0, x1] × [y0, y1] 안에는 하나도 없는지 (안에 든 첫 점에서 멈춰요) */
function noneInside(pts: readonly { x: number; y: number }[], [x0, x1]: readonly number[], [y0, y1]: readonly number[]): boolean {
  return pts.length > 0 && !pts.some((q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1);
}

/** ScatterChart가 PointChart에 넘기는 산점도 기능 묶음 */
export const SCATTER_KIT = {
  text: TEXT,
  arrowStep,
  nearestInDirection,
  entryPoint,
  seededUnit,
  smallestGap,
  uniq,
  seriesHighlight,
  colors: categoricalDots,
  canvasGroups: seriesCanvasGroups,
  linearFit,
  fitSegment,
  fitTagSpot,
  quadrantTags,
  tagBox,
  placeSeriesLabels,
  describe: describeScatter,
  RefLines,
  Overlay,
  /** 육각 밀도 (options.bin "hex") */
  hex: HEX_KIT,
  noneInside,
};

export type ScatterKit = typeof SCATTER_KIT;
