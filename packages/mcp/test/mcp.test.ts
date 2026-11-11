import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server";

type Content = { type: string; text?: string; data?: string; mimeType?: string };
let client: Client;

beforeAll(async () => {
  const server = createServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(b), client.connect(a)]);
});
afterAll(async () => client?.close());

const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, content: r.content as Content[] };
};
const firstJson = (c: Content[]) => JSON.parse(c[0].text!);

describe("MCP 도구", () => {
  it("다섯 도구와 입력 스키마", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_chart_schema", "list_charts", "render_chart", "suggest_chart", "validate_spec"]);
    for (const t of tools) {
      expect(t.description!.length).toBeGreaterThan(60);
      expect(t.inputSchema.type).toBe("object");
    }
    expect(tools.find((t) => t.name === "list_charts")!.annotations?.readOnlyHint).toBe(true);
  });
  it("list_charts: 전체와 필터", async () => {
    expect(firstJson((await call("list_charts", {})).content).count).toBe(44);
    const r = firstJson((await call("list_charts", { group: "distribution" })).content);
    expect(r.charts.map((c: { type: string }) => c.type)).toEqual(["beeswarm", "ridgeline", "box", "histogram"]);
  });
  it("get_chart_schema: 스키마, 예시, React 코드. 별칭과 모르는 타입", async () => {
    const r = await call("get_chart_schema", { type: "line" });
    const j = firstJson(r.content);
    expect(j.schema.properties.type.const).toBe("line");
    expect(j.example.type).toBe("line");
    expect(r.content[1].text).toContain("<LineChart");
    expect(j.variants.map((v: { id: string }) => v.id)).toContain("forecast");
    expect(firstJson((await call("get_chart_schema", { type: "doughnut" })).content).type).toBe("donut");
    expect((await call("get_chart_schema", { type: "pyramid" })).isError).toBe(true);
    expect(firstJson((await call("get_chart_schema", {})).content).oneOf).toHaveLength(44);
  });
  it("validate_spec: 오류 경로와 제안", async () => {
    const j = firstJson((await call("validate_spec", { spec: { type: "bar", data: [{ q: "1분기", revenue: 1 }], encoding: { x: "q", y: "revenu" } } })).content);
    expect(j.valid).toBe(false);
    expect(j.errors[0]).toMatchObject({ path: "encoding.y", code: "field_not_found" });
    expect(j.errors[0].message).toContain('Did you mean "revenue"?');
  });
  it("validate_spec: locale, 그다음 스펙 options.locale이면 한국어 메시지 (render_chart와 같게)", async () => {
    const spec = { type: "bar", data: [{ q: "1분기", revenue: 1 }], encoding: { x: "q", y: "revenu" } };
    const msg = async (args: Record<string, unknown>) => firstJson((await call("validate_spec", args)).content).errors[0].message as string;
    expect(await msg({ spec, locale: "ko" })).toContain('"revenue"인가요?');
    expect(await msg({ spec: { ...spec, options: { locale: "ko-KR" } } })).toContain('"revenue"인가요?');
  });
  it("render_chart: PNG 이미지, SVG, React 코드", async () => {
    const r = await call("render_chart", { spec: { type: "pie", data: [{ label: "a", value: 3 }, { label: "b", value: 1 }], card: { title: "비중", takeaway: "a가 75%" } }, format: "both", theme: "light", width: 480, scale: 1 });
    expect(r.isError).toBe(false);
    const img = r.content.find((c) => c.type === "image")!;
    expect(img.mimeType).toBe("image/png");
    const png = Buffer.from(img.data!, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(480);
    expect(r.content.some((c) => c.text?.startsWith("<svg"))).toBe(true);
    expect(r.content.some((c) => c.text?.includes("<PieChart"))).toBe(true);
  });
  it('render_chart: a choropleth with "map": "auto" finds the world map from country names', async () => {
    const spec = { type: "choropleth", data: [{ country: "Brazil", rate: 2 }, { country: "KOR", rate: 5 }, { country: 840, rate: 4 }], encoding: { region: "country", value: "rate" } };
    const r = await call("render_chart", { spec, format: "svg", width: 640 });
    expect(r.isError).toBe(false);
    const svg = r.content.find((c) => c.text?.startsWith("<svg"))!.text!;
    expect(svg).toContain("Choropleth map. 3 regions with data. Highest South Korea 5");
    expect((svg.match(/fill-rule="evenodd"/g) ?? []).length).toBeGreaterThan(160);
  });
  it("render_chart: a symbol map from coordinates and a flow map from country names", async () => {
    const spec = { type: "symbolMap", data: [{ city: "Tokyo", lon: 139.69, lat: 35.69, users: 9 }, { city: "Paris", lon: 2.35, lat: 48.86, users: 4 }], encoding: { size: "users", label: "city" } };
    const r = await call("render_chart", { spec, format: "svg", width: 640 });
    expect(r.isError).toBe(false);
    const svg = r.content.find((c) => c.text?.startsWith("<svg"))!.text!;
    expect(svg).toContain("Symbol map. 2 places, 13 in total. Largest: Tokyo 9");
    const flow = { type: "flowMap", data: [{ source: "Brazil", target: "Portugal", value: 4 }], encoding: {} };
    const f = await call("render_chart", { spec: flow, format: "svg", width: 640 });
    expect(f.content.find((c) => c.text?.startsWith("<svg"))!.text!).toContain("Flow map. 1 flow between 2 places");
  });
  it("render_chart: locale로 차트 글자 언어를 정해요 (기본 영어)", async () => {
    const spec = { type: "pie", data: [{ label: "a", value: 3 }, { label: "b", value: 1 }] };
    const svgOf = (r: { content: Content[] }) => r.content.find((c) => c.text?.startsWith("<svg"))!.text!;
    expect(svgOf(await call("render_chart", { spec, format: "svg" }))).toContain("Pie chart. 2 items, total 4.");
    expect(svgOf(await call("render_chart", { spec, format: "svg", locale: "ko" }))).toContain("파이 차트. 2개 항목, 합계 4.");
  });
  it("render_chart: 틀린 스펙은 isError와 검증 결과", async () => {
    const r = await call("render_chart", { spec: { type: "pie" } });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[1].text!).errors[0].code).toBe("missing_data");
  });
  it("suggest_chart: csv, rows, 입력 없음", async () => {
    const a = firstJson((await call("suggest_chart", { csv: "from,to,value\n검색,상세,10\n상세,구매,4\n상세,이탈,6\n" })).content);
    expect(a.suggestions[0].type).toBe("sankey");
    const b = firstJson((await call("suggest_chart", { rows: [{ cat: "A", sub: "a1", v: 3 }, { cat: "A", sub: "a2", v: 2 }, { cat: "B", sub: "b1", v: 4 }] })).content);
    expect(b.suggestions[0].type).toBe("treemap");
    expect((await call("suggest_chart", {})).isError).toBe(true);
    // url은 http(s)만: 파일 경로를 주면 서버 컴퓨터의 파일을 읽지 않고 오류로 돌려줘요 (이 테스트 파일은 어디서나 있어요)
    const local = await call("suggest_chart", { url: fileURLToPath(import.meta.url) });
    expect(local.isError).toBe(true);
    expect(local.content[0].text).toContain("http:// or https://");
  });
  it("suggest_chart: locale ko면 이름, 이유, 스펙이 한국어 (ztd-charts suggest --locale ko와 같게)", async () => {
    const csv = "month,channel,revenue\n2025-01,검색,120\n2025-01,SNS,64\n2025-02,검색,128\n2025-02,SNS,75\n2025-03,검색,131\n2025-03,SNS,92\n2025-04,검색,140\n2025-04,SNS,104\n";
    const j = firstJson((await call("suggest_chart", { csv, limit: 1, locale: "ko" })).content);
    expect(j.suggestions[0]).toMatchObject({ type: "line", name: "라인 차트" });
    expect(j.suggestions[0].reason).toMatch(/[가-힣]/);
    expect(j.suggestions[0].spec.options.locale).toBe("ko-KR");
  });
  it("리소스: JSON Schema", async () => {
    const { resources } = await client.listResources();
    expect(resources[0].uri).toBe("ztd-charts://schema/chart-spec.json");
    const r = await client.readResource({ uri: resources[0].uri });
    expect(JSON.parse((r.contents[0] as { text: string }).text).oneOf).toHaveLength(44);
  });
});

describe("stdio 서버 (빌드 결과)", () => {
  const bin = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  it.skipIf(!existsSync(bin))("npx로 띄운 것처럼 stdio로 대화해요", async () => {
    const c = new Client({ name: "stdio-test", version: "0.0.0" });
    await c.connect(new StdioClientTransport({ command: "node", args: [bin], stderr: "ignore" }));
    const r = await c.callTool({ name: "list_charts", arguments: { level: "basic" } });
    expect(JSON.parse((r.content as Content[])[0].text!).count).toBe(11);
    await c.close();
  });
});
