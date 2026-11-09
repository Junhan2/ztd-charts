import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server";

type Content = { type: string; text?: string };
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

describe("MCP: 큰 SVG와 PNG 이모지", () => {
  it("1 MB가 넘는 SVG는 글로 돌려주지 않고 PNG와 안내 한 줄로 대신해요", async () => {
    const data = Array.from({ length: 12000 }, (_, i) => ({ x: (i * 7919) % 1000, y: (i * 104729) % 997 }));
    const r = await call("render_chart", { spec: { type: "scatter", data, encoding: { x: "x", y: "y" } }, format: "svg" });
    expect(r.isError).toBe(false);
    expect(r.content.some((c) => c.type === "image")).toBe(true);
    expect(r.content.some((c) => c.type === "text" && (c.text ?? "").startsWith("<svg"))).toBe(false);
    expect(r.content.find((c) => /too large to return as text/.test(c.text ?? ""))?.text).toMatch(/^The SVG is \d+\.\d MB/);
    const small = await call("render_chart", { spec: { type: "scatter", data: data.slice(0, 50), encoding: { x: "x", y: "y" } }, format: "svg" });
    expect(small.content.some((c) => c.type === "text" && (c.text ?? "").startsWith("<svg"))).toBe(true);
  });
  it("PNG에서 뺀 이모지를 경고에 같이 알려요", async () => {
    const r = await call("render_chart", { spec: { type: "bar", data: [{ k: "🍎 사과", v: 4 }, { k: "배", v: 5 }], encoding: { x: "k", y: "v" } }, locale: "ko" });
    expect(r.content.find((c) => /^Size /.test(c.text ?? ""))?.text).toContain("이모지 1개를 뺐어요");
  });
});

describe("MCP: 스펙의 테마, 범례 색, 로캘", () => {
  it("render_chart는 evil.json을 그리지 않고 검증 결과(bad_theme_value, bad_legend_color)를 돌려줘요", async () => {
    const evil = { type: "pie", data: [{ label: "a", value: 1 }], card: { title: "Sales", legend: [{ label: "L", color: 'x"/><script>alert(document.domain)</script><x y="' }] }, theme: { accent: "red}</style><script>alert(2)</script><style>" } };
    const r = await call("render_chart", { spec: evil, format: "svg" });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[1].text!).errors.map((e: { code: string }) => e.code)).toEqual(["bad_legend_color", "bad_theme_value"]);
    expect(r.content.some((c) => c.type === "text" && /<svg/.test(c.text ?? ""))).toBe(false);
  });
  it('validate_spec는 "ko_KR"을 받고 "" 로캘은 bad_locale', async () => {
    const spec = (locale: string) => ({ type: "bar", data: [{ x: "a", y: 1 }], encoding: { x: "x", y: "y" }, options: { locale } });
    expect(JSON.parse((await call("validate_spec", { spec: spec("ko_KR") })).content[0].text!).valid).toBe(true);
    expect(JSON.parse((await call("validate_spec", { spec: spec("") })).content[0].text!).errors[0].code).toBe("bad_locale");
    const r = await call("render_chart", { spec: spec("ko_KR"), format: "svg" });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain("막대 차트");
  });
});

describe("MCP: 데이터 주소가 내부망이면 막아요", () => {
  it("suggest_chart와 render_chart는 기본으로 127.0.0.1을 요청 없이 막고, ZTD_CHARTS_ALLOW_PRIVATE_URLS=1이면 가져와요", async () => {
    let hits = 0;
    const http = createHttpServer((_req, res) => {
      hits++;
      res.writeHead(200, { "content-type": "text/csv" });
      res.end("month,revenue\n2025-01,120\n2025-02,135\n");
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/data.csv`;
    try {
      const s = await call("suggest_chart", { url });
      expect(s.isError).toBe(true);
      expect(s.content[0].text).toContain("private or local network");
      const r = await call("render_chart", { spec: { type: "line", data: { url }, encoding: { x: "month", y: "revenue" } }, format: "svg" });
      expect(r.isError).toBe(true);
      expect(hits).toBe(0);
      process.env.ZTD_CHARTS_ALLOW_PRIVATE_URLS = "1";
      const server = createServer();
      const [a, b] = InMemoryTransport.createLinkedPair();
      const open = new Client({ name: "test", version: "0.0.0" });
      await Promise.all([server.connect(b), open.connect(a)]);
      const ok = await open.callTool({ name: "suggest_chart", arguments: { url } });
      expect(ok.isError).toBeFalsy();
      expect(hits).toBe(1);
      await open.close();
    } finally {
      delete process.env.ZTD_CHARTS_ALLOW_PRIVATE_URLS;
      http.close();
    }
  });
});
