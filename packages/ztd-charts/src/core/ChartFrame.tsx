import { useContext, useEffect, useId, useMemo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { overrideVars } from "../theme/context";
import { CardTitleContext } from "./cardTitle";
import type { ChartTheme } from "../theme/tokens";
import { ensureBaseStyles } from "./css";
import { useIsoLayoutEffect } from "./env";
import type { ChartMessages } from "./i18n";
import type { ChartCtx } from "./useChart";
import type { ChartEvent, TooltipData, TooltipRow } from "./types";

export interface ChartFrameProps<T> {
  c: ChartCtx<T>;
  /** Name of the chart type, e.g. "Pie chart" */
  kind: string;
  ariaLabel?: string;
  description: string;
  /** Message shown when there is nothing to draw (default "No data."). Tells why data that exists cannot be drawn */
  emptyText?: string;
  events: ChartEvent<T>[];
  tip: TooltipData | null;
  renderTip?: ((e: ChartEvent<T>) => ReactNode) | boolean;
  className?: string;
  style?: CSSProperties;
  theme?: Partial<ChartTheme>;
  /** Called when the pointer moves over the svg (svg coordinates) */
  onPointerMove?: (x: number, y: number, e: PointerEvent<SVGSVGElement>) => void;
  /** Called when the pointer is pressed and released (svg coordinates). For charts that use dragging, such as range selection */
  onPointerDown?: (x: number, y: number, e: PointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (x: number, y: number, e: PointerEvent<SVGSVGElement>) => void;
  /** Receives key events before the default keyboard navigation. Return true to skip the default handling */
  onKey?: (e: KeyboardEvent<HTMLDivElement>) => boolean;
  /** Sentence for screen readers to announce. When set, it is read instead of the selected item */
  announce?: string;
  defs?: ReactNode;
  children?: ReactNode;
  /** HTML layered above the svg */
  overlay?: ReactNode;
  /** HTML laid under the svg (canvas) */
  underlay?: ReactNode;
  /** Turns off keyboard navigation */
  noNav?: boolean;
}

const MAX_TABLE_ROWS = 60;
const MAX_TIP_ROWS = 8;

/** A tooltip with many series shows only the first 8 rows and gives the number of omitted series in the last row. Pass the rows sorted in display order */
export function capTipRows(rows: TooltipRow[], more: (n: number) => string): TooltipRow[] {
  return rows.length > MAX_TIP_ROWS ? [...rows.slice(0, MAX_TIP_ROWS), { label: more(rows.length - MAX_TIP_ROWS), value: "" }] : rows;
}
/** Hidden on screen and read only by screen readers. Inline, so it stays hidden before the CSS arrives (SSR, no JS) */
export const SR_ONLY: CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

export function ChartFrame<T>(props: ChartFrameProps<T>) {
  const { c, events } = props;
  const uid = useId().replace(/:/g, "");
  const titleId = `${uid}t`;
  const descId = `${uid}d`;
  c.events.current = events;
  useIsoLayoutEffect(() => {
    ensureBaseStyles();
  }, []);

  const count = events.length;
  const nav = !props.noNav && count > 0;
  // Name: ariaLabel, then the title of the wrapping card, then the chart type ("Bar chart")
  const cardTitle = useContext(CardTitleContext);
  const label = props.ariaLabel ?? cardTitle ?? props.kind;
  // Not rebuilt when the table content is unchanged: it renders every frame during the entrance animation, and some charts create events anew each time
  // Compared by the text that actually goes into the table (up to 60 rows), not by the array. The text is built only when the array changes and the table is shown
  const tableSig = useMemo(
    () =>
      nav
        ? `${events.length}\u0002${events
            .slice(0, MAX_TABLE_ROWS)
            .map((e) => `${e.label}\u0001${e.series ?? ""}\u0001${e.formatted ?? e.value ?? ""}`)
            .join("\u0002")}`
        : "",
    [events, nav],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const table = useMemo(() => <DataTable label={label} events={events} t={c.t} />, [label, tableSig, c.t]);
  const svgRect = useRef<DOMRect | null>(null);
  useEffect(() => {
    const drop = () => {
      svgRect.current = null;
    };
    window.addEventListener("scroll", drop, { capture: true, passive: true });
    window.addEventListener("resize", drop, { passive: true });
    return () => {
      window.removeEventListener("scroll", drop, { capture: true });
      window.removeEventListener("resize", drop);
    };
  }, []);
  useEffect(() => {
    svgRect.current = null;
  }, [c.width, c.height]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Attached only with nav. Keys bubbling up from an inner button (such as the zoom's "Show all") belong to that button
    if (e.target !== e.currentTarget) return;
    if (props.onKey?.(e)) {
      e.preventDefault();
      return;
    }
    const cur = c.active;
    let next: number | null | undefined;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = cur === null ? 0 : (cur + 1) % count;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = cur === null ? count - 1 : (cur - 1 + count) % count;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      case "Escape":
        // With nothing selected, Escape is not swallowed (so an outer handler, such as closing a dialog, receives it)
        if (cur === null) return;
        next = null;
        break;
      case "Enter":
      case " ":
        if (cur !== null) {
          e.preventDefault();
          c.click(cur);
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    c.setActive(next, "keyboard");
  };

  // An item selected by touch stays selected until a press outside. c is a new object every render, so the effect depends only on the values it uses
  const { via, node, setActive } = c;
  useEffect(() => {
    if (via !== "touch" || !node) return undefined;
    const off = (ev: Event) => {
      if (!node.contains(ev.target as Node)) setActive(null);
    };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [via, node, setActive]);

  const activeEvent = c.active !== null ? events[c.active] : null;
  // A spot pointed at in another linked chart (sync) shows only the vertical line; the tooltip appears only on the chart being pointed at
  const tip = c.showTooltip && props.renderTip !== false && !c.pending && c.via !== "sync" ? props.tip : null;
  // When responsive, the viewBox width is the measured width, so the scale is 1. Measured only for a fixed width (measuring forces a layout)
  const scale = tip && !c.responsive && c.node && c.width ? c.node.getBoundingClientRect().width / c.width || 1 : 1;
  const custom = typeof props.renderTip === "function" && activeEvent ? props.renderTip(activeEvent) : null;
  const live = props.announce ?? (c.via === "keyboard" && activeEvent ? `${activeEvent.label}${activeEvent.series ? ` ${activeEvent.series}` : ""}: ${activeEvent.formatted ?? activeEvent.value ?? ""} (${(c.active ?? 0) + 1}/${count})` : "");

  let tipStyle: CSSProperties | undefined;
  if (tip) {
    const px = tip.x * scale;
    const boxW = c.width * scale;
    // Centered on the point but kept 4px inside both edges of the chart (a translate % is relative to the tooltip's own width, so no width measurement is needed)
    const shiftX = `clamp(${(4 - px).toFixed(1)}px, -50%, calc(${(boxW - px - 4).toFixed(1)}px - 100%))`;
    const below = tip.y < 64;
    // A small card floating over the card background: a border and shadow set it apart from the chart. left and top glide to the next point with a CSS transition
    tipStyle = {
      position: "absolute",
      left: px,
      top: tip.y * scale,
      transform: `translate(${shiftX}, ${below ? "16px" : "calc(-100% - 14px)"})`,
      background: c.p.paint("panel"),
      color: c.p.paint("ink"),
      border: `1px solid ${c.p.paint("line")}`,
      borderRadius: 12,
      padding: "8px 11px",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      fontSize: 12,
      lineHeight: "18px",
      zIndex: 5,
      boxShadow: "0 10px 28px -8px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.08)",
      fontVariantNumeric: "tabular-nums",
      minWidth: 112,
      maxWidth: Math.max(160, c.width * scale - 8),
    };
  }

  const onLeave = (e: PointerEvent<HTMLDivElement>) => {
    svgRect.current = null;
    if (e.pointerType === "touch") return;
    if (c.via !== "keyboard") c.setActive(null);
  };

  // Passed on in svg coordinates. The position is measured once on enter and again only on scroll or resize (measuring on every move would force a layout)
  const inSvg = (fn: ((x: number, y: number, e: PointerEvent<SVGSVGElement>) => void) | undefined) =>
    fn
      ? (e: PointerEvent<SVGSVGElement>) => {
          const r = (svgRect.current ??= e.currentTarget.getBoundingClientRect());
          if (!r.width) return;
          fn(((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height, e);
        }
      : undefined;
  const onMove = inSvg(props.onPointerMove);
  const onDownProp = inSvg(props.onPointerDown);
  // A finger tap sends only pointerdown, without pointermove. This lets charts that read values on move also show the tapped spot
  const onDown =
    onMove || onDownProp
      ? (e: PointerEvent<SVGSVGElement>) => {
          if (e.pointerType === "touch") onMove?.(e);
          onDownProp?.(e);
        }
      : undefined;
  const onUp = inSvg(props.onPointerUp);

  const vars = overrideVars(props.theme);
  return (
    <div
      ref={c.ref}
      className={`ztd-root${c.reduced ? " ztd-still" : ""}${props.className ? ` ${props.className}` : ""}`}
      role="group"
      aria-roledescription={c.t.chart}
      aria-label={label}
      aria-describedby={descId}
      tabIndex={nav ? 0 : undefined}
      onKeyDown={nav ? onKey : undefined}
      onBlur={(e) => {
        if (c.via === "keyboard" && !e.currentTarget.contains(e.relatedTarget as Node)) c.setActive(null);
      }}
      onPointerLeave={onLeave}
      style={{
        width: "100%",
        maxWidth: c.measured ? undefined : "100%",
        fontFamily: c.p.cssVars ? `var(--ztd-font, ${c.p.theme.fontFamily})` : c.p.theme.fontFamily,
        color: c.p.paint("ink"),
        ...vars,
        ...props.style,
      }}
    >
      {c.pending ? null : props.underlay}
      <svg
        className="ztd-svg"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        viewBox={`0 0 ${Math.max(1, Math.round(c.width * 10) / 10)} ${Math.max(1, Math.round(c.height * 10) / 10)}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ fontFamily: "inherit", touchAction: "pan-y", position: props.underlay ? "relative" : undefined }}
      >
        <title id={titleId}>{label}</title>
        <desc id={descId}>{count || c.description !== undefined ? props.description : props.emptyText ?? c.t.empty}</desc>
        {props.defs && !c.pending ? <defs>{props.defs}</defs> : null}
        {c.pending ? null : props.children}
      </svg>
      {c.pending ? null : props.overlay}
      {tip ? (
        <div className="ztd-tip" aria-hidden="true" style={tipStyle}>
          {custom ?? (
            <>
              <div style={{ fontWeight: 600, fontSize: 11.5, color: c.p.paint("muted"), marginBottom: tip.rows.length ? 4 : 0, overflow: "hidden", textOverflow: "ellipsis" }}>{tip.title}</div>
              {tip.rows.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: c.p.paint(r.strong ? "ink" : "muted") }}>
                    {r.color ? <span style={{ width: 8, height: 8, borderRadius: 999, background: r.color, display: "inline-block", boxShadow: "inset 0 0 0 1px rgba(127,127,127,0.3)" }} /> : null}
                    {r.label}
                  </span>
                  <span style={{ fontWeight: r.strong === false ? 500 : 700 }}>{r.value}</span>
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}
      <span className="ztd-sr" style={SR_ONLY} aria-live="polite" aria-atomic="true">
        {live}
      </span>
      {nav && !c.pending ? table : null}
    </div>
  );
}

function DataTable<T>({ label, events, t }: { label: string; events: ChartEvent<T>[]; t: ChartMessages }) {
  return (
    <div className="ztd-sr" style={SR_ONLY}>
      <table>
        <caption>{t.table(label)}</caption>
        <tbody>
          {events.slice(0, MAX_TABLE_ROWS).map((e, i) => (
            <tr key={i}>
              <th scope="row">{e.series ? `${e.label} · ${e.series}` : e.label}</th>
              <td>{e.formatted ?? e.value ?? ""}</td>
            </tr>
          ))}
          {events.length > MAX_TABLE_ROWS ? (
            <tr>
              <td colSpan={2}>{t.more(events.length - MAX_TABLE_ROWS)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** SVG text inside a chart */
export function Txt(props: {
  x: number;
  y: number;
  children?: ReactNode;
  size?: number;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  weight?: number;
  opacity?: number;
  baseline?: "central" | "auto" | "hanging";
  className?: string;
  letterSpacing?: number;
}) {
  const b = props.baseline ?? "central";
  return (
    <text
      x={Math.round(props.x * 10) / 10}
      y={Math.round(props.y * 10) / 10}
      dy={b === "central" ? "0.35em" : b === "hanging" ? "0.75em" : undefined}
      fontSize={props.size ?? 11}
      fill={props.fill ?? "currentColor"}
      textAnchor={props.anchor ?? "start"}
      fontWeight={props.weight ?? 400}
      opacity={props.opacity === undefined || props.opacity >= 1 ? undefined : Math.max(0, props.opacity)}
      className={props.className}
      letterSpacing={props.letterSpacing}
      style={{ pointerEvents: "none", fontVariantNumeric: "tabular-nums" }}
    >
      {props.children}
    </text>
  );
}
