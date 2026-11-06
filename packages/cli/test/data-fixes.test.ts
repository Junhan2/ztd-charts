import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fetchUrl, loadRows, MAX_FETCH_BYTES, reactSnippet, render } from "../src/api";
import { isPrivateAddress } from "../src/guard";

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

/** 요청 수를 세는 작은 서버: /ok.csv, /bad.json(JSON이 아님), /big(20MB 넘게), 나머지 404 */
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

/** 만든 React 코드를 TSX로 읽어 문법 오류와, 이름이 name인 JSX 속성의 실제 값을 돌려줘요 */
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

describe("reactSnippet: 따옴표, 역슬래시가 든 글도 컴파일돼요", () => {
  it('제목의 " \\ & 줄바꿈이 깨지지 않고 값도 그대로예요', () => {
    const card = { title: 'The "AI" share', takeaway: "50% \\ half", subtitle: "R&amp;D\nline 2", number: "01", level: "basic" };
    const code = reactSnippet({ type: "pie", data: [{ label: "a", value: 1 }], encoding: { label: "label", value: "value" }, options: { unit: '"', "bad key": 1 }, card } as never);
    const { errors, attrs } = parseSnippet(code);
    expect(errors).toEqual([]);
    expect(attrs).toMatchObject({ title: card.title, takeaway: card.takeaway, subtitle: card.subtitle, number: "01", level: "basic", unit: '"', label: "label" });
    expect(code).not.toContain("bad key");
    // 평범한 글은 예전처럼 "…" 속성 그대로
    expect(code).toContain('number="01"');
  });
});

describe("render: 검사 먼저, 주소가 든 오류", () => {
  it("틀린 스펙이면 data.url을 가져오지 않아요", async () => {
    hits = 0;
    await expect(render({ type: "line", data: { url: `${base}/ok.csv` }, encoding: { x: "month", y: "revenue" }, options: { curve: "wavy" } } as never)).rejects.toThrow(/options\.curve/);
    expect(hits).toBe(0);
    const ok = await render({ type: "line", data: { url: `${base}/ok.csv` }, encoding: { x: "month", y: "revenue" } } as never);
    expect(ok.svg).toContain("<svg");
    expect(hits).toBe(1);
  });
  it("가져온 행으로 다시 검사해요 (없는 필드)", async () => {
    await expect(render({ type: "line", data: { url: `${base}/ok.csv` }, encoding: { x: "month", y: "sales" } } as never)).rejects.toThrow(/encoding\.y: Field "sales"/);
  });
  it("HTTP 오류, JSON 오류, http(s)가 아닌 주소 모두 주소를 알려 줘요", async () => {
    await expect(render({ type: "pie", data: { url: `${base}/missing.csv` } } as never)).rejects.toThrow(`Couldn't load data from ${base}/missing.csv: HTTP 404 Not Found`);
    await expect(render({ type: "pie", data: { url: `${base}/bad.json` } } as never)).rejects.toThrow(`${base}/bad.json`);
    await expect(render({ type: "pie", data: { url: "/local/data.csv" } } as never)).rejects.toThrow("Couldn't load data from /local/data.csv: only http:// and https:// addresses can be fetched");
    await expect(render({ type: "pie", data: { url: `${base}/missing.csv` } } as never, { locale: "ko" })).rejects.toThrow(`${base}/missing.csv에서 데이터를 가져오지 못했어요: HTTP 404`);
  });
  it("20MB가 넘는 응답은 끝까지 받지 않고 멈춰요", async () => {
    expect(MAX_FETCH_BYTES).toBe(20 * 1024 * 1024);
    await expect(loadRows(`${base}/big`)).rejects.toThrow(`Couldn't load data from ${base}/big: the response is larger than 20 MB`);
  });
  it("시간 한도를 넘으면 몇 초를 기다렸는지 알려 줘요", async () => {
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

describe("보안: allowPrivate: false는 내부망 주소를 요청 없이 막아요 (MCP 서버가 이렇게 써요)", () => {
  it("IP 그대로, localhost, ::ffff: 꼴, 숫자 꼴 모두 막고 서버에는 요청이 가지 않아요", async () => {
    const port = new URL(base).port;
    const before = hits;
    for (const url of [`${base}/ok.csv`, `http://localhost:${port}/ok.csv`, `http://[::ffff:127.0.0.1]:${port}/ok.csv`, `http://2130706433:${port}/ok.csv`]) {
      await expect(fetchUrl(url, undefined, { allowPrivate: false })).rejects.toThrow("private or local network");
    }
    await expect(loadRows(`${base}/ok.csv`, "ko", { allowPrivate: false })).rejects.toThrow("내부망이나 이 컴퓨터를 가리키는 주소라 막았어요");
    await expect(render({ type: "pie", data: { url: `${base}/ok.csv` } } as never, { allowPrivate: false })).rejects.toThrow("private or local network");
    expect(hits).toBe(before);
  });
  it("IPv4를 품는 IPv6 꼴(NAT64, 6to4, 옛 호환)은 안의 IPv4로 판단해요", () => {
    // 127.0.0.1, 169.254.169.254, 192.168.1.1 을 품은 꼴과 지역용 NAT64, 옛 사이트 로컬
    for (const a of ["::ffff:7f00:1", "::7f00:1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "2002:c0a8:101::", "64:ff9b:1::1", "fec0::1"]) expect(isPrivateAddress(a), a).toBe(true);
    // 8.8.8.8 을 품은 꼴과 공용 IPv6는 그대로 가져와요 (IPv6 전용 망은 IPv4 사이트를 64:ff9b:: 꼴로 받아요)
    for (const a of ["8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "2002:808:808::", "2606:4700:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
  });
  it("기본값은 지금처럼 가져와요", async () => {
    const before = hits;
    expect(await (await fetchUrl(`${base}/ok.csv`)).text()).toContain("2025-01,120");
    expect(hits).toBe(before + 1);
  });
});

describe("보안: evil.json (리뷰어 재현)", () => {
  const evil = { type: "pie", data: [{ label: "a", value: 1 }], card: { title: "Sales", legend: [{ label: "L", color: 'x"/><script>alert(document.domain)</script><x y="' }] }, theme: { accent: "red}</style><script>alert(2)</script><style>" } };
  it("render는 SVG, HTML을 만들지 않고 검증 오류로 멈춰요", async () => {
    for (const format of ["svg", "html"] as const) await expect(render(evil as never, { format })).rejects.toThrow(/card\.legend\[0\]\.color[\s\S]*theme\.accent/);
  });
  it("CLI render도 파일을 만들지 않고 실패해요", async () => {
    if (!existsSync(CLI)) throw new Error("먼저 pnpm build로 CLI를 빌드하세요");
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
