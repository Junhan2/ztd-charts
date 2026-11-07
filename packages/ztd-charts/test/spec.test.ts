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
  it("33종, 타입과 컴포넌트 이름이 겹치지 않아요", () => {
    expect(CHARTS).toHaveLength(33);
    expect(new Set(CHARTS.map((c) => c.type)).size).toBe(33);
    expect(new Set(CHARTS.map((c) => c.component)).size).toBe(33);
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
    expect(koNames.length).toBe(29);
    const shape = (rows: Record<string, unknown>[]) => JSON.stringify(rows, (_k, v) => (typeof v === "string" ? "" : v));
    for (const k of koNames) {
      const en = all[k.slice(0, -2)];
      expect(shape(all[k]), k).toBe(shape(en));
      expect(JSON.stringify(all[k]), k).toMatch(HANGUL);
      expect(JSON.stringify(en), k).not.toMatch(HANGUL);
    }
    expect(samples.barSample.map((r) => r.team)).toEqual(["Domestic", "Overseas", "Domestic", "Overseas", "Domestic", "Overseas", "Domestic", "Overseas"]);
  });
  it("묶음과 수준은 id, 영어, 한글 이름이 모두 있어요", () => {
    expect(GROUPS.map((g) => g.id)).toEqual(["proportion", "trend", "comparison", "distribution", "relationship", "flow", "hierarchy", "kpi"]);
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
    expect(codes({ type: "scatter", data: [{ x: 1, y: 2 }], encoding: { x: "x", y: "y" } })).toEqual(["!alias"]);
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
