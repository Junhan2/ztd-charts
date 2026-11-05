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
import { numGetter, strGetter } from "../data/accessor";
import { sankeyLayout, sankeyLinkPath, type SankeyLink, type SankeyNode } from "../layout/sankey";
import { plural, type ChartLang } from "../core/i18n";

const en = {
  kind: "Sankey diagram",
  total: "Total",
  in: "In",
  out: "Out",
  flow: "Flow",
  flows: (n: number) => plural(n, "flow"),
  /** 링크가 출발 노드에서 차지하는 비율의 이름 */
  from: (source: string) => `Share of ${source}`,
  desc: (nodes: number, links: number) => `${plural(nodes, "node")}, ${plural(links, "flow")}. Largest flows`,
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
  },
};

export interface SankeyChartProps<T = Row> extends Omit<BaseChartProps<T>, "highlight"> {
  source?: Accessor<T, string>;
  target?: Accessor<T, string>;
  value?: Accessor<T, number>;
  /** 노드 폭(px). 기본 10 */
  nodeWidth?: number;
  /** 노드 사이 간격(px). 기본 14 */
  nodePadding?: number;
  /** 강조할 노드 이름(또는 인덱스). 그 노드로 들어오고 나가는 흐름이 강조돼요. 함수는 배치된 노드(name, value 등)를 받아요. 기본은 마지막 열에서 가장 큰 노드 */
  highlight?: Highlight<SankeyNode>;
}

/** 생키 다이어그램: 단계 사이 흐름의 양 */
export function SankeyChart<T = Row>(props: SankeyChartProps<T>) {
  const c = useChart(props, { height: (w) => Math.max(220, Math.min(340, w * 0.6)), duration: 1000, stagger: 70 });
  const { p, width: W, height: H } = c;
  const msg = MSG[c.lang];

  const links0 = useMemo(() => {
    const gs = strGetter(props.source, "source");
    const gt = strGetter(props.target, "target");
    const gv = numGetter(props.value, "value");
    return props.data.map((d, i) => ({ source: gs(d, i), target: gt(d, i), value: gv(d, i) || 0, d }));
  }, [props.data, props.source, props.target, props.value]);

  // Only the layers are read here, so the relaxation passes are skipped.
  const pre = useMemo(() => sankeyLayout([], links0, { width: 100, height: 100, iterations: 0 }), [links0]);
  const firstLabels = pre.nodes.filter((n) => n.layer === 0);
  const maxLayer = Math.max(0, ...pre.nodes.map((n) => n.layer));
  const lastLabels = pre.nodes.filter((n) => n.layer === maxLayer && maxLayer > 0);
  const lw = Math.min(W * 0.22, Math.max(0, ...firstLabels.map((n) => Math.max(textWidth(n.label, 11.5, 700), textWidth(c.fmt(n.value), 10.5)))) + 10);
  const rw = Math.min(W * 0.22, Math.max(0, ...lastLabels.map((n) => Math.max(textWidth(n.label, 11.5, 700), textWidth(c.fmt(n.value), 10.5)))) + 10);

  const layout = useMemo(() => sankeyLayout([], links0, { width: Math.max(60, W - lw - rw), height: H - 8, x0: lw, y0: 4, nodeWidth: props.nodeWidth ?? 10, nodePadding: props.nodePadding ?? 14 }), [links0, W, H, lw, rw, props.nodeWidth, props.nodePadding]);

  const hiNodes = useMemo(() => {
    const names = layout.nodes.map((n) => n.label);
    if (props.highlight !== undefined) return resolveHighlight(props.highlight as never, layout.nodes as never[], names, layout.nodes.map((n) => n.value));
    const last = layout.nodes.filter((n) => n.layer === maxLayer);
    const best = last.sort((a, b) => b.value - a.value)[0];
    return new Set(best ? [best.index] : []);
  }, [layout, props.highlight, maxLayer]);

  const linkHot = (l: SankeyLink) => hiNodes.has(l.source.index) || hiNodes.has(l.target.index);
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

  // Built once per layout, not per animation frame; the link's own row is found through a map, not a scan.
  const fv = c.fv;
  const events = useMemo<ChartEvent<T>[]>(() => {
    const rowOf = new Map<string, T>();
    for (const x of links0) if (!rowOf.has(`${x.source}>${x.target}`)) rowOf.set(`${x.source}>${x.target}`, x.d as T);
    return [
      ...layout.nodes.map((n) => ({ datum: null, index: n.index, key: n.id, label: n.label, value: n.value, formatted: fv(n.value) })),
      ...layout.links.map((l, k) => ({ datum: rowOf.get(`${l.source.id}>${l.target.id}`) ?? null, index: nodeCount + k, key: `${l.source.id}>${l.target.id}`, label: `${l.source.label} → ${l.target.label}`, value: l.value, formatted: fv(l.value) })),
    ];
  }, [layout, links0, nodeCount, fv]);

  let tip: TooltipData | null = null;
  const act = c.active;
  if (act !== null) {
    if (act < nodeCount) {
      const n = layout.nodes[act];
      if (n) tip = { x: (n.x0 + n.x1) / 2, y: n.y0, title: n.label, rows: [{ label: msg.total, value: c.fv(n.value), color: hiNodes.has(n.index) ? accent.fill : p.paint("neutralStrong") }, ...(n.inLinks.length ? [{ label: msg.in, value: msg.flows(n.inLinks.length) }] : []), ...(n.outLinks.length ? [{ label: msg.out, value: msg.flows(n.outLinks.length) }] : [])] };
    } else {
      const l = layout.links[act - nodeCount];
      if (l) tip = { x: (l.source.x1 + l.target.x0) / 2, y: (l.y0 + l.y1) / 2 - l.width / 2, title: `${l.source.label} → ${l.target.label}`, rows: [{ label: msg.flow, value: c.fv(l.value), color: linkHot(l) ? accent.fill : p.paint("neutral") }, { label: msg.from(l.source.label), value: c.pct((l.value / (l.source.value || 1)) * 100) }] };
    }
  }

  const activeNode = act !== null && act < nodeCount ? layout.nodes[act] : null;
  const activeLink = act !== null && act >= nodeCount ? layout.links[act - nodeCount] : null;
  const linkOpacity = (l: SankeyLink) => {
    if (activeNode) return l.source === activeNode || l.target === activeNode ? 0.75 : 0.12;
    if (activeLink) return l === activeLink ? 0.8 : 0.12;
    return linkHot(l) ? 0.55 : 0.32;
  };
  const desc = props.description ?? `${msg.kind}. ${msg.desc(nodeCount, layout.links.length)}: ${[...layout.links].sort((a, b) => b.value - a.value).slice(0, 3).map((l) => `${l.source.label}→${l.target.label} ${c.fv(l.value)}`).join(", ")}.`;

  return (
    <ChartFrame c={c} kind={msg.kind} ariaLabel={props.ariaLabel} description={desc} events={events} tip={tip} renderTip={props.tooltip} className={props.className} style={props.style} theme={props.theme}>
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
        // 가운데 열 라벨은 흐름 띠 위에 놓여서 카드 바탕색 받침을 깔아요
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
