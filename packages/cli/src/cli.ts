#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { capChartSize, COMMON_OPTIONS, findGroup, findLevel, formatIssues, GROUPS, LEVELS, localizeDef, variantSpec, variantsIn } from "ztd-charts/spec";
import { langOf } from "ztd-charts/server";
import { getChartInfo, getChartSchema, isHttpUrl, listCharts, loadRows, reactSnippet, render, resolveType, suggest, validate, type ChartSpec } from "./api";
import { CLI_TEXT, SCHEMA_URL, VERSION } from "./messages";

/** 지금 쓰는 문구. main에서 --locale로 정해요 */
let t = CLI_TEXT.en;

function fail(msg: string, code = 1): never {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function readSpec(file: string): ChartSpec {
  if (!file) fail(t.needSpec);
  if (!existsSync(file)) fail(t.noFile(file));
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ChartSpec;
  } catch (e) {
    fail(t.badJson((e as Error).message));
  }
}

type Flags = Record<string, unknown>;

/** 값을 받는 옵션(--out chart.png). 값 없이 쓰면 멈춰요 */
function textFlag(f: Flags, name: string): string | undefined {
  const v = f[name];
  if (v === undefined) return undefined;
  if (typeof v !== "string") fail(t.needValue(name));
  return v;
}

/** 숫자 옵션(--width 720). 0보다 큰 숫자가 아니면 멈춰요 (NaN 크기로 그리지 않게) */
function numberFlag(f: Flags, name: string): number | undefined {
  const v = textFlag(f, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(t.badNumber(name, v));
  return n;
}

/** --out 확장자별 형식. 여기 없는 확장자는 멈춰요 (x.jpg에 SVG를 쓰지 않게) */
const OUT_FORMATS: Record<string, "svg" | "png" | "html"> = { svg: "svg", png: "png", html: "html", htm: "html" };

/** --locale ko 또는 --locale=ko를 뽑아내고 나머지 인자를 돌려줘요. 명령 앞뒤 어디에 와도 돼요 */
function takeLocale(argv: string[]): { locale?: string; args: string[] } {
  const args: string[] = [];
  let locale: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--locale") locale = argv[++i];
    else if (a.startsWith("--locale=")) locale = a.slice("--locale=".length);
    else args.push(a);
  }
  // "ko_KR"도 받아요 (Intl은 "ko-KR"만 읽어요)
  return { locale: locale?.replace(/_/g, "-"), args };
}

/** info 표의 타입 칸: getChartInfo의 enum 글('"a" | "b"')을 칸에 맞게 줄여요('a|b'). enum이 아닌 타입은 그대로 */
const compactType = (type: string) => type.replace(/"/g, "").replace(/ \| /g, "|");

function pad(s: string, n: number): string {
  let w = 0;
  for (const ch of s) w += /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/.test(ch) ? 2 : 1;
  return s + " ".repeat(Math.max(1, n - w));
}

async function main(argv0: string[]) {
  const { locale, args: argv } = takeLocale(argv0);
  const lang = langOf(locale);
  t = CLI_TEXT[lang];
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(t.help);
    return;
  }
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const { values: f, positionals: pos } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: {
      json: { type: "boolean" },
      out: { type: "string", short: "o" },
      "out-dir": { type: "string" },
      width: { type: "string", short: "w" },
      height: { type: "string" },
      theme: { type: "string", short: "t" },
      scale: { type: "string" },
      "no-frame": { type: "boolean" },
      frame: { type: "boolean" },
      interactive: { type: "boolean" },
      font: { type: "string", multiple: true },
      type: { type: "string" },
      group: { type: "string" },
      level: { type: "string" },
      limit: { type: "string" },
      force: { type: "boolean" },
      variant: { type: "string" },
    },
  });
  const out = (s: string) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);
  /** --out이 있으면 파일로 저장하고, 없으면 화면에 찍어요 (schema, example) */
  const saveOrPrint = (text: string) => {
    const file = textFlag(f, "out");
    if (!file) return out(text);
    writeFileSync(file, `${text}\n`);
    return out(t.saved(file));
  };

  switch (cmd) {
    case "list": {
      const group = textFlag(f, "group");
      const level = textFlag(f, "level");
      // 모르는 값을 0종으로 조용히 넘기지 않고 쓸 수 있는 값을 알려줘요
      if (group && !findGroup(group)) fail(t.unknownFilter("group", group, GROUPS.map((g) => (lang === "ko" ? g.ko : g.id))));
      if (level && !findLevel(level)) fail(t.unknownFilter("level", level, LEVELS.map((l) => (lang === "ko" ? l.ko : l.id))));
      const list = listCharts({ group, level, locale });
      if (f.json) return out(JSON.stringify(list, null, 2));
      const [w0, w1, w2, w3] = t.listWidths;
      const [h0, h1, h2, h3, h4] = t.listHead;
      out(`${pad(h0, w0)}${pad(h1, w1)}${pad(h2, w2)}${pad(h3, w3)}${h4}`);
      for (const c of list) out(`${pad(c.type, w0)}${pad(c.name, w1)}${pad(findLevel(c.level)?.[lang] ?? c.level, w2)}${pad(findGroup(c.group)?.[lang] ?? c.group, w3)}${c.summary}`);
      out(t.listFoot(list.length));
      return;
    }
    case "info": {
      const type = pos[0] ?? fail(t.needType("info"));
      const info = getChartInfo(type, locale);
      if (f.json) return out(JSON.stringify(info, null, 2));
      out(`${info.name} (${info.type}, <${info.component}>) · ${findLevel(info.level)?.[lang] ?? info.level} · ${findGroup(info.group)?.[lang] ?? info.group}`);
      out(`${info.summary}\n${t.useWhen}: ${info.useWhen}\n${t.avoidWhen}: ${info.avoidWhen}\n`);
      out("encoding");
      for (const c of info.encoding) out(`  ${pad(c.name, 10)}${pad(c.required ? t.required : t.optional, t.flagWidth)}${pad(c.type, 18)}${c.description}`);
      out(`\n${t.ownOptions}`);
      // info.options는 차트 전용 옵션 뒤에 공통 옵션이 와요. 공통 옵션은 아래 한 줄에 이름만 적어요
      const common = COMMON_OPTIONS.map((o) => o.name);
      for (const o of info.options.filter((x) => !common.includes(x.name))) out(`  ${pad(o.name, 16)}${pad(compactType(o.type), 24)}${o.description}${o.default !== undefined ? t.defaultValue(JSON.stringify(o.default)) : ""}`);
      out(`\n${t.commonOptions}: ${common.join(", ")}`);
      if (info.variants.length) out(`\n${t.variants}: ${info.variants.map((x) => `${x.id} (${x.name})`).join(", ")}\n  ztd-charts example ${info.type} --variant ${info.variants[0].id}`);
      out(`\n${t.exampleSpec}: ztd-charts example ${info.type}\n\nReact\n${info.react}`);
      return;
    }
    case "schema": {
      return saveOrPrint(JSON.stringify(getChartSchema(pos[0], locale), null, 2));
    }
    case "example": {
      const type = pos[0] ?? fail(t.needType("example"));
      const def = resolveType(type) ?? fail(t.unknownChart(type));
      const local = localizeDef(def, lang);
      const id = textFlag(f, "variant");
      const ids = variantsIn(def.type, lang).map((x) => x.id);
      const spec = id ? (variantSpec(local, id) ?? fail(ids.length ? t.unknownFilter("variant", id, ids) : t.noVariants(def.type))) : local.example;
      return saveOrPrint(JSON.stringify({ $schema: SCHEMA_URL, ...spec }, null, 2));
    }
    case "validate": {
      const spec = readSpec(pos[0]);
      const r = validate(spec, locale);
      if (f.json) out(JSON.stringify(r, null, 2));
      else {
        if (r.valid) out(t.valid(pos[0], spec.type, r.warnings.length));
        const text = formatIssues(r);
        if (text) out(text);
      }
      process.exitCode = r.valid ? 0 : 1;
      return;
    }
    case "render": {
      const spec = readSpec(pos[0]);
      const target = textFlag(f, "out") ?? `${basename(pos[0], extname(pos[0]))}.svg`;
      const format = OUT_FORMATS[extname(target).slice(1).toLowerCase()] ?? fail(t.badOut(target));
      const theme = textFlag(f, "theme");
      if (theme !== undefined && theme !== "dark" && theme !== "light") fail(t.badTheme(theme));
      const scale = numberFlag(f, "scale");
      const res = await render(spec, {
        format,
        // 한 변은 MAX_CHART_SIZE(10,000px)까지. 넘으면 줄여서 그려요
        width: capChartSize(numberFlag(f, "width")),
        height: capChartSize(numberFlag(f, "height")),
        theme,
        scale,
        frame: f["no-frame"] ? false : f.frame ? true : undefined,
        interactive: !!f.interactive,
        fonts: (f.font as string[] | undefined) ?? [],
        locale,
      });
      mkdirSync(dirname(resolve(target)), { recursive: true });
      if (format === "png") writeFileSync(target, res.png!);
      else writeFileSync(target, format === "html" ? res.html! : res.svg!);
      out(t.saved(`${target}${res.width ? ` (${res.width}×${res.height}${format === "png" ? ` @${scale ?? 2}x` : ""})` : ""}`));
      for (const n of res.notes ?? []) out(`! ${n}`);
      return;
    }
    case "init": {
      const dir = resolve(pos[0] ?? ".");
      const type = textFlag(f, "type") ?? "bar";
      const def = resolveType(type) ?? fail(t.unknownChart(type));
      const example = localizeDef(def, lang).example;
      mkdirSync(join(dir, "charts"), { recursive: true });
      const files: Record<string, string> = {
        [`charts/${def.type}.spec.json`]: `${JSON.stringify({ $schema: SCHEMA_URL, ...example, data: Array.isArray(example.data) ? example.data.slice(0, 40) : example.data }, null, 2)}\n`,
        ...t.init(def.type),
      };
      for (const [rel, body] of Object.entries(files)) {
        const p = join(dir, rel);
        if (existsSync(p) && !f.force) {
          out(t.skipped(rel));
          continue;
        }
        writeFileSync(p, body);
        out(t.created(rel));
      }
      out(`\n${t.next}`);
      return;
    }
    case "suggest": {
      const src = pos[0] ?? fail(t.needData);
      // 주소도, 붙여 넣은 CSV나 JSON도 아니면 파일 경로예요. 없는 파일을 빈 데이터로 읽지 않게 먼저 막아요
      const isInline = src.includes("\n") || /^\s*[[{]/.test(src);
      if (!isHttpUrl(src) && !isInline && !existsSync(src)) fail(t.noFile(src));
      const limit = numberFlag(f, "limit") ?? 5;
      const outDir = textFlag(f, "out-dir");
      const rows = await loadRows(src, locale);
      const { profile, suggestions } = suggest(rows, { limit, locale });
      if (f.json) out(JSON.stringify({ profile, suggestions }, null, 2));
      else {
        out(t.data(profile.rows, profile.columns.map(t.column).join(", ")));
        if (!suggestions.length) out(t.noFit);
        suggestions.forEach((s, i) => out(`${i + 1}. ${s.name} (${s.type})  ${t.score} ${s.score}\n   ${s.reason}\n   encoding ${JSON.stringify(s.spec.encoding)}${s.spec.options ? ` options ${JSON.stringify(s.spec.options)}` : ""}`));
      }
      if (outDir) {
        mkdirSync(outDir, { recursive: true });
        suggestions.forEach((s, i) => {
          const p = join(outDir, `${String(i + 1).padStart(2, "0")}-${s.type}.json`);
          writeFileSync(p, `${JSON.stringify({ $schema: SCHEMA_URL, ...s.spec }, null, 2)}\n`);
          if (!f.json) out(t.saved(p));
        });
      }
      return;
    }
    case "snippet": {
      const spec = readSpec(pos[0]);
      return out(reactSnippet(spec, { locale }));
    }
    default:
      fail(`${t.unknownCommand(cmd)}\n\n${t.help}`);
  }
}

process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
});
main(process.argv.slice(2)).catch((e: unknown) => fail(t.error(e instanceof Error ? e.message : String(e))));
