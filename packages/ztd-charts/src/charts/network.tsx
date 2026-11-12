import { useMemo, useState, type PointerEvent, type ReactNode } from "react";
import { ChartFrame } from "../core/ChartFrame";
import { clamp, r2, sum } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import { plural, type ChartLang } from "../core/i18n";
import type { Mark } from "../core/motion";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { hasField, numGetter, strGetter } from "../data/accessor";
import { byDegree, groupNames, networkGraph, networkOrder, networkSwatches, otherEnd, positions, type NetworkGraph, type NetworkSort } from "../layout/network";

const en = {
  kind: "Network",
  connections: (n: number) => plural(n, "connection"),
  connectionsLabel: "Connections",
  total: "Total",
  strongest: "Strongest link",
  strongestTo: (name: string) => `strongest link to ${name}`,
  pinned: "pinned",
  linkOf: (k: number, n: number) => `link ${k} of ${n}`,
  desc: (nodes: number, links: number) => `${plural(nodes, "node")}, ${plural(links, "link")}`,
  parts: (n: number) => `in ${n} separate parts`,
  most: "Most connected",
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "네트워크",
    connections: (n) => `연결 ${n}개`,
    connectionsLabel: "연결",
    total: "합계",
    strongest: "가장 굵은 선",
    strongestTo: (name) => `가장 굵은 선은 ${name}`,
    pinned: "고정",
    linkOf: (k, n) => `링크 ${n}개 중 ${k}번째`,
    desc: (nodes, links) => `노드 ${nodes}개, 링크 ${links}개`,
    parts: (n) => `서로 떨어진 묶음 ${n}개`,
    most: "가장 많이 이어진 노드",
  },
};

export interface NetworkChartProps<T = Row> extends Omit<BaseChartProps<T>, "highlight"> {
  /** Source node field. Default "source" ("from" when absent) */
  source?: Accessor<T, string>;
  /** Target node field. Default "target" ("to" when absent) */
  target?: Accessor<T, string>;
  /** Link width value. Without it (and without a "value" field in the data), each row counts as 1 */
  value?: Accessor<T, number>;
  /** Node to highlight (name, index, array, or "max" for the most connected node). A function receives the node name. Default "max" */
  highlight?: Highlight<string>;
  /** Layout. Only "arc" for now (nodes in a single row, links as arcs above) */
  layout?: "arc";
  /** Node order. "auto" keeps groups (or connected components when there are none) together and shortens long arcs, "data" follows data order, "group" orders by group, "degree" puts the most connected nodes first. Default "auto" */
  sort?: NetworkSort;
  /** Node name → group name. Each group gets its own dot color (gray steps), and sort "group" and "auto" keep group members together */
  groups?: Readonly<Record<string, string>>;
  /** Dot size: "value" is the sum of connected link values, "degree" the number of connected nodes. Default "value" */
  nodeSize?: "value" | "degree";
}

const LABEL_SIZE = 11;
/** sin 45°. For tilted labels */
const TILT = Math.SQRT1_2;
/** Horizontal spacing between tilted labels (px). Line spacing 12px ÷ sin 45° */
const TILT_GAP = 17;
/** Maximum width of a tilted label (px) */
const MAX_TILT = 96;
/** Gap between horizontal labels (px) */
const FLAT_GAP = 6;
/**
 * Maximum spacing between neighboring nodes (px). So that a graph of two or three nodes does not spread to both edges of the card with one semicircle filling it,
 * small graphs are drawn small and centered. It widens enough for the longest label to fit horizontally, but only up to MAX_FLAT_STEP
 */
const MAX_STEP = 88;
const MAX_FLAT_STEP = 160;
/** Above this many links, no wide transparent line (hover target) is laid under each arc. At 3,000 links the SVG would double in size, and a graph that dense is read by node anyway */
const HIT_LINKS = 800;

type Part = { node: number; name: string } | { link: number; key: string };

/**
 * Network (arc layout): nodes sit in a single row and links connect them as arcs above. Arc height is proportional to the distance between the two nodes, and width to the value.
 * The layout is a single computation, so the server and browser renders match, and the nodes have an order, so the left and right keys move between them
 */
export function NetworkChart<T = Row>(props: NetworkChartProps<T>) {
  const { graph, weighted } = useMemo(() => {
    const has = (k: string) => props.data.some((d) => d !== null && typeof d === "object" && hasField(d as object, k));
    const gs = strGetter(props.source ?? (has("source") ? "source" : "from"), "source");
    const gt = strGetter(props.target ?? (has("target") ? "target" : "to"), "target");
    // Without a value field, each row counts as 1 (data that shows structure only)
    const weighted = props.value !== undefined || has("value");
    const gv = numGetter(props.value, "value");
    // Names are matched with surrounding spaces trimmed ("Orders" and " Orders" are the same node). Case still matters
    const rows = props.data.map((d, i) => ({ source: gs(d, i).trim(), target: gt(d, i).trim(), value: weighted ? gv(d, i) : 1 }));
    return { graph: networkGraph(rows, props.groups), weighted };
  }, [props.data, props.source, props.target, props.value, props.groups]);
  const groups = useMemo(() => groupNames(props.groups), [props.groups]);
  const order = useMemo(() => networkOrder(graph, props.sort ?? "auto", groups), [graph, props.sort, groups]);
  const { nodes, links } = graph;
  const N = order.length;

  // Highlight "max" is the node with the most connections (on a tie, the larger value total). Nodes without links are never picked
  const hi = useMemo(() => {
    const total = sum(nodes.map((n) => n.strength)) + 1;
    const score = nodes.map((n) => (n.degree ? n.degree + n.strength / total : NaN));
    const names = nodes.map((n) => n.name);
    return resolveHighlight(props.highlight as never, names as never[], names, score, "max");
  }, [nodes, props.highlight]);

  const showLabels = props.showLabels !== false;
  const sizeByDegree = props.nodeSize === "degree";
  // Default height: enough for the label band and the longest arc (a semicircle). An order with short arcs is lower, so the top is not left empty. Measured once per width
  const fitHeight = useMemo(() => {
    const seen = new Map<number, number>();
    return (w: number) => {
      let h = seen.get(w);
      if (h === undefined) seen.set(w, (h = clamp(arcGeometry(graph, order, w, 1e6, showLabels, hi, sizeByDegree).natural + 4, 120, Math.max(220, w * 0.6))));
      return h;
    };
  }, [graph, order, showLabels, hi, sizeByDegree]);
  const c = useChart(props, { height: fitHeight, duration: 1000 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];
  const geo = useMemo(() => arcGeometry(graph, order, W, H, showLabels, hi, sizeByDegree), [graph, order, W, H, showLabels, hi, sizeByDegree]);
  const { x, r, baseY, label, tilt, step, x0 } = geo;

  // Keyboard, table and tooltip order: nodes in layout order, then links from the largest value
  const linkOrder = useMemo(() => links.map((l) => l.index).sort((a, b) => links[b].value - links[a].value || a - b), [links]);
  const eventOfLink = useMemo(() => {
    const m = new Array<number>(links.length);
    linkOrder.forEach((k, j) => (m[k] = N + j));
    return m;
  }, [linkOrder, links.length, N]);
  const eventOfNode = useMemo(() => positions(order), [order]);
  // Link keys are built only once (used for the table key, the motion key, and checking whether a link was in the previous frame)
  const linkKeys = useMemo(() => links.map((l) => `${nodes[l.a].name}\u0001${nodes[l.b].name}`), [links, nodes]);
  const nameIndex = useMemo(() => new Map(nodes.map((n) => [n.name, n.index])), [nodes]);
  const name = (n: number) => nodes[n].name;
  const linkLabel = (k: number) => {
    const l = links[k];
    return l.ab > 0 && l.ba > 0 ? `${name(l.a)} ↔ ${name(l.b)}` : l.ab > 0 ? `${name(l.a)} → ${name(l.b)}` : `${name(l.b)} → ${name(l.a)}`;
  };

  const fv = c.fv;
  const events = useMemo<ChartEvent<T>[]>(
    () => [
      ...order.map((n, i) => ({ datum: null, index: i, key: nodes[n].name, label: nodes[n].name, value: weighted ? nodes[n].strength : nodes[n].degree, formatted: `${msg.connections(nodes[n].degree)}${weighted ? `, ${fv(nodes[n].strength)}` : ""}` })),
      ...linkOrder.map((k, j) => {
        const l = links[k];
        const both = l.ab > 0 && l.ba > 0;
        return {
          datum: (props.data[l.row] as T) ?? null,
          index: N + j,
          key: linkKeys[k],
          label: linkLabel(k),
          value: l.value,
          formatted: !weighted ? undefined : both ? `${nodes[l.a].name}→${nodes[l.b].name} ${fv(l.ab)}, ${nodes[l.b].name}→${nodes[l.a].name} ${fv(l.ba)}` : fv(l.value),
        };
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, linkOrder, nodes, links, linkKeys, weighted, fv, msg, props.data, N],
  );

  // The item pinned by a click (or Enter). Kept by name, so it stays pinned across data changes as long as it is the same node
  const [pin, setPin] = useState<string | null>(null);
  // Anchor node (by name) when picking links with the up and down keys
  const [anchor, setAnchor] = useState<string | null>(null);
  const pinIndex = useMemo(() => (pin === null ? -1 : events.findIndex((e) => e.key === pin)), [events, pin]);
  const anchorNode = anchor === null ? -1 : (nameIndex.get(anchor) ?? -1);
  const focus = c.active ?? (pinIndex >= 0 ? pinIndex : null);
  const focusNode = focus !== null && focus < N ? order[focus] : -1;
  const focusLink = focus !== null && focus >= N ? linkOrder[focus - N] : -1;
  const near = useMemo(() => {
    const s = new Set<number>();
    const add = (n: number) => {
      s.add(n);
      for (const k of nodes[n].links) s.add(links[k].a).add(links[k].b);
    };
    if (focusNode >= 0) add(focusNode);
    else if (focusLink >= 0) s.add(links[focusLink].a).add(links[focusLink].b);
    else hi.forEach(add);
    return s;
  }, [focusNode, focusLink, hi, nodes, links]);
  const focused = focusNode >= 0 || focusLink >= 0;
  const hotLink = (k: number) => (focusNode >= 0 ? links[k].a === focusNode || links[k].b === focusNode : focusLink >= 0 ? k === focusLink : hi.has(links[k].a) || hi.has(links[k].b));

  const D = c.motion.duration ?? 1000;
  const marks = useMemo<Mark<Part>[]>(() => {
    const ms: Mark<Part>[] = [];
    for (const n of order) ms.push({ key: `n:${nodes[n].name}`, to: [x[n], r[n]], from: [x[n], 0], delay: (x[n] / Math.max(1, W)) * D * 0.25, data: { node: n, name: nodes[n].name } });
    for (const l of links) {
      const xa = x[l.a];
      const xb = x[l.b];
      const key = linkKeys[l.index];
      ms.push({ key: `l:${key}`, to: [xa, xb, geo.h[l.index], geo.w[l.index]], from: [xa, xb, 0, geo.w[l.index]], delay: D * 0.2 + (Math.min(xa, xb) / Math.max(1, W)) * D * 0.35, data: { link: l.index, key } });
    }
    return ms;
  }, [order, nodes, links, linkKeys, x, r, geo, W, D]);
  const m = useMotion(marks, c.motion);
  const labelFade = m.fade(D * 0.3, 300);

  const accent = p.paint("accent");
  const swatches = useMemo(() => networkSwatches(p, groups.length), [p, groups.length]);
  const groupIndex = useMemo(() => new Map(groups.map((g, i) => [g, i])), [groups]);
  const dotColor = (n: number) => {
    if (focusNode === n || (!focused && hi.has(n))) return accent;
    // When groups are used, nodes without a group get the last step
    if (groups.length) return swatches[groupIndex.get(nodes[n].group) ?? groups.length].fill;
    return near.has(n) || (!focused && !hi.size) ? p.paint("ink") : p.paint("neutralStrong");
  };

  let tip: TooltipData | null = null;
  const act = c.active;
  if (act !== null && act < N) {
    const n = order[act];
    const node = nodes[n];
    const top = node.links[0];
    const peer = top !== undefined ? name(otherEnd(links, top, n)) : "";
    // The tooltip floats above this node's highest arc. Placed over the dot, it would cover the short arcs (the nearest neighbors)
    const reach = node.links.reduce((m, k) => Math.max(m, geo.h[k] + geo.w[k] / 2), r[n]);
    tip = {
      x: x[n],
      y: baseY - reach - 4,
      title: node.name,
      rows: [
        { label: msg.connectionsLabel, value: node.degree.toLocaleString(c.locale), color: hi.has(n) ? accent : p.paint("ink") },
        ...(weighted ? [{ label: msg.total, value: fv(node.strength) }] : []),
        ...(top !== undefined ? [{ label: msg.strongest, value: weighted ? `${peer} ${fv(links[top].value)}` : peer, strong: false }] : []),
      ],
    };
  } else if (act !== null && act >= N) {
    const k = linkOrder[act - N];
    const l = links[k];
    if (l) {
      const rows = !weighted ? [] : l.ab > 0 && l.ba > 0 ? [{ label: `${name(l.a)} → ${name(l.b)}`, value: fv(l.ab), color: accent }, { label: `${name(l.b)} → ${name(l.a)}`, value: fv(l.ba) }] : [{ label: c.t.value, value: fv(l.value), color: accent }];
      tip = { x: (x[l.a] + x[l.b]) / 2, y: baseY - geo.h[k], title: linkLabel(k), rows };
    }
  }

  const desc = useMemo(() => {
    if (props.description !== undefined) return props.description;
    const top3 = nodes.map((n) => n.index).filter((n) => nodes[n].degree > 0).sort(byDegree(nodes)).slice(0, 3).map((n) => nodes[n]);
    return `${msg.kind}. ${msg.desc(N, links.length)}${graph.components > 1 ? `, ${msg.parts(graph.components)}` : ""}.${top3.length ? ` ${msg.most}: ${top3.map((n, i) => (i ? `${n.name} (${n.degree})` : `${n.name} (${msg.connections(n.degree)})`)).join(", ")}.` : ""}`;
  }, [props.description, nodes, msg, N, links.length, graph.components]);

  let announce = "";
  if (c.via === "keyboard" && act !== null && events[act]) {
    const pinned = pinIndex === act ? `, ${msg.pinned}` : "";
    if (act < N) {
      const node = nodes[order[act]];
      const top = node.links[0];
      announce = `${node.name}, ${msg.connections(node.degree)}${top !== undefined ? `, ${msg.strongestTo(name(otherEnd(links, top, node.index)))}` : ""}${pinned} (${act + 1}/${N})`;
    } else {
      const k = linkOrder[act - N];
      const base = anchorNode >= 0 ? nodes[anchorNode] : undefined;
      const j = base ? base.links.indexOf(k) : -1;
      announce = `${events[act].label}${events[act].formatted ? `: ${events[act].formatted}` : ""}${j >= 0 ? `, ${msg.linkOf(j + 1, base!.links.length)}` : ""}${pinned}`;
    }
  }

  const togglePin = (i: number) => {
    const key = events[i]?.key;
    if (key === undefined) return;
    setPin((cur) => (cur === key ? null : key));
    c.click(i);
  };
  // Nearest node. Small graphs sit in the middle, so empty space farther than half a step (at least 24px) from a node picks nothing
  const nodeAt = (px: number) => {
    const i = N === 1 ? 0 : Math.round(clamp((px - x0) / (step || 1), 0, N - 1));
    return Math.abs(px - x[order[i]]) <= Math.max(step / 2, 24) ? i : null;
  };
  const nodeZone = baseY - geo.rMax - 8;

  const onKey = (e: { key: string }) => {
    if (!N) return false;
    const curNode = act !== null && act < N ? order[act] : anchorNode;
    const go = (i: number) => c.setActive(i, "keyboard");
    switch (e.key) {
      case "ArrowRight":
      case "ArrowLeft": {
        const at = curNode >= 0 ? eventOfNode[curNode] : e.key === "ArrowRight" ? -1 : N;
        const next = (at + (e.key === "ArrowRight" ? 1 : -1) + N) % N;
        setAnchor(nodes[order[next]].name);
        go(next);
        return true;
      }
      case "ArrowDown":
      case "ArrowUp": {
        // The anchor node's links, largest value first. Pressing up past the thickest link returns to the node
        const base = curNode >= 0 ? curNode : act !== null && act >= N ? links[linkOrder[act - N]].a : order[0];
        const list = nodes[base].links;
        setAnchor(nodes[base].name);
        if (!list.length) {
          go(eventOfNode[base]);
          return true;
        }
        const j = act !== null && act >= N ? list.indexOf(linkOrder[act - N]) : -1;
        const nj = e.key === "ArrowDown" ? (j + 1) % list.length : j - 1;
        go(nj < 0 ? eventOfNode[base] : eventOfLink[list[nj]]);
        return true;
      }
      case "Home":
      case "End": {
        const i = e.key === "Home" ? 0 : N - 1;
        setAnchor(nodes[order[i]].name);
        go(i);
        return true;
      }
      case "Enter":
      case " ":
        if (act === null) return false;
        togglePin(act);
        return true;
      case "Escape":
        setPin(null);
        setAnchor(null);
        return false;
      default:
        return false;
    }
  };

  const linkOf = (e: { target: EventTarget }) => {
    const v = (e.target as Element).getAttribute?.("data-l");
    return v === null || v === undefined ? -1 : Number(v);
  };
  const overLink = (e: PointerEvent) => {
    const i = linkOf(e);
    if (i >= 0) c.setActive(i, e.pointerType === "touch" ? "touch" : "pointer");
  };
  const clickLink = (e: { target: EventTarget }) => {
    const i = linkOf(e);
    if (i >= 0) togglePin(i);
  };
  const quiet: ReactNode[] = [];
  const hot: ReactNode[] = [];
  const dots: ReactNode[] = [];
  const hitLinks = links.length <= HIT_LINKS;
  // The more links, the fainter the non-highlighted arcs (0.32 up to 80, 0.1 at 3,000), so the highlighted node's arcs are not buried even when dense
  const quietOpacity = r2(clamp(0.32 * Math.sqrt(80 / Math.max(1, links.length)), 0.1, 0.32));
  const linkBase = p.paint("neutralStrong");
  const textInk = p.paint("ink");
  const textMuted = p.paint("muted");
  for (const it of m.items) {
    const d = it.data;
    if ("link" in d) {
      const [xa, xb, h, w] = it.v;
      if (w <= 0) continue;
      const k = d.link;
      const live = !it.exiting && linkKeys[k] === d.key;
      const isHot = live && hotLink(k);
      const ev = live ? eventOfLink[k] : -1;
      const path = arcD(xa, xb, h, baseY);
      // Hover and clicks are handled by the arc group (<g>) through data-l (item index). No function is created per link
      const tag = ev >= 0 ? { "data-l": ev } : {};
      const ring = act === ev && c.via === "keyboard";
      const line = <path key={hitLinks ? undefined : it.key} className="ztd-mark" d={path} fill="none" stroke={isHot ? accent : linkBase} strokeWidth={r2(ring ? w + 1.5 : w)} strokeLinecap="round" opacity={isHot ? 0.9 : focused ? r2(quietOpacity * 0.22) : quietOpacity} {...(hitLinks ? {} : tag)} />;
      const el = hitLinks ? (
        <g key={it.key}>
          {line}
          {ev >= 0 ? <path d={path} fill="none" stroke="transparent" strokeWidth={r2(Math.max(8, w + 6))} {...tag} /> : null}
        </g>
      ) : (
        line
      );
      (isHot ? hot : quiet).push(el);
    } else {
      const [cx, rr] = it.v;
      const n = d.node;
      const live = !it.exiting && nodes[n]?.name === d.name;
      const dim = focused && live && !near.has(n);
      const lab = live && showLabels ? label[n] : "";
      const strongText = live && (focusNode === n || (!focused && hi.has(n)));
      dots.push(
        <g key={it.key} opacity={dim ? 0.3 : undefined}>
          {rr > 0 ? <circle className="ztd-mark" cx={r2(cx)} cy={r2(baseY)} r={r2(rr)} fill={live ? dotColor(n) : linkBase} stroke={p.paint("panel")} strokeWidth={rr > 3 ? 1.5 : 0.75} /> : null}
          {live && act === eventOfNode[n] && c.via === "keyboard" ? <circle cx={r2(cx)} cy={r2(baseY)} r={r2(rr + 3)} fill="none" stroke={accent} strokeWidth={2} pointerEvents="none" /> : null}
          {lab ? (
            <text
              x={r2(cx)}
              y={r2(baseY + geo.rMax + 6)}
              dy={tilt ? "0.35em" : "0.75em"}
              transform={tilt ? `rotate(-45 ${r2(cx)} ${r2(baseY + geo.rMax + 6)})` : undefined}
              fontSize={LABEL_SIZE}
              fontWeight={strongText ? 800 : near.has(n) ? 650 : 500}
              fill={strongText || near.has(n) ? textInk : textMuted}
              textAnchor={tilt ? "end" : "middle"}
              opacity={labelFade >= 1 ? undefined : labelFade}
              style={{ pointerEvents: "none" }}
            >
              {lab}
            </text>
          ) : null}
        </g>,
      );
    }
  }

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
      onKey={onKey}
      onPointerMove={(px, py, e) => {
        if ((e.target as Element).hasAttribute?.("data-l")) return;
        const how = e.pointerType === "touch" ? "touch" : "pointer";
        if (py >= nodeZone && N) {
          const i = nodeAt(px);
          if (i !== c.active) c.setActive(i, how);
        } else if (c.active !== null && c.active < N) c.setActive(null, how);
      }}
    >
      <g onPointerOver={overLink} onClick={clickLink}>
        {quiet}
      </g>
      <g onPointerOver={overLink} onClick={clickLink}>
        {hot}
      </g>
      {N ? <rect x={0} y={r2(nodeZone)} width={r2(W)} height={r2(Math.max(0, H - nodeZone))} fill="transparent" onClick={() => c.active !== null && c.active < N && togglePin(c.active)} /> : null}
      {/* Dots and labels take no clicks. The transparent band below pins the nearest node */}
      <g pointerEvents="none">{dots}</g>
    </ChartFrame>
  );
}

/** Upper arc: from the left end to the right end, horizontal radius half the distance, vertical radius h. Symmetric left to right */
function arcD(xa: number, xb: number, h: number, y: number): string {
  const l = Math.min(xa, xb);
  const rgt = Math.max(xa, xb);
  return `M${r2(l)},${r2(y)}A${r2((rgt - l) / 2)},${r2(Math.max(0, h))} 0 0 1 ${r2(rgt)},${r2(y)}`;
}

/**
 * Positions, dot sizes, arc heights and widths, and labels. Labels are horizontal when they all fit in the node spacing, otherwise tilted 45°;
 * when even tilted they are denser than 17px, only non-overlapping labels are written, highlighted first, then by number of connections
 */
function arcGeometry(g: NetworkGraph, order: readonly number[], W: number, H: number, showLabels: boolean, hi: ReadonlySet<number>, sizeByDegree: boolean) {
  const { nodes, links } = g;
  const N = order.length;
  const wOf = nodes.map((n) => (showLabels ? textWidth(n.name, LABEL_SIZE, 600) : 0));
  const widest = wOf.reduce((a, b) => Math.max(a, b), 0);
  const cap = clamp(widest + FLAT_GAP + 2, MAX_STEP, MAX_FLAT_STEP);
  const inner = (l: number, rgt: number) => (N > 1 ? Math.min(cap, Math.max(0, W - l - rgt) / (N - 1)) : 0);
  const step0 = inner(8, 8);
  const rMax = N > 1 ? clamp(step0 * 0.35, 1.5, 9) : 9;
  const edge = rMax + 3;
  let padL = edge;
  let padR = edge;
  let tilt = false;
  if (showLabels && N) {
    const first = wOf[order[0]];
    const last = wOf[order[N - 1]];
    padL = Math.max(edge, first / 2 + 2);
    padR = Math.max(edge, last / 2 + 2);
    const st = inner(padL, padR);
    tilt = padL + padR > W * 0.6 || (N === 1 ? first > W - 8 : order.some((n) => wOf[n] > st - FLAT_GAP));
    if (tilt) {
      // Tilted labels hang down to the left of their node. Reserve a left margin so the first nodes' labels fit (up to 30% of the width)
      padR = edge;
      padL = edge;
      order.forEach((n, i) => (padL = Math.max(padL, Math.min(wOf[n], MAX_TILT) * TILT + 4 - i * step0)));
      padL = Math.min(padL, W * 0.3);
    }
  }
  const step = inner(padL, padR);
  // Width left over because of the spacing cap is split to both sides to center the row (within the label margins)
  const row = (N - 1) * step;
  const x0 = clamp((W - row) / 2, padL, Math.max(padL, W - padR - row));
  const x = new Array<number>(nodes.length);
  order.forEach((n, i) => (x[n] = N > 1 ? x0 + i * step : W / 2));

  const label = new Array<string>(nodes.length).fill("");
  let band = edge + 2;
  if (showLabels && N) {
    if (!tilt) {
      for (const n of order) label[n] = nodes[n].name;
      band = rMax + 6 + LABEL_SIZE + 6;
    } else {
      const deg = byDegree(nodes);
      const rank = [...order].sort((a, b) => Number(hi.has(b)) - Number(hi.has(a)) || deg(a, b));
      // Keep the x of labels already written sorted and check only the neighbors on each side (fast even with 300 nodes)
      const taken: number[] = [];
      let widest = 0;
      for (const n of rank) {
        let lo = 0;
        let hiIdx = taken.length;
        while (lo < hiIdx) {
          const mid = (lo + hiIdx) >> 1;
          if (taken[mid] < x[n]) lo = mid + 1;
          else hiIdx = mid;
        }
        if ((lo > 0 && x[n] - taken[lo - 1] < TILT_GAP) || (lo < taken.length && taken[lo] - x[n] < TILT_GAP)) continue;
        const s = truncate(nodes[n].name, Math.min(MAX_TILT, (x[n] - 2) / TILT), LABEL_SIZE, 600);
        if (!s) continue;
        label[n] = s;
        taken.splice(lo, 0, x[n]);
        widest = Math.max(widest, textWidth(s, LABEL_SIZE, 600));
      }
      band = rMax + 6 + (widest + LABEL_SIZE) * TILT + 4;
    }
  }

  // Link width: proportional to value, up to 45% of the node spacing (1.2~7px). 2px when all values are equal
  let vmax = 0;
  let vmin = Infinity;
  for (const l of links) {
    vmax = Math.max(vmax, l.value);
    vmin = Math.min(vmin, l.value);
  }
  const maxW = N > 1 ? clamp(step * 0.45, 1.2, 7) : 2;
  const minW = Math.min(1, maxW);
  const w = links.map((l) => (vmax <= vmin ? Math.min(2, maxW) : minW + (maxW - minW) * (l.value / vmax)));
  const topPad = maxW / 2 + 3;
  const baseY = Math.max(topPad + 8, H - band, H * 0.4);
  let span = 0;
  for (const l of links) span = Math.max(span, Math.abs(x[l.a] - x[l.b]));
  // Arc height is half the distance (a semicircle) times the factor that brings the longest arc up to the top margin. Every arc uses the same factor, so height follows distance
  const k = span > 0 ? Math.min(1, (baseY - topPad) / (span / 2)) : 1;
  const h = links.map((l) => (Math.abs(x[l.a] - x[l.b]) / 2) * k);

  const size = nodes.map((n) => (sizeByDegree ? n.degree : n.strength));
  const sMax = size.reduce((a, b) => Math.max(a, b), 0);
  const rMin = Math.max(1, rMax * 0.35);
  const r = size.map((s) => (s > 0 && sMax > 0 ? rMin + (rMax - rMin) * Math.sqrt(s / sMax) : rMin));
  // Height needed to draw the arcs as semicircles (the default height)
  const natural = band + span / 2 + topPad;
  return { x, r, h, w, baseY, label, tilt, step, x0, rMax, natural };
}
