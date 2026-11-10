import { isoDay } from "../core/format";
import { langOf } from "../core/i18n";
import { toNumber } from "../data/accessor";
import { useChartLocale, useChartTheme } from "../theme/context";
import type { ChartTheme } from "../theme/tokens";

export type DownloadFormat = "csv" | "svg" | "png";

export interface DownloadButtonsProps {
  /** CSV로 내려받을 행 */
  data: readonly Record<string, unknown>[];
  /** CSV 열과 순서. 없거나 비었으면 앞 200행에 나오는 모든 열 */
  columns?: readonly string[];
  /** 파일 이름(확장자 빼고). 없으면 "chart" */
  filename?: string;
  /** 보일 단추. 기본 셋 다. 순서는 늘 CSV, SVG, PNG */
  formats?: readonly DownloadFormat[];
  /** 단추 글자의 로캘. 없으면 ThemeProvider를 따라요 */
  locale?: string;
  theme?: Partial<ChartTheme>;
}

const FORMATS: DownloadFormat[] = ["csv", "svg", "png"];
/** 셀 앞에 오면 스프레드시트가 수식으로 읽는 글자 (OWASP CSV Injection: 줄바꿈과 전각 글자도 넣어요) */
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/;
/** 페이지 밖에서는 못 읽는 색 표기 */
const PAGE_ONLY = /var\(|color-mix\(/;

/** 셀 하나: 유한한 수는 그대로, 비었으면 빈칸, 나머지는 따옴표로 감싼 글자. 수식처럼 시작하는 글자는 앞에 ' 를 붙여요 */
function csvCell(v: unknown): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (v === null || v === undefined || (v instanceof Date && Number.isNaN(v.getTime()))) return "";
  // 날짜는 로컬 날짜로
  const s = v instanceof Date ? isoDay(v.getTime()) : String(v);
  return `"${(FORMULA_START.test(s) && !Number.isFinite(toNumber(s)) ? `'${s}` : s).replace(/"/g, '""')}"`;
}

/** 앞 200행에 나오는 모든 열 */
export function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
  return [...new Set(rows.slice(0, 200).flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))];
}

/** 엑셀이 UTF-8로 여는 CSV: BOM, CRLF 줄바꿈, 첫 줄은 열 이름 */
export function csvText(rows: readonly Record<string, unknown>[], columns: readonly string[]): string {
  const lines = [columns.map(csvCell), ...rows.map((r) => columns.map((c) => csvCell(r[c])))];
  return `${String.fromCharCode(0xfeff)}${lines.map((l) => l.join(",")).join("\r\n")}\r\n`;
}

/** 파일 이름에 못 쓰는 글자와 줄바꿈은 -로, 80자까지 */
export function fileName(s: string | undefined): string {
  return Array.from((s ?? "").replace(/[\\/:*?"<>|\r\n\t]+/g, "-").trim()).slice(0, 80).join("") || "chart";
}

function save(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  // 내려받기가 시작된 뒤에 풀어요 (바로 풀면 몇몇 브라우저는 파일을 못 받아요)
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** PNG 배율 (CLI의 기본 배율과 같아요) */
const PNG_SCALE = 2;
/** 내보낸 그림 둘레의 여백(차트 좌표). 그림이 끝에 붙지 않고, viewBox 밖으로 조금 나간 글자(36종 예시에서 최대 7)도 담겨요 */
const PAD = 16;

interface Snapshot {
  svg: string;
  /** 여백을 더한 내보낸 그림 크기 */
  w: number;
  h: number;
  /** 차트 viewBox 크기 (캔버스 밑그림이 덮는 영역) */
  vw: number;
  vh: number;
  bg: string;
  canvas: HTMLCanvasElement | null;
}

/** oklab() 같은 새 색 표기는 디자인 도구가 못 읽어요. 캔버스 한 점에 칠해 rgb로 바꿔요 */
function rgbOf(c: string, memo: Map<string, string>): string {
  if (!/^(ok)?l(ab|ch)\(|^color\(/.test(c)) return c;
  let out = memo.get(c);
  if (out) return out;
  const g = document.createElement("canvas").getContext("2d");
  if (!g) return c;
  g.fillStyle = c;
  g.fillRect(0, 0, 1, 1);
  const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data;
  out = a === 255 ? `rgb(${r}, ${gr}, ${b})` : `rgba(${r}, ${gr}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
  memo.set(c, out);
  return out;
}

function make(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * 단추가 든 카드의 차트 SVG를 페이지 밖에서도 같은 색, 같은 글꼴 목록으로 보이게 복제해요.
 * scale은 width, height 배율(PNG는 2), withBackground면 배경 사각형과 캔버스 밑그림(image)을 넣어요
 */
function snapshot(from: Element, scale: number, withBackground: boolean): Snapshot | null {
  const card = from.closest(".ztd-card");
  const svg = card?.querySelector<SVGSVGElement>("svg.ztd-svg");
  if (!card || !svg) return null;
  const { width: vw, height: vh } = svg.viewBox.baseVal;
  const [w, h] = [vw + PAD * 2, vh + PAD * 2];
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const copies = clone.querySelectorAll("*");
  const memo = new Map<string, string>();
  svg.querySelectorAll("*").forEach((el, i) => {
    let cs: CSSStyleDeclaration | undefined;
    for (const a of Array.from(el.attributes)) {
      if (!PAGE_ONLY.test(a.value)) continue;
      const v = (cs ??= getComputedStyle(el)).getPropertyValue(a.name);
      if (v) copies[i].setAttribute(a.name, rgbOf(v, memo));
    }
  });
  // 페이지에서 물려받던 글꼴(font-family: inherit)과 크기(width 100%)를 값으로 적어요
  clone.removeAttribute("style");
  for (const [k, v] of Object.entries({ viewBox: `${-PAD} ${-PAD} ${w} ${h}`, width: w * scale, height: h * scale, "font-family": getComputedStyle(svg).fontFamily })) clone.setAttribute(k, String(v));
  const bg = rgbOf(getComputedStyle(card).backgroundColor, memo);
  const canvas = svg.parentElement?.querySelector("canvas") ?? null;
  if (withBackground) {
    // title, desc 다음, 차트 그림 앞에: 배경, 캔버스 밑그림 순서
    const at = clone.querySelector("desc")?.nextSibling ?? clone.firstChild;
    clone.insertBefore(make("rect", { x: -PAD, y: -PAD, width: w, height: h, fill: bg }), at);
    if (canvas) clone.insertBefore(make("image", { href: canvas.toDataURL(), width: vw, height: vh }), at);
  }
  return { svg: new XMLSerializer().serializeToString(clone), w, h, vw, vh, bg, canvas };
}

/** PNG(2배): 배경, 캔버스 밑그림, SVG 순서로 칠해요. 같은 출처 blob 그림이라 캔버스가 막히지 않아요. SVG를 그림으로 그리면 웹 글꼴은 못 읽어 설치된 글꼴로 그려요 */
function savePng(from: Element, name: string): void {
  const s = snapshot(from, PNG_SCALE, false);
  if (!s) return;
  const k = PNG_SCALE;
  const c = document.createElement("canvas");
  c.width = Math.ceil(s.w * k);
  c.height = Math.ceil(s.h * k);
  const g = c.getContext("2d");
  if (!g) return;
  g.fillStyle = s.bg;
  g.fillRect(0, 0, c.width, c.height);
  if (s.canvas) g.drawImage(s.canvas, PAD * k, PAD * k, s.vw * k, s.vh * k);
  const url = URL.createObjectURL(new Blob([s.svg], { type: "image/svg+xml" }));
  const img = new Image();
  img.onload = () => {
    g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob((b) => b && save(b, `${name}.png`), "image/png");
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

/**
 * 내려받기 단추(CSV, SVG, PNG). 카드(ChartCard)의 actions에 넣어요.
 * CSV는 data를 columns 순서로, SVG와 PNG는 단추가 든 카드의 차트 그림만 (카드 제목, 범례, 출처 줄은 빼고) 내려받아요
 */
export function DownloadButtons(props: DownloadButtonsProps) {
  const p = useChartTheme(props.theme);
  const ko = langOf(useChartLocale(props.locale)) === "ko";
  const name = fileName(props.filename);
  const run = (f: DownloadFormat, btn: HTMLElement) => {
    if (f === "csv") return save(new Blob([csvText(props.data, props.columns?.length ? props.columns : columnsOf(props.data))], { type: "text/csv;charset=utf-8" }), `${name}.csv`);
    if (f === "png") return savePng(btn, name);
    const s = snapshot(btn, 1, true);
    if (s) save(new Blob([s.svg], { type: "image/svg+xml" }), `${name}.svg`);
  };
  return (
    <span style={{ display: "inline-flex", gap: 6, flex: "none" }}>
      {FORMATS.filter((f) => !props.formats || props.formats.includes(f)).map((f) => {
        const F = f.toUpperCase();
        const label = ko ? `${F} 내려받기` : `Download ${F}`;
        return (
          <button
            key={f}
            type="button"
            className="ztd-btn"
            aria-label={label}
            title={label}
            onClick={(e) => run(f, e.currentTarget)}
            style={{ background: "transparent", color: p.paint("muted"), border: `1px solid ${p.paint("line2")}`, borderRadius: 14, height: 28, padding: "0 10px", fontSize: 12, fontWeight: 700, flex: "none" }}
          >
            {F}
          </button>
        );
      })}
    </span>
  );
}
