import { createRequire } from "node:module";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { CHARTS, chartsIn, COMMON_OPTIONS, commonOptionsIn, findGroup, findLevel, GROUPS, LEVELS, localizeDef, schemaFor, schemaForIn, specSchema, specSchemaIn, suggestCharts, validateSpec, VARIANTS, variantsIn, variantSpec, type ChartSpec } from "../src/spec";
import { VARIANT_NAMES_KO } from "../src/spec/locales/variants-ko";
import { CHANNELS, META, resolveMeta } from "../src/spec/meta";
import * as samples from "../src/spec/samples";

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateAll = ajv.compile(specSchema());
const HANGUL = /[가-힣]/;
const KO = chartsIn("ko");
/** options.locale을 뺀 스펙. 한글 예시와 추천을 locale이 없던 예전 값과 비교할 때 써요 */
const noLocale = ({ options: { locale: _locale, ...options } = {}, ...spec }: ChartSpec) => ({ ...spec, options });

describe("레지스트리", () => {
  it("37종, 타입과 컴포넌트 이름이 겹치지 않아요", () => {
    expect(CHARTS).toHaveLength(37);
    expect(new Set(CHARTS.map((c) => c.type)).size).toBe(37);
    expect(new Set(CHARTS.map((c) => c.component)).size).toBe(37);
  });
  it("차트별 스키마 파일을 패키지 이름으로 불러와요 (README에 적은 경로)", () => {
    const req = createRequire(import.meta.url);
    expect(() => req.resolve("ztd-charts/schema.json")).not.toThrow();
    for (const c of CHARTS) expect(() => req.resolve(`ztd-charts/schema/charts/${c.type}.schema.json`), c.type).not.toThrow();
  });
  it("가벼운 META/CHANNELS가 레지스트리와 같아요 (한글 이름은 META 한 곳)", () => {
    for (const c of CHARTS) {
      expect(META[c.type]).toEqual({ component: c.component, name: c.name, nameKo: localizeDef(c, "ko").name });
      expect((CHANNELS as Record<string, unknown>)[c.type]).toBe(c.encoding);
    }
    expect(resolveMeta("doughnut")?.type).toBe("donut");
    expect(resolveMeta("PieChart")).toMatchObject({ type: "pie", name: "Pie chart", nameKo: "파이 차트" });
  });
  it("기본 글은 영어예요: 이름, 설명, 채널, 옵션, 예시 카드와 데이터", () => {
    for (const c of CHARTS) {
      expect(c.name, c.type).toBe(c.nameEn);
      const { options, ...rest } = c;
      expect(JSON.stringify(rest), c.type).not.toMatch(HANGUL);
      // 펀넬 rateLabel 설명만 한국어 로캘의 기본값("전 단계 대비")을 그대로 적어요
      for (const o of options) if (!(c.type === "funnel" && o.name === "rateLabel")) expect(o.description, `${c.type}.${o.name}`).not.toMatch(HANGUL);
      expect(LEVELS.map((l) => l.id), c.type).toContain(c.example.card?.level);
    }
    for (const o of COMMON_OPTIONS) expect(o.description, o.name).not.toMatch(HANGUL);
  });
  it("모든 예시가 검증을 통과해요 (영어, 한글)", () => {
    for (const c of [...CHARTS, ...KO]) {
      const r = validateSpec(c.example);
      expect(r.errors, c.type).toEqual([]);
    }
  });
  it("모든 예시가 공개 JSON Schema(ajv 2020)도 통과해요 (영어, 한글)", () => {
    CHARTS.forEach((c, i) => {
      const one = ajv.compile(schemaFor(c.type)!);
      for (const example of [c.example, KO[i].example]) {
        const ok = validateAll(example);
        expect(ok, `${c.type}: ${JSON.stringify(validateAll.errors?.slice(0, 3))}`).toBe(true);
        expect(one(example), c.type).toBe(true);
      }
    });
  });
  it("스키마는 틀린 스펙을 거부해요", () => {
    expect(validateAll({ type: "pie" })).toBe(false);
    expect(validateAll({ type: "nope", data: [] })).toBe(false);
    expect(validateAll({ type: "bar", data: [], options: { layout: "diagonal" } })).toBe(false);
    expect(validateAll({ type: "pie", data: [], options: { typo: 1 } })).toBe(false);
    expect(validateAll({ type: "pie", data: { url: "/a.csv", format: "xml" } })).toBe(false);
  });
});

describe("한글 레지스트리 (localizeDef, chartsIn)", () => {
  it("모든 차트의 한글 글이 빠짐없어요: 이름, 설명, 채널, 옵션, 예시", () => {
    expect(KO).toHaveLength(CHARTS.length);
    KO.forEach((k, i) => {
      const en = CHARTS[i];
      expect(k.type).toBe(en.type);
      for (const f of ["name", "summary", "useWhen", "avoidWhen", "why"] as const) expect(k[f], `${k.type}.${f}`).toMatch(HANGUL);
      for (const c of k.encoding) expect(c.description, `${k.type}.encoding.${c.name}`).toMatch(HANGUL);
      for (const o of k.options) expect(o.description, `${k.type}.options.${o.name}`).toMatch(HANGUL);
      expect(k.example.card?.title, k.type).toBe(k.name);
      expect(JSON.stringify(k.example.card), k.type).toMatch(HANGUL);
      // 언어와 상관없는 값은 그대로예요
      expect({ ...k, name: en.name, summary: en.summary, useWhen: en.useWhen, avoidWhen: en.avoidWhen, why: en.why, encoding: en.encoding, options: en.options, example: en.example }).toEqual(en);
      expect(k.encoding.map((c) => ({ ...c, description: "" }))).toEqual(en.encoding.map((c) => ({ ...c, description: "" })));
      expect(k.options.map((o) => ({ ...o, description: "" }))).toEqual(en.options.map((o) => ({ ...o, description: "" })));
    });
    for (const o of commonOptionsIn("ko")) expect(o.description, o.name).toMatch(HANGUL);
  });
  it('localizeDef(def, "ko")는 예전 한글 이름과 예시를 돌려줘요. 예시의 options.locale은 "ko-KR"이에요', () => {
    const pie = localizeDef(CHARTS[0], "ko");
    expect(pie.name).toBe("파이 차트");
    expect(pie.nameEn).toBe("Pie chart");
    for (const k of KO) expect(k.example.options?.locale, k.type).toBe("ko-KR");
    expect(noLocale(pie.example)).toEqual({ type: "pie", data: samples.pieSampleKo, encoding: { label: "device", value: "sales" }, options: { highlight: "모바일" }, card: { number: "01", title: "파이 차트", subtitle: "기기별 매출 비중", takeaway: "2~4개 항목만", level: "기본", legend: "auto" } });
    const bar = KO.find((c) => c.type === "bar")!;
    expect(bar.example.data).toBe(samples.barSampleKo);
    expect(noLocale(bar.example).options).toEqual({ layout: "stacked", highlight: "해외" });
    expect(localizeDef(CHARTS[0], "en")).toBe(CHARTS[0]);
    expect(chartsIn("en")).toBe(CHARTS);
  });
  it("예시 데이터: 한글판은 영어판과 숫자, 필드, 행 수가 같아요", () => {
    const all = samples as unknown as Record<string, Record<string, unknown>[]>;
    const koNames = Object.keys(all).filter((k) => k.endsWith("SampleKo"));
    expect(koNames.length).toBe(32);
    // 넓은 표(스카이라인)는 필드 이름이 곧 계열 이름이라 한글판은 필드 이름까지 한글이에요. 그 표는 값만 같은 순서로 견줘요
    const WIDE = new Set(["skylineSampleKo"]);
    const shape = (rows: Record<string, unknown>[], wide: boolean) => JSON.stringify(wide ? rows.map((r) => Object.values(r)) : rows, (_k, v) => (typeof v === "string" ? "" : v));
    for (const k of koNames) {
      const en = all[k.slice(0, -2)];
      expect(shape(all[k], WIDE.has(k)), k).toBe(shape(en, WIDE.has(k)));
      expect(JSON.stringify(all[k]), k).toMatch(HANGUL);
      expect(JSON.stringify(en), k).not.toMatch(HANGUL);
    }
    expect(samples.barSample.map((r) => r.team)).toEqual(["Domestic", "Overseas", "Domestic", "Overseas", "Domestic", "Overseas", "Domestic", "Overseas"]);
  });
  it("묶음과 수준은 id, 영어, 한글 이름이 모두 있어요", () => {
    expect(GROUPS.map((g) => g.id)).toEqual(["proportion", "trend", "comparison", "distribution", "relationship", "flow", "hierarchy", "map", "kpi"]);
    expect(LEVELS.map((l) => l.id)).toEqual(["basic", "intermediate", "advanced"]);
    for (const l of [...GROUPS, ...LEVELS]) {
      expect(l.en, l.id).toMatch(/^[A-Z]/);
      expect(l.ko, l.id).toBeTruthy();
    }
    expect(new Set(GROUPS.map((g) => g.ko)).size).toBe(GROUPS.length);
    for (const c of CHARTS) {
      expect(findGroup(c.group)?.id, c.type).toBe(c.group);
      expect(findLevel(c.level)?.id, c.type).toBe(c.level);
    }
  });
  it("findGroup, findLevel은 id, 영어, 한글 이름을 대소문자 없이 받아요", () => {
    expect(findGroup("분포")?.id).toBe("distribution");
    expect(findGroup("Distribution")?.id).toBe("distribution");
    expect(findGroup("DISTRIBUTION")?.ko).toBe("분포");
    expect(findGroup("kpi")?.en).toBe("KPI");
    expect(findLevel("기본")?.id).toBe("basic");
    expect(findLevel("Advanced")?.ko).toBe("심화");
    expect(findLevel(" intermediate ")?.en).toBe("Intermediate");
    expect(findGroup("없음")).toBeUndefined();
    expect(findLevel("expert")).toBeUndefined();
  });
  it("스키마: 기본은 영어, specSchemaIn(\"ko\"), schemaForIn(type, \"ko\")면 한글 설명이에요", () => {
    const en = schemaFor("pie") as { title: string; description: string };
    const ko = schemaForIn("pie", "ko") as { title: string; description: string };
    expect(en.title).toBe("Pie chart");
    expect(en.description).toContain("Use when:");
    expect(ko.title).toBe("파이 차트 (Pie chart)");
    expect(ko.description).toContain("쓸 때:");
    expect(JSON.stringify(specSchema())).not.toMatch(/쓸 때|피할 때/);
    expect(JSON.stringify(specSchemaIn("ko"))).toContain("항목 이름 필드");
    expect(specSchemaIn("en")).toEqual(specSchema());
    expect(schemaForIn("pie", "en")).toEqual(en);
    expect(schemaForIn("nope", "ko")).toBeNull();
    // 한글 스키마도 한글 예시를 받아요
    const one = new Ajv2020({ strict: false }).compile(specSchemaIn("ko"));
    for (const c of KO) expect(one(c.example), c.type).toBe(true);
  });
});

describe("validateSpec 메시지", () => {
  const codes = (spec: unknown) => {
    const r = validateSpec(spec);
    return [...r.errors.map((e) => e.code), ...r.warnings.map((w) => `!${w.code}`)];
  };
  it("타입 오타는 비슷한 이름을 알려줘요", () => {
    const r = validateSpec({ type: "piee", data: [] });
    expect(r.errors[0].code).toBe("unknown_type");
    expect(r.errors[0].message).toContain('Did you mean "pie"?');
  });
  it('메시지는 영어가 기본이고 { lang: "ko" }면 한글이에요. code와 path는 같아요', () => {
    const bad = { type: "pie", data: [{ name: "a", v: "많음" }], encoding: { label: "nam", value: "v", colour: "x" }, options: { hilight: "a", height: "200" }, card: { level: 1 } };
    const en = validateSpec(bad);
    const ko = validateSpec(bad, { lang: "ko" });
    const ids = (r: typeof en) => [...r.errors, ...r.warnings].map((i) => `${i.path}:${i.code}`);
    expect(ids(ko)).toEqual(ids(en));
    expect(ids(en).length).toBeGreaterThanOrEqual(6);
    for (const i of [...en.errors, ...en.warnings]) expect(i.message, i.code).not.toMatch(HANGUL);
    for (const i of [...ko.errors, ...ko.warnings]) expect(i.message, i.code).toMatch(HANGUL);
    expect(en.warnings.find((w) => w.code === "unknown_channel")?.message).toContain("Pie chart has no channel");
    expect(ko.warnings.find((w) => w.code === "unknown_channel")?.message).toBe('파이 차트에는 "colour" 채널이 없어요. 가능한 채널: label, value');
    expect(ko.errors.find((e) => e.code === "field_not_found")?.message).toContain('"name"인가요?');
    expect(validateSpec({ type: "sankey", data: [{ a: 1 }] }, { lang: "ko" }).errors[0].message).toBe("encoding.source 값이 필요해요. 데이터 필드: a");
    expect(validateSpec({ type: "sankey", data: [{ a: 1 }] }).errors[0].message).toBe("encoding.source (Source node) is required. Data fields: a");
  });
  it("한글 메시지의 조사는 키 이름에 따라 틀어지지 않아요", () => {
    const ko = validateSpec({ type: "donut", data: [{ label: "a", value: 1 }], options: { centerLabel: 1, sort: "yes" } }, { lang: "ko" });
    expect(ko.errors.map((e) => e.message)).toEqual(["options.centerLabel 값은 문자열이어야 해요(지금 number)", "options.sort 값은 true나 false여야 해요(지금 string)"]);
  });
  it("별칭은 경고와 함께 통과", () => {
    expect(codes({ type: "doughnut", data: [{ label: "a", value: 1 }] })).toEqual(["!alias"]);
  });
  it("없는 필드, 숫자 아님, 필수 채널", () => {
    const data = [{ name: "a", v: "많음" }];
    expect(codes({ type: "pie", data, encoding: { label: "nam", value: "v" } })).toEqual(expect.arrayContaining(["field_not_found", "not_numeric"]));
    expect(validateSpec({ type: "pie", data, encoding: { label: "nam", value: "v" } }).errors[0].message).toContain('"name"');
    expect(codes({ type: "sankey", data: [{ a: 1 }], encoding: {} })).toEqual(expect.arrayContaining(["missing_channel"]));
    expect(codes({ type: "sankey", data: { url: "https://x.test/a.json" } })).toEqual(expect.arrayContaining(["!missing_channel_default"]));
  });
  it("기본 필드 이름과 같으면 encoding을 생략해도 돼요", () => {
    expect(validateSpec({ type: "pie", data: [{ label: "a", value: 1 }] }).valid).toBe(true);
  });
  it("옵션 타입, enum, 범위, 모르는 옵션", () => {
    const base = { type: "funnel", data: [{ label: "a", value: 1 }] };
    expect(codes({ ...base, options: { rateBase: "last" } })).toContain("bad_enum");
    expect(codes({ ...base, options: { height: "200" } })).toContain("bad_option_type");
    expect(codes({ type: "donut", data: [{ label: "a", value: 1 }], options: { innerRadius: 2 } })).toContain("out_of_range");
    const r = validateSpec({ ...base, options: { hilight: "a" } });
    expect(r.warnings[0].message).toContain('"highlight"');
  });
  it("상자 그림 whiskers는 0~100 사이 숫자 두 개를 받아요(순서는 그릴 때 맞춰요)", () => {
    const box = (whiskers: unknown) => codes({ type: "box", data: [{ group: "a", value: 1 }], options: { whiskers } });
    for (const ok of [[5, 95], [0, 100], [95, 5]]) expect(box(ok)).not.toContain("bad_option_items");
    for (const bad of [[5], [5, 50, 95], [-1, 95], [5, 101], [5, "95"]]) expect(box(bad)).toContain("bad_option_items");
    expect(box("5-95")).toContain("bad_option_type");
  });
  it("data 모양", () => {
    expect(codes({ type: "pie", data: [[1, 2]] })).toContain("bad_row");
    expect(codes({ type: "pie", data: { url: "ftp://x" } })).toContain("bad_url");
    expect(validateSpec({ type: "pie", data: { csv: "label,value\na,1" } }).valid).toBe(true);
    expect(codes({ type: "pie", data: [] })).toEqual(["!empty", "!missing_channel_default", "!missing_channel_default"]);
  });
});

describe("suggestCharts", () => {
  const top = (rows: Record<string, unknown>[]) => suggestCharts(rows).suggestions.map((s) => s.type);
  it("단계 데이터 → 퍼널", () => expect(top(samples.funnelSample)[0]).toBe("funnel"));
  it("시계열 여러 계열 → 라인", () => expect(top(samples.lineSample)[0]).toBe("line"));
  it("계층 → 트리맵", () => expect(top(samples.treemapSample)[0]).toBe("treemap"));
  it("source/target → 생키, 양방향이면 코드", () => {
    expect(top(samples.sankeySample)).toContain("sankey");
    expect(top(samples.chordSample)[0]).toBe("chord");
  });
  it("숫자 세 개 + 이름 → 버블", () => expect(top(samples.bubbleSample)).toContain("bubble"));
  it("부호 섞인 증감 → 폭포", () => expect(top([{ k: "시작", v: 100 }, { k: "a", v: 20 }, { k: "b", v: -15 }, { k: "c", v: 8 }])[0]).toBe("waterfall"));
  it("값 하나 + 목표 → 게이지", () => expect(top([{ value: 73, target: 85 }])[0]).toBe("gauge"));
  it("그룹마다 값이 많으면 분포 차트", () => expect(top(samples.boxSample).slice(0, 3)).toEqual(expect.arrayContaining(["box"])));
  it("하루 단위 장기 데이터 → 캘린더", () => expect(top(samples.calendarSample)[0]).toBe("calendar"));
  it("순위 필드 → 범프", () => expect(top(samples.bumpSample)[0]).toBe("bump"));
  it("숫자 지표 다섯 개 → 평행 좌표", () => expect(top(samples.parallelSample)).toContain("parallel"));
  it("추천 스펙은 모두 검증을 통과해요", () => {
    for (const rows of [samples.funnelSample, samples.lineSample, samples.treemapSample, samples.sankeySample, samples.bubbleSample, samples.boxSample]) {
      for (const s of suggestCharts(rows).suggestions) expect(validateSpec(s.spec).errors, s.type).toEqual([]);
    }
  });
  it('한글 데이터도 같은 차트를 골라요. 이유와 카드는 영어가 기본, { lang: "ko" }면 한글', () => {
    const pairs = [[samples.funnelSample, samples.funnelSampleKo], [samples.treemapSample, samples.treemapSampleKo], [samples.chordSample, samples.chordSampleKo], [samples.bumpSample, samples.bumpSampleKo]] as const;
    for (const [en, ko] of pairs) expect(suggestCharts(ko).suggestions.map((s) => s.type)).toEqual(suggestCharts(en).suggestions.map((s) => s.type));
    const en = suggestCharts(samples.funnelSample).suggestions;
    const ko = suggestCharts(samples.funnelSample, { lang: "ko" }).suggestions;
    expect(ko.map((s) => [s.type, s.score])).toEqual(en.map((s) => [s.type, s.score]));
    expect(en[0]).toMatchObject({ name: "Funnel chart", spec: { card: { title: "Funnel chart", level: "basic" } } });
    expect(ko[0]).toMatchObject({ name: "퍼널 차트", spec: { card: { title: "퍼널 차트", level: "basic" } } });
    for (const s of en) expect(`${s.reason} ${s.spec.card?.takeaway}`, s.type).not.toMatch(HANGUL);
    for (const s of ko) expect(`${s.reason} ${s.spec.card?.takeaway}`, s.type).toMatch(HANGUL);
    // 한글 추천 스펙만 options.locale "ko-KR"을 적어요
    for (const s of en) expect(s.spec.options?.locale, s.type).toBeUndefined();
    for (const s of ko) expect(s.spec.options?.locale, s.type).toBe("ko-KR");
  });
});

describe("range band (encoding.lower, encoding.upper)", () => {
  const rows = [
    { d: "a", app: "A", v: 5, lo: 4, hi: 6 },
    { d: "b", app: "A", v: 6, lo: 7, hi: 5 },
    { d: "c", app: "B", v: 2, lo: 1, hi: 3 },
  ];
  const band = (type: string, extra: object = {}) => validateSpec({ type, data: rows, encoding: { x: "d", y: "v", lower: "lo", upper: "hi" }, ...extra });
  const codes = (r: ReturnType<typeof validateSpec>) => [...r.errors.map((e) => e.code), ...r.warnings.map((w) => `!${w.code}`)];

  it("crossed bounds pass with a warning that they are swapped", () => {
    const r = band("line");
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => `${w.path} ${w.message}`)).toEqual(["encoding.lower lower is above upper in 1 row. They are swapped when drawn"]);
    expect(validateSpec({ type: "line", data: rows, encoding: { x: "d", y: "v", lower: "lo", upper: "hi" } }, { lang: "ko" }).warnings[0].message).toBe("1개 행에서 lower가 upper보다 커요. 바꿔서 그려요");
  });

  it('a band on stacked areas is an error; stack "none" or one series passes', () => {
    const stacked = band("area", { encoding: { x: "d", y: "v", series: "app", lower: "lo", upper: "hi" } });
    expect(stacked.valid).toBe(false);
    expect(stacked.errors.map((e) => `${e.path}:${e.code}`)).toEqual(["options.stack:band_stacked"]);
    expect(codes(band("area", { encoding: { x: "d", y: "v", series: "app", lower: "lo", upper: "hi" }, options: { stack: "percent" } }))).toContain("band_stacked");
    expect(band("area", { encoding: { x: "d", y: "v", series: "app", lower: "lo", upper: "hi" }, options: { stack: "none" } }).valid).toBe(true);
    expect(band("area").valid).toBe(true);
  });

  it("warns when a band cannot be drawn: one bound, a field per y missing, bandFrom without a forecast", () => {
    expect(codes(validateSpec({ type: "line", data: rows, encoding: { x: "d", y: "v", lower: "lo" } }))).toEqual(["!band_half"]);
    expect(codes(validateSpec({ type: "line", data: [{ d: "a", p: 1, q: 2, lo: 0, hi: 3 }], encoding: { x: "d", y: ["p", "q"], lower: ["lo"], upper: ["hi"] } }))).toEqual(["!band_fields"]);
    expect(codes(band("line", { options: { bandFrom: "forecast" } }))).toContain("!band_no_forecast");
    expect(codes(band("line", { options: { bandFrom: "forecast", annotations: [{ type: "forecast", from: "b" }] } }))).not.toContain("!band_no_forecast");
  });

  it("the JSON Schema takes the band channels and options", () => {
    const line = CHARTS.find((c) => c.type === "line")!;
    for (const id of ["band", "forecast-band"]) expect(validateAll(variantSpec(line, id)), id).toBe(true);
    expect(validateAll({ type: "area", data: rows, encoding: { x: "d", y: "v", lower: ["lo"], upper: ["hi"] }, options: { outside: true, bandFrom: "start" } })).toBe(true);
    expect(validateAll({ type: "line", data: rows, options: { bandFrom: "later" } })).toBe(false);
  });
});

describe("options.connectNulls (line, area)", () => {
  it("is a boolean option, default false, on line and area, described in both languages and taken by the JSON Schema", () => {
    const owners = CHARTS.filter((c) => c.options.some((o) => o.name === "connectNulls"));
    expect(owners.map((c) => c.type)).toEqual(["line", "area"]);
    for (const c of owners) {
      expect(c.options.find((o) => o.name === "connectNulls"), c.type).toMatchObject({ type: "boolean", default: false });
      expect(KO.find((k) => k.type === c.type)!.options.find((o) => o.name === "connectNulls")!.description, c.type).toMatch(HANGUL);
    }
    const spec = { type: "line", data: [{ m: "a", v: 1 }, { m: "b", v: null }, { m: "c", v: 3 }], encoding: { x: "m", y: "v" } };
    expect(validateAll({ ...spec, options: { connectNulls: true } })).toBe(true);
    expect(validateAll({ ...spec, options: { connectNulls: "yes" } })).toBe(false);
    expect(validateSpec({ ...spec, options: { connectNulls: true } }).warnings).toEqual([]);
    expect(validateSpec({ ...spec, options: { connectNulls: "yes" } }).errors.map((e) => e.code)).toEqual(["bad_option_type"]);
  });
});

describe("text in number columns and duplicate x (options.aggregate)", () => {
  const codesOf = (r: ReturnType<typeof validateSpec>) => [...r.errors.map((e) => e.code), ...r.warnings.map((w) => `!${w.code}`)];

  it("draws text cells as gaps with the row numbers in a warning, and rejects only when more than half is text", () => {
    const data = [{ k: "A", v: 10 }, { k: "B", v: "n/a" }, { k: "C", v: "n/a" }, { k: "D", v: 30 }, { k: "E", v: "#N/A" }, { k: "F", v: 25 }];
    const half = validateSpec({ type: "bar", data, encoding: { x: "k", y: "v" } });
    expect(half.valid).toBe(true);
    expect(half.warnings.map((w) => `${w.path} ${w.message}`)).toEqual(['encoding.y 3 values in "v" are not a number and drawn as a gap (row 2 "n/a", row 3 "n/a", row 5 "#N/A")']);
    expect(validateSpec({ type: "bar", data, encoding: { x: "k", y: "v" } }, { lang: "ko" }).warnings[0].message).toBe('"v" 값 3개는 숫자가 아니라 빈 칸으로 그려요(2행 "n/a", 3행 "n/a", 5행 "#N/A")');
    expect(codesOf(validateSpec({ type: "bar", data: [...data, { k: "G", v: "-" }], encoding: { x: "k", y: "v" } }))).toEqual(["not_numeric"]);
  });

  it("warns when rows with the same x get added, unless options.aggregate says how to combine them", () => {
    const data = [{ m: "2025-01", r: 3 }, { m: "2025-01", r: 5 }, { m: "2025-02", r: 4.2 }];
    const spec = { type: "line", data, encoding: { x: "m", y: "r" } };
    expect(codesOf(validateSpec(spec))).toEqual(["!duplicate_x"]);
    expect(validateSpec(spec, { lang: "ko" }).warnings[0].message).toBe('m 값이 같은 행은 더해서 그려요(1곳, 처음 "2025-01" 2행). 비율, 평균처럼 더하면 안 되는 값이면 options.aggregate를 "mean", "last", "count" 중 하나로 정해 주세요');
    expect(validateSpec({ ...spec, options: { aggregate: "mean" } }).warnings).toEqual([]);
    expect(codesOf(validateSpec({ type: "line", data: data.map((d, i) => ({ ...d, s: i === 1 ? "b" : "a" })), encoding: { x: "m", y: "r", series: "s" } }))).toEqual([]);
    expect(codesOf(validateSpec({ ...spec, options: { aggregate: "median" } }))).toEqual(["bad_enum"]);
    const owners = CHARTS.filter((c) => c.options.some((o) => o.name === "aggregate")).map((c) => c.type);
    expect(owners).toEqual(["line", "area", "stream", "bar"]);
    for (const t of owners) expect(KO.find((k) => k.type === t)!.options.find((o) => o.name === "aggregate")!.description, t).toMatch(HANGUL);
  });
});

describe("highlight by wide-table column, slope periods", () => {
  it("a wide-table column name is a valid highlight, and a slope says which periods and items it leaves out", () => {
    const wide = { type: "line", data: [{ m: "2025-01", ours: 1, theirs: 2 }, { m: "2025-02", ours: 3, theirs: 2 }], encoding: { x: "m", y: ["ours", "theirs"] }, options: { highlight: "ours" } };
    expect(validateSpec(wide).warnings).toEqual([]);
    expect(validateSpec({ ...wide, options: { highlight: "nobody" } }).warnings.map((w) => w.code)).toEqual(["highlight_not_found"]);
    const data = [
      { k: "A", p: "2023", v: 1 }, { k: "A", p: "2024", v: 2 }, { k: "A", p: "2025", v: 3 },
      { k: "B", p: "2023", v: 4 }, { k: "B", p: "2024", v: 5 },
    ];
    const r = validateSpec({ type: "slope", data, encoding: { label: "k", x: "p", value: "v" } });
    expect(r.warnings.map((w) => `${w.code} ${w.message}`)).toEqual(["slope_periods Only the first and last periods are drawn (3 periods: 2023, 2024, 2025)", 'slope_incomplete 1 item lacks a value in the first (2023) or last (2025) period and is left out ("B")']);
    expect(validateSpec({ type: "slope", data, encoding: { label: "k", x: "p", value: "v" } }, { lang: "ko" }).warnings.map((w) => w.message)).toEqual(["처음과 마지막 기간만 그려요(기간 3개: 2023, 2024, 2025)", '처음(2023)이나 마지막(2025) 기간 값이 없는 항목 1개는 빼고 그려요("B")']);
  });
});

describe("bar layout diverging", () => {
  const wide = { type: "bar", data: [{ q: "Support", Disagree: 30, Neutral: 22, Agree: 20 }], encoding: { x: "q", y: ["Disagree", "Neutral", "Agree"] } };
  const long = { type: "bar", data: [{ q: "A", sex: "Male", n: -4 }, { q: "A", sex: "Female", n: 6 }], encoding: { x: "q", y: "n", series: "sex" } };
  const issues = (spec: unknown, lang: "en" | "ko" = "en") => {
    const r = validateSpec(spec, { lang });
    return [...r.errors.map((e) => `${e.path} ${e.code}: ${e.message}`), ...r.warnings.map((w) => `!${w.path} ${w.code}: ${w.message}`)];
  };
  it("5: negative, neutral 이름이 계열(넓은 표는 y 필드, 긴 표는 series 값)에 없으면 거절하고 비슷한 이름을 알려요", () => {
    expect(issues({ ...wide, options: { layout: "diverging", negative: ["Disagree"], neutral: "Neutral", percent: true, sort: "positive" } })).toEqual([]);
    expect(issues({ ...long, options: { layout: "diverging", negative: ["Male"] } })).toEqual([]);
    const bad = { ...wide, options: { layout: "diverging", negative: ["Disagre"], neutral: "Netural" } };
    expect(validateSpec(bad).valid).toBe(false);
    expect(issues(bad)).toEqual([
      'options.negative[0] series_not_found: "Disagre" is not a series. Did you mean "Disagree"? Series: Disagree, Neutral, Agree',
      'options.neutral series_not_found: "Netural" is not a series. Did you mean "Neutral"? Series: Disagree, Neutral, Agree',
    ]);
    expect(issues(bad, "ko")).toEqual([
      'options.negative[0] series_not_found: "Disagre" 계열이 없어요. "Disagree"인가요? 있는 계열: Disagree, Neutral, Agree',
      'options.neutral series_not_found: "Netural" 계열이 없어요. "Neutral"인가요? 있는 계열: Disagree, Neutral, Agree',
    ]);
    expect(issues({ ...long, options: { layout: "diverging", negative: ["Women"] } })).toEqual(['options.negative[0] series_not_found: "Women" is not a series. Series: Male, Female']);
    expect(issues({ type: "bar", data: [{ x: "a", y: 1 }], options: { layout: "diverging", negative: ["y"] } })[0]).toBe('options.negative[0] series_not_found: "y" is not a series: this chart has one series. Set encoding.series, or y as an array of fields');
  });
  it("neutral 계열을 negative에도 넣으면 그 계열 이름과 함께 거절해요", () => {
    const both = { ...wide, options: { layout: "diverging", negative: ["Neutral", "Disagree"], neutral: "Neutral" } };
    expect(issues(both)).toEqual(['options.negative[0] neutral_in_negative: "Neutral" is the neutral series, so it cannot also be in options.negative. Remove it from one of them']);
    expect(issues(both, "ko")).toEqual(['options.negative[0] neutral_in_negative: "Neutral" 계열은 neutral이라 options.negative에 함께 넣을 수 없어요. 한쪽에서 빼 주세요']);
  });
  it("sort 값, diverging 밖에서 쓴 옵션, 그리지 않는 주석과 선을 알려요", () => {
    expect(issues({ ...wide, options: { sort: "both" } })).toEqual(['options.sort bad_option_type: options.sort must be true, false, "positive" or "negative"']);
    expect(issues({ ...wide, options: { sort: "positive", negative: ["Disagree"] } }, "ko")).toEqual(['!options.negative ignored_option: options.negative 옵션은 layout "diverging"에서만 써요', '!options.sort ignored_option: sort "positive" 값은 layout "diverging"에서만 써요']);
    expect(issues({ ...wide, options: { layout: "diverging", annotations: [{ type: "line", y: 5 }] } }).map((i) => i.split(":")[0])).toEqual(["!options.annotations annotations_ignored"]);
    expect(issues({ ...wide, encoding: { ...wide.encoding, line: "Agree" }, options: { layout: "diverging" } }).map((i) => i.split(":")[0])).toEqual(["!encoding.line line_ignored"]);
  });
});

describe("options.tooltip.template (차례 3 ⑩)", () => {
  const data = [{ m: "1월", v: 300, owner: "민지" }];
  const spec = (tooltip: unknown) => ({ type: "line", data, encoding: { x: "m", y: "v" }, options: { tooltip } });
  it("true, false, { template }만 받아요", () => {
    for (const tooltip of [true, false, { template: "{label} · {owner}" }]) {
      expect(validateSpec(spec(tooltip)).errors, JSON.stringify(tooltip)).toEqual([]);
      expect(validateAll(spec(tooltip)), JSON.stringify(tooltip)).toBe(true);
    }
    for (const tooltip of [{ template: 3 }, { template: "x", extra: 1 }, "x"]) {
      expect(validateSpec(spec(tooltip)).errors.map((e) => e.code), JSON.stringify(tooltip)).toEqual(["bad_option_type"]);
      expect(validateAll(spec(tooltip)), JSON.stringify(tooltip)).toBe(false);
    }
  });
  it("없는 열 이름은 비슷한 열과 함께 알려요", () => {
    const w = validateSpec(spec({ template: "{label} · 담당 {ownr}" })).warnings;
    expect(w.map((x) => x.code)).toEqual(["tooltip_field_not_found"]);
    expect(w[0].message).toContain("Did you mean {owner}?");
    expect(validateSpec(spec({ template: "{label} {value} {series} {owner}" })).warnings).toEqual([]);
  });
  it("스키마는 툴팁 정의를 한 번 두고 차트마다 가리켜요", () => {
    const s = JSON.stringify(specSchema());
    expect(specSchema().$defs).toHaveProperty("tooltip");
    expect(s.match(/"\$ref":"#\/\$defs\/tooltip"/g)).toHaveLength(CHARTS.length);
    expect(JSON.stringify((specSchemaIn("ko").$defs as Record<string, unknown>).tooltip)).toContain("값이 없는 칸이 든 줄은 빼요");
  });
});

describe("card.source, note, accent (차례 2 ⑭)", () => {
  const spec = { type: "bar", data: [{ x: "A", y: 1 }], encoding: { x: "x", y: "y" }, card: { title: "올해 매출", source: "통계청", note: "2025-10 기준", accent: "올해" } };
  it("알려진 키이고 스키마도 받아요", () => {
    expect(validateSpec(spec).warnings).toEqual([]);
    expect(validateAll(spec)).toBe(true);
  });
  it("accent가 제목에 없으면 알리고, 글자가 아니면 오류예요", () => {
    expect(validateSpec({ ...spec, card: { ...spec.card, accent: "작년" } }).warnings.map((w) => w.code)).toEqual(["accent_not_in_title"]);
    expect(validateSpec({ ...spec, card: { ...spec.card, source: 3 } }).errors.map((e) => e.code)).toEqual(["bad_card_value"]);
  });
  it("download는 true, false나 csv, svg, png 배열만 받아요", () => {
    for (const download of [true, false, ["csv"], ["png", "svg", "csv"]]) {
      const s = { ...spec, card: { ...spec.card, download } };
      expect(validateSpec(s).warnings, JSON.stringify(download)).toEqual([]);
      expect(validateSpec(s).errors, JSON.stringify(download)).toEqual([]);
      expect(validateAll(s), JSON.stringify(download)).toBe(true);
    }
    for (const download of ["csv", [], ["jpg"], 1]) {
      const s = { ...spec, card: { ...spec.card, download } };
      expect(validateSpec(s).errors.map((e) => e.code), JSON.stringify(download)).toEqual(["bad_card_value"]);
      expect(validateAll(s), JSON.stringify(download)).toBe(false);
    }
    expect(validateSpec({ ...spec, card: { ...spec.card, download: "csv" } }, { lang: "ko" }).errors[0].message).toBe('card.download 값은 true 또는 "csv", "svg", "png" 배열이어야 해요');
  });
});

describe("pie and donut slices (options.other)", () => {
  it("warns about slices of 0 or less by name, and suggests options.other for many slices", () => {
    const data = [{ label: "검색", value: 40 }, { label: "환불", value: -8 }, { label: "보류", value: 0 }];
    expect(validateSpec({ type: "pie", data }).warnings.map((w) => `${w.code} ${w.message}`)).toEqual(['nonpositive_slice 2 slices are 0 or less and left out ("환불" -8, "보류" 0)']);
    expect(validateSpec({ type: "donut", data }, { lang: "ko" }).warnings[0].message).toBe('0 이하인 조각 2개는 빼고 그려요("환불" -8, "보류" 0)');
    const many = Array.from({ length: 12 }, (_, i) => ({ label: `c${i}`, value: 12 - i }));
    expect(validateSpec({ type: "pie", data: many }).warnings.map((w) => w.code)).toEqual(["many_slices"]);
    expect(validateSpec({ type: "pie", data: many, options: { other: 6 } }).warnings).toEqual([]);
    expect(CHARTS.filter((c) => c.options.some((o) => o.name === "other")).map((c) => c.type)).toEqual(["pie", "donut"]);
    for (const t of ["pie", "donut"]) expect(KO.find((k) => k.type === t)!.options.find((o) => o.name === "other")!.description, t).toMatch(HANGUL);
  });
});

describe("options.annotations", () => {
  const base = { type: "line", data: [{ m: "a", v: 1 }, { m: "b", v: 2 }], encoding: { x: "m", y: "v" } };

  it("checks each annotation and points at the bad one", () => {
    const r = validateSpec({ ...base, options: { annotations: [{ type: "line" }, { type: "nope" }, { type: "event", x: "a" }, { type: "band", y: [1, 2] }, { type: "forecast", from: "b" }] } });
    expect(r.errors.filter((e) => e.code === "bad_annotation").map((e) => e.path)).toEqual(["options.annotations[0]", "options.annotations[1]", "options.annotations[2]"]);
    const ko = validateSpec({ ...base, options: { annotations: [{ type: "line" }] } }, { lang: "ko" });
    expect(ko.errors[0].message).toBe('"line"에는 숫자 y가 있어야 해요');
  });

  it("warns that horizontal bars do not draw annotations", () => {
    const r = validateSpec({ type: "bar", data: [{ x: "a", y: 1 }], encoding: { x: "x", y: "y" }, options: { orientation: "horizontal", annotations: [{ type: "line", y: 1 }] } });
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("annotations_ignored");
  });

  it("puts the annotation types in the JSON Schema", () => {
    expect(JSON.stringify(schemaFor("line"))).toContain('"enum":["band","line","event","forecast","trend","weekends"]');
    expect(JSON.stringify(schemaFor("candlestick"))).toContain('"annotations"');
  });
});

describe("variants", () => {
  it("every variant is a valid spec in both languages, changes its example, and has a unique id and a Korean name", () => {
    expect(Object.values(VARIANTS).flat().length).toBeGreaterThan(60);
    for (const [type, list] of Object.entries(VARIANTS)) {
      const def = CHARTS.find((d) => d.type === type);
      expect(def, type).toBeTruthy();
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
      const ko = variantsIn(type, "ko");
      // 한국어 이름표에 남은 id가 없어요 (변형을 지우면 이름도 지워요)
      expect(Object.keys(VARIANT_NAMES_KO[type] ?? {}).sort()).toEqual(list.map((x) => x.id).sort());
      const defaults = Object.fromEntries([...def!.options, ...COMMON_OPTIONS].map((o) => [o.name, o.default]));
      const koDef = localizeDef(def!, "ko");
      for (const x of list) {
        for (const [lang, d] of [["en", def!], ["ko", koDef]] as const) {
          const r = validateSpec(variantSpec(d, x.id), { lang });
          expect([...r.errors, ...r.warnings].map((i) => `${type}/${x.id}: ${i.message}`)).toEqual([]);
          // 예시가 이미 그 값이면 변형이 예시와 같아져요 (예시를 바꾸면 변형도 다시 봐요)
          const ex = (d.example.options ?? {}) as Record<string, unknown>;
          const changed = Object.entries(x.options).some(([k, val]) => JSON.stringify(val) !== JSON.stringify(ex[k] ?? defaults[k] ?? (Array.isArray(val) ? [] : undefined)));
          expect(changed, `${type}/${x.id} (${lang})`).toBe(true);
        }
        expect(ko.find((k) => k.id === x.id)?.name, `${type}/${x.id}`).not.toBe(x.name);
      }
    }
    expect(variantSpec(CHARTS[0], "nope")).toBeNull();
  });
});

describe("로그 눈금 경고 (차례 4 ⑯)", () => {
  const line = (ys: number[], options: Record<string, unknown>) => ({ type: "line", data: ys.map((v, i) => ({ m: `p${i}`, v })), encoding: { x: "m", y: "v" }, options });
  const codes = (r: { warnings: { path: string; code: string }[] }) => r.warnings.map((w) => `${w.path}:${w.code}`).sort();
  it("0 이하 값은 개수와 행으로 알리고, 쓸 수 없는 yDomain과 fit도 알려요", () => {
    const spec = line([5, 0, -3, 40], { yScale: "log", yDomain: [0, 100] });
    const en = validateSpec(spec);
    expect(en.errors).toEqual([]);
    expect(codes(en)).toEqual(["options.yDomain:ignored_option", "options.yScale:nonpositive_log"]);
    expect(en.warnings.find((w) => w.code === "nonpositive_log")!.message).toBe("2 values at or below 0 are left out, because a log scale cannot show them (row 2 0, row 3 -3)");
    expect(validateSpec(spec, { lang: "ko" }).warnings.find((w) => w.code === "nonpositive_log")!.message).toBe("로그 눈금은 0 이하를 그릴 수 없어서 0 이하 값 2개는 빼고 그려요(2행 0, 3행 -3)");
    expect(codes(validateSpec({ type: "scatter", data: [{ x: 1, y: 2 }, { x: 2, y: 3 }], encoding: { x: "x", y: "y" }, options: { yScale: "log", fit: "linear" } }))).toEqual(["options.fit:ignored_option"]);
    expect(validateSpec(line(Array.from({ length: 24 }, (_, i) => Math.round(120 * 1.62 ** i)), { yScale: "log" })).warnings).toEqual([]);
  });
  it("영역과 막대는 로그 눈금이 없다고 까닭과 함께 알려요", () => {
    const w = validateSpec({ type: "area", data: [{ m: "a", v: 1 }, { m: "b", v: 2 }], encoding: { x: "m", y: "v" }, options: { yScale: "log" } }).warnings.find((x) => x.path === "options.yScale")!;
    expect(w.code).toBe("unknown_option");
    expect(w.message).toBe('Area chart has no option "yScale": its length from 0 is the value, so it has no log scale. Use line, scatter or bubble with yScale "log"');
  });
});

describe("범례 켜고 끄기 검사 (차례 4 ⑫)", () => {
  const CH = ["Search", "Social", "Ads", "Referral", "Direct"];
  const data = ["Jan", "Feb"].flatMap((m, k) => CH.map((ch, s) => ({ m, ch, v: 40 + s * 10 + k * 3 })));
  const line = { type: "line", data, encoding: { x: "m", y: "v", series: "ch" }, options: { highlight: "Social", hidden: ["Ads"] }, card: { title: "Visits", legend: "toggle" } };
  it('"toggle"은 받고, 켜고 끌 수 없는 차트는 알리고, 틀린 값에는 쓸 수 있는 값을 알려요', () => {
    const r = validateSpec(line);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(validateAll(line)).toBe(true);
    const pie = validateSpec({ type: "pie", data: [{ label: "a", value: 1 }, { label: "b", value: 2 }], encoding: { label: "label", value: "value" }, card: { legend: "toggle" } }).warnings;
    expect(pie.map((w) => w.code)).toEqual(["legend_toggle_ignored"]);
    expect(pie[0].message).toBe('card.legend "toggle" works on line, area, bar and scatter, so this chart draws a plain legend');
    expect(validateSpec({ ...line, card: { legend: "toggles" } }).errors.find((e) => e.code === "bad_legend")!.message).toContain('"toggle"');
  });
});
