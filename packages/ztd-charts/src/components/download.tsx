import { isoDay } from "../core/format";
import { langOf } from "../core/i18n";
import { toNumber } from "../data/accessor";
import { useChartLocale, useChartTheme } from "../theme/context";
import type { ChartTheme } from "../theme/tokens";

export type DownloadFormat = "csv" | "svg" | "png";

export interface DownloadButtonsProps {
  /** Rows to download as CSV */
  data: readonly Record<string, unknown>[];
  /** CSV columns and their order. When omitted or empty, every column that appears in the first 200 rows */
  columns?: readonly string[];
  /** File name (without extension). When omitted, "chart" */
  filename?: string;
  /** Buttons to show. Default all three. The order is always CSV, SVG, PNG */
  formats?: readonly DownloadFormat[];
  /** Locale of the button text. Follows ThemeProvider when omitted */
  locale?: string;
  theme?: Partial<ChartTheme>;
}

const FORMATS: DownloadFormat[] = ["csv", "svg", "png"];
/** Characters that make a spreadsheet read a cell as a formula when they come first (OWASP CSV Injection: line breaks and full-width characters included) */
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/;
/** Color notations that cannot be read outside the page */
const PAGE_ONLY = /var\(|color-mix\(/;

/** One cell: finite numbers as is, empty for missing values, everything else as quoted text. Text that starts like a formula gets a leading ' */
function csvCell(v: unknown): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (v === null || v === undefined || (v instanceof Date && Number.isNaN(v.getTime()))) return "";
  // Dates as local dates
  const s = v instanceof Date ? isoDay(v.getTime()) : String(v);
  return `"${(FORMULA_START.test(s) && !Number.isFinite(toNumber(s)) ? `'${s}` : s).replace(/"/g, '""')}"`;
}

/** Every column that appears in the first 200 rows */
export function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
  return [...new Set(rows.slice(0, 200).flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))];
}

/** CSV that Excel opens as UTF-8: BOM, CRLF line breaks, column names on the first line */
export function csvText(rows: readonly Record<string, unknown>[], columns: readonly string[]): string {
  const lines = [columns.map(csvCell), ...rows.map((r) => columns.map((c) => csvCell(r[c])))];
  return `${String.fromCharCode(0xfeff)}${lines.map((l) => l.join(",")).join("\r\n")}\r\n`;
}

/** Characters not allowed in file names, and line breaks, become -; up to 80 characters */
export function fileName(s: string | undefined): string {
  return Array.from((s ?? "").replace(/[\\/:*?"<>|\r\n\t]+/g, "-").trim()).slice(0, 80).join("") || "chart";
}

function save(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  // Revoke after the download starts (revoking right away makes some browsers fail to save the file)
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** PNG scale (same as the CLI's default scale) */
const PNG_SCALE = 2;
/** Margin around the exported image (chart coordinates). Keeps the drawing off the edges and also fits text that spills slightly past the viewBox (up to 7 in the examples of the 36 charts) */
const PAD = 16;

interface Snapshot {
  svg: string;
  /** Exported image size including the margin */
  w: number;
  h: number;
  /** Chart viewBox size (the area the canvas underlay covers) */
  vw: number;
  vh: number;
  bg: string;
  canvas: HTMLCanvasElement | null;
}

/** Design tools cannot read newer color notations such as oklab(). Paints one canvas pixel to convert them to rgb */
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
 * Clones the chart SVG of the card that holds the buttons so it shows the same colors and font list outside the page.
 * scale multiplies width and height (2 for PNG); withBackground adds a background rectangle and the canvas underlay (image)
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
  // Write out the font (font-family: inherit) and size (width 100%) inherited from the page as values
  clone.removeAttribute("style");
  for (const [k, v] of Object.entries({ viewBox: `${-PAD} ${-PAD} ${w} ${h}`, width: w * scale, height: h * scale, "font-family": getComputedStyle(svg).fontFamily })) clone.setAttribute(k, String(v));
  const bg = rgbOf(getComputedStyle(card).backgroundColor, memo);
  const canvas = svg.parentElement?.querySelector("canvas") ?? null;
  if (withBackground) {
    // After title and desc, before the chart drawing: background, then canvas underlay
    const at = clone.querySelector("desc")?.nextSibling ?? clone.firstChild;
    clone.insertBefore(make("rect", { x: -PAD, y: -PAD, width: w, height: h, fill: bg }), at);
    if (canvas) clone.insertBefore(make("image", { href: canvas.toDataURL(), width: vw, height: vh }), at);
  }
  return { svg: new XMLSerializer().serializeToString(clone), w, h, vw, vh, bg, canvas };
}

/** PNG (2x): paints the background, the canvas underlay, then the SVG. A same-origin blob image does not taint the canvas. An SVG drawn as an image cannot load web fonts, so installed fonts are used */
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
 * Download buttons (CSV, SVG, PNG). Put them in a card's (ChartCard) actions.
 * CSV downloads data in columns order; SVG and PNG download only the chart drawing of the card that holds the buttons (without the card title, legend and source line)
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
