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
  /** 출발 노드 필드. 기본 "source" (없으면 "from") */
  source?: Accessor<T, string>;
  /** 도착 노드 필드. 기본 "target" (없으면 "to") */
  target?: Accessor<T, string>;
  /** 링크 굵기 값. 없으면(데이터에 "value" 필드도 없으면) 행마다 1이에요 */
  value?: Accessor<T, number>;
  /** 강조할 노드(이름, 인덱스, 배열, "max"는 가장 많이 이어진 노드). 함수는 노드 이름을 받아요. 기본 "max" */
  highlight?: Highlight<string>;
  /** 배치. 지금은 "arc"(노드를 한 줄에 두고 링크를 위쪽 호로)만 있어요 */
  layout?: "arc";
  /** 노드 순서. "auto"는 묶음(없으면 연결된 덩어리)을 붙여 두고 긴 호를 줄이는 순서, "data"는 데이터 순서, "group"은 묶음 순서, "degree"는 이어진 노드가 많은 것부터. 기본 "auto" */
  sort?: NetworkSort;
  /** 노드 이름 → 묶음 이름. 묶음마다 점 색이 달라지고(회색 단계), sort "group"과 "auto"가 묶음끼리 붙여 둬요 */
  groups?: Readonly<Record<string, string>>;
  /** 점 크기: "value"는 이어진 링크 값의 합, "degree"는 이어진 노드 수. 기본 "value" */
  nodeSize?: "value" | "degree";
}

const LABEL_SIZE = 11;
/** sin 45°. 기울인 이름표 */
const TILT = Math.SQRT1_2;
/** 기울인 이름표 사이 가로 간격(px). 줄 간격 12px ÷ sin 45° */
const TILT_GAP = 17;
/** 기울인 이름표 최대 폭(px) */
const MAX_TILT = 96;
/** 가로 이름표 사이 여백(px) */
const FLAT_GAP = 6;
/**
 * 이웃한 노드 사이 최대 간격(px). 노드가 두셋뿐인 그래프가 카드 양끝까지 벌어져 반원 하나가 카드를 채우지 않게,
 * 작은 그래프는 작게 가운데에 그려요. 가장 긴 이름표가 가로로 들어갈 만큼은 넓혀 주되 MAX_FLAT_STEP까지예요
 */
const MAX_STEP = 88;
const MAX_FLAT_STEP = 160;
/** 링크가 이보다 많으면 호마다 넓은 투명 선(호버 자리)을 깔지 않아요. 3,000개면 SVG가 두 배가 되고, 그만큼 빽빽하면 노드로 읽어요 */
const HIT_LINKS = 800;

type Part = { node: number; name: string } | { link: number; key: string };

/**
 * 네트워크(호 배치): 노드를 한 줄에 두고 링크를 위쪽 호로 이어요. 호 높이는 두 노드 사이 거리에, 굵기는 값에 비례해요.
 * 배치가 한 번의 계산이라 서버와 브라우저 그림이 같고, 노드에 순서가 있어 좌우 키로 옮겨 다녀요
 */
export function NetworkChart<T = Row>(props: NetworkChartProps<T>) {
  const { graph, weighted } = useMemo(() => {
    const has = (k: string) => props.data.some((d) => d !== null && typeof d === "object" && hasField(d as object, k));
    const gs = strGetter(props.source ?? (has("source") ? "source" : "from"), "source");
    const gt = strGetter(props.target ?? (has("target") ? "target" : "to"), "target");
    // 값 필드가 없으면 행마다 1 (구조만 보는 데이터)
    const weighted = props.value !== undefined || has("value");
    const gv = numGetter(props.value, "value");
    // 이름 앞뒤 빈칸은 떼고 맞춰요("Orders"와 " Orders"는 같은 노드). 대소문자는 그대로 구분해요
    const rows = props.data.map((d, i) => ({ source: gs(d, i).trim(), target: gt(d, i).trim(), value: weighted ? gv(d, i) : 1 }));
    return { graph: networkGraph(rows, props.groups), weighted };
  }, [props.data, props.source, props.target, props.value, props.groups]);
  const groups = useMemo(() => groupNames(props.groups), [props.groups]);
  const order = useMemo(() => networkOrder(graph, props.sort ?? "auto", groups), [graph, props.sort, groups]);
  const { nodes, links } = graph;
  const N = order.length;

  // 강조 "max"는 이어진 노드가 가장 많은 노드 (같으면 값 합이 큰 노드). 링크가 없는 노드는 고르지 않아요
  const hi = useMemo(() => {
    const total = sum(nodes.map((n) => n.strength)) + 1;
    const score = nodes.map((n) => (n.degree ? n.degree + n.strength / total : NaN));
    const names = nodes.map((n) => n.name);
    return resolveHighlight(props.highlight as never, names as never[], names, score, "max");
  }, [nodes, props.highlight]);

  const showLabels = props.showLabels !== false;
  const sizeByDegree = props.nodeSize === "degree";
  // 기본 높이: 이름표 띠와 가장 긴 호(반원)가 들어가는 만큼. 호가 짧은 순서면 낮아져서 위가 비지 않아요. 폭마다 한 번만 재요
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

  // 키보드, 표, 툴팁 순서: 노드는 배치 순서, 그다음 링크는 값이 큰 것부터
  const linkOrder = useMemo(() => links.map((l) => l.index).sort((a, b) => links[b].value - links[a].value || a - b), [links]);
  const eventOfLink = useMemo(() => {
    const m = new Array<number>(links.length);
    linkOrder.forEach((k, j) => (m[k] = N + j));
    return m;
  }, [linkOrder, links.length, N]);
  const eventOfNode = useMemo(() => positions(order), [order]);
  // 링크 이름표(표의 key, 움직임 key, 지난 프레임의 링크인지 보는 데)를 한 번만 만들어요
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

  // 눌러서(또는 Enter) 고정한 항목. 이름으로 들고 있어서 데이터가 바뀌어도 같은 노드면 그대로예요
  const [pin, setPin] = useState<string | null>(null);
  // 위아래 키로 링크를 고를 때 기준 노드 (이름)
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
    // 묶음을 쓰면 묶음 없는 노드는 마지막 단계예요
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
    // 툴팁은 이 노드의 가장 높은 호 위에 띄워요. 점 위에 두면 짧은 호(가장 가까운 이웃)를 가려요
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
  // 가장 가까운 노드. 작은 그래프는 가운데에 있어서, 노드에서 반 칸(최소 24px)보다 먼 빈자리는 아무것도 고르지 않아요
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
        // 기준 노드의 링크를 값이 큰 것부터. 위 키로 가장 굵은 링크 앞까지 오면 노드로 돌아가요
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
  // 링크가 많을수록 강조 아닌 호를 옅게 (80개까지 0.32, 3,000개면 0.1). 빽빽해도 강조 노드의 호가 묻히지 않아요
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
      // 호버와 누름은 호 묶음(<g>)이 data-l(항목 번호)로 받아요. 링크마다 함수를 만들지 않아요
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
      {/* 점과 이름표는 누름을 받지 않아요. 아래 투명한 띠가 가장 가까운 노드를 고정해요 */}
      <g pointerEvents="none">{dots}</g>
    </ChartFrame>
  );
}

/** 위쪽 호: 왼쪽 끝에서 오른쪽 끝으로, 가로 반지름은 거리의 절반, 세로 반지름 h. 좌우 대칭이에요 */
function arcD(xa: number, xb: number, h: number, y: number): string {
  const l = Math.min(xa, xb);
  const rgt = Math.max(xa, xb);
  return `M${r2(l)},${r2(y)}A${r2((rgt - l) / 2)},${r2(Math.max(0, h))} 0 0 1 ${r2(rgt)},${r2(y)}`;
}

/**
 * 자리, 점 크기, 호 높이와 굵기, 이름표. 노드 간격에 이름표가 모두 가로로 들어가면 가로로, 아니면 45° 기울이고,
 * 기울여도 17px보다 촘촘하면 강조, 이어진 노드가 많은 순서로 겹치지 않는 이름표만 적어요
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
      // 기울인 이름표는 노드 왼쪽 아래로 늘어져요. 첫 노드들의 이름표가 들어가게 왼쪽 여백을 잡아요 (폭의 30%까지)
      padR = edge;
      padL = edge;
      order.forEach((n, i) => (padL = Math.max(padL, Math.min(wOf[n], MAX_TILT) * TILT + 4 - i * step0)));
      padL = Math.min(padL, W * 0.3);
    }
  }
  const step = inner(padL, padR);
  // 간격 상한에 걸려 남는 폭은 양옆으로 나눠 줄을 가운데에 둬요 (이름표 여백 안에서)
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
      // 이미 적은 이름표의 x를 정렬해 두고 양옆 이웃만 봐요 (노드 300개에서도 빨라요)
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

  // 링크 굵기: 값에 비례, 노드 간격의 45%(1.2~7px)까지. 값이 모두 같으면 2px
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
  // 호 높이는 거리의 절반(반원)에, 가장 긴 호가 위 여백까지 오게 한 배율을 곱해요. 모든 호가 같은 배율이라 높이가 거리를 따라요
  const k = span > 0 ? Math.min(1, (baseY - topPad) / (span / 2)) : 1;
  const h = links.map((l) => (Math.abs(x[l.a] - x[l.b]) / 2) * k);

  const size = nodes.map((n) => (sizeByDegree ? n.degree : n.strength));
  const sMax = size.reduce((a, b) => Math.max(a, b), 0);
  const rMin = Math.max(1, rMax * 0.35);
  const r = size.map((s) => (s > 0 && sMax > 0 ? rMin + (rMax - rMin) * Math.sqrt(s / sMax) : rMin));
  // 호를 반원으로 그릴 때 필요한 높이 (기본 높이)
  const natural = band + span / 2 + topPad;
  return { x, r, h, w, baseY, label, tilt, step, x0, rMax, natural };
}
