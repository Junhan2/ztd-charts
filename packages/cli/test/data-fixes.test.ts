import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fetchUrl, loadRows, MAX_FETCH_BYTES, PNG_MAX_PIXELS, pngZoom, reactSnippet, render, svgToPng } from "../src/api";
import { isPrivateAddress } from "../src/guard";

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

/** A small server that counts requests: /ok.csv, /bad.json (not JSON), /big (over 20MB), 404 for the rest */
let server: Server;
let base = "";
let hits = 0;
beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    if (req.url === "/ok.csv") {
      res.writeHead(200, { "content-type": "text/csv" });
      res.end("month,revenue\n2025-01,120\n2025-02,135\n");
    } else if (req.url === "/bad.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{not json");
    } else if (req.url === "/big") {
      res.writeHead(200, { "content-type": "text/csv" });
      const chunk = Buffer.alloc(1024 * 1024, 49);
      let sent = 0;
      const push = () => {
        while (sent < 21 && res.write(chunk)) sent++;
        if (sent < 21) res.once("drain", push);
        else res.end();
      };
      res.on("error", () => {});
      push();
    } else {
      res.writeHead(404, "Not Found");
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => server?.close());

/** Reads the generated React code as TSX and returns the syntax errors and the actual value of each JSX attribute, keyed by name */
function parseSnippet(code: string) {
  const out = ts.transpileModule(code, { reportDiagnostics: true, fileName: "snippet.tsx", compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 } });
  const sf = ts.createSourceFile("snippet.tsx", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const attrs: Record<string, string> = {};
  const visit = (n: ts.Node) => {
    if (ts.isJsxAttribute(n) && n.initializer) {
      const init = n.initializer;
      const lit = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression) ? init.expression : null;
      if (lit) attrs[n.name.getText(sf)] = lit.text;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { errors: (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), attrs };
}

describe("reactSnippet: text with quotes and backslashes still compiles", () => {
  it('" \\ & and line breaks in the title do not break, and the values stay intact', () => {
    const card = { title: 'The "AI" share', takeaway: "50% \\ half", subtitle: "R&amp;D\nline 2", number: "01", level: "basic" };
    const code = reactSnippet({ type: "pie", data: [{ label: "a", value: 1 }], encoding: { label: "label", value: "value" }, options: { unit: '"', "bad key": 1 }, card } as never);
    const { errors, attrs } = parseSnippet(code);
    expect(errors).toEqual([]);
    expect(attrs).toMatchObject({ title: card.title, takeaway: card.takeaway, subtitle: card.subtitle, number: "01", level: "basic", unit: '"', label: "label" });
    expect(code).not.toContain("bad key");
    // Plain text stays a "…" attribute, as before
    expect(code).toContain('number="01"');
  });
});

describe("render: validation first, errors that name the address", () => {
  it("does not fetch data.url when the spec is invalid", async () => {
    hits = 0;
    await expect(render({ type: "line", data: { url: `${base}/ok.csv` }, encoding: { x: "month", y: "revenue" }, options: { curve: "wavy" } } as never)).rejects.toThrow(/options\.curve/);
    expect(hits).toBe(0);
    const ok = await render({ type: "line", data: { url: `${base}/ok.csv` }, encoding: { x: "month", y: "revenue" } } as never);
    expect(ok.svg).toContain("<svg");
    expect(hits).toBe(1);
  });
  it("validates again with the fetched rows (missing field)", async () => {
    await expect(render({ type: "line", data: { url: `${base}/ok.csv` }, encoding: { x: "month", y: "sales" } } as never)).rejects.toThrow(/encoding\.y: Field "sales"/);
  });
  it("HTTP errors, JSON errors and non-http(s) addresses all name the address", async () => {
    await expect(render({ type: "pie", data: { url: `${base}/missing.csv` } } as never)).rejects.toThrow(`Couldn't load data from ${base}/missing.csv: HTTP 404 Not Found`);
    await expect(render({ type: "pie", data: { url: `${base}/bad.json` } } as never)).rejects.toThrow(`${base}/bad.json`);
    await expect(render({ type: "pie", data: { url: "/local/data.csv" } } as never)).rejects.toThrow("Couldn't load data from /local/data.csv: only http:// and https:// addresses can be fetched");
    await expect(render({ type: "pie", data: { url: `${base}/missing.csv` } } as never, { locale: "ko" })).rejects.toThrow(`${base}/missing.csv에서 데이터를 가져오지 못했어요: HTTP 404`);
  });
  it("stops a response over 20MB without reading it to the end", async () => {
    expect(MAX_FETCH_BYTES).toBe(20 * 1024 * 1024);
    await expect(loadRows(`${base}/big`)).rejects.toThrow(`Couldn't load data from ${base}/big: the response is larger than 20 MB`);
  });
  it("past the time limit, says how many seconds it waited", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    try {
      await expect(fetchUrl("https://slow.example/a.csv")).rejects.toThrow("Couldn't load data from https://slow.example/a.csv: no response within 15 seconds");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("security: allowPrivate: false blocks private network addresses without a request (as the MCP server uses it)", () => {
  it("blocks plain IPs, localhost, the ::ffff: form and the numeric form, and no request reaches the server", async () => {
    const port = new URL(base).port;
    const before = hits;
    for (const url of [`${base}/ok.csv`, `http://localhost:${port}/ok.csv`, `http://[::ffff:127.0.0.1]:${port}/ok.csv`, `http://2130706433:${port}/ok.csv`]) {
      await expect(fetchUrl(url, undefined, { allowPrivate: false })).rejects.toThrow("private or local network");
    }
    await expect(loadRows(`${base}/ok.csv`, "ko", { allowPrivate: false })).rejects.toThrow("내부망이나 이 컴퓨터를 가리키는 주소라 막았어요");
    await expect(render({ type: "pie", data: { url: `${base}/ok.csv` } } as never, { allowPrivate: false })).rejects.toThrow("private or local network");
    expect(hits).toBe(before);
  });
  it("IPv6 forms that embed IPv4 (NAT64, 6to4, old compatible) are judged by the IPv4 inside", () => {
    // Forms that embed 127.0.0.1, 169.254.169.254 and 192.168.1.1, plus local-use NAT64 and the old site-local range
    for (const a of ["::ffff:7f00:1", "::7f00:1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "2002:c0a8:101::", "64:ff9b:1::1", "fec0::1"]) expect(isPrivateAddress(a), a).toBe(true);
    // Forms that embed 8.8.8.8 and public IPv6 are fetched as usual (IPv6-only networks reach IPv4 sites in the 64:ff9b:: form)
    for (const a of ["8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "2002:808:808::", "2606:4700:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
  });
  it("the default fetches as before", async () => {
    const before = hits;
    expect(await (await fetchUrl(`${base}/ok.csv`)).text()).toContain("2025-01,120");
    expect(hits).toBe(before + 1);
  });
});

describe("security: evil.json (reviewer repro)", () => {
  const evil = { type: "pie", data: [{ label: "a", value: 1 }], card: { title: "Sales", legend: [{ label: "L", color: 'x"/><script>alert(document.domain)</script><x y="' }] }, theme: { accent: "red}</style><script>alert(2)</script><style>" } };
  it("render makes no SVG or HTML and stops with a validation error", async () => {
    for (const format of ["svg", "html"] as const) await expect(render(evil as never, { format })).rejects.toThrow(/card\.legend\[0\]\.color[\s\S]*theme\.accent/);
  });
  it("CLI render also fails without making a file", async () => {
    if (!existsSync(CLI)) throw new Error("Build the CLI first with pnpm build");
    const dir = mkdtempSync(join(tmpdir(), "ztd-evil-"));
    writeFileSync(join(dir, "evil.json"), JSON.stringify(evil));
    for (const out of ["evil.svg", "evil.html"]) {
      const r = await exec("node", [CLI, "render", "evil.json", "--out", out], { cwd: dir }).then(
        (x) => ({ code: 0, out: x.stdout + x.stderr }),
        (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout + e.stderr }),
      );
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("theme.accent");
      expect(existsSync(join(dir, out))).toBe(false);
    }
  });
});

describe("svgToPng: pixel limit", () => {
  /** Swaps resvg for a fake that only records the SVG size and zoom it receives. No large bitmap is actually made */
  const capture = async (fn: () => Promise<unknown>) => {
    const seen: { w: number; h: number; zoom: number }[] = [];
    vi.doMock("@resvg/resvg-js", () => ({
      Resvg: class {
        constructor(svg: string, o: { fitTo: { value: number } }) {
          const tag = /<svg\b[^>]*>/.exec(svg)![0];
          seen.push({ w: Number(/ width="([\d.]+)"/.exec(tag)![1]), h: Number(/ height="([\d.]+)"/.exec(tag)![1]), zoom: o.fitTo.value });
        }
        render() {
          return { asPng: () => new Uint8Array([1]) };
        }
      },
    }));
    try {
      await fn();
    } finally {
      vi.doUnmock("@resvg/resvg-js");
    }
    return seen;
  };
  const pixels = (q: { w: number; h: number; zoom: number }) => q.w * q.h * q.zoom * q.zoom;

  it("the zoom is set from the outer <svg>'s real, unreduced size, so size × zoom² stays within PNG_MAX_PIXELS", async () => {
    expect(pngZoom('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="450">', 2)).toBe(2);
    expect(pngZoom('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1000">', 4)).toBe(4);
    // A document larger than the chart side limit (10,000) is still measured at its own size
    const seen = await capture(() => svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="240000"></svg>', { scale: 4 }));
    expect(seen).toHaveLength(1);
    expect(pixels(seen[0])).toBeLessThanOrEqual(PNG_MAX_PIXELS * 1.0001);
    // The inner <svg>'s size is not read as the outer size
    expect(pngZoom('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9000 9000"><svg width="10" height="10"/></svg>', 2)).toBeNull();
  });
  it("when the outer <svg> size cannot be read (missing, %, 0, negative), it errors without drawing", async () => {
    for (const svg of ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<svg width="100%" height="100%"></svg>', '<svg width="0" height="10"></svg>', '<svg width="-5" height="10"></svg>', "<g/>"]) {
      expect(pngZoom(svg, 2), svg).toBeNull();
      const seen = await capture(() => expect(svgToPng(svg, { scale: 2 })).rejects.toThrow("Couldn't read a width and height"));
      expect(seen, svg).toHaveLength(0);
    }
  });
  it("even the largest small multiples (24 panels one per row, panel height 10,000px) keep the PNG within the pixel limit", async () => {
    const data = Array.from({ length: 24 }, (_, g) => [1, 2, 3].map((x) => ({ g: `g${g}`, x, y: x * (g + 1) }))).flat();
    const spec = { type: "line", data, encoding: { x: "x", y: "y" }, options: { height: 10000 }, facet: { by: "g", columns: 1 }, card: { title: "Largest facet grid", note: "n ".repeat(400) } };
    const seen = await capture(() => render(spec as never, { format: "png", width: 10000, scale: 4 }));
    expect(seen).toHaveLength(1);
    expect(seen[0].h).toBeGreaterThan(240000);
    expect(seen[0].h).toBeLessThanOrEqual(250000);
    expect(pixels(seen[0])).toBeLessThanOrEqual(PNG_MAX_PIXELS * 1.0001);
  });
});
