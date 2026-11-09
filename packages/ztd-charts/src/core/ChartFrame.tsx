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
  /** 차트 종류 이름. 예: "Pie chart" */
  kind: string;
  ariaLabel?: string;
  description: string;
  /** 그릴 것이 없을 때 설명 (기본 "No data."). 데이터는 있는데 못 그리는 까닭을 알려 줘요 */
  emptyText?: string;
  events: ChartEvent<T>[];
  tip: TooltipData | null;
  renderTip?: ((e: ChartEvent<T>) => ReactNode) | boolean;
  className?: string;
  style?: CSSProperties;
  theme?: Partial<ChartTheme>;
  /** 포인터가 svg 위에서 움직일 때 (svg 좌표) */
  onPointerMove?: (x: number, y: number, e: PointerEvent<SVGSVGElement>) => void;
  /** 포인터를 누를 때, 뗄 때 (svg 좌표). 구간 선택처럼 끌기를 쓰는 차트용 */
  onPointerDown?: (x: number, y: number, e: PointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (x: number, y: number, e: PointerEvent<SVGSVGElement>) => void;
  /** 기본 키보드 탐색보다 먼저 받아요. true를 돌려주면 기본 처리를 건너뛰어요 */
  onKey?: (e: KeyboardEvent<HTMLDivElement>) => boolean;
  /** 스크린리더에 읽어 줄 문장. 있으면 고른 항목 대신 이걸 읽어요 */
  announce?: string;
  defs?: ReactNode;
  children?: ReactNode;
  /** svg 위에 올리는 HTML */
  overlay?: ReactNode;
  /** svg 아래에 까는 HTML (캔버스) */
  underlay?: ReactNode;
  /** 키보드 탐색 끄기 */
  noNav?: boolean;
}

const MAX_TABLE_ROWS = 60;
const MAX_TIP_ROWS = 8;

/** 계열이 많은 툴팁은 앞 8줄만 보여 주고, 빠진 계열 수를 마지막 줄에 알려요. 보여 줄 순서로 정렬해서 넘겨요 */
export function capTipRows(rows: TooltipRow[], more: (n: number) => string): TooltipRow[] {
  return rows.length > MAX_TIP_ROWS ? [...rows.slice(0, MAX_TIP_ROWS), { label: more(rows.length - MAX_TIP_ROWS), value: "" }] : rows;
}
/** 화면에서 숨기고 스크린리더만 읽게. 인라인이라 CSS가 들어오기 전(SSR, JS 없음)에도 숨어요 */
const SR_ONLY: CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

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
  // 이름: ariaLabel, 그다음 감싼 카드의 제목, 그다음 차트 종류("Bar chart")
  const cardTitle = useContext(CardTitleContext);
  const label = props.ariaLabel ?? cardTitle ?? props.kind;
  // 표 내용이 같으면 다시 만들지 않아요. 등장 애니메이션 중 매 프레임 렌더되고, events를 매번 새로 만드는 차트도 있어서
  // 배열이 아니라 표에 실제로 들어가는 글자로 비교해요 (최대 60행). 글자는 배열이 바뀔 때만, 표를 보일 때만 만들어요
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
    // nav일 때만 달아요. 안쪽 버튼(줌 "전체 보기" 등)에서 올라온 키는 그 버튼 몫이에요
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
        // 고른 게 없으면 Escape를 삼키지 않아요 (대화상자 닫기 같은 바깥 처리가 받게)
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

  // 터치로 고른 항목은 바깥을 누를 때까지 유지. c는 렌더마다 새 객체라 쓰는 값만 의존해요
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
  // 묶인 다른 차트에서 짚은 자리(sync)는 세로선만 보여 주고 툴팁은 짚은 차트에만 띄워요
  const tip = c.showTooltip && props.renderTip !== false && !c.pending && c.via !== "sync" ? props.tip : null;
  // 반응형이면 viewBox 폭이 곧 잰 폭이라 배율이 1이에요. 고정 폭일 때만 재요 (재면 레이아웃을 강제해요)
  const scale = tip && !c.responsive && c.node && c.width ? c.node.getBoundingClientRect().width / c.width || 1 : 1;
  const custom = typeof props.renderTip === "function" && activeEvent ? props.renderTip(activeEvent) : null;
  const live = props.announce ?? (c.via === "keyboard" && activeEvent ? `${activeEvent.label}${activeEvent.series ? ` ${activeEvent.series}` : ""}: ${activeEvent.formatted ?? activeEvent.value ?? ""} (${(c.active ?? 0) + 1}/${count})` : "");

  let tipStyle: CSSProperties | undefined;
  if (tip) {
    const px = tip.x * scale;
    const boxW = c.width * scale;
    // 점 가운데에 두되 차트 양끝 4px 안으로 가둬요 (translate의 %는 툴팁 자기 폭 기준이라 폭을 재지 않아도 돼요)
    const shiftX = `clamp(${(4 - px).toFixed(1)}px, -50%, calc(${(boxW - px - 4).toFixed(1)}px - 100%))`;
    const below = tip.y < 64;
    // 카드 바탕 위에 뜨는 작은 카드: 테두리와 그림자로 차트와 갈라요. left, top은 CSS 전환으로 다음 점까지 미끄러져요
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

  // svg 좌표로 바꿔 넘겨요. 위치는 들어올 때 한 번 재고 스크롤, 크기 변화 때만 다시 재요 (움직일 때마다 재면 레이아웃을 강제해요)
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
  // 손가락으로 톡 누르면 pointermove 없이 pointerdown만 와요. 움직임으로 값을 읽는 차트도 누른 자리를 보여 줘요
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

/** 차트 안의 SVG 글자 */
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
