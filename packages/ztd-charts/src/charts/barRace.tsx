import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { clamp, roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import { subscribeTick, type Mark } from "../core/motion";
import { makeFormatter, withUnit } from "../core/format";
import { emphasis } from "../core/palette";
import { prepSeries, xNum, type Aggregate } from "../core/series";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { useChartLocale, type Painter } from "../theme/context";

const en = {
  kind: "Bar race chart",
  play: "Play",
  pause: "Pause",
  prev: "Previous frame",
  next: "Next frame",
  frame: "Frame",
  rank: "Rank",
  /** 1st, 2nd, 3rd, 4th, 11th, 21st */
  nth: (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`,
  up: (n: number) => `up ${plural(n, "place")}`,
  down: (n: number) => `down ${plural(n, "place")}`,
  desc: (items: number, frames: number, first: string, last: string) => `${plural(items, "item")} ranked over ${plural(frames, "frame")}, from ${first} to ${last}`,
  lead: (frame: string, name: string, v: string) => `At ${frame}, ${name} leads with ${v}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "막대 레이스",
    play: "재생",
    pause: "멈춤",
    prev: "이전 시점",
    next: "다음 시점",
    frame: "시점",
    rank: "순위",
    nth: (n) => `${n}위`,
    up: (n) => `${n}계단 오름`,
    down: (n) => `${n}계단 내림`,
    desc: (items, frames, first, last) => `항목 ${items}개의 순위, ${first}부터 ${last}까지 시점 ${frames}개`,
    lead: (frame, name, v) => `${frame} 1위 ${name}, ${v}`,
  },
};

export interface BarRaceProps<T = Row> extends BaseChartProps<T> {
  /** 항목 이름 필드. 기본 "label" */
  label?: Accessor<T, string>;
  /** 값 필드. 기본 "value" */
  value?: Accessor<T, number>;
  /** 시점 필드(연도, 날짜, 순서 있는 아무 키). 숫자와 날짜는 그 순서로, 섞이거나 글자면 처음 나온 순서로 놓아요. 기본 "frame" */
  frame?: Accessor<T, unknown>;
  /** 시점마다 보여 줄 위쪽 항목 수 (1~50). 기본 10 */
  top?: number;
  /** 재생할 때 시점 하나의 시간(ms, 100~60000). 기본 1000 */
  stepMs?: number;
  /** 화면에 들어오면 처음 시점부터 저절로 재생해요. 동작 줄이기에서는 재생하지 않아요. 기본 false */
  autoplay?: boolean;
  /** 처음 보이는 시점이고 정적 그림(SVG, PNG, 서버 첫 그림)의 시점이에요. 시점 값(2021, "2021-03")으로. 기본 마지막 시점 */
  startFrame?: string | number;
  /** 같은 시점, 같은 항목이 여러 행일 때 합치는 방법. 기본 "sum" */
  aggregate?: Aggregate;
}

/** 위아래 여백(px). 등장하고 빠지는 막대가 이 밖으로 미끄러져요 */
const PAD = 4;
const DEFAULT_TOP = 10;
const DEFAULT_STEP = 1000;
/** 시점 글자: 구석에 들어가는 가장 작은 크기, 들어가지 않을 때 막대 아래 따로 두는 띠의 높이와 글자 크기, 막대 끝과 띄우는 거리(px) */
const LABEL_MIN = 18;
const BAND_H = 24;
const BAND_SIZE = 18;
const LABEL_GAP = 8;

/**
 * Bloom 아이콘(linear, 0.12.0): play, pause, play-left-to-line, play-right-to-line.
 * 그리는 틀은 ChartCard의 다시 재생 단추와 같아요 (24 칸, 14px, 선 2.2)
 */
const ICONS = {
  play: ["M6.75 12C6.75 8.81 6.75 7.214 7.725 6.544C7.822 6.477 7.925 6.417 8.032 6.366C9.1 5.857 10.482 6.655 13.245 8.25C16.008 9.845 17.389 10.642 17.483 11.821C17.493 11.94 17.493 12.06 17.483 12.179C17.389 13.358 16.008 14.155 13.245 15.75C10.482 17.345 9.1 18.143 8.032 17.634C7.925 17.583 7.822 17.523 7.725 17.456C6.75 16.786 6.75 15.19 6.75 12Z"],
  pause: [
    "M6.75 5.25L8.25 5.25C8.957 5.25 9.311 5.25 9.53 5.47C9.75 5.689 9.75 6.043 9.75 6.75L9.75 17.25C9.75 17.957 9.75 18.311 9.53 18.53C9.311 18.75 8.957 18.75 8.25 18.75L6.75 18.75C6.043 18.75 5.689 18.75 5.47 18.53C5.25 18.311 5.25 17.957 5.25 17.25L5.25 6.75C5.25 6.043 5.25 5.689 5.47 5.47C5.689 5.25 6.043 5.25 6.75 5.25Z",
    "M15.75 5.25L17.25 5.25C17.957 5.25 18.311 5.25 18.53 5.47C18.75 5.689 18.75 6.043 18.75 6.75L18.75 17.25C18.75 17.957 18.75 18.311 18.53 18.53C18.311 18.75 17.957 18.75 17.25 18.75L15.75 18.75C15.043 18.75 14.689 18.75 14.47 18.53C14.25 18.311 14.25 17.957 14.25 17.25L14.25 6.75C14.25 6.043 14.25 5.689 14.47 5.47C14.689 5.25 15.043 5.25 15.75 5.25Z",
  ],
  prev: ["M18.75 12C18.75 8.969 18.75 7.453 17.824 6.816C17.731 6.753 17.633 6.696 17.532 6.648C16.517 6.164 15.205 6.922 12.58 8.437C9.954 9.953 8.642 10.711 8.553 11.831C8.544 11.943 8.544 12.057 8.553 12.169C8.642 13.289 9.954 14.047 12.58 15.563C15.205 17.078 16.517 17.836 17.532 17.352C17.633 17.304 17.731 17.247 17.824 17.184C18.75 16.547 18.75 15.031 18.75 12Z", "M5.25 6.75V17.25"],
  next: ["M5.25 12C5.25 8.969 5.25 7.453 6.176 6.816C6.269 6.753 6.367 6.696 6.468 6.648C7.483 6.164 8.795 6.922 11.42 8.437C14.046 9.953 15.358 10.711 15.447 11.831C15.456 11.943 15.456 12.057 15.447 12.169C15.358 13.289 14.046 14.047 11.421 15.563C8.795 17.078 7.483 17.836 6.468 17.352C6.367 17.304 6.269 17.247 6.176 17.184C5.25 16.547 5.25 15.031 5.25 12Z", "M18.75 6.75V17.25"],
};

/** 한 시점의 순위: 값이 있는 항목을 큰 값부터 (같은 값은 데이터에 처음 나온 순서라 시점마다 깜빡이지 않아요), pos는 항목마다 1부터의 자리(없으면 0) */
interface Standing {
  order: number[];
  pos: Int32Array;
}

interface Bar {
  s: number;
  slot: number;
  value: number;
  /** 지난 시점보다 오른 계단 수 (내렸으면 음수). 지난 시점에 없었으면 0 */
  move: number;
}

/** 시점 값을 시점 번호로. 숫자, 날짜 시점은 같은 시각이면, 그 밖은 키나 표시 글자가 같으면. 없으면 -1 */
function frameIndex(m: { type: "number" | "date" | "band"; keys: string[]; xnum: number[]; labels: string[] }, v: unknown): number {
  if (v === undefined || v === null || v === "") return -1;
  if (m.type !== "band") {
    const n = xNum(m.type, v);
    const k = Number.isFinite(n) ? m.xnum.indexOf(n) : -1;
    if (k >= 0) return k;
  }
  const s = String(v);
  const k = m.keys.indexOf(s);
  return k >= 0 ? k : m.labels.indexOf(s);
}

/**
 * 막대 레이스: 시점마다 위쪽 N개 항목을 가로 막대로 줄 세우고, 시점이 바뀌면 길이와 자리가 지금 자리에서 함께 움직여요.
 * 순위에 들고 나는 항목은 아래 끝에서 들어오고 나가요. 색은 순위가 아니라 항목을 따라가요(강조 항목만 강조색).
 * 정적 그림과 서버 첫 그림은 한 시점(기본 마지막)을 다 그리고, 재생 단추와 시점 막대는 SVG 밖 HTML이라 그림에 들어가지 않아요
 */
export function BarRace<T = Row>(props: BarRaceProps<T>) {
  const locale = useChartLocale(props.locale);
  const model = useMemo(() => {
    const m = prepSeries(props.data, props.frame ?? "frame", props.value ?? "value", props.label ?? "label", { locale, aggregate: props.aggregate ?? "sum" });
    // 날짜 시점이 같은 글자가 되면("Jan"이 두 해) 연도까지 적어요. 시점 글자는 크게 깔리고 낭독기가 읽어서 겹치면 안 돼요
    if (m.type === "date" && new Set(m.labels).size < m.labels.length) {
      const monthly = m.xnum.every((t) => new Date(t).getDate() === 1);
      const f = new Intl.DateTimeFormat(locale, monthly ? { year: "numeric", month: "short" } : { year: "numeric", month: "short", day: "numeric" });
      return { ...m, labels: m.xnum.map((t) => f.format(t)) };
    }
    return m;
  }, [props.data, props.frame, props.value, props.label, props.aggregate, locale]);
  const nF = model.keys.length;
  const nI = model.series.length;
  const last = Math.max(0, nF - 1);

  // 시점마다 순위는 처음 읽을 때 한 번만 세요. 보는 시점과 그 전 시점 몇 개만 들고 있어요 (항목 1,000개를 다시 줄 세우는 데 0.1ms쯤이라 다 들고 있을 까닭이 없어요)
  const standing = useMemo(() => {
    const cache = new Map<number, Standing>();
    return (k: number): Standing => {
      let st = cache.get(k);
      if (st) return st;
      if (cache.size >= 4) cache.clear();
      const order: number[] = [];
      const pos = new Int32Array(nI);
      if (k >= 0 && k < nF) for (let s = 0; s < nI; s++) if (model.series[s] !== "" && Number.isFinite(model.values[s][k])) order.push(s);
      order.sort((a, b) => model.values[b][k] - model.values[a][k] || a - b);
      order.forEach((s, i) => (pos[s] = i + 1));
      st = { order, pos };
      cache.set(k, st);
      return st;
    };
  }, [model, nF, nI]);

  // 칸 수는 모든 시점에서 같아요 (높이가 시점마다 바뀌지 않게): top과 한 시점에 값이 있는 항목 수 중 작은 것
  const stats = useMemo(() => {
    let most = 0;
    let hi = 0;
    let lo = 0;
    let ints = true;
    for (let k = 0; k < nF; k++) {
      let n = 0;
      for (let s = 0; s < nI; s++) {
        const v = model.values[s][k];
        if (!Number.isFinite(v) || model.series[s] === "") continue;
        n++;
        if (v > hi) hi = v;
        if (v < lo) lo = v;
        if (ints && !Number.isInteger(v)) ints = false;
      }
      most = Math.max(most, n);
    }
    return { most, hi, lo, ints };
  }, [model, nF, nI]);
  const top = typeof props.top === "number" && props.top >= 1 ? Math.min(50, Math.round(props.top)) : DEFAULT_TOP;
  const S = Math.max(1, Math.min(top, stats.most));
  const stepMs = typeof props.stepMs === "number" && props.stepMs > 0 ? clamp(props.stepMs, 100, 60000) : DEFAULT_STEP;

  // 시점 글자 자리는 모든 시점에서 한 번만 정해요 (재생, 넘겨 보기 중에 글자가 뛰지 않게). 그래서 높이를 정하기 전에 칸마다 무엇이 어디까지 닿는지 모아요.
  // fv는 useChart가 만드는 것과 같은 형식이에요 (높이 함수가 useChart 안에서 불려서 먼저 만들어요)
  const fvPre = useMemo(() => withUnit(makeFormatter(props.format, locale), props.unit), [props.format, locale, props.unit]);
  /**
   * 칸마다 막대 끝 후보 [막대 끝 위치(0~1), 값 글자 폭, 순위 표시 여부]: 모든 시점의 멈춘 자리와, 시점 사이 전환의 양 끝.
   * 전환 중 막대는 두 칸 사이의 칸을 모두 지나고(들고 나는 막대는 아래 끝 칸 S에서), 길이는 양 끝 사이에 있어서 양 끝만 보면 돼요
   */
  const lanes = useMemo(() => {
    const rows: number[][] = Array.from({ length: S }, () => []);
    // 시점마다 막대 길이의 기준(그리기와 같은 규칙: 위쪽 S개 값과 0)
    const lo = new Float64Array(nF);
    const hi = new Float64Array(nF);
    const add = (j0: number, j1: number, v: number, k: number, mark: boolean) => {
      const at = (Math.max(0, v) - lo[k]) / (hi[k] - lo[k]);
      const w = textWidth(fvPre(v), 11, 700);
      for (let j = j0; j <= j1; j++) rows[j].push(at, w, mark ? 1 : 0);
    };
    const slot = (st: Standing, s: number) => (st.pos[s] && st.pos[s] <= S ? st.pos[s] - 1 : S);
    for (let k = 0; k < nF; k++) {
      const now = standing(k);
      const prev = k ? standing(k - 1) : null;
      for (const s of now.order.slice(0, S)) {
        lo[k] = Math.min(lo[k], model.values[s][k]);
        hi[k] = Math.max(hi[k], model.values[s][k]);
      }
      if (hi[k] === lo[k]) hi[k] = lo[k] + 1;
      const items = new Set([...now.order.slice(0, S), ...(prev ? prev.order.slice(0, S) : [])]);
      for (const s of items) {
        const b = slot(now, s);
        const a = prev ? slot(prev, s) : b;
        const j0 = Math.min(a, b);
        const j1 = Math.min(S - 1, Math.max(a, b));
        // 지금 시점에 있으면 그 값과 순위 표시, 빠지는 막대는 지난 값을 들고 나가요 (순위 표시는 있다고 쳐요)
        const moved = b < S ? !!(prev && prev.pos[s] && prev.pos[s] !== now.pos[s]) : true;
        if (prev) add(j0, j1, a < S ? model.values[s][k - 1] : model.values[s][k], k - 1, moved);
        add(j0, j1, b < S ? model.values[s][k] : model.values[s][k - 1], k, moved);
      }
    }
    return rows;
  }, [standing, model, nF, S, fvPre]);
  const widestEm = useMemo(() => Math.max(0, ...model.series.slice(0, 2000).map((s) => textWidth(s, 1, 800))), [model]);
  /** 가장 긴 시점 글자의 1px당 폭. 모든 시점에 같은 크기를 쓰려고 가장 긴 글자로 재요 */
  const labelEm = useMemo(() => Math.max(0, ...Array.from(model.labels, (l) => textWidth(l, 1, 800))), [model]);
  const showLabels = props.showLabels !== false;
  const fixedH = props.height;
  /** 폭 w(와 정한 높이)에서 칸, 열, 시점 글자 자리. 높이 함수와 그리기가 같이 써요 */
  const plan = useMemo(() => {
    const columns = (w: number, plotH: number) => {
      const rowH = Math.max(1, plotH / S);
      const showText = rowH >= 12;
      const nameSize = rowH >= 22 ? 11.5 : 10.5;
      const showValues = showLabels && showText;
      const nameW = Math.min(w * 0.3, Math.max(20, widestEm * nameSize) + 10);
      const valueW = showValues ? Math.max(textWidth(fvPre(stats.hi), 11, 700), textWidth(fvPre(stats.lo), 11, 700)) + 8 : 0;
      const markW = showValues && nF > 1 ? textWidth(String(nI), 10, 700) + 18 : 0;
      const x0 = nameW + 6;
      const x1 = Math.max(x0 + 1, w - valueW - markW - 4);
      return { plotH, rowH, showText, nameSize, showValues, nameW, markW, x0, x1 };
    };
    /** 오른쪽 아래 구석에 들어가는 가장 큰 시점 글자 크기. 글자 상자가 덮는 칸에서 막대 끝, 값, 순위 표시가 모두 글자 왼쪽에 끝나야 해요. 없으면 0 */
    const corner = (w: number, g: ReturnType<typeof columns>) => {
      const reach = (j: number) => {
        let r = 0;
        const row = lanes[j];
        for (let i = 0; i < row.length; i += 3) r = Math.max(r, g.x0 + row[i] * (g.x1 - g.x0) + (g.showValues ? 6 + row[i + 1] + (row[i + 2] ? g.markW : 0) : 0));
        return r;
      };
      const pref = Math.min(72, g.plotH * 0.3, ((g.x1 - g.x0) * 0.6) / Math.max(0.1, labelEm));
      for (let z = pref; z >= LABEL_MIN; z -= 2) {
        const left = w - 2 - labelEm * z - LABEL_GAP;
        const first = Math.max(0, Math.floor((g.plotH - z * 0.82) / g.rowH));
        let clear = true;
        for (let j = first; j < S && clear; j++) clear = reach(j) <= left;
        if (clear) return z;
      }
      return 0;
    };
    const cache = new Map<string, ReturnType<typeof columns> & { band: number; label: number }>();
    return (w: number, h?: number) => {
      const key = `${w}|${h}`;
      let out = cache.get(key);
      if (out) return out;
      const plotH = h === undefined ? S * (w < 400 ? 26 : 30) : Math.max(1, h - PAD * 2);
      const g = columns(w, plotH);
      const size = labelEm > 0 && nI ? corner(w, g) : 0;
      // 구석에 들어가지 않으면 막대 아래 띠에 둬요. 정한 높이면 그 안에서 띠만큼 칸을 줄이고, 아니면 차트가 띠만큼 커져요
      out = size || !labelEm || !nI ? { ...g, band: 0, label: size } : { ...columns(w, h === undefined ? plotH : Math.max(1, plotH - BAND_H)), band: BAND_H, label: BAND_SIZE };
      if (cache.size > 8) cache.clear();
      cache.set(key, out);
      return out;
    };
  }, [lanes, S, nF, nI, widestEm, labelEm, showLabels, fvPre, stats.hi, stats.lo]);

  const c = useChart(props, {
    height: (w) => {
      const g = plan(w);
      return g.plotH + PAD * 2 + g.band;
    },
    duration: 700,
    stagger: 40,
  });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const gid = useId().replace(/:/g, "");

  // 보는 시점. startFrame이나 데이터가 바뀌면 그 시점으로 돌아가요
  const start = useMemo(() => {
    const k = frameIndex(model, props.startFrame);
    return k >= 0 ? k : last;
  }, [model, props.startFrame, last]);
  const [frame, setFrame] = useState(start);
  const [seen, setSeen] = useState(start);
  if (seen !== start) {
    setSeen(start);
    setFrame(start);
  }
  const f = Math.min(frame, last);
  const [playing, setPlaying] = useState(false);
  const canPlay = nF > 1 && !c.reduced;
  /** 마지막 시점 변화가 재생인지. 재생 중 전환은 시점 하나 길이로 고르게(linear), 넘겨 보기는 차트의 움직임(spring)이에요. 멈춰도 진행 중인 전환은 같은 방식으로 끝나요 */
  const mode = useRef<"play" | "step">("step");
  const frameRef = useRef(f);
  frameRef.current = f;
  /** 키보드나 단추로 시점을 옮긴 뒤에는 시점과 고른 항목을 읽어 줘요 (재생 중에는 읽지 않아요) */
  const told = useRef(false);
  const go = (k: number, how: "play" | "step") => {
    mode.current = how;
    frameRef.current = k;
    setFrame(k);
  };

  // 재생: 모든 차트가 같이 쓰는 프레임 루프에 붙어서, 화면에 보이고 탭이 보일 때만 시간이 흘러요. 늦게 온 프레임은 시점 하나까지만 쳐서 한꺼번에 넘어가지 않아요
  const active = c.motion.active;
  useEffect(() => {
    if (!playing || !canPlay || !active) return undefined;
    let at = 0;
    let acc = 0;
    let off: (() => void) | null = null;
    const tick = (now: number) => {
      acc += at ? Math.min(now - at, stepMs) : 0;
      at = now;
      if (acc < stepMs) return true;
      acc = 0;
      const next = frameRef.current + 1;
      go(Math.min(next, last), "play");
      if (next >= last) setPlaying(false);
      return true;
    };
    const watch = () => {
      off?.();
      off = null;
      at = 0;
      if (!document.hidden) off = subscribeTick(tick);
    };
    watch();
    document.addEventListener("visibilitychange", watch);
    return () => {
      off?.();
      document.removeEventListener("visibilitychange", watch);
    };
  }, [playing, canPlay, active, stepMs, last]);

  // autoplay: 움직임이 켜진 채 처음 화면에 들어올 때 한 번. startFrame이 없으면 첫 시점부터
  const autoDone = useRef(false);
  useEffect(() => {
    if (!props.autoplay || autoDone.current || !canPlay || !c.motion.enabled || !active) return;
    autoDone.current = true;
    if (props.startFrame === undefined) go(0, "step");
    setPlaying(true);
  }, [props.autoplay, props.startFrame, canPlay, c.motion.enabled, active]);

  const toggle = () => {
    if (playing) return setPlaying(false);
    told.current = false;
    if (frameRef.current >= last) go(0, "step");
    setPlaying(true);
  };
  /** 넘겨 보기 (키보드, 단추, 시점 막대): 재생을 멈추고 그 시점으로. 키보드로 고른 막대는 같은 항목을 따라가요 */
  const stepTo = (k: number, keyboard = false) => {
    setPlaying(false);
    told.current = true;
    const next = clamp(k, 0, last);
    if (keyboard && c.active !== null) {
      const s = shown[c.active]?.s;
      const slot = s === undefined ? -1 : standing(next).order.slice(0, S).indexOf(s);
      c.setActive(slot >= 0 ? slot : null, "keyboard");
    }
    if (next !== frameRef.current) go(next, "step");
  };

  const now = standing(f);
  const before = standing(f - 1);
  /** 지난 시점보다 오른 계단 수. 지난 시점에 없었거나 첫 시점이면 0 */
  const moveOf = (s: number) => (before.pos[s] && now.pos[s] ? before.pos[s] - now.pos[s] : 0);
  const shown = useMemo<Bar[]>(
    () => now.order.slice(0, S).map((s, slot) => ({ s, slot, value: model.values[s][f], move: moveOf(s) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now, before, S, model, f],
  );
  let lo = 0;
  let hi = 0;
  for (const b of shown) {
    lo = Math.min(lo, b.value);
    hi = Math.max(hi, b.value);
  }
  if (hi === lo) hi = lo + 1;

  // 강조는 항목 이름으로 정해서 모든 시점에서 같은 항목이에요. 기본은 마지막 시점의 1위
  const hiSet = useMemo(() => {
    const rows = model.rows.map((r) => r.findLast((d) => d !== null) ?? null);
    return resolveHighlight(props.highlight, rows as T[], model.series, model.series.map((_, s) => model.values[s][last]), "max");
  }, [model, props.highlight, last]);
  const colors = useMemo(() => emphasis(p, nI, hiSet), [p, nI, hiSet]);

  const play = mode.current === "play";
  const motion = { ...c.motion, dataKey: `${c.sig}|${f}`, stagger: 0, duration: props.duration ?? (play ? stepMs : 700), easing: props.easing ?? (play ? ("linear" as const) : c.motion.easing) };
  const stg = c.motion.stagger ?? 40;
  const marks = useMemo<Mark<Bar>[]>(() => shown.map((b) => ({ key: `r:${model.series[b.s]}`, to: [b.value, b.slot], from: [0, b.slot], enter: [b.value, S], exit: [b.value, S], delay: b.slot * stg, data: b })), [shown, model, S, stg]);
  const m = useMotion(marks, motion);
  const domMarks = useMemo<Mark<null>[]>(() => [{ key: "d", to: [lo, hi], data: null }], [lo, hi]);
  const dm = useMotion(domMarks, motion);
  const [d0, d1] = dm.get("d") ?? [lo, hi];

  // 가로 자리: 이름 열, 막대, 값과 순위 표시. 값 자리는 모든 시점의 가장 긴 값으로 잡아서 시점마다 막대 폭이 흔들리지 않아요
  const L = plan(W, fixedH === undefined ? undefined : H);
  const { plotH, rowH, showText, nameSize, showValues, nameW, x0, x1 } = L;
  const barH = Math.max(1, rowH * 0.7);
  const { fv } = c;
  // 자른 이름은 폭이 바뀔 때만 만들어요 (재생 중 프레임마다 자르지 않게)
  const names = useMemo(() => model.series.map((s, i) => truncate(s, nameW - 4, nameSize, hiSet.has(i) ? 800 : 500)), [model, nameW, nameSize, hiSet]);
  const span = d1 - d0 > 0 ? d1 - d0 : 1;
  const xs = (v: number) => x0 + ((v - d0) / span) * (x1 - x0);
  const yOf = (slot: number) => PAD + slot * rowH + (rowH - barH) / 2;
  const r = Math.min(p.theme.radiusMark, barH / 2);

  const nth = msg.nth;
  const moveText = (n: number) => (n > 0 ? msg.up(n) : msg.down(-n));
  const events = useMemo<ChartEvent<T>[]>(
    () =>
      shown.map((b) => ({
        datum: model.rows[b.s][f],
        index: b.slot,
        key: model.series[b.s],
        label: model.series[b.s],
        value: b.value,
        formatted: `${fv(b.value)}, ${nth(b.slot + 1)}${b.move ? `, ${moveText(b.move)}` : ""}`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, model, f, fv, msg],
  );

  const frameLabel = model.labels[f] ?? "";
  const narrate = (s: number) => {
    const mv = moveOf(s);
    return `${frameLabel}, ${model.series[s]}, ${nth(now.pos[s])}, ${fv(model.values[s][f])}${mv ? `, ${moveText(mv)}` : ""}`;
  };
  const focus = [...hiSet].find((s) => now.pos[s] > 0) ?? now.order[0];
  const announce =
    c.via === "keyboard" && c.active !== null && shown[c.active] ? narrate(shown[c.active].s) : told.current && !playing && focus !== undefined ? narrate(focus) : "";

  const lead = shown[0];
  const desc = props.description ?? (lead ? `${msg.kind}. ${msg.desc(now.order.length, nF, model.labels[0], model.labels[last])}. ${msg.lead(frameLabel, model.series[lead.s], fv(lead.value))}.` : "");

  const act = c.active !== null ? shown[c.active] : undefined;
  const tip: TooltipData | null = act
    ? {
        x: xs(Math.max(0, act.value)),
        y: yOf(act.slot),
        title: model.series[act.s],
        rows: [{ label: frameLabel, value: fv(act.value), color: colors[act.s].fill }, { label: msg.rank, value: `${nth(act.slot + 1)}${act.move ? ` (${moveText(act.move)})` : ""}`, strong: false }],
      }
    : null;

  // 뒤에 크고 조용하게 까는 시점 글자: 구석이면 그림 아래 끝에, 띠면 띠 가운데에 (plan이 모든 시점에서 막대와 겹치지 않는 자리를 골랐어요)
  const big = L.label;
  const labelY = L.band ? PAD + plotH + PAD + L.band - 7 : PAD + plotH - big * 0.08;
  const stepOnly = c.reduced && c.hydrated;

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
      onPointerMove={(_px, py, e) => {
        const k = Math.floor((py - PAD) / rowH);
        c.setActive(k >= 0 && k < events.length ? k : null, e.pointerType === "touch" ? "touch" : "pointer");
      }}
      onKey={(e) => {
        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && nF > 1) {
          stepTo(frameRef.current + (e.key === "ArrowRight" ? 1 : -1), true);
          return true;
        }
        if (e.key === " " && canPlay) {
          toggle();
          return true;
        }
        return false;
      }}
      defs={
        <clipPath id={`${gid}c`}>
          <rect x={0} y={0} width={W} height={plotH + PAD * 2} />
        </clipPath>
      }
      overlay={
        nF > 1 && nI ? (
          <Controls p={p} msg={msg} frame={f} last={last} labels={model.labels} playing={playing} stepOnly={stepOnly} canPlay={canPlay} narrow={W < 340} onToggle={toggle} onStep={stepTo} />
        ) : null
      }
    >
      {nI && frameLabel && big ? (
        <Txt x={W - 2} y={labelY} anchor="end" baseline="auto" size={big} weight={800} fill={p.paint("dim")} opacity={0.45} letterSpacing={-big * 0.03}>
          {frameLabel}
        </Txt>
      ) : null}
      {stats.lo < 0 ? <line x1={xs(0)} x2={xs(0)} y1={PAD} y2={PAD + plotH} stroke={p.paint("line")} strokeWidth={1} /> : null}
      <g clipPath={`url(#${gid}c)`}>
        {m.items.map((it) => {
          const b = it.data;
          // 순위 밖으로 밀려 내려가는 막대는 그대로 그려요. 데이터가 바뀌어 b.s가 다른 항목(또는 없는 항목)을 가리키면 이제 없는 항목이라 빼요
          if (it.exiting && it.key !== `r:${model.series[b.s]}`) return null;
          const [v, slot] = it.v;
          const y = yOf(slot);
          const a = xs(Math.min(0, v));
          const e = xs(Math.max(0, v));
          const isHi = hiSet.has(b.s);
          const isActive = !it.exiting && c.active === b.slot;
          // 아래 끝(칸 S)에 가까울수록 옅어져서 들고 나는 막대가 끝에서 사라져요
          const fade = clamp(S - slot, 0, 1);
          const op = fade * (c.active === null || isActive ? 1 : 0.55);
          const valueText = fv(it.progress >= 1 ? b.value : stats.ints ? Math.round(v) : v);
          const vx = (v < 0 ? xs(0) : e) + 6;
          const weight = isHi ? 800 : 500;
          const ink = p.paint(isHi ? "ink" : "muted");
          const cy = y + barH / 2;
          return (
            <g key={it.key} opacity={op < 1 ? op : undefined}>
              <path d={roundRectPath(a, y, e - a, barH, v < 0 ? { tl: r, bl: r } : { tr: r, br: r })} fill={colors[b.s].fill} className="ztd-mark" />
              {isActive && c.via === "keyboard" ? <path d={roundRectPath(a - 2, y - 2, e - a + 4, barH + 4, 4)} fill="none" stroke={p.paint("ink")} strokeWidth={2} /> : null}
              {showText ? (
                <Txt x={nameW} y={cy} anchor="end" size={nameSize} weight={weight} fill={ink}>
                  {names[b.s]}
                </Txt>
              ) : null}
              {showValues ? (
                <Txt x={vx} y={cy} size={11} weight={isHi ? 800 : 700} fill={p.paint("ink")}>
                  {valueText}
                </Txt>
              ) : null}
              {showValues && b.move ? <MoveMark p={p} x={vx + textWidth(fv(b.value), 11, 700) + 6} y={cy} move={b.move} /> : null}
            </g>
          );
        })}
      </g>
    </ChartFrame>
  );
}

/** 순위 변화: 오르면 강조 글자색 ▲, 내리면 흐린 ▼, 옆에 계단 수 */
function MoveMark({ p, x, y, move }: { p: Painter; x: number; y: number; move: number }) {
  const up = move > 0;
  const fill = p.paint(up ? "accentText" : "muted");
  return (
    <g aria-hidden="true">
      <path d={up ? `M${x},${y + 3}h7l-3.5,-6z` : `M${x},${y - 3}h7l-3.5,6z`} fill={fill} />
      <Txt x={x + 9} y={y} size={10} weight={700} fill={fill}>
        {Math.abs(move)}
      </Txt>
    </g>
  );
}

function Icon({ d }: { d: string[] }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {d.map((x, i) => (
        <path key={i} d={x} />
      ))}
    </svg>
  );
}

/**
 * 재생과 시점 막대 (SVG 밖 HTML). 단추는 카드의 다시 재생 단추와 같은 틀이에요.
 * 동작 줄이기에서는 재생 대신 이전, 다음 시점 단추예요. 시점 막대는 끌거나 화살표, Home, End, PageUp, PageDown으로 옮겨요
 */
function Controls(props: { p: Painter; msg: typeof en; frame: number; last: number; labels: string[]; playing: boolean; stepOnly: boolean; canPlay: boolean; narrow: boolean; onToggle: () => void; onStep: (k: number) => void }) {
  const { p, msg, frame, last } = props;
  const track = useRef<HTMLDivElement>(null);
  // ChartCard의 다시 재생 단추와 같은 틀
  const btn: CSSProperties = { background: "transparent", color: p.paint("muted"), border: `1px solid ${p.paint("line2")}`, borderRadius: 14, width: 28, height: 28, display: "inline-grid", placeItems: "center", padding: 0, flex: "none" };
  const edge: CSSProperties = { fontSize: 11, color: p.paint("muted"), whiteSpace: "nowrap", flex: "none", fontVariantNumeric: "tabular-nums" };
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    const k = Math.round(clamp((e.clientX - box.left) / box.width, 0, 1) * last);
    if (k !== frame) props.onStep(k);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.round((last + 1) / 10));
    const to: Record<string, number> = { ArrowLeft: frame - 1, ArrowDown: frame - 1, ArrowRight: frame + 1, ArrowUp: frame + 1, PageDown: frame - page, PageUp: frame + page, Home: 0, End: last };
    if (!(e.key in to)) return;
    e.preventDefault();
    props.onStep(to[e.key]);
  };
  const at = last ? (frame / last) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
      {props.stepOnly ? (
        <>
          <button type="button" className="ztd-btn" aria-label={msg.prev} title={msg.prev} disabled={frame <= 0} onClick={() => props.onStep(frame - 1)} style={{ ...btn, opacity: frame <= 0 ? 0.4 : undefined }}>
            <Icon d={ICONS.prev} />
          </button>
          <button type="button" className="ztd-btn" aria-label={msg.next} title={msg.next} disabled={frame >= last} onClick={() => props.onStep(frame + 1)} style={{ ...btn, opacity: frame >= last ? 0.4 : undefined }}>
            <Icon d={ICONS.next} />
          </button>
        </>
      ) : (
        <button type="button" className="ztd-btn" aria-label={props.playing ? msg.pause : msg.play} title={props.playing ? msg.pause : msg.play} disabled={!props.canPlay} onClick={props.onToggle} style={btn}>
          <Icon d={props.playing ? ICONS.pause : ICONS.play} />
        </button>
      )}
      {props.narrow ? null : <span style={edge}>{props.labels[0]}</span>}
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        className="ztd-btn"
        aria-label={msg.frame}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={frame}
        aria-valuetext={props.labels[frame]}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) pick(e);
        }}
        style={{ position: "relative", flex: 1, minWidth: 60, height: 28, touchAction: "none", borderRadius: 14 }}
      >
        <span style={{ position: "absolute", left: 0, right: 0, top: 12, height: 4, borderRadius: 2, background: p.paint("line") }} />
        <span style={{ position: "absolute", left: 0, width: `${at}%`, top: 12, height: 4, borderRadius: 2, background: p.paint("accent") }} />
        {/* 손잡이: 테두리를 넣은 14px 원. box-sizing을 정해 두어 페이지의 box-sizing과 상관없이 가운데가 선의 가운데(y 14)와 값 자리에 와요 */}
        <span style={{ position: "absolute", left: `calc(${at}% - 7px)`, top: 7, width: 14, height: 14, boxSizing: "border-box", borderRadius: 7, border: `2px solid ${p.paint("accent")}`, background: p.paint("panel") }} />
      </div>
      {props.narrow ? null : <span style={edge}>{props.labels[last]}</span>}
    </div>
  );
}
