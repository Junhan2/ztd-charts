import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getChartInfo, getChartSchema, isHttpUrl, listCharts, loadRows, reactSnippet, render, specSnippet, suggest, validate, type ChartSpec } from "ztd-charts-cli";
import { GROUPS, LEVELS, parseCSV, normalizeData, specLocale, type ChartGroup, type ChartLevel } from "ztd-charts/spec";

export const SERVER_NAME = "ztd-charts";
export const SERVER_VERSION = "0.2.1";

const GROUP_IDS = GROUPS.map((g) => g.id) as [ChartGroup, ...ChartGroup[]];
const LEVEL_IDS = LEVELS.map((l) => l.id) as [ChartLevel, ...ChartLevel[]];

const text = (t: string) => ({ type: "text" as const, text: t });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

/** 데이터가 큰 스펙은 앞부분만 보여줘요 (응답 크기 관리) */
function trimSpec(spec: ChartSpec, rows = 20): ChartSpec {
  if (!Array.isArray(spec.data) || spec.data.length <= rows) return spec;
  return { ...spec, data: spec.data.slice(0, rows) };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {}, resources: {} }, instructions: 'ztd-charts: 33 animated React chart types driven by a JSON spec { type, data, encoding, options, card }. Typical flow: suggest_chart (or list_charts) -> get_chart_schema -> write a spec -> validate_spec -> render_chart to preview -> use the returned React snippet. Built-in chart text (tooltips, screen reader text, badges) and number formats are English by default. For Korean, pass locale "ko" to render_chart or set options.locale in the spec, and write card text in Korean. validate_spec and suggest_chart take locale too.' });

  server.registerTool(
    "list_charts",
    {
      title: "List chart types",
      description: "List the 33 chart types with name, level (basic, intermediate, advanced), group, one-line summary, when to use or avoid, and encoding channels. Filter by group or level.",
      inputSchema: { group: z.enum(GROUP_IDS).optional().describe("Chart group"), level: z.enum(LEVEL_IDS).optional().describe("Difficulty level") },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ group, level }) => {
      const list = listCharts({ group, level });
      return { content: [json({ count: list.length, charts: list })] };
    },
  );

  server.registerTool(
    "get_chart_schema",
    {
      title: "Get chart schema",
      description: "Get the JSON Schema for one chart type (encoding channels, options with types/defaults), plus a complete example spec and a React snippet. Omit type for the full schema of all 33 charts (about 200 KB, so prefer asking for one type).",
      inputSchema: { type: z.string().optional().describe('Chart type, e.g. "pie", "line", "sankey". Aliases like "scatter", "violin" work.') },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ type }) => {
      if (!type) return { content: [json(getChartSchema())] };
      try {
        const info = getChartInfo(type);
        return { content: [json({ type: info.type, name: info.name, summary: info.summary, useWhen: info.useWhen, avoidWhen: info.avoidWhen, encoding: info.encoding, options: info.options, example: trimSpec(info.example), schema: info.schema }), text(info.react)] };
      } catch (e) {
        return { isError: true, content: [text((e as Error).message)] };
      }
    },
  );

  server.registerTool(
    "validate_spec",
    {
      title: "Validate chart spec",
      description: "Validate a chart spec against the registry and its inline data: unknown type (with did-you-mean), missing/unknown encoding channels, fields missing from data, non-numeric value fields, option types and enums. Returns { valid, errors[], warnings[] } with JSON paths and messages. Set locale for the language of the messages.",
      inputSchema: {
        spec: z.record(z.string(), z.unknown()).describe("{ type, data, encoding, options?, card?, theme? }"),
        locale: z.string().optional().describe('Locale for the error and warning messages. Default "en-US", or the spec\'s options.locale when set. "ko" or "ko-KR" gives Korean messages'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ spec, locale }) => {
      // render_chart와 같은 로캘(locale, 그다음 스펙 options.locale)로 검사해요. 둘 다 없으면 영어
      const r = validate(spec, specLocale(spec as unknown as ChartSpec, locale));
      return { content: [json(r)] };
    },
  );

  server.registerTool(
    "render_chart",
    {
      title: "Render chart",
      description: "Server-render a chart spec to PNG (returned as an image) and/or SVG text, with the card frame (number, title, legend, takeaway, level badge) when spec.card is set. Also returns ready-to-paste React code. data may be inline rows, { csv }, or { url } (fetched). Set locale for the language of built-in chart text and number formats.",
      inputSchema: {
        spec: z.record(z.string(), z.unknown()).describe("Chart spec"),
        format: z.enum(["png", "svg", "both"]).optional().describe("Default png"),
        width: z.number().int().min(200).max(2400).optional().describe("Pixel width, default 720"),
        theme: z.enum(["dark", "light"]).optional().describe("Default dark"),
        scale: z.number().min(1).max(4).optional().describe("PNG pixel ratio, default 2"),
        locale: z.string().optional().describe('Locale for built-in chart text and number formats. Default "en-US" (1.2K). "ko" or "ko-KR" gives Korean text and 1.2만 style numbers'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ spec, format = "png", width, theme, scale, locale }) => {
      const s = spec as unknown as ChartSpec;
      // 그릴 때와 같은 로캘(locale, 그다음 스펙 options.locale)로 검사해요
      const v = validate(s, specLocale(s, locale));
      if (!v.valid) return { isError: true, content: [text("Invalid spec. Fix the errors below (the same result validate_spec returns)."), json(v)] };
      try {
        const res = await render(s, { format: format === "svg" ? "svg" : "png", width, theme, scale, locale });
        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
        if (format !== "svg" && res.png) content.push({ type: "image", data: res.png.toString("base64"), mimeType: "image/png" });
        if ((format === "svg" || format === "both") && res.svg) content.push(text(res.svg));
        content.push(text(`Size ${res.width}×${res.height}px${v.warnings.length ? `\nWarnings: ${v.warnings.map((w) => w.message).join(" / ")}` : ""}`));
        content.push(text(`// React (components)\n${reactSnippet(s)}\n// React (spec as is)\n${specSnippet(s)}`));
        return { content };
      } catch (e) {
        return { isError: true, content: [text(`Render failed: ${(e as Error).message}`)] };
      }
    },
  );

  server.registerTool(
    "suggest_chart",
    {
      title: "Suggest charts for data",
      description: "Profile tabular data (column kinds, cardinality, hierarchy, source/target pairs, dates) and recommend chart types ranked by fit, each with a reason and a ready spec. Pass csv text, rows (array of objects), or a url to CSV/JSON (Google Sheets CSV export, REST). Set locale for the language of the reasons and the suggested specs.",
      inputSchema: {
        csv: z.string().optional().describe("CSV text with header row"),
        rows: z.array(z.record(z.string(), z.unknown())).optional().describe("Array of row objects"),
        url: z.string().optional().describe("http(s) URL returning CSV or JSON"),
        limit: z.number().int().min(1).max(10).optional().describe("Default 5"),
        locale: z.string().optional().describe('Locale for chart names, reasons and card text in the suggestions. Default "en-US". "ko" or "ko-KR" gives Korean text and sets options.locale "ko-KR" in each spec'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ csv, rows, url, limit, locale }) => {
      let data: Record<string, unknown>[];
      try {
        if (rows) data = normalizeData(rows);
        else if (csv) data = parseCSV(csv);
        else if (url) {
          // http(s)만 받아요. loadRows는 파일 경로도 읽어서, 그대로 두면 서버가 도는 컴퓨터의 파일을 돌려줄 수 있어요
          if (!isHttpUrl(url)) return { isError: true, content: [text("url must start with http:// or https://. For a local file, pass its text as csv or its rows as rows.")] };
          data = await loadRows(url, locale);
        } else return { isError: true, content: [text("Pass one of csv, rows or url.")] };
      } catch (e) {
        return { isError: true, content: [text(`Couldn't read the data: ${(e as Error).message}`)] };
      }
      const { profile, suggestions } = suggest(data, { limit: limit ?? 5, locale });
      return {
        content: [
          json({
            profile,
            suggestions: suggestions.map((s) => ({ type: s.type, name: s.name, score: s.score, reason: s.reason, spec: trimSpec(s.spec, 8), note: s.spec.data && Array.isArray(s.spec.data) && s.spec.data.length > 8 ? `spec.data shows only the first 8 rows. Put all ${s.spec.data.length} rows in the real spec.` : undefined })),
          }),
        ],
      };
    },
  );

  server.registerResource(
    "chart-spec-schema",
    "ztd-charts://schema/chart-spec.json",
    { title: "ztd charts spec JSON Schema", description: "JSON Schema (draft 2020-12) for all chart specs", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(getChartSchema(), null, 2) }] }),
  );

  return server;
}
