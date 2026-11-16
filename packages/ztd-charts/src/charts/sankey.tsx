import { useMemo } from "react";
import { ChartFrame, Txt } from "../core/ChartFrame";
import { r2, roundRectPath } from "../core/geometry";
import { resolveHighlight } from "../core/highlight";
import type { Mark } from "../core/motion";
import { swatch } from "../core/palette";
import { textWidth, truncate } from "../core/text";
import type { Accessor, BaseChartProps, ChartEvent, Highlight, Row, TooltipData } from "../core/types";
import { useChart } from "../core/useChart";
import { useMotion } from "../core/useMotion";
import { hasField, numGetter, strGetter } from "../data/accessor";
import { dimensionLinks, SANKEY_MAX_DIMENSIONS, sankeyLayout, sankeyLinkPath, type SankeyLink, type SankeyNode, type SankeyNodeIn } from "../layout/sankey";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Sankey diagram",
  total: "Total",
  in: "In",
  out: "Out",
  flow: "Flow",
  flows: (n: number) => plural(n, "flow"),
  /** Name of a link's share of its source node */
  from: (source: string) => `Share of ${source}`,
  desc: (nodes: number, links: number) => `${plural(nodes, "node")}, ${plural(links, "flow")}. Largest flows`,
  /** Stage columns (dimensions): the node of empty cells, the node that groups the smaller values, a node's share of all rows, and a link's part that runs through the focus node */
  blank: "(blank)",
  other: (n: number) => `Other (${n})`,
  ofTotal: "Share of total",
  through: (nodes: string) => `Through ${nodes}`,
};
const MSG: Record<ChartLang, typeof en> = {
  en,
  ko: {
    kind: "생키 다이어그램",
    total: "합계",
    in: "들어옴",
    out: "나감",
    flow: "흐름",
    flows: (n) => `흐름 ${n}개`,
    from: (source) => `${source} 중 비중`,
    desc: (nodes, links) => `노드 ${nodes}개, 흐름 ${links}개. 큰 흐름`,
    blank: "(빈 값)",
    other: (n) => `기타 ${n}개`,
    ofTotal: "전체 중 비중",
    through: (nodes) => `${nodes} 경유`,
  },
};

const NO_NODES: SankeyNodeIn[] = [];

export interface SankeyChartProps<T = Row> extends Omit<BaseChartProps<T>, "highlight"> {
  source?: Accessor<T, string>;
  target?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** Stage columns of a wide table, left to right (2 to 6 fields). Each row is one path through them, so source and target are not used. Without value (and a "value" field), each row counts 1 */
  dimensions?: string[];
  /** Titles of the stage columns, by field name. Default: the field name */
  dimensionLabels?: Record<string, string>;
  /** Node width (px). Default 10 */
  nodeWidth?: number;
  /** Gap between nodes (px). Default 14 */
  nodePadding?: number;
  /** Node name (or index) to highlight. Flows into and out of that node are highlighted. A function receives the laid-out node (name, value, etc.). Default: the largest node in the last column */
  highlight?: Highlight<SankeyNode>;
}

/** Sankey diagram: the volume of flows between stages */
export function SankeyChart<T = Row>(props: SankeyChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(220, Math.min(340, w * 0.6)), duration: 1000, stagger: 70 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];

  // Stages from a wide table (dimensions): each row is one path through up to 6 columns, added up into links between neighboring columns
  const stages = useMemo(() => {
    if (props.dimensions === undefined) return null;
    const fields = ([] as string[]).concat(props.dimensions).slice(0, SANKEY_MAX_DIMENSIONS);
    // Without a value field, each row counts 1 (as in the network and the flow map)
    const weighted = props.value !== undefined || props.data.some((d) => d !== null && typeof d === "object" && hasField(d as object, "value"));
    return { fields, ...dimensionLinks(props.data, fields.map((f) => strGetter<T>(f, f)), weighted ? numGetter(props.value, "value") : () => 1, msg) };
  }, [props.data, props.dimensions, props.value, msg]);

  const links0 = useMemo(() => {
    if (stages) return [];
    const gs = strGetter(props.source, "source");
    const gt = strGetter(props.target, "target");
    const gv = numGetter(props.value, "value");
    return props.data.map((d, i) => ({ source: gs(d, i), target: gt(d, i), value: gv(d, i) || 0, d }));
  }, [stages, props.data, props.source, props.target, props.value]);
  const nodesIn = stages ? stages.nodes : NO_NODES;
  const linksIn = stages ? stages.links : links0;

  // Only the layers are read here, so the relaxation passes are skipped.
  const pre = useMemo(() => sankeyLayout(nodesIn, linksIn, { width: 100, height: 100, iterations: 0 }), [nodesIn, linksIn]);
  const firstLabels = pre.nodes.filter((n) => n.layer === 0);
  const maxLayer = Math.max(0, ...pre.nodes.map((n) => n.layer));
  const lastLabels = pre.nodes.filter((n) => n.layer === maxLayer && maxLayer > 0);
  const lw = Math.min(W * 0.22, Math.max(0, ...firstLabels.map((n) => Math.max(textWidth(n.label, 11.5, 700), textWidth(c.fmt(n.value), 10.5)))) + 10);
  const rw = Math.min(W * 0.22, Math.max(0, ...lastLabels.map((n) => Math.max(textWidth(n.label, 11.5, 700), textWidth(c.fmt(n.value), 10.5)))) + 10);

  // Stage columns get their titles in an 18px band above the nodes
  const top = stages ? 18 : 0;
  const layout = useMemo(() => sankeyLayout(nodesIn, linksIn, { width: Math.max(60, W - lw - rw), height: H - 8 - top, x0: lw, y0: 4 + top, nodeWidth: props.nodeWidth ?? 10, nodePadding: props.nodePadding ?? 14 }), [nodesIn, linksIn, W, H, lw, rw, top, props.nodeWidth, props.nodePadding]);

  const hiNodes = useMemo(() => {
    const names = layout.nodes.map((n) => n.label);
    if (props.highlight !== undefined) return resolveHighlight(props.highlight as never, layout.nodes as never[], names, layout.nodes.map((n) => n.value));
    const last = layout.nodes.filter((n) => n.layer === maxLayer);
    const best = last.sort((a, b) => b.value - a.value)[0];
    return new Set(best ? [best.index] : []);
  }, [layout, props.highlight, maxLayer]);

  // With stages the links stay gray, and the highlighted rows are drawn over them instead (through)
  const linkHot = (l: SankeyLink) => !stages && (hiNodes.has(l.source.index) || hiNodes.has(l.target.index));
  const act = c.active;
  const focusNode = act !== null && act < layout.nodes.length ? act : -1;
  // Stages: per link, the amount of the rows through the pointed node, or else through the highlighted nodes. Layout indexes are the dimensionLinks indexes
  const through = useMemo(() => {
    if (!stages) return null;
    const focus = focusNode >= 0 ? new Set([focusNode]) : hiNodes;
    const out = stages.links.map(() => 0);
    if (focus.size) for (const path of stages.paths) if (path.nodes.some((n) => focus.has(n))) for (const k of path.links) out[k] += path.value;
    return out;
  }, [stages, hiNodes, focusNode]);
  const stg = c.motion.stagger ?? 70;
  const D = c.motion.duration ?? 1000;
  const marks = useMemo<Mark<{ node?: SankeyNode; link?: SankeyLink }>[]>(() => {
    const ms: Mark<{ node?: SankeyNode; link?: SankeyLink }>[] = [];
    layout.nodes.forEach((n) => {
      const mid = (n.y0 + n.y1) / 2;
      ms.push({ key: `n:${n.id}`, to: [n.y0, n.y1], from: [mid, mid], enter: [mid, mid], delay: n.layer * stg * 2, data: { node: n } });
    });
    layout.links.forEach((l, k) => ms.push({ key: `l:${l.source.id}>${l.target.id}`, to: [1, l.y0, l.y1, l.width], from: [0, l.y0, l.y1, l.width], enter: [0, l.y0, l.y1, l.width], delay: D * 0.25 + l.source.layer * stg * 3 + (k % 6) * 25, data: { link: l } }));
    return ms;
  }, [layout, stg, D]);
  const m = useMotion(marks, c.motion);
  const accent = swatch(p, "accent");
  const nodeCount = layout.nodes.length;

  // Stage column titles: dimensionLabels, else the field name. Column k is layer k
  const dimLabels = props.dimensionLabels;
  const titles = useMemo(() => (stages ? stages.fields.map((f) => dimLabels?.[f] ?? f) : null), [stages, dimLabels]);
  // Built once per layout, not per animation frame; the link's own row is found through a map, not a scan.
  const fv = c.fv;
  const events = useMemo<ChartEvent<T>[]>(() => {
    const rowOf = new Map<string, T>();
    for (const x of links0) if (!rowOf.has(`${x.source}>${x.target}`)) rowOf.set(`${x.source}>${x.target}`, x.d as T);
    // With stages, screen readers hear "column: value", so a name in two columns stays apart
    const named = (n: SankeyNode) => (titles ? `${titles[n.layer]}: ${n.label}` : n.label);
    return [
      ...layout.nodes.map((n) => ({ datum: null, index: n.index, key: n.id, label: named(n), value: n.value, formatted: fv(n.value) })),
      ...layout.links.map((l, k) => ({ datum: rowOf.get(`${l.source.id}>${l.target.id}`) ?? null, index: nodeCount + k, key: `${l.source.id}>${l.target.id}`, label: `${named(l.source)} → ${named(l.target)}`, value: l.value, formatted: fv(l.value) })),
    ];
  }, [layout, links0, nodeCount, fv, titles]);

  let tip: TooltipData | null = null;
  if (act !== null) {
    if (act < nodeCount) {
      const n = layout.nodes[act];
      // Stages: the node's share of all rows (every row passes every column, so each column adds up to the total)
      const all = stages ? stages.paths.reduce((a, q) => a + q.value, 0) : 0;
      if (n) tip = { x: (n.x0 + n.x1) / 2, y: n.y0, title: n.label, rows: [{ label: msg.total, value: c.fv(n.value), color: hiNodes.has(n.index) ? accent.fill : p.paint("neutralStrong") }, ...(stages ? [{ label: msg.ofTotal, value: c.pct((n.value / (all || 1)) * 100) }] : []), ...(n.inLinks.length ? [{ label: msg.in, value: msg.flows(n.inLinks.length) }] : []), ...(n.outLinks.length ? [{ label: msg.out, value: msg.flows(n.outLinks.length) }] : [])] };
    } else {
      const l = layout.links[act - nodeCount];
      if (l) {
        // Stages: the part of this link that runs through the highlighted nodes (the accent band over it)
        const via = through && hiNodes.size ? [{ label: msg.through([...hiNodes].map((i) => layout.nodes[i].label).join(", ")), value: c.fv(through[l.index]), color: accent.fill }] : [];
        tip = { x: (l.source.x1 + l.target.x0) / 2, y: (l.y0 + l.y1) / 2 - l.width / 2, title: `${l.source.label} → ${l.target.label}`, rows: [{ label: msg.flow, value: c.fv(l.value), color: linkHot(l) ? accent.fill : p.paint("neutral") }, { label: msg.from(l.source.label), value: c.pct((l.value / (l.source.value || 1)) * 100) }, ...via] };
      }
    }
  }

  const activeNode = act !== null && act < nodeCount ? layout.nodes[act] : null;
  const activeLink = act !== null && act >= nodeCount ? layout.links[act - nodeCount] : null;
  const linkOpacity = (l: SankeyLink) => {
    // Stages: the gray links stay light under the accent rows, and step back while something is pointed at
    if (stages) return activeLink ? (l === activeLink ? 0.5 : 0.2) : activeNode ? 0.2 : 0.32;
    if (activeNode) return l.source === activeNode || l.target === activeNode ? 0.75 : 0.12;
    if (activeLink) return l === activeLink ? 0.8 : 0.12;
    return linkHot(l) ? 0.55 : 0.32;
  };
  const desc = props.description ?? `${msg.kind}. ${msg.desc(nodeCount, layout.links.length)}: ${[...layout.links].sort((a, b) => b.value - a.value).slice(0, 3).map((l) => `${l.source.label}→${l.target.label} ${c.fv(l.value)}`).join(", ")}.`;
  // Stage titles: the first from the left edge, the last to the right edge, the others centered on their column. Each keeps to its half of the space to its neighbors
  const centers = titles ? titles.map((_, k) => layout.nodes.find((n) => n.layer === k)).map((n) => (n ? (n.x0 + n.x1) / 2 : 0)) : [];

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
      {titles && nodeCount ? (
        <g>
          {titles.map((title, k) => {
            const end = k === titles.length - 1;
            const room = k === 0 ? (centers[0] + centers[1]) / 2 - 6 : end ? W - (centers[k - 1] + centers[k]) / 2 - 6 : Math.min(centers[k] - centers[k - 1], centers[k + 1] - centers[k]) - 12;
            return (
              <Txt key={k} x={k === 0 ? 0 : end ? W : centers[k]} y={9} anchor={k === 0 ? "start" : end ? "end" : "middle"} size={11} weight={700} fill={p.paint("muted")}>
                {truncate(title, room, 11, 700)}
              </Txt>
            );
          })}
        </g>
      ) : null}
      <g>
        {m.items.map((it) => {
          const l = it.data.link;
          if (!l) return null;
          const k = layout.links.indexOf(l);
          const [t, y0, y1, w] = it.v;
          if (t <= 0.001) return null;
          const hot = linkHot(l);
          return <path key={it.key} className="ztd-mark" d={sankeyLinkPath({ source: l.source, target: l.target, y0, y1, width: w }, t)} fill={hot ? accent.fill : p.paint("neutralStrong")} opacity={linkOpacity(l) * Math.min(1, t * 1.5)} onPointerEnter={(e) => c.setActive(nodeCount + k, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(nodeCount + k)} />;
        })}
      </g>
      {through ? (
        <g pointerEvents="none">
          {m.items.map((it) => {
            const l = it.data.link;
            const part = l && !it.exiting ? through[l.index] : 0;
            if (!l || !(part > 0)) return null;
            const [t, y0, y1, w] = it.v;
            if (t <= 0.001) return null;
            // As wide as its part, on the top edge of the link at both ends
            const pw = (w * part) / l.value;
            return <path key={it.key} d={sankeyLinkPath({ source: l.source, target: l.target, y0: y0 - (w - pw) / 2, y1: y1 - (w - pw) / 2, width: pw }, t)} fill={accent.fill} opacity={0.6 * Math.min(1, t * 1.5)} />;
          })}
        </g>
      ) : null}
      {m.items.map((it) => {
        const n = it.data.node;
        if (!n) return null;
        const [y0, y1] = it.v;
        const hot = hiNodes.has(n.index);
        const isA = act === n.index;
        const first = n.layer === 0;
        const last = n.layer === maxLayer && maxLayer > 0;
        const lx = first ? n.x0 - 8 : n.x1 + 8;
        const anchor = first ? "end" : "start";
        const room = first ? lw - 10 : last ? rw - 10 : Math.max(40, (layout.nodes.find((q) => q.layer === n.layer + 1)?.x0 ?? W) - n.x1 - 16);
        const cy = (n.y0 + n.y1) / 2;
        const two = n.y1 - n.y0 >= 26;
        // Middle-column labels sit on top of the flow bands, so they get a backing in the card background color
        const overLinks = !first && !last;
        const name = truncate(n.label, room, 11.5, 700);
        const pillW = Math.max(textWidth(name, 11.5, 800), two ? textWidth(c.fmt(n.value), 10.5) : 0) + 10;
        const pillH = two ? 32 : 18;
        return (
          <g key={it.key} onPointerEnter={(e) => c.setActive(n.index, e.pointerType === "touch" ? "touch" : "pointer")} onClick={() => c.click(n.index)}>
            <path d={roundRectPath(n.x0, y0, n.x1 - n.x0, Math.max(1, y1 - y0), 2)} fill={hot ? accent.fill : p.paint("ink")} stroke={isA && c.via === "keyboard" ? p.paint("accent") : "none"} strokeWidth={2} />
            {c.showLabels ? (
              <g opacity={m.fade(n.layer * stg * 2 + D * 0.35, 300)} pointerEvents="none">
                {overLinks ? <rect x={r2(lx - 5)} y={r2(cy - pillH / 2)} width={pillW} height={pillH} rx={6} fill={p.paint("panel")} opacity={0.94} /> : null}
                <Txt x={lx} y={two ? cy - 7 : cy} anchor={anchor} size={11.5} weight={hot || isA ? 800 : 600} fill={p.paint("ink")}>
                  {name}
                </Txt>
                {two ? (
                  <Txt x={lx} y={cy + 8} anchor={anchor} size={10.5} fill={p.paint("muted")}>
                    {c.fmt(n.value)}
                  </Txt>
                ) : null}
              </g>
            ) : null}
          </g>
        );
      })}
    </ChartFrame>
  );
}
