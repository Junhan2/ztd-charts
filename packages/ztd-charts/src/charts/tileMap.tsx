import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { roundRectPath, sum } from "../core/geometry";
import { HIGHLIGHT_KEYWORDS, resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark } from "../core/motion";
import { makeFormatter } from "../core/format";
import { colorScaleOf, readableOn, scaleSwatch } from "../core/palette";
import { ScaleLegend, scaleLegendWidth } from "../core/scaleLegend";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { numGetter, strGetter } from "../data/accessor";
import { resolveGrid, tileMatcher, tileNeighbor, type TileDef } from "../layout/tileGrid";

const en = {
  kind: "Tile map",
  legend: ["Less", "More"] as [string, string],
  noData: "No data",
  rankLabel: "Rank",
  rank: (k: number, n: number) => `${k} of ${n}`,
  desc: (n: number, hi: string, lo: string, mean: string) => `${plural(n, "region")} with data. Highest ${hi}, lowest ${lo}, mean ${mean}`,
  same: (n: number, v: string) => (n === 1 ? `1 region with data, at ${v}` : `${n} regions with data, all at the same value, ${v}`),
  missing: (n: number) => `${plural(n, "region")} without data`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "타일 격자 지도",
    legend: ["적음", "많음"],
    noData: "데이터 없음",
    rankLabel: "순위",
    rank: (k, n) => `${n}곳 중 ${k}위`,
    desc: (n, hi, lo, mean) => `데이터가 있는 지역 ${n}곳. 가장 높은 곳 ${hi}, 가장 낮은 곳 ${lo}, 평균 ${mean}`,
    same: (n, v) => (n === 1 ? `데이터가 있는 지역 1곳, 값 ${v}` : `데이터가 있는 지역 ${n}곳, 모두 같은 값 ${v}`),
    missing: (n) => `데이터 없는 지역 ${n}곳`,
  },
};

export interface TileMapProps<T = Row> extends BaseChartProps<T> {
  /** 지역 이름이나 코드 필드. 기본 "region" */
  region?: Accessor<T, string>;
  /** 값 필드. 기본 "value" */
  value?: Accessor<T, number>;
  /** 내장 격자 이름("kr-sido", "kr-sido-2025")이나 타일 배열 [{ id, label, row, col, aliases }]. 기본 "kr-sido" */
  map?: string | readonly TileDef[];
  /** 위쪽 색 범례. 기본 true */
  legend?: boolean;
  /** 범례 양끝 이름. 기본 ["Less", "More"] (한국어 로캘은 ["적음", "많음"]) */
  legendLabels?: [string, string];
  /** 가장 작은 값을 가장 진하게 칠해요. 기본 강조도 가장 작은 값으로 옮겨요. 기본 false */
  colorReverse?: boolean;
  /** 색 단계 수 (2~12). 기본 5 */
  colorSteps?: number;
  /**
   * 내장 한국 격자의 지역 이름 언어. "auto"는 타일에 맞은 지역 값에 한글이 하나라도 있으면 한국어("서울"), 아니면 locale 언어예요.
   * 타일, 툴팁, 스크린리더 문장과 표가 같이 따라요. 숫자와 나머지 글자는 locale을 따르고, 사용자 격자는 자기 label을 써요. 기본 "auto"
   */
  labels?: "auto" | "ko" | "en";
}

/** 타일 세로 크기의 상한(px), 가로 대 세로 비율의 상한. 넓은 카드에서도 타일이 납작해지지 않아요 */
const MAX_TILE_H = 64;
const MAX_RATIO = 1.6;
/** 가장 옅은 단계의 불투명도. 빈 타일(회색)과 구분돼요 */
const MIN_OPACITY = 0.14;
/**
 * 값 글자의 좌우 여백(px)과 폭 여유. 크롬에서 굵은 숫자는 textWidth 추정보다 최대 6.5% 넓게 그려져서(3,400,000,000: 추정 92.2, 실제 98.2)
 * 추정 폭의 1.1배가 안쪽 폭에 들어갈 때만 적어요
 */
const VALUE_PAD = 4;
const WIDTH_SAFETY = 1.1;
/** 한글 (지역 이름 언어를 고를 때) */
const HANGUL = /[가-힣ㄱ-ㆎ]/;

interface TileInfo<T> {
  i: number;
  tile: TileDef;
  label: string;
  value: number;
  datum: T | null;
  /** 값 순위 (1이 가장 큼). 값이 없으면 0 */
  rank: number;
}

/** 타일 이름 글자: 한 줄로 들어가는 가장 큰 크기, 안 되면 빈칸이나 "-"에서 두 줄, 그래도 안 되면 말줄임 */
function fitName(label: string, w: number): { lines: string[]; size: number; cut: boolean } {
  for (const size of [11.5, 11, 10, 9]) if (textWidth(label, size, 600) <= w) return { lines: [label], size, cut: false };
  const at = Math.max(label.lastIndexOf(" "), label.lastIndexOf("-"));
  if (at > 0) {
    const lines = [label.slice(0, at + (label[at] === "-" ? 1 : 0)).trim(), label.slice(at + 1).trim()];
    for (const size of [10, 9]) if (lines.every((l) => textWidth(l, size, 600) <= w)) return { lines, size, cut: false };
  }
  return { lines: [truncate(label, w, 9, 600)], size: 9, cut: true };
}

/**
 * 타일 격자 지도: 지역마다 같은 크기 타일 하나를 대략의 자리에 두고 값으로 칠해요.
 * 경계 데이터와 투영이 없어서 작은 지역(서울, 세종)도 큰 도와 같은 크기로 읽혀요
 */
export function TileMap<T = Row>(props: TileMapProps<T>) {
  const grid = useMemo(() => resolveGrid(props.map ?? "kr-sido") ?? [], [props.map]);
  const nRows = grid.reduce((m, t) => Math.max(m, t.row + 1), 0);
  const nCols = grid.reduce((m, t) => Math.max(m, t.col + 1), 0);
  const legendH = props.legend === false ? 0 : 22;
  const c = useChart(props, { height: (w) => legendH + nRows * Math.min(w / Math.max(1, nCols), MAX_TILE_H), duration: 520, stagger: 28 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];

  // 이름 → 타일: 행 맞추기와 강조가 같이 써요 ("서울", "Seoul", "KR-11" 모두 같은 타일)
  const match = useMemo(() => tileMatcher(grid), [grid]);
  const tiles = useMemo<TileInfo<T>[]>(() => {
    const gr = strGetter(props.region, "region");
    const gv = numGetter(props.value, "value");
    const out: TileInfo<T>[] = grid.map((tile, i) => ({ i, tile, label: "", value: NaN, datum: null, rank: 0 }));
    let hangul = false;
    // 같은 타일에 맞는 행이 여럿이면 뒤 행이 이겨요 (validateSpec이 알려요). 값이 숫자가 아닌 행은 데이터 없음이에요
    props.data.forEach((d, i) => {
      const name = gr(d, i);
      const k = match(name);
      if (k < 0) return;
      hangul ||= HANGUL.test(String(name));
      out[k].value = gv(d, i);
      out[k].datum = d;
    });
    // 이름 언어: 정했으면 그대로, "auto"면 데이터가 한글일 때 한국어, 아니면 locale 언어 (한국어 이름이 없는 사용자 격자는 label)
    const lang = props.labels === "ko" || props.labels === "en" ? props.labels : hangul ? "ko" : c.lang;
    for (const t of out) t.label = (lang === "ko" ? t.tile.labelKo : undefined) ?? t.tile.label ?? t.tile.id;
    // 순위는 값이 있는 타일끼리 (같은 값은 같은 순위). layout/stats의 ranks와 같은 규칙인데, 그 모듈을 불러오면 TileMap 번들이 약 0.1KB 커져서 여기서 세요
    const vals = out.filter((t) => Number.isFinite(t.value)).map((t) => t.value);
    for (const t of out) if (Number.isFinite(t.value)) t.rank = 1 + vals.filter((v) => v > t.value).length;
    return out;
  }, [grid, match, props.data, props.region, props.value, props.labels, c.lang]);

  /** 키보드, 표, 라이브 영역 순서: 값이 큰 타일부터, 그다음 데이터 없는 타일(읽는 순서). 둘 다 순위가 없으면 NaN이라 읽는 순서로 넘어가요 */
  const order = useMemo(() => [...tiles].sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity) || a.i - b.i), [tiles]);
  const withData = order.filter((t) => t.rank > 0);
  const n = withData.length;
  const mn = n ? withData[n - 1].value : 0;
  const mx = n ? withData[0].value : 0;
  /** 값이 모두 같으면 가장 큰 곳도 작은 곳도 없어요: "max", "min" 강조와 설명의 최고, 최저를 쓰지 않아요 */
  const flat = n > 0 && mx === mn;

  const scale = useMemo(() => colorScaleOf(props.colorReverse, undefined, props.colorSteps ?? 5), [props.colorReverse, props.colorSteps]);
  const steps = scale.steps ?? 5;

  const hiSet = useMemo(() => {
    // 이름은 지역 이름표로 타일 번호로 바꿔요 (맞는 타일이 없으면 -1이라 resolveHighlight가 버려요). 숫자는 타일 번호(읽는 순서)예요
    const h = props.highlight;
    const byName = (x: number | string) => (typeof x === "string" && !HIGHLIGHT_KEYWORDS.includes(x) ? match(x) : x);
    const resolved =
      typeof h === "string" || typeof h === "number" || Array.isArray(h)
        ? ((Array.isArray(h) ? h : [h]) as (number | string)[]).filter((x) => !(flat && (x === "max" || x === "min"))).map(byName)
        : h;
    // 데이터 없는 타일(null)은 판별 함수에 넘기지 않아요 (resolveHighlight)
    return resolveHighlight(resolved as Highlight<T> | undefined, tiles.map((t) => t.datum) as T[], tiles.map((t) => t.tile.id), tiles.map((t) => t.value), flat ? "none" : props.colorReverse ? "min" : "max");
  }, [match, tiles, flat, props.highlight, props.colorReverse]);

  // 칸 크기: 폭을 열로 나누고, 세로는 상한까지, 가로는 세로의 1.6배까지. 남는 폭은 양옆으로 나눠 가운데에 둬요
  const baseW = W / Math.max(1, nCols);
  const ch = Math.max(1, Math.min(baseW, (H - legendH) / Math.max(1, nRows)));
  const cw = Math.min(baseW, ch * MAX_RATIO);
  const gridW = cw * nCols;
  const x0 = (W - gridW) / 2;
  const y0 = legendH;
  const gap = Math.min(cw, ch) > 30 ? 4 : 2;
  const rad = Math.min(p.theme.radiusMark + 2, Math.min(cw, ch) / 5);

  // 타일마다 바뀌지 않는 모양(자리, 색, 글자 맞춤). 등장 중 매 프레임, 호버마다 다시 그려도 여기는 다시 재지 않아요
  const { fmt, showLabels, locale } = c;
  // 긴 값의 다음 후보: 로캘의 짧은 꼴(1.2B, 12억). format을 정했으면 그 꼴을 지켜서 줄이지 않고 빼요
  const userFormat = props.format !== undefined;
  const short = useMemo(() => (userFormat ? null : makeFormatter("compact", locale)), [userFormat, locale]);
  const looks = useMemo(
    () =>
      tiles.map((t) => {
        const b = { x: x0 + t.tile.col * cw + gap / 2, y: y0 + t.tile.row * ch + gap / 2, w: Math.max(0.5, cw - gap), h: Math.max(0.5, ch - gap) };
        const sw = t.rank ? scaleSwatch(p, mx > mn ? (t.value - mn) / (mx - mn) : 1, MIN_OPACITY, scale) : null;
        // 이름이 먼저예요: 값은 이름이 다 들어가고 그 아래 자리가 있을 때만 적어요
        const name = fitName(t.label, b.w - 6);
        const lineH = name.size + 2;
        // 값은 전체 숫자, 짧은 꼴, 없음 순서. 추정 폭의 1.1배가 안쪽 폭(좌우 4px 뺀 폭)에 들어가는 가장 큰 크기로 적어요 (툴팁과 표는 늘 전체 숫자)
        const sizeFor = (s: string) => [13, 11.5].find((size) => textWidth(s, size, 700) * WIDTH_SAFETY <= b.w - VALUE_PAD * 2 && name.lines.length * lineH + size + 3 + 8 <= b.h);
        let valueText = sw && showLabels && !name.cut ? fmt(t.value) : "";
        let valueSize = valueText ? sizeFor(valueText) : undefined;
        if (valueText && valueSize === undefined && short) valueSize = sizeFor((valueText = short(t.value)));
        if (valueSize === undefined) valueText = "";
        const blockH = name.lines.length * lineH + (valueSize ? valueSize + 3 : 0);
        return {
          b,
          d: roundRectPath(b.x, b.y, b.w, b.h, rad),
          ring: roundRectPath(b.x - 1.5, b.y - 1.5, b.w + 3, b.h + 3, rad + 1.5),
          sw,
          ink: sw ? sw.text : readableOn(p, p.theme.neutralSoft),
          name,
          valueText,
          valueSize,
          lineH,
          top: b.y + b.h / 2 - blockH / 2,
          showName: showLabels && b.h >= name.lines.length * lineH + 4,
        };
      }),
    [tiles, x0, y0, cw, ch, gap, rad, p, mn, mx, scale, fmt, short, showLabels],
  );

  const stg = c.motion.stagger ?? 28;
  const marks = useMemo<Mark<TileInfo<T>>[]>(() => tiles.map((t) => ({ key: `t${t.tile.id}`, to: [1], from: [0], delay: (t.tile.row * nCols + t.tile.col) * stg, data: t })), [tiles, nCols, stg]);
  const m = useMotion(marks, c.motion);

  const fv = c.fv;
  // 값이 있는 타일이 하나도 없으면 항목도 없어요: 빈 타일만 그리고, 설명은 ChartFrame의 "No data."예요
  const listed = useMemo(() => (n ? order : []), [order, n]);
  const events: ChartEvent<T>[] = useMemo(
    () =>
      listed.map((t) => ({
        datum: t.datum,
        index: t.i,
        key: t.tile.id,
        label: t.label,
        value: t.rank ? t.value : null,
        formatted: t.rank ? `${fv(t.value)}, ${msg.rank(t.rank, n)}` : msg.noData,
      })),
    [listed, fv, msg, n],
  );
  const eventOf = useMemo(() => new Map(listed.map((t, k) => [t.i, k])), [listed]);
  const cellOf = useMemo(() => new Map(grid.map((t, i) => [`${t.row},${t.col}`, i])), [grid]);

  const activeTile = c.active !== null ? listed[c.active] : undefined;
  let tip: TooltipData | null = null;
  if (activeTile) {
    const b = looks[activeTile.i].b;
    tip = {
      x: b.x + b.w / 2,
      y: b.y,
      title: activeTile.label,
      rows: activeTile.rank ? [{ label: c.t.value, value: fv(activeTile.value), color: p.paint("accent") }, { label: msg.rankLabel, value: msg.rank(activeTile.rank, n), strong: false }] : [{ label: c.t.value, value: msg.noData, strong: false }],
    };
  }

  const ll = props.legendLabels ?? msg.legend;
  const lw = scaleLegendWidth(steps, ll);
  const legendRight = Math.min(W, Math.max(x0 + gridW, lw));
  const mean = n ? sum(withData.map((t) => t.value)) / n : 0;
  const lacking = tiles.length - n;
  const summary = !n ? "" : flat ? msg.same(n, fv(mx)) : msg.desc(n, `${withData[0].label} ${fv(mx)}`, `${withData[n - 1].label} ${fv(mn)}`, fv(mean));
  const desc = props.description ?? (n ? `${msg.kind}. ${summary}${lacking ? `. ${msg.missing(lacking)}` : ""}.` : "");
  // 데이터 없는 타일도 키보드로 닿고 "No data"로 읽혀요(표에도 있어요). 그래서 기본 문장의 "(k/N)" 대신 순위가 든 같은 글을 읽고,
  // End도 기본(마지막 항목, 데이터 없는 타일)이 아니라 값이 가장 작은 타일로 가요
  const announce = c.via === "keyboard" && c.active !== null && events[c.active] ? `${events[c.active].label}: ${events[c.active].formatted}` : "";

  return (
    <ChartFrame
      c={c}
      kind={msg.kind}
      ariaLabel={props.ariaLabel}
      description={desc}
      events={events}
      tip={tip}
      renderTip={props.tooltip}
      announce={announce}
      className={props.className}
      style={props.style}
      theme={props.theme}
      onPointerMove={(px, py, e) => {
        const i = cellOf.get(`${Math.floor((py - y0) / ch)},${Math.floor((px - x0) / cw)}`);
        const k = i === undefined ? null : eventOf.get(i) ?? null;
        if (k !== c.active) c.setActive(k, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={(e) => {
        // End는 값이 가장 작은 타일로 (데이터 없는 타일은 그 뒤에 있어요). Home은 기본대로 가장 큰 타일이에요
        if (e.key === "End" && n) {
          c.setActive(n - 1, "keyboard");
          return true;
        }
        if (!e.key.startsWith("Arrow") || !activeTile) return false;
        // 화살표는 그 방향의 가장 가까운 타일로. 없으면 그 자리에 있어요
        const next = tileNeighbor(grid, activeTile.i, e.key);
        if (next >= 0) c.setActive(eventOf.get(next) ?? null, "keyboard");
        return true;
      }}
    >
      {props.legend !== false && n ? <ScaleLegend p={p} right={legendRight} steps={steps} scale={scale} labels={ll} min={MIN_OPACITY} /> : null}
      {m.items.map((it) => {
        const t = it.data;
        const { b, d, ring, sw, ink, name, valueText, valueSize, lineH, top, showName } = looks[t.i];
        const k = eventOf.get(t.i) ?? -1;
        const isHi = hiSet.has(t.i);
        const isActive = c.active === k;
        return (
          <g key={it.key} opacity={it.v[0]}>
            <path
              d={d}
              fill={sw ? sw.fill : p.paint("neutralSoft")}
              opacity={(sw ? sw.opacity : 1) * (c.active === null || isActive ? 1 : 0.55)}
              className="ztd-mark"
              onPointerEnter={(e) => c.setActive(k < 0 ? null : k, e.pointerType === "touch" ? "touch" : "pointer")}
              onClick={() => k >= 0 && c.click(k)}
            />
            {isHi || isActive ? <path d={ring} fill="none" stroke={p.paint("ink")} strokeWidth={isActive ? 2.5 : 2} pointerEvents="none" /> : null}
            {showName
              ? name.lines.map((line, j) => (
                  <Txt key={j} x={b.x + b.w / 2} y={top + j * lineH + lineH / 2} anchor="middle" size={name.size} weight={isHi ? 700 : sw ? 600 : 500} fill={ink}>
                    {line}
                  </Txt>
                ))
              : null}
            {showName && valueSize ? (
              <Txt x={b.x + b.w / 2} y={top + name.lines.length * lineH + 3 + valueSize / 2} anchor="middle" size={valueSize} weight={isHi ? 800 : 700} fill={ink}>
                {valueText}
              </Txt>
            ) : null}
          </g>
        );
      })}
    </ChartFrame>
  );
}
