import type { KeyboardEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoLegend, Chart } from "../src/charts/Chart";
import { NetworkChart } from "../src/charts/network";
import type { ChartFrameProps } from "../src/core/ChartFrame";
import { arcCost, networkGraph, networkOrder } from "../src/layout/network";
import { renderSpecToSVG } from "../src/server";
import { CHARTS, validateSpec } from "../src/spec";
import { networkSample, networkSampleKo } from "../src/spec/samples";
import { ThemeProvider } from "../src/theme/context";

/** tileMap.test.tsx와 같은 틀: active를 주면 고른 항목을, spy를 켜면 setActive 호출을 기록해요. frame은 마지막 ChartFrame props예요 */
const state = vi.hoisted(() => ({
  active: null as number | null,
  via: "pointer" as "pointer" | "keyboard",
  spy: false,
  calls: [] as [number | null, string | undefined][],
  frame: null as unknown,
}));

vi.mock("../src/core/useChart", async (orig) => {
  const actual = await orig<typeof import("../src/core/useChart")>();
  return {
    ...actual,
    useChart: (props: never, d: never) => {
      const c = actual.useChart(props, d);
      const out = state.spy ? { ...c, setActive: (i: number | null, via?: string) => void state.calls.push([i, via]) } : c;
      return state.active === null ? out : { ...out, active: state.active, via: state.via };
    },
  };
});
vi.mock("../src/core/ChartFrame", async (orig) => {
  const actual = await orig<typeof import("../src/core/ChartFrame")>();
  return {
    ...actual,
    ChartFrame: (p: ChartFrameProps<unknown>) => {
      state.frame = p;
      return actual.ChartFrame(p);
    },
  };
});

afterEach(() => {
  state.active = null;
  state.via = "pointer";
  state.spy = false;
  state.calls = [];
  state.frame = null;
});

const r = (el: ReactElement) => renderToStaticMarkup(el);
const frame = () => state.frame as ChartFrameProps<unknown>;
type L = { from: string; to: string; calls?: unknown };
const L = (from: string, to: string, calls?: unknown): L => ({ from, to, calls });
const draw = (data: readonly Record<string, unknown>[], extra: Record<string, unknown> = {}) => r(<NetworkChart data={data} source="from" target="to" value="calls" width={720} animate={false} {...extra} />);
/** 호 path: 왼쪽 끝 x, 오른쪽 끝 x, 세로 반지름, 굵기, 색, 불투명도 (보이는 선만, 투명한 호버 선은 빼요) */
const arcs = (h: string) =>
  [...h.matchAll(/<path class="ztd-mark" d="M([\d.]+),([\d.]+)A([\d.]+),([\d.]+) 0 0 1 ([\d.]+),([\d.]+)" fill="none" stroke="([^"]+)" stroke-width="([\d.]+)"[^>]*opacity="([\d.]+)"/g)].map((m) => ({ x0: +m[1], y: +m[2], rx: +m[3], ry: +m[4], x1: +m[5], y1: +m[6], stroke: m[7], w: +m[8], opacity: +m[9] }));
const dots = (h: string) => [...h.matchAll(/<circle class="ztd-mark" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="([^"]+)"/g)].map((m) => ({ x: +m[1], r: +m[3], fill: m[4] }));
const labels = (h: string) => [...h.matchAll(/<text x="([\d.]+)" y="[\d.]+" dy="[^"]+"(?: transform="([^"]+)")? font-size="11" font-weight="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: +m[1], tilt: !!m[2], weight: +m[3], text: m[4] }));
const ACCENT = /--ztd-accent/;

describe("networkGraph and networkOrder", () => {
  it("merges both directions and duplicate rows into one link, keeping each direction's sum (the chord rule)", () => {
    const g = networkGraph([
      { source: "A", target: "B", value: 3 },
      { source: "A", target: "B", value: 2 },
      { source: "B", target: "A", value: 4 },
      { source: "B", target: "C", value: 1 },
    ]);
    expect(g.links.map((l) => [g.nodes[l.a].name, g.nodes[l.b].name, l.ab, l.ba, l.value])).toEqual([
      ["A", "B", 5, 4, 9],
      ["B", "C", 1, 0, 1],
    ]);
    expect(g.nodes.map((n) => [n.name, n.degree, n.strength])).toEqual([
      ["A", 1, 9],
      ["B", 2, 10],
      ["C", 1, 1],
    ]);
    // B의 링크는 값이 큰 것부터
    expect(g.nodes[1].links.map((k) => g.links[k].value)).toEqual([9, 1]);
  });

  it("self links, values at or below 0 and non-numbers draw no link but keep the node; blank names drop the row", () => {
    const g = networkGraph([
      { source: "A", target: "A", value: 3 },
      { source: "A", target: "B", value: 0 },
      { source: "B", target: "C", value: -2 },
      { source: "C", target: "D", value: NaN },
      { source: "", target: "E", value: 1 },
      { source: "D", target: "F", value: 2 },
    ]);
    expect(g.nodes.map((n) => n.name)).toEqual(["A", "B", "C", "D", "F"]);
    expect(g.links).toHaveLength(1);
    // F는 도착으로만 나와요. 덩어리는 큰 것부터: D-F, 그다음 A, B, C 하나씩
    expect(g.nodes.map((n) => n.component)).toEqual([1, 2, 3, 0, 0]);
    expect(g.components).toBe(4);
  });

  it("sorts as given, by group, by degree, and by default with shorter arcs than the data order", () => {
    const rows = networkSample.map((d) => ({ source: d.from, target: d.to, value: d.calls }));
    const g = networkGraph(rows, { Payments: "Money", Billing: "Money", Web: "Edge" });
    const names = (o: number[]) => o.map((n) => g.nodes[n].name);
    expect(names(networkOrder(g, "data")).slice(0, 4)).toEqual(["Web", "Gateway", "Mobile app", "Auth"]);
    expect(names(networkOrder(g, "degree")).slice(0, 3)).toEqual(["Gateway", "Payments", "Orders"]);
    expect(names(networkOrder(g, "group", ["Money", "Edge"])).slice(0, 3)).toEqual(["Payments", "Billing", "Web"]);
    const cost = (o: number[]) => arcCost(g, o.map((_, n) => o.indexOf(n)));
    const plain = networkGraph(rows);
    const costOf = (o: number[]) => arcCost(plain, o.map((_, n) => o.indexOf(n)));
    // 표본에서 긴 호의 합(칸 수): 데이터 순서 75, 기본 순서 54 (28% 짧아요)
    expect([costOf(networkOrder(plain, "data")), costOf(networkOrder(plain))]).toEqual([75, 54]);
    // 묶음을 주면 묶음끼리 붙어 있어요
    const grouped = names(networkOrder(g, "auto", ["Money", "Edge"]));
    expect(grouped.slice(0, 2).sort()).toEqual(["Billing", "Payments"]);
    expect(grouped[2]).toBe("Web");
    expect(cost(networkOrder(g, "auto", ["Money", "Edge"]))).toBeLessThanOrEqual(cost(networkOrder(g, "group", ["Money", "Edge"])));
  });

  it("keeps each connected part together, the largest first", () => {
    const rows = [L("A", "B"), L("X", "Y"), L("B", "C"), L("Y", "Z"), L("C", "A"), L("Q", "R")].map((d) => ({ source: d.from, target: d.to, value: 1 }));
    const g = networkGraph(rows);
    const order = networkOrder(g).map((n) => g.nodes[n].name);
    expect(order.slice(0, 3).sort()).toEqual(["A", "B", "C"]);
    expect(order.slice(3, 6).sort()).toEqual(["X", "Y", "Z"]);
    expect(order.slice(6).sort()).toEqual(["Q", "R"]);
  });
});

describe("NetworkChart", () => {
  it("highlights the most connected node by default, its links in the accent color and drawn over the quiet ones", () => {
    const h = draw(networkSample);
    const a = arcs(h);
    expect(a).toHaveLength(24);
    const hot = a.filter((x) => ACCENT.test(x.stroke));
    // Gateway: Web, Mobile app, Auth, Search, Catalog, Cart, Orders, Logs
    expect(hot).toHaveLength(8);
    // 강조 호는 모두 나머지 뒤에 그려요 (위에 얹혀요)
    expect(a.findIndex((x) => ACCENT.test(x.stroke))).toBe(a.length - hot.length);
    expect(labels(h).filter((t) => t.weight === 800).map((t) => t.text)).toEqual(["Gateway"]);
    expect(dots(h).filter((d) => ACCENT.test(d.fill))).toHaveLength(1);
    expect(labels(draw(networkSample, { highlight: "Payments" })).filter((t) => t.weight === 800).map((t) => t.text)).toEqual(["Payments"]);
    // 맞는 노드가 없거나 "none"이면 강조색이 없어요
    for (const highlight of ["Nope", "none"]) expect(draw(networkSample, { highlight })).not.toMatch(ACCENT);
  });

  it("arcs are symmetric half ellipses whose height follows the distance, and none reaches above the top", () => {
    for (const width of [720, 390, 280]) {
      const h = draw(networkSample, { width });
      const a = arcs(h);
      const k = a.map((x) => x.ry / x.rx);
      // 모든 호가 같은 배율: 높이는 거리에 비례해요
      expect(Math.max(...k) - Math.min(...k)).toBeLessThan(0.02);
      for (const x of a) {
        expect(x.y).toBe(x.y1);
        expect(x.rx).toBeCloseTo((x.x1 - x.x0) / 2, 1);
        expect(x.y - x.ry - x.w / 2).toBeGreaterThanOrEqual(0);
      }
      // 굵기는 값을 따라요: 가장 굵은 호는 Web-Gateway(42)
      const widest = a.reduce((m, x) => (x.w > m.w ? x : m));
      expect(widest.w).toBeGreaterThan(Math.min(...a.map((x) => x.w)));
    }
  });

  it("the table, tooltip and narration name the node's connections and strongest link", () => {
    state.active = 0;
    state.via = "keyboard";
    draw(networkSample, { highlight: "Payments", unit: "K" });
    const ev = frame().events;
    const pay = ev.findIndex((e) => e.label === "Payments");
    expect(ev[pay].formatted).toBe("7 connections, 41K");
    state.active = pay;
    draw(networkSample, { highlight: "Payments", unit: "K" });
    expect(frame().announce).toBe(`Payments, 7 connections, strongest link to Orders (${pay + 1}/14)`);
    expect(frame().tip!.rows.map((row) => `${row.label}=${row.value}`)).toEqual(["Connections=7", "Total=41K", "Strongest link=Orders 12K"]);
    // 노드 다음은 링크, 값이 큰 것부터. 두 방향이 있는 쌍은 방향마다 값을 적어요
    const both = ev.find((e) => e.label === "Orders ↔ Payments")!;
    expect(both.formatted).toBe("Orders→Payments 9K, Payments→Orders 3K");
    expect(ev[14].label).toBe("Web → Gateway");
    expect(frame().description).toBe("Network. 14 nodes, 24 links. Most connected: Gateway (8 connections), Payments (7), Orders (5).");
    r(<NetworkChart data={networkSampleKo} source="from" target="to" value="calls" width={720} animate={false} locale="ko" unit="천 건" />);
    expect(frame().description).toBe("네트워크. 노드 14개, 링크 24개. 가장 많이 이어진 노드: 게이트웨이 (연결 8개), 결제 (7), 주문 (5).");
  });

  it("a link's tooltip names both ends and the value", () => {
    draw(networkSample);
    const ev = frame().events;
    state.active = ev.findIndex((e) => e.label === "Orders ↔ Payments");
    draw(networkSample);
    expect(frame().tip!.title).toBe("Orders ↔ Payments");
    expect(frame().tip!.rows.map((row) => `${row.label}=${row.value}`)).toEqual(["Orders → Payments=9", "Payments → Orders=3"]);
  });

  it("focusing a node keeps only its links and neighbors; the rest goes quiet", () => {
    draw(networkSample);
    state.active = frame().events.findIndex((e) => e.label === "Billing");
    const h = draw(networkSample);
    const a = arcs(h);
    // Billing: Payments, Logs
    expect(a.filter((x) => ACCENT.test(x.stroke))).toHaveLength(2);
    expect(a.filter((x) => !ACCENT.test(x.stroke)).every((x) => x.opacity < 0.1)).toBe(true);
    expect((h.match(/<g opacity="0.3">/g) ?? []).length).toBe(14 - 3);
  });

  it("left and right walk the nodes in layout order, up and down walk the node's links by weight, Enter pins", async () => {
    const { ChartFrame: RealFrame } = await vi.importActual<typeof import("../src/core/ChartFrame")>("../src/core/ChartFrame");
    const onClick = vi.fn();
    const run = (active: number | null, key: string) => {
      state.spy = true;
      state.active = active;
      state.via = "keyboard";
      state.calls = [];
      draw(networkSample, { onClick });
      let root: ReactElement<{ onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void }> | null = null;
      function Probe() {
        root = RealFrame(frame());
        return root;
      }
      r(<Probe />);
      const self = {};
      root!.props.onKeyDown({ key, target: self, currentTarget: self, preventDefault() {} } as never);
      return state.calls.map(([i]) => (i === null ? "-" : frame().events[i].label));
    };
    draw(networkSample);
    const ev = frame().events;
    const gw = ev.findIndex((e) => e.label === "Gateway");
    expect(run(null, "ArrowRight")).toEqual([ev[0].label]);
    expect(run(gw, "ArrowRight")).toEqual([ev[gw + 1].label]);
    expect(run(gw, "ArrowLeft")).toEqual([ev[gw - 1].label]);
    expect(run(0, "ArrowLeft")).toEqual([ev[13].label]);
    // Gateway의 가장 굵은 링크는 Web(42), 그다음 Mobile app(36)
    expect(run(gw, "ArrowDown")).toEqual(["Web → Gateway"]);
    expect(run(null, "End")).toEqual([ev[13].label]);
    expect(onClick).not.toHaveBeenCalled();
    run(gw, "Enter");
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ label: "Gateway" }));
  });

  it("a graph with two to four nodes is a small drawing in the middle, and the card height follows it", () => {
    const chain = (n: number) => Array.from({ length: n - 1 }, (_, i) => L(`N${i}`, `N${i + 1}`, i + 1));
    for (const width of [720, 390])
      for (const n of [2, 3, 4]) {
        const h = draw(chain(n), { width });
        const xs = dots(h).map((d) => d.x);
        const span = Math.max(...xs) - Math.min(...xs);
        // 이웃 간격은 88px까지, 줄은 가운데
        expect(span, `${n} nodes at ${width}`).toBeLessThanOrEqual(88 * (n - 1) + 0.1);
        expect(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - width / 2)).toBeLessThan(1);
        expect(Math.max(...arcs(h).map((a) => a.ry))).toBeLessThanOrEqual(44 * (n - 1) + 0.1);
        const height = +/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(h)![1];
        expect(height).toBeLessThanOrEqual(200);
      }
    // 이름표가 길면 가로로 들어갈 만큼 넓히되 160px까지
    const wide = dots(draw([L("Payments service", "Orders service", 1)])).map((d) => d.x);
    expect(wide[1] - wide[0]).toBeGreaterThan(88);
    expect(wide[1] - wide[0]).toBeLessThanOrEqual(160);
  });

  it("names match after trimming surrounding spaces, and case still counts", () => {
    draw([L("Orders", "Payments", 3), L("orders", "Payments ", 4), L(" Orders", "payments", 5)]);
    expect(frame().events.filter((e) => !e.label.includes("→") && !e.label.includes("↔")).map((e) => e.label).sort()).toEqual(["Orders", "Payments", "orders", "payments"]);
    expect(validateSpec({ type: "network", data: [L(" A", "A ", 1), L("  ", "B", 1)], encoding: { source: "from", target: "to", value: "calls" } }).warnings.map((w) => `W ${w.code}: ${w.message}`)).toEqual(["W network_self_link: 1 row links a node to itself and is not drawn", "W network_blank_node: 1 row has an empty source or target and is left out"]);
  });

  it("labels go flat when they fit, tilt when they do not, and thin out by rule so they never overlap", () => {
    const short = [L("A", "B", 1), L("B", "C", 2), L("C", "D", 1)];
    expect(labels(draw(short)).every((t) => !t.tilt)).toBe(true);
    for (const width of [720, 390, 280]) {
      const ls = labels(draw(networkSample, { width }));
      expect(ls.every((t) => t.tilt), String(width)).toBe(true);
      const xs = ls.map((t) => t.x).sort((a, b) => a - b);
      // 기울인 이름표 사이 가로 간격 17px 이상 (줄 간격 12px)
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(16.9);
    }
    // 390px에서 표본 14개는 모두 적어요
    expect(labels(draw(networkSample, { width: 390 }))).toHaveLength(14);
    expect(labels(draw(networkSample, { showLabels: false }))).toHaveLength(0);
  });

  it("long, RTL, CJK and emoji names are cut to the room they have", () => {
    const data = [L("Payments and billing reconciliation service", "شبكة الدفع", 5), L("שירות הזמנות", "🚀 Launch", 3), L("🚀 Launch", "決済サービス", 4), L("決済サービス", "결제", 2)];
    for (const width of [280, 390]) {
      const ls = labels(draw(data, { width }));
      expect(ls).toHaveLength(6);
      expect(ls.some((t) => t.text.endsWith("…"))).toBe(true);
      expect(ls.map((t) => t.text)).toContain("שירות הזמנות");
    }
  });

  it("edge inputs draw without NaN, Infinity or undefined", () => {
    const cases: Record<string, unknown>[][] = [
      [],
      [L("A", "B", 3)],
      [L("A", "A", 3)],
      [L("A", "B", 0), L("A", "C", -3), L("B", "C", "n/a"), L("C", "D", null), { from: "D", to: "E" }, L("E", "F", Infinity), L("F", "A", "12")],
      [L("", "B", 1), { from: "A", to: null, calls: 2 }],
      [L("<b>", '"&', 1)],
    ];
    for (const data of cases) for (const width of [280, 720]) expect(draw(data, { width })).not.toMatch(/NaN|Infinity|undefined/);
    // 노드는 있는데 링크가 없으면 점만, 강조 없음
    const lonely = draw([L("A", "A", 3), L("B", "C", 0)]);
    expect(arcs(lonely)).toHaveLength(0);
    expect(dots(lonely)).toHaveLength(3);
    expect(lonely).not.toMatch(ACCENT);
    expect(frame().description).toBe("Network. 3 nodes, 0 links, in 3 separate parts.");
    // 값 필드가 없으면 행마다 1: 같은 쌍 두 행은 2
    r(<NetworkChart data={[{ from: "A", to: "B" }, { from: "A", to: "B" }, { from: "B", to: "C" }]} width={480} animate={false} />);
    expect(frame().events.map((e) => `${e.label}=${e.value}`)).toEqual(["A=1", "B=2", "C=1", "A → B=2", "B → C=1"]);
  });

  it("300 nodes and 3,000 links stay within a few hundred KB, and labels thin out", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const big = Array.from({ length: 3000 }, () => {
      const a = Math.floor(rnd() * 300);
      const b = (a + 1 + Math.floor(rnd() * 299)) % 300;
      return L(`svc-${a}`, `svc-${b}`, 1 + Math.floor(rnd() * 50));
    });
    const h = draw(big);
    expect(h).not.toMatch(/NaN|Infinity|undefined/);
    expect(arcs(h).length).toBeGreaterThan(2500);
    // 3,000개면 호버용 투명 선을 깔지 않아요
    expect(h).not.toContain('stroke="transparent"');
    expect(h.length).toBeLessThan(700_000);
    const ls = labels(h);
    expect(ls.length).toBeGreaterThan(20);
    expect(ls.length).toBeLessThan(50);
  });

  it("groups color the dots in gray steps and the card legend uses the same colors", () => {
    const groups = { Web: "Edge", Gateway: "Edge", Payments: "Money", Billing: "Money", Logs: "Ops" };
    const spec = { type: "network", data: networkSample, encoding: { source: "from", target: "to", value: "calls" }, options: { groups, highlight: "none" } };
    expect(autoLegend(spec, networkSample, "en-US")).toEqual([
      { label: "Edge", color: "ink", shape: "circle" },
      { label: "Money", color: "neutralStrong", shape: "circle" },
      { label: "Ops", color: "mix:0.6666666666666667", shape: "circle" },
    ]);
    // 서버 SVG(테마 색이 든 글자)에서 범례 색과 그 묶음 노드의 점 색이 같아요. 묶음 없는 노드는 범례에 없는 네 번째 단계예요
    for (const theme of ["light", "dark"] as const) {
      const svg = renderSpecToSVG({ ...spec, card: { title: "t", legend: "auto" } }, { width: 720, theme });
      const at = svg.indexOf("<svg x=");
      const legend = new Map([...svg.slice(0, at).matchAll(/<text [^>]*>([^<]*)<\/text><rect [^>]*fill="([^"]+)"/g)].map((m) => [m[1], m[2]]));
      const body = svg.slice(at);
      const dotOf = (name: string) => {
        const lab = [...body.matchAll(/<circle class="ztd-mark" cx="([\d.]+)" cy="[\d.]+" r="[\d.]+" fill="([^"]+)"/g)];
        const x = new RegExp(`<text x="([\\d.]+)"[^>]*>${name}</text>`).exec(body)![1];
        return lab.find((m) => m[1] === x)![2];
      };
      expect([dotOf("Gateway"), dotOf("Billing"), dotOf("Logs")], theme).toEqual([legend.get("Edge"), legend.get("Money"), legend.get("Ops")]);
      expect(new Set([dotOf("Orders"), ...legend.values()]).size, theme).toBe(4);
    }
    expect(autoLegend({ ...spec, options: {} }, networkSample, "en-US")).toEqual([]);
  });

  it("the server SVG and the browser chart draw the same geometry, at the end state", () => {
    const def = CHARTS.find((c) => c.type === "network")!;
    const geometry = (s: string) => [...s.matchAll(/ (d|cx|r|x|y|width|height)="([-\d.,MLHVACZ ]+)"/g)].map((m) => `${m[1]}=${m[2]}`).join(" ");
    const server = renderSpecToSVG(def.example, { width: 640 + 48, frame: false, theme: "light" });
    const browser = r(
      <ThemeProvider theme="light">
        <Chart spec={{ ...def.example, card: undefined }} width={640} animate={false} />
      </ThemeProvider>,
    );
    const body = /<svg[^>]*class="ztd-svg"[^>]*>([\s\S]*?)<\/svg>/.exec(browser)![1];
    expect(geometry(body).length).toBeGreaterThan(500);
    const inner = server.slice(server.indexOf('<svg x="'));
    expect(geometry(inner).replace(/^x=\S+ y=\S+ width=\S+ height=\S+ /, "")).toBe(geometry(body));
    // 동작 줄이기도 같은 끝 상태
    const direct = (extra: Record<string, unknown>) => geometry(draw(networkSample, extra));
    expect(direct({ animate: undefined, reducedMotion: true })).toBe(direct({}));
  });
});

describe("validateSpec: network", () => {
  const spec = (data: Record<string, unknown>[], options: Record<string, unknown> = {}) => ({ type: "network", data, encoding: { source: "from", target: "to", value: "calls" }, options });
  const issues = (s: unknown, lang: "en" | "ko" = "en") => {
    const v = validateSpec(s, { lang });
    return [...v.errors.map((e) => `E ${e.code}: ${e.message}`), ...v.warnings.map((w) => `W ${w.code}: ${w.message}`)];
  };

  it("the example validates cleanly, and its aliases draw as network", () => {
    expect(issues(CHARTS.find((c) => c.type === "network")!.example)).toEqual([]);
    expect(issues({ ...spec(networkSample), type: "arcDiagram" })).toEqual(['W alias: "arcDiagram" is drawn as "network"']);
  });

  it("warns about self links, blank names and negative values, and names unknown layouts", () => {
    expect(issues(spec([L("A", "A", 1), L("", "B", 1), L("A", "B", -1), L("A", "C", 2)]))).toEqual([
      "W network_self_link: 1 row links a node to itself and is not drawn",
      "W network_blank_node: 1 row has an empty source or target and is left out",
      "W network_negative_value: 1 link has a value below 0 and is not drawn. The nodes stay",
    ]);
    expect(issues(spec(networkSample, { layout: "force" }))).toEqual(['E bad_enum: options.layout must be one of "arc"']);
    expect(issues(spec([L("A", "A", 1)]), "ko")).toEqual(["W network_self_link: 노드가 자기 자신으로 가는 행 1개는 그리지 않아요"]);
  });

  it("checks groups: names must be strings and keys should be nodes", () => {
    expect(issues(spec(networkSample, { groups: { Web: 1, Atlantis: "Edge" } }))).toEqual(['W network_bad_group: Group names must be strings, so "Web" has no group', 'W network_group_not_found: "Atlantis" is not a node in the data']);
    expect(issues(spec(networkSample, { groups: ["Edge"] }))[0]).toMatch(/^E bad_option_type: options.groups must be an object/);
  });
});
