import type { ReactNode } from "react";
import type { Painter } from "../theme/context";
import { Txt } from "./ChartFrame";
import type { ChartLang } from "./i18n";
import { linearFit } from "./geometry";
import { textWidth, truncate, type Box } from "./text";

/** 차트 위 주석 한 칸 (options.annotations) */
export interface Annotation {
  /** "band" 칠한 구간 | "line" 가로 기준선 | "event" 사건 표시 | "forecast" 예측 구간 | "trend" 추세선 | "weekends" 주말 음영 */
  type: "band" | "line" | "event" | "forecast" | "trend" | "weekends";
  /** event: x 값. band: [시작, 끝] x 구간 */
  x?: unknown;
  /** line: y 값. band: [아래, 위] y 구간 */
  y?: number | readonly [number, number];
  /** forecast: 이 x부터 예측이에요 (선이 점선이 돼요) */
  from?: unknown;
  label?: string;
}

const isPair = (v: unknown): v is readonly [unknown, unknown] => Array.isArray(v) && v.length === 2;

/** y축 범위에 넣어야 하는 값 (구간과 기준선이 데이터 밖이어도 그림 안에 들어오게) */
export function annotationYs(list: readonly Annotation[] | undefined): number[] {
  const out: number[] = [];
  for (const a of list ?? []) {
    if (a.type === "line" && typeof a.y === "number") out.push(a.y);
    else if (a.type === "band" && isPair(a.y)) out.push(Number(a.y[0]), Number(a.y[1]));
  }
  return out.filter(Number.isFinite);
}

/** 예측이 시작하는 x 값 (없으면 undefined) */
export const forecastFrom = (list: readonly Annotation[] | undefined): unknown => list?.find((a) => a.type === "forecast")?.from;

export interface AnnotationGeom {
  p: Painter;
  lang: ChartLang;
  /** x 값을 픽셀로. 못 찾으면 null */
  xAt: (v: unknown) => number | null;
  y: (v: number) => number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** 날짜 x일 때 시간 범위, 점 수, 시간 → 픽셀 (주말 음영). 날짜가 아니면 없어요 */
  time?: { t0: number; t1: number; n: number; xt: (t: number) => number };
  /** 칸 폭의 절반. x 구간을 양 끝 칸 가장자리까지 넓혀요 (범주, 봉). 이어진 x는 0 */
  half: number;
  /** 예측 구간을 칸 왼쪽 끝부터 (막대) */
  edge?: boolean;
  /** 추세선을 맞출 강조 계열의 점 (픽셀) */
  points?: () => { x: number; y: number }[];
}

const clampX = (g: AnnotationGeom, x: number) => Math.max(g.x0, Math.min(g.x1, x));
const inside = (g: AnnotationGeom, x: number | null): x is number => x !== null && x >= g.x0 - 1 && x <= g.x1 + 1;
/** x 구간 [시작, 끝]의 픽셀 범위 (작은 쪽부터). 한쪽이라도 못 찾으면 null */
function xRange(g: AnnotationGeom, v: readonly unknown[]): [number, number] | null {
  const a = g.xAt(v[0]);
  const b = g.xAt(v[1]);
  return a === null || b === null ? null : [Math.min(a, b) - g.half, Math.max(a, b) + g.half];
}

/** 예측이 시작하는 픽셀 (그림 왼쪽 끝 안으로 당겨요). from이 없거나 그림 오른쪽 밖이면 null. 선의 점선 나누기도 이걸 써요 */
export function forecastX(g: AnnotationGeom, from: unknown): number | null {
  const x = from === undefined ? null : g.xAt(from);
  return x === null || x > g.x1 ? null : Math.max(g.x0, x - (g.edge ? g.half : 0));
}

const TEXT = {
  en: { forecast: "Forecast", trend: "Trend", period: "period", weekends: "weekends shaded", lead: "Annotations" },
  ko: { forecast: "예측", trend: "추세", period: "기간", weekends: "주말 음영", lead: "주석" },
};

/** 시리즈 아래에 까는 주석: 칠한 구간, 주말, 예측 구간 */
export function AnnotationsUnder({ list, g }: { list?: readonly Annotation[]; g: AnnotationGeom }) {
  if (!list?.length) return null;
  const { p } = g;
  const h = Math.max(0, g.bottom - g.top);
  const nodes: ReactNode[] = [];
  list.forEach((a, i) => {
    if (a.type === "band" && isPair(a.y)) {
      const ya = g.y(Number(a.y[0]));
      const yb = g.y(Number(a.y[1]));
      if (!Number.isFinite(ya) || !Number.isFinite(yb)) return;
      const top = Math.max(g.top, Math.min(ya, yb));
      const bot = Math.min(g.bottom, Math.max(ya, yb));
      nodes.push(
        <g key={i}>
          <rect x={g.x0} y={top} width={Math.max(0, g.x1 - g.x0)} height={Math.max(0, bot - top)} fill={p.paint("accent")} opacity={0.1} />
          <line x1={g.x0} x2={g.x1} y1={top} y2={top} stroke={p.paint("accent")} strokeOpacity={0.45} strokeDasharray="3 3" />
          <line x1={g.x0} x2={g.x1} y1={bot} y2={bot} stroke={p.paint("accent")} strokeOpacity={0.45} strokeDasharray="3 3" />
        </g>,
      );
    } else if ((a.type === "band" && isPair(a.x)) || a.type === "forecast") {
      let r: [number, number] | null;
      if (a.type === "forecast") {
        const xf = forecastX(g, a.from);
        r = xf === null ? null : [xf, g.x1];
      } else r = xRange(g, a.x as readonly unknown[]);
      if (!r) return;
      const xa = clampX(g, r[0]);
      const xb = clampX(g, r[1]);
      if (xb - xa < 0.5) return;
      nodes.push(<rect key={i} x={xa} y={g.top} width={xb - xa} height={h} fill={p.paint("ink")} opacity={0.05} />);
    } else if (a.type === "weekends" && g.time && g.time.t1 - g.time.t0 <= 86400000 * 400) {
      // 토요일 0시부터 월요일 0시까지. 400일이 넘으면 칸이 너무 잘아서 그리지 않아요.
      // 점 간격의 절반(최대 12시간)만큼 앞당겨서 하루치 점이 음영 가운데에 와요
      const pad = Math.min(43200000, (g.time.t1 - g.time.t0) / Math.max(1, g.time.n - 1) / 2);
      const d = new Date(g.time.t0);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 1) % 7));
      for (let n = 0; d.getTime() - pad <= g.time.t1 && n < 60; n++) {
        const sat = d.getTime();
        d.setDate(d.getDate() + 2);
        const xa = Math.max(g.x0, g.time.xt(sat - pad));
        const xb = Math.min(g.x1, g.time.xt(d.getTime() - pad));
        if (xb > xa) nodes.push(<rect key={`${i}w${n}`} x={xa} y={g.top} width={xb - xa} height={h} fill={p.paint("ink")} opacity={0.045} />);
        d.setDate(d.getDate() + 5);
      }
    }
  });
  return (
    <g aria-hidden="true" pointerEvents="none">
      {nodes}
    </g>
  );
}

/** 이름표 폭: 글자 + 양옆 4px */
const tagW = (text: string, strong?: boolean) => textWidth(text, 10.5, strong ? 700 : 500) + 8;

/** 이름표(Tag) 상자: 글자 + 양옆 4px, 높이 16px. x는 anchor 쪽 끝, y는 줄 가운데예요. 겹침을 미리 재는 곳(산점도)도 이 상자를 써요 */
export function tagBox(text: string, x: number, y: number, anchor: "start" | "end" = "start", strong?: boolean): Box {
  const w = tagW(text, strong);
  return { x: anchor === "end" ? x - w : x, y: y - 8, w, h: 16 };
}

/** 카드 바탕 받침 위에 쓰는 작은 글자 (선이 지나가도 읽히게). 산점도 사분면 이름과 추세선 이름표도 이걸 써요 */
export function Tag({ p, x, y, text, anchor = "start", strong }: { p: Painter; x: number; y: number; text: string; anchor?: "start" | "end"; strong?: boolean }) {
  const b = tagBox(text, x, y, anchor, strong);
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={5} fill={p.paint("panel")} opacity={0.94} />
      <Txt x={b.x + 4} y={y} size={10.5} weight={strong ? 700 : 500} fill={p.paint(strong ? "ink" : "muted")}>
        {text}
      </Txt>
    </g>
  );
}

/** 시리즈 위에 올리는 주석: 기준선, 사건, 추세선과 구간 이름표 */
export function AnnotationsOver({ list, g }: { list?: readonly Annotation[]; g: AnnotationGeom }) {
  if (!list?.length) return null;
  const { p } = g;
  const tx = TEXT[g.lang];
  const nodes: ReactNode[] = [];
  // 사건 이름표가 겹치면 아랫줄로 내려요
  const rows: number[] = [];
  list.forEach((a, i) => {
    if (a.type === "line" && typeof a.y === "number") {
      const yy = g.y(a.y);
      if (!Number.isFinite(yy)) return;
      nodes.push(
        <g key={i}>
          <line x1={g.x0} x2={g.x1} y1={yy} y2={yy} stroke={p.paint("dim")} strokeDasharray="4 3" />
          {a.label ? <Tag p={p} x={g.x1 - 2} y={yy - 10} text={truncate(a.label, 160, 10.5)} anchor="end" /> : null}
        </g>,
      );
    } else if (a.type === "band" && a.label) {
      const top = isPair(a.y) ? Math.max(g.top, Math.min(g.y(Number(a.y[0])), g.y(Number(a.y[1])))) : g.top;
      const r = isPair(a.x) ? xRange(g, a.x) : [g.x0, g.x1];
      if (!r || !Number.isFinite(top)) return;
      nodes.push(<Tag key={i} p={p} x={Math.min(clampX(g, r[0]), g.x1 - 40) + 4} y={top + 11} text={truncate(a.label, 160, 10.5)} />);
    } else if (a.type === "forecast") {
      const xf = forecastX(g, a.from);
      if (xf === null) return;
      nodes.push(
        <g key={i}>
          <line x1={xf} x2={xf} y1={g.top} y2={g.bottom} stroke={p.paint("dim")} strokeDasharray="2 3" />
          <Tag p={p} x={Math.min(xf + 4, g.x1 - 50)} y={g.top + 9} text={truncate(a.label ?? tx.forecast, 120, 10.5)} />
        </g>,
      );
    } else if (a.type === "event" && a.label) {
      const xe = g.xAt(a.x);
      if (!inside(g, xe)) return;
      const text = truncate(a.label, 140, 10.5, 700);
      const w = tagW(text, true);
      const left = Math.max(g.x0, Math.min(xe - w / 2, g.x1 - w));
      let row = rows.findIndex((end) => end < left - 4);
      if (row < 0) row = rows.length;
      rows[row] = left + w;
      const yy = g.top + 9 + row * 18;
      nodes.push(
        <g key={i}>
          <line x1={xe} x2={xe} y1={yy + 8} y2={g.bottom} stroke={p.paint("ink")} strokeOpacity={0.45} strokeDasharray="2 3" />
          <circle cx={xe} cy={g.bottom} r={2.5} fill={p.paint("ink")} opacity={0.6} />
          <Tag p={p} x={left} y={yy} text={text} strong />
        </g>,
      );
    } else if (a.type === "trend" && g.points) {
      const pts = g.points().filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
      if (pts.length < 2) return;
      // 최소제곱 직선. 축이 선형이라 픽셀 좌표로 맞춰도 데이터로 맞춘 선과 같아요
      const { at } = linearFit(pts);
      const xa = pts[0].x;
      const xb = pts[pts.length - 1].x;
      nodes.push(
        <g key={i}>
          <line x1={xa} x2={xb} y1={at(xa)} y2={at(xb)} stroke={p.paint("muted")} strokeWidth={1.5} strokeDasharray="6 4" strokeLinecap="round" />
          <Tag p={p} x={xb - 2} y={at(xb) - 11} text={truncate(a.label ?? tx.trend, 120, 10.5)} anchor="end" />
        </g>,
      );
    }
  });
  return (
    <g aria-hidden="true" pointerEvents="none">
      {nodes}
    </g>
  );
}

/** 스크린리더 설명에 붙이는 주석 문장. xText는 x 값을 차트의 x 이름표로 바꿔요 (없으면 적은 값 그대로). 주석이 없으면 빈 글자 */
export function describeAnnotations(list: readonly Annotation[] | undefined, lang: ChartLang, fv: (v: number) => string, xText?: (v: unknown) => string): string {
  if (!list?.length) return "";
  const tx = TEXT[lang];
  const ko = lang === "ko";
  const s = xText ?? ((v: unknown) => String(v ?? ""));
  const parts = list
    .map((a) => {
      const label = a.label ? (ko ? `(${a.label})` : ` (${a.label})`) : "";
      if (a.type === "band" && isPair(a.y)) return ko ? `구간 ${fv(Number(a.y[0]))}~${fv(Number(a.y[1]))}${label}` : `band ${fv(Number(a.y[0]))} to ${fv(Number(a.y[1]))}${label}`;
      if (a.type === "band" && isPair(a.x)) return ko ? `${a.label ?? tx.period} ${s(a.x[0])}~${s(a.x[1])}` : `${a.label ?? tx.period} from ${s(a.x[0])} to ${s(a.x[1])}`;
      if (a.type === "line" && typeof a.y === "number") return ko ? `기준선 ${fv(a.y)}${label}` : `reference line at ${fv(a.y)}${label}`;
      if (a.type === "event") return ko ? `${s(a.x)} ${a.label ?? ""}`.trim() : `${a.label ?? "event"} at ${s(a.x)}`;
      if (a.type === "forecast") return ko ? `${s(a.from)}부터 ${a.label ?? tx.forecast}` : `${a.label ?? tx.forecast.toLowerCase()} from ${s(a.from)}`;
      if (a.type === "trend") return ko ? (a.label ?? "추세선") : (a.label ?? "trend line");
      if (a.type === "weekends") return tx.weekends;
      return "";
    })
    .filter(Boolean);
  return parts.length ? ` ${tx.lead}: ${parts.join(ko ? ", " : "; ")}.` : "";
}
