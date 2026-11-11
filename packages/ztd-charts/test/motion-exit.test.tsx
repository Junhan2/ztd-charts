// 등장이 끝난 차트에 다른 데이터를 주면 useMotion이 engine.update로 넘어가고, 빠진 항목은 옛 data를 든 채 exiting으로 남아요.
// 그 옛 번호로 새 데이터의 배열을 읽으면 렌더가 던져서 페이지 전체가 하얘졌어요 (문서 갤러리의 언어 전환, 타일 지도 미국 51칸 → 한국 16칸).
// jsdom이 없어서 react-dom/client가 쓰는 만큼만 흉내 낸 작은 DOM에 차트를 붙여요. window가 있어야 isBrowser가 참이 되고 애니메이션이 켜져요
import type { ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const HTML = "http://www.w3.org/1999/xhtml";

class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  nodeValue: string | null = null;
  attrs = new Map<string, string>();
  style: Record<string, unknown> = { setProperty(k: string, v: string) { this[k] = v; }, removeProperty(k: string) { delete this[k]; } };
  constructor(
    public nodeType: number,
    public nodeName: string,
    public ownerDocument: FakeNode | null,
    public namespaceURI: string | null = HTML,
  ) {}
  get tagName() { return this.nodeName.toUpperCase(); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() { const s = this.parentNode?.childNodes ?? []; return s[s.indexOf(this) + 1] ?? null; }
  get parentElement(): FakeNode | null { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get id() { return this.attrs.get("id") ?? ""; }
  set id(v: string) { this.attrs.set("id", v); }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue ?? "" : this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v: string) {
    if (this.nodeType === 3) this.nodeValue = v;
    else {
      for (const c of this.childNodes) c.parentNode = null;
      this.childNodes = [];
      if (v) this.appendChild(Object.assign(new FakeNode(3, "#text", this.ownerDocument), { nodeValue: v }));
    }
  }
  set innerHTML(v: string) { this.textContent = v; }
  appendChild(c: FakeNode) { return this.insertBefore(c, null); }
  insertBefore(c: FakeNode, ref: FakeNode | null) {
    c.parentNode?.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c: FakeNode) {
    this.childNodes.splice(this.childNodes.indexOf(c), 1);
    c.parentNode = null;
    return c;
  }
  contains(n: FakeNode | null) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  setAttribute(k: string, v: unknown) { this.attrs.set(k, String(v)); }
  setAttributeNS(_: string | null, k: string, v: unknown) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  removeAttributeNS(_: string | null, k: string) { this.attrs.delete(k); }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getContext() { return null; }
  focus() {}
  blur() {}
}

/** requestAnimationFrame 대신 모아 두었다가 정한 시각으로 돌려요 */
const frames: ((t: number) => void)[] = [];

function installDom() {
  const doc = new FakeNode(9, "#document", null) as FakeNode & Record<string, unknown>;
  const el = (name: string, ns = HTML) => new FakeNode(1, name, doc, ns);
  const win: Record<string, unknown> = { document: doc, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {}, innerHeight: 900, devicePixelRatio: 1 };
  const root = doc.appendChild(el("html"));
  Object.assign(doc, {
    defaultView: win,
    documentElement: root,
    head: root.appendChild(el("head")),
    body: root.appendChild(el("body")),
    activeElement: null,
    createElement: (t: string) => el(t),
    createElementNS: (ns: string, t: string) => el(t, ns),
    createTextNode: (s: string) => Object.assign(new FakeNode(3, "#text", doc), { nodeValue: s }),
    getElementById: (id: string) => {
      const walk = (n: FakeNode): FakeNode | null => (n.attrs.get("id") === id ? n : n.childNodes.reduce<FakeNode | null>((f, c) => f ?? walk(c), null));
      return walk(doc);
    },
  });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("requestAnimationFrame", (fn: (t: number) => void) => frames.push(fn));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return doc;
}

type Mods = {
  act: typeof import("react").act;
  createRoot: typeof import("react-dom/client").createRoot;
  Chart: typeof import("../src/charts/Chart").Chart;
  spec: typeof import("../src/spec");
};
let mods: Mods;
let doc: FakeNode & Record<string, unknown>;

beforeAll(async () => {
  doc = installDom();
  // window가 생긴 뒤에 불러야 env.ts의 isBrowser가 참이에요. 새로 불러온 지도 등록표에도 내장 지도를 다시 올려요 (setup-maps.ts와 같게)
  vi.resetModules();
  const [react, client, chart, spec, geo, world, us, kr] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("../src/charts/Chart"),
    import("../src/spec"),
    import("../src/geo/registry"),
    import("../src/geo/world"),
    import("../src/geo/us-states"),
    import("../src/geo/kr-sido"),
  ]);
  geo.registerMap(world.world, us.usStates, kr.krSido);
  mods = { act: react.act, createRoot: client.createRoot, Chart: chart.Chart, spec };
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** 모아 둔 프레임을 now + ms 시각으로 돌려요. 계속 움직이는 차트(실시간 선)가 끝없이 돌지 않게 몇 바퀴까지만 */
function flush(ms: number) {
  const t = performance.now() + ms;
  for (let k = 0; k < 4 && frames.length; k++) for (const fn of frames.splice(0)) fn(t);
}

describe("데이터가 바뀔 때 빠지는 항목 (useMotion exiting)", () => {
  it("등장이 끝난 모든 차트에 다른 언어 예시, 절반, 한 행, 빈 데이터, 원래 데이터를 차례로 줘도 던지지 않아요", async () => {
    const { act, createRoot, Chart, spec } = mods;
    const failures: string[] = [];
    let entered = 0;
    for (const def of spec.CHARTS) {
      const en = def.example;
      const ko = spec.localizeDef(def, "ko").example;
      const rows = spec.inlineRows(en.data);
      const steps: [string, typeof en][] = [];
      if (ko !== en) steps.push(["ko example", ko]);
      if (rows) {
        steps.push(["first half", { ...en, data: rows.slice(0, Math.ceil(rows.length / 2)) }], ["one row", { ...en, data: rows.slice(0, 1) }], ["no rows", { ...en, data: [] }]);
      }
      steps.push(["full data", en]);
      const errors: unknown[] = [];
      const onError = (e: unknown) => void errors.push(e);
      const container = (doc.body as FakeNode).appendChild(new FakeNode(1, "div", doc));
      const root = createRoot(container as unknown as HTMLElement, { onUncaughtError: onError, onCaughtError: onError, onRecoverableError: onError });
      const draw = (s: typeof en): ReactNode => <Chart spec={s} width={480} />;
      const run = async (label: string, fn: () => void) => {
        try {
          await act(async () => fn());
        } catch (e) {
          errors.push(e);
        }
        if (errors.length) failures.push(`${def.type} / ${label}: ${String((errors[0] as Error)?.message ?? errors[0])}`);
        return errors.length === 0;
      };
      // 붙이고, 등장을 끝까지 돌려요. 등장이 시작됐는지(프레임을 요청했는지)도 세요
      let ok = await run("mount", () => root.render(draw(en)));
      if (frames.length) entered++;
      if (ok) ok = await run("entrance", () => flush(60_000));
      for (const [label, s] of ok ? steps : []) {
        // 바꾼 직후(빠지는 항목이 옛 data로 남아 있어요), 전환 중간, 전환 끝
        if (!(await run(label, () => root.render(draw(s))))) break;
        if (!(await run(`${label} (mid)`, () => flush(150)))) break;
        if (!(await run(`${label} (end)`, () => flush(60_000)))) break;
      }
      await act(async () => root.unmount());
      frames.length = 0;
    }
    expect(failures).toEqual([]);
    // 애니메이션이 실제로 켜졌는지: 모든 차트가 등장 프레임을 요청해야 해요 (꺼져 있으면 update 경로를 안 거쳐요)
    expect(entered).toBe(spec.CHARTS.length);
  }, 60_000);
});
