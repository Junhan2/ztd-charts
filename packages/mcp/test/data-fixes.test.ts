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

describe("MCP: large SVG and PNG emoji", () => {
  it("an SVG over 1 MB is not returned as text but replaced by a PNG and a one-line note", async () => {
    const data = Array.from({ length: 12000 }, (_, i) => ({ x: (i * 7919) % 1000, y: (i * 104729) % 997 }));
    const r = await call("render_chart", { spec: { type: "scatter", data, encoding: { x: "x", y: "y" } }, format: "svg" });
    expect(r.isError).toBe(false);
    expect(r.content.some((c) => c.type === "image")).toBe(true);
    expect(r.content.some((c) => c.type === "text" && (c.text ?? "").startsWith("<svg"))).toBe(false);
    expect(r.content.find((c) => /too large to return as text/.test(c.text ?? ""))?.text).toMatch(/^The SVG is \d+\.\d MB/);
    const small = await call("render_chart", { spec: { type: "scatter", data: data.slice(0, 50), encoding: { x: "x", y: "y" } }, format: "svg" });
    expect(small.content.some((c) => c.type === "text" && (c.text ?? "").startsWith("<svg"))).toBe(true);
  });
  it("reports the emoji removed from the PNG in the warning", async () => {
    const r = await call("render_chart", { spec: { type: "bar", data: [{ k: "🍎 사과", v: 4 }, { k: "배", v: 5 }], encoding: { x: "k", y: "v" } }, locale: "ko" });
    expect(r.content.find((c) => /^Size /.test(c.text ?? ""))?.text).toContain("이모지 1개를 뺐어요");
  });
});

describe("MCP: spec theme, legend colors, locale", () => {
  it("render_chart does not draw evil.json and returns the validation result (bad_theme_value, bad_legend_color)", async () => {
    const evil = { type: "pie", data: [{ label: "a", value: 1 }], card: { title: "Sales", legend: [{ label: "L", color: 'x"/><script>alert(document.domain)</script><x y="' }] }, theme: { accent: "red}</style><script>alert(2)</script><style>" } };
    const r = await call("render_chart", { spec: evil, format: "svg" });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[1].text!).errors.map((e: { code: string }) => e.code)).toEqual(["bad_legend_color", "bad_theme_value"]);
    expect(r.content.some((c) => c.type === "text" && /<svg/.test(c.text ?? ""))).toBe(false);
  });
  it('validate_spec accepts "ko_KR" and rejects an "" locale with bad_locale', async () => {
    const spec = (locale: string) => ({ type: "bar", data: [{ x: "a", y: 1 }], encoding: { x: "x", y: "y" }, options: { locale } });
    expect(JSON.parse((await call("validate_spec", { spec: spec("ko_KR") })).content[0].text!).valid).toBe(true);
    expect(JSON.parse((await call("validate_spec", { spec: spec("") })).content[0].text!).errors[0].code).toBe("bad_locale");
    const r = await call("render_chart", { spec: spec("ko_KR"), format: "svg" });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain("막대 차트");
  });
});

describe("MCP: blocks data addresses on a private network", () => {
  it("suggest_chart and render_chart block 127.0.0.1 without a request by default, and fetch it with ZTD_CHARTS_ALLOW_PRIVATE_URLS=1", async () => {
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

describe("MCP: chart size limit", () => {
  it("render_chart does not draw a huge height from the spec and returns the validation result (out_of_range)", async () => {
    const r = await call("render_chart", { spec: { type: "bar", data: [{ x: "a", y: 1 }], encoding: { x: "x", y: "y" }, options: { height: 1e9 } }, format: "svg" });
    expect(r.isError).toBe(true);
    expect(r.content.map((c) => c.text ?? "").join("\n")).toContain("out_of_range");
  });
});
