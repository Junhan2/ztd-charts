import { ISO_DATE_RE, isDateText, isYear, monthOf, toDate } from "../core/format";
import { toNumber, uniq } from "../data/accessor";
import { localizeDef, withKoLocale } from "./localize";
import { getChartDef } from "./registry";
import type { ChartSpec, Lang } from "./types";

export type ColumnKind = "number" | "date" | "category" | "text";

export interface ColumnProfile {
  name: string;
  kind: ColumnKind;
  distinct: number;
  nulls: number;
  min?: number;
  max?: number;
  negatives?: boolean;
  integer?: boolean;
  /** 날짜 간격이 하루 단위인지 */
  daily?: boolean;
  /** 값이 두 개 이상 있고 모두 달라요 (항목 이름, 순번) */
  unique?: boolean;
  /** 숫자가 행 순서대로 줄지 않아요 (시간 단계, 순번) */
  sorted?: boolean;
}

export interface DataProfile {
  rows: number;
  columns: ColumnProfile[];
}

export interface Suggestion {
  type: string;
  name: string;
  score: number;
  reason: string;
  spec: ChartSpec;
}

const SOURCE_RE = /^(source|from|src|출발|보낸|origin|시작)/i;
const TARGET_RE = /^(target|to|dst|도착|받은|dest)/i;
const DATE_NAME = /(date|day|month|week|year|time|날짜|일자|월|주|연도|시간|기간|period)/i;
const YEAR_NAME = /(year|연도|년도|^년$)/i;
const MONTH_KO = /^(1[0-2]|[1-9])월$/;
/** YYYYMMDD 숫자나 글자(20240315) */
const YMD = /^\d{8}$/;
const RANK_RE = /(rank|순위|등수)/i;
const STAGE_RE = /(stage|step|funnel|단계|스텝)/i;
const BEFORE_RE = /(before|prev|start|이전|전|작년|기존|old)/i;
const AFTER_RE = /(after|next|end|이후|후|올해|신규|new)/i;
const TARGET_KPI = /(target|goal|목표)/i;
/** 엑셀 등이 빈 칸에 쓰는 표시 ("-", "n/a", "#N/A", "null") */
const MISSING = /^(-|—|–|n\/?a|#n\/a|na|null|nan|none)$/i;
/** 순번이 아니라 식별자라 x로 쓰지 않는 이름 */
const ID_NAME = /^(id|no|번호|#|key|코드|code)$/i;
/** 폭포 차트의 시작, 끝 라벨 (없으면 증감이 아니라 순서 없는 조각이에요) */
const WATERFALL_START = /^(시작|start|begin|opening|기초|전월|작년|이전|prev)/i;
const WATERFALL_END = /^(끝|end|합계|total|closing|현재|이번)/i;
/** 기간 라벨: 연도, 분기, "3월", 영어 월 이름(앞부분도. "Marketing"은 아니에요) */
const isPeriod = (s: string) => /^(\d{4}|q[1-4])$/i.test(s) || MONTH_KO.test(s) || monthOf(s) > 0;
const TOTAL_WORD = /^(total|합계|시작|start|end|끝)$/i;
/** 항목이 많을 때 막대로 보여 줄 큰 항목 수 */
const TOP_N = 7;

export function profileData(rows: readonly Record<string, unknown>[]): DataProfile {
  const sample = rows.slice(0, 5000);
  const names = uniq(sample.slice(0, 200).flatMap((r) => Object.keys(r ?? {})));
  const columns = names.map((name): ColumnProfile => {
    const vals = sample.map((r) => r?.[name]);
    // "-", "n/a" 같은 빈 칸 표시도 빈 칸이에요 (그리기에서도 빈 칸이에요)
    const present = vals.filter((v) => v !== null && v !== undefined && v !== "" && !(typeof v === "string" && MISSING.test(v.trim())));
    const nulls = vals.length - present.length;
    const nums = present.map((v) => toNumber(v));
    const numOk = present.length ? nums.filter(Number.isFinite).length / present.length : 0;
    const distinct = new Set(present.map((v) => String(v))).size;
    const unique = present.length > 1 && distinct === present.length;
    // "1월"…"12월"은 순서가 있는 시간이에요 (파이 조각이 아니에요)
    if (present.length && present.every((v) => typeof v === "string" && MONTH_KO.test(v.trim()))) return { name, kind: "date", distinct, nulls, daily: false, unique };
    // 연도 열(2019)과 이름이 날짜인 YYYYMMDD 숫자(20240315)도 시간이에요
    const years = YEAR_NAME.test(name) && nums.every(isYear);
    const compact = years || (DATE_NAME.test(name) && present.every((v) => YMD.test(String(v).trim()) && toDate(v)));
    // 차트가 날짜 축으로 읽는 표기(점, 한국식, 분기, 영어 월 이름)와 같아요
    const looksDate = present.length > 0 && (compact || (present.every((v) => v instanceof Date || (typeof v === "string" && isDateText(v.trim()))) && present.filter((v) => toDate(v)).length / present.length > 0.9));
    if (looksDate) {
      const ts = present.map((v) => toDate(v)?.getTime() ?? NaN).filter(Number.isFinite).sort((a, b) => a - b);
      const gaps = ts.slice(1).map((t, i) => t - ts[i]).filter((g) => g > 0);
      const med = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
      return { name, kind: "date", distinct, nulls, min: ts[0], max: ts[ts.length - 1], daily: med > 0 && med <= 86400000 * 1.5, unique };
    }
    // 검사기와 같은 규칙: 숫자가 절반 넘으면 숫자 열이고 나머지 글자는 빈 칸으로 그려요
    if (numOk >= 0.5 && !(typeof present[0] === "string" && /^0\d/.test(String(present[0])))) {
      const f = nums.filter(Number.isFinite);
      return { name, kind: "number", distinct, nulls, min: Math.min(...f), max: Math.max(...f), negatives: f.some((v) => v < 0), integer: f.every((v) => Number.isInteger(v)), unique, sorted: f.every((v, i) => i === 0 || v >= f[i - 1]) };
    }
    const avgLen = present.reduce<number>((a, v) => a + String(v).length, 0) / Math.max(1, present.length);
    // 모두 다른 짧은 이름은 항목 이름이라 몇백 개여도 범주예요
    return { name, kind: (distinct <= Math.max(60, present.length * 0.6) || unique) && avgLen < 40 ? "category" : "text", distinct, nulls, unique };
  });
  return { rows: rows.length, columns };
}

/** x 하나에 붙은 범주 값의 평균 개수. 1에 가까우면 범주는 x의 속성이라 계열로 나누지 않아요 (처음 5,000행) */
function perX(rows: readonly Record<string, unknown>[], x: string, c: string): number {
  const sample = rows.slice(0, 5000);
  const xs = new Set(sample.map((r) => String(r[x])));
  // x 길이를 앞에 붙여 x와 범주 값의 경계가 어디든 다른 짝과 겹치지 않게
  const pairs = new Set(sample.map((r) => `${String(r[x]).length}:${String(r[x])}${String(r[c])}`));
  return pairs.size / Math.max(1, xs.size);
}

function mk(type: string, score: number, reason: string, rows: readonly Record<string, unknown>[], encoding: Record<string, string | string[]>, options?: Record<string, unknown>): Suggestion {
  const def = getChartDef(type)!;
  return { type, name: def.name, score: Math.round(score * 100) / 100, reason, spec: { type, data: rows.slice(0, 5000) as Record<string, unknown>[], encoding, ...(options ? { options } : {}), card: { title: def.name, takeaway: def.summary, level: def.level } } };
}

/**
 * 항목이 많을 때(모두 다른 이름 12개 넘게) 큰 7개를 가로 막대로. 나머지 합이 가장 큰 막대보다 작으면 "기타" 한 줄로 더하고,
 * 크면 막대가 납작해지니 큰 8개만 두고 나머지는 빼요. 스펙 데이터는 그 8줄이에요 (MCP가 보여 주는 8행 안)
 */
function topBars(rows: readonly Record<string, unknown>[], label: string, value: string, t: (en: string, ko: string) => string): Suggestion {
  const ranked = rows.map((r) => ({ name: r[label], v: toNumber(r[value]) })).filter((x) => Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
  const restSum = ranked.slice(TOP_N).reduce((a, x) => a + x.v, 0);
  const withOther = ranked.length > TOP_N && restSum <= ranked[0].v;
  const shown = ranked.slice(0, withOther ? TOP_N : TOP_N + 1);
  const left = ranked.length - shown.length;
  const data = shown.map((x) => ({ [label]: x.name, [value]: x.v }));
  if (withOther) data.push({ [label]: t(`Other (${left})`, `기타 ${left}개`), [value]: restSum });
  const reason = withOther
    ? t(`${ranked.length} items are too many to compare at once, so the bars show the ${TOP_N} largest and add up the other ${left} as "Other"`, `항목이 ${ranked.length}개라 한 번에 비교하기 어려워서 큰 ${TOP_N}개만 막대로 보여 줘요. 나머지 ${left}개는 "기타"로 더했어요`)
    : t(`${ranked.length} items are too many to compare at once, so the bars show the ${shown.length} largest. The other ${left} are left out`, `항목이 ${ranked.length}개라 한 번에 비교하기 어려워서 큰 ${shown.length}개만 막대로 보여 줘요. 나머지 ${left}개는 뺐어요`);
  return mk("bar", 0.88, reason, data, { x: label, y: value }, { orientation: "horizontal" });
}

/** 추천 하나의 차트 이름과 카드 제목, 요약을 그 언어로. 한글 스펙은 options.locale도 "ko-KR"이에요 */
function inLang(s: Suggestion, lang: Lang): Suggestion {
  if (lang === "en") return s;
  const def = localizeDef(getChartDef(s.type)!, lang);
  return { ...s, name: def.name, spec: withKoLocale({ ...s.spec, card: { ...s.spec.card, title: def.name, takeaway: def.summary } }) };
}

/**
 * 데이터 모양을 보고 어울리는 차트를 점수순으로 추천해요.
 * 이유(reason), 차트 이름, 카드 글은 영어, { lang: "ko" }면 한글이고 스펙의 options.locale은 "ko-KR"이에요.
 */
export function suggestCharts(rows: readonly Record<string, unknown>[], opts: { limit?: number; lang?: Lang } = {}): { profile: DataProfile; suggestions: Suggestion[] } {
  const lang = opts.lang ?? "en";
  /** 같은 이유의 영어와 한글 */
  const t = (en: string, ko: string) => (lang === "ko" ? ko : en);
  const profile = profileData(rows);
  const cols = profile.columns;
  const n = profile.rows;
  // 값 열은 빈 칸이 적은 것부터
  const numsAll = cols.filter((c) => c.kind === "number" && !RANK_RE.test(c.name)).sort((a, b) => a.nulls - b.nulls);
  const ranksC = cols.filter((c) => c.kind === "number" && RANK_RE.test(c.name));
  // 날짜 열이 없고 값 열이 둘 이상이면, 줄지 않고 모두 다른 숫자 열(20행 이상, 식별자 이름이 아닌)은 시간 단계 x예요
  const seq = cols.some((c) => c.kind === "date") || numsAll.length < 2 || n < 20 ? undefined : numsAll.find((c) => c.sorted && c.unique && !ID_NAME.test(c.name));
  const dates = seq ? [seq] : cols.filter((c) => c.kind === "date");
  const nums = numsAll.filter((c) => c !== seq);
  const cats = cols.filter((c) => c.kind === "category");
  const out: Suggestion[] = [];
  const v0 = nums[0];
  if (!n || !cols.length) return { profile, suggestions: [] };

  // 흐름: source/target
  const src = cats.find((c) => SOURCE_RE.test(c.name));
  const dst = cats.find((c) => TARGET_RE.test(c.name));
  if (src && dst && v0) {
    const pairs = new Set(rows.map((r) => `${r[src.name]}>${r[dst.name]}`));
    const reciprocal = rows.some((r) => pairs.has(`${r[dst.name]}>${r[src.name]}`));
    const srcVals = new Set(rows.map((r) => String(r[src.name])));
    const chained = rows.some((r) => srcVals.has(String(r[dst.name])));
    if (reciprocal) out.push(mk("chord", 0.92, t(`${src.name}→${dst.name} goes both ways, so a chord diagram fits`, `${src.name}→${dst.name} 관계가 양방향이라 코드 다이어그램이 맞아요`), rows, { source: src.name, target: dst.name, value: v0.name }));
    out.push(mk("sankey", reciprocal ? 0.8 : 0.95, chained ? t("The flow runs through several stages, which a Sankey diagram shows well", "흐름이 여러 단계로 이어져서 생키 다이어그램이 잘 맞아요") : t("A Sankey diagram shows the amount between source and target as band width", "생키 다이어그램으로 출발과 도착 사이 양을 띠 굵기로 보여 줘요"), rows, { source: src.name, target: dst.name, value: v0.name }));
  }

  // 시간
  const t0 = dates[0];
  if (t0 && v0) {
    // 범주는 x 하나에 값이 여럿 붙을 때만 계열이에요. 달마다 채널이 하나면 선을 쪼개지 않고 채널별 합계 막대를 따로 권해요
    const small = cats.filter((c) => c.distinct >= 2 && c.distinct <= 12);
    const seriesCat = small.find((c) => perX(rows, t0.name, c.name) >= 1.5);
    const attrCat = seriesCat ? undefined : small[0];
    const span = (t0.max ?? 0) - (t0.min ?? 0);
    // YYYYMMDD 숫자(20240315)와 ISO가 아닌 날짜 글자("2025.03.01")는 날짜로 읽으라고 적어요.
    // 차트도 날짜로 읽지만, 적어 두면 검사기가 "글자가 날짜가 됐어요" 경고를 내지 않아요 (선, 영역, 스트림만 xType을 받아요)
    const head = rows.slice(0, 50).map((r) => String(r[t0.name] ?? "").trim());
    const xt = head.some((v) => YMD.test(v) || (isDateText(v) && !ISO_DATE_RE.test(v))) ? { xType: "date" } : undefined;
    if (t0.daily && span > 86400000 * 60 && !seriesCat) out.push(mk("calendar", 0.9, t("Daily values over more than two months show weekday and seasonal patterns in a calendar heatmap", "하루 단위 값이 두 달 넘게 있어 캘린더 히트맵으로 요일, 계절 패턴이 보여요"), rows, { date: t0.name, value: v0.name }));
    if (seriesCat) {
      out.push(mk("line", 0.93, t(`Compares the ${t0.name} trend by ${seriesCat.name} (one highlighted line, the rest gray)`, `${t0.name} 흐름을 ${seriesCat.name}별로 비교해요(강조 한 줄, 나머지는 회색)`), rows, { x: t0.name, y: v0.name, series: seriesCat.name }, xt));
      out.push(mk("area", 0.8, t("If the series add up to something meaningful, stacked areas show how the mix changes", "계열 합이 의미 있으면 쌓은 영역으로 구성 변화를 봐요"), rows, { x: t0.name, y: v0.name, series: seriesCat.name }, xt));
      if (seriesCat.distinct >= 5) out.push(mk("stream", 0.72, t("With many series, a streamgraph can show the rhythm of the flow", "계열이 많아서 스트림그래프로 흐름의 리듬을 보여 줄 수 있어요"), rows, { x: t0.name, y: v0.name, series: seriesCat.name }, xt));
    } else {
      out.push(mk("line", 0.9, t(`A line chart shows ${v0.name} over ${t0.name}`, `라인 차트로 ${t0.name}에 따른 ${v0.name} 추이를 봐요`), rows, { x: t0.name, y: nums.length > 1 && nums.length <= 6 ? nums.map((c) => c.name) : v0.name }, nums.length <= 1 ? { ...xt, area: true } : xt));
      if (attrCat) {
        const [tn, cn] = [t0.name, attrCat.name];
        out.push(mk("bar", 0.85, t(`Each ${tn} has one ${cn}, so the line is not split by ${cn}. A bar adds up ${v0.name} by ${cn}`, `${tn}마다 ${cn} 값이 하나라 선을 ${cn}별로 나누지 않아요. 막대로 ${cn}별 ${v0.name} 합계를 보여 줘요`), rows, { x: cn, y: v0.name }, { aggregate: "sum", sort: true }));
      }
      out.push(mk("sparkline", 0.6, t("A sparkline fits the trend next to a KPI", "스파크라인으로 KPI 옆에 작은 추세선을 넣어요"), rows, { x: t0.name, y: v0.name }));
    }
  }

  // 순위 흐름
  const rk = ranksC[0];
  const timeCat = dates[0] ?? cats.find((c) => DATE_NAME.test(c.name));
  const item = cats.find((c) => c !== timeCat && c.distinct >= 3 && c.distinct <= 12);
  if (rk && timeCat && item) out.push(mk("bump", 0.94, t(`There is a ${rk.name} field, so a bump chart shows the rank changes`, `${rk.name} 필드가 있어서 범프 차트로 순위 변화를 보여 줘요`), rows, { x: timeCat.name, series: item.name, rank: rk.name }));

  // 범주 + 값
  const cat = cats.find((c) => c !== src && c !== dst && !STAGE_RE.test(c.name)) ?? cats[0];
  const stage = cats.find((c) => STAGE_RE.test(c.name));
  if (stage && v0 && !src) {
    const vals = rows.map((r) => toNumber(r[v0.name]));
    const decreasing = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
    if (decreasing) out.push(mk("funnel", 0.96, t("Values shrink at every stage, so a funnel shows the drop-off", "단계마다 값이 줄어서 퍼널 차트로 이탈을 보여 줘요"), rows, { label: stage.name, value: v0.name }));
  }
  if (cat && v0 && !t0 && !src) {
    const perCat = n / Math.max(1, cat.distinct);
    // 둘째 범주는 값이 둘 이상이고, 첫째도 모두 다른 이름이면 또 다른 이름 열(별명, 코드)이 아니어야 해요
    const second = cats.find((c) => c !== cat && c !== src && c !== dst && c.distinct >= 2 && !(c.unique && cat.unique));
    if (perCat >= 6 && !second) {
      out.push(mk("box", 0.86, t(`Each ${cat.name} has many values, so a box plot summarizes the distribution`, `${cat.name}마다 값이 여러 개라 분포를 박스 플롯으로 요약해요`), rows, { group: cat.name, value: v0.name }));
      out.push(mk("beeswarm", n <= 1500 ? 0.84 : 0.6, t("A beeswarm shows every single dot", "비스웜으로 점 하나하나를 보여 줘요"), rows, { group: cat.name, value: v0.name }));
      if (cat.distinct >= 4) out.push(mk("ridgeline", 0.8, t("With several groups, a ridgeline compares the shape of each distribution", "그룹이 여러 개라 릿지라인으로 분포 모양을 비교해요"), rows, { group: cat.name, value: v0.name }));
    } else if (second && cat.distinct <= 40) {
      const pairs = new Set(rows.map((r) => `${r[cat.name]}|${r[second.name]}`)).size;
      const parent = cat.distinct < second.distinct ? cat : second;
      const child = parent === cat ? second : cat;
      const childToParent = new Map<string, Set<string>>();
      rows.forEach((r) => {
        const k = String(r[child.name]);
        if (!childToParent.has(k)) childToParent.set(k, new Set());
        childToParent.get(k)!.add(String(r[parent.name]));
      });
      const hierarchical = [...childToParent.values()].every((s) => s.size === 1) && child.distinct > parent.distinct;
      const full = pairs >= cat.distinct * second.distinct * 0.8;
      if (hierarchical) {
        out.push(mk("treemap", 0.92, t(`${child.name} sits under ${parent.name}, so a treemap fits the hierarchy`, `${child.name} 필드가 ${parent.name} 필드 아래에 있는 계층이라 트리맵이 맞아요`), rows, { group: parent.name, label: child.name, value: v0.name }));
        out.push(mk("sunburst", 0.82, t("A sunburst shows the same hierarchy in rings", "선버스트로 같은 계층을 고리 모양으로 보여 줘요"), rows, { group: parent.name, label: child.name, value: v0.name }));
      } else if (full) {
        const rowsCat = cat.distinct <= second.distinct ? cat : second;
        const colsCat = rowsCat === cat ? second : cat;
        out.push(mk("heatmap", 0.88, t(`The ${rowsCat.name} × ${colsCat.name} grid is full, so a heatmap shows the pattern`, `${rowsCat.name} × ${colsCat.name} 격자가 꽉 차 있어 히트맵으로 패턴을 봐요`), rows, { x: colsCat.name, y: rowsCat.name, value: v0.name }));
        if (colsCat.distinct <= 6 && rowsCat.distinct <= 5) out.push(mk("marimekko", 0.74, t("A marimekko shows the column share and the share within each column together", "마리메코 차트로 열 비중과 열 안 비중을 함께 보여 줘요"), rows, { x: colsCat.name, series: rowsCat.name, value: v0.name }));
        if (rowsCat.distinct <= 4) out.push(mk("bar", 0.8, t("Grouped bars compare each series by category", "범주별로 계열을 묶은 막대로 비교해요"), rows, { x: colsCat.name, y: v0.name, series: rowsCat.name }));
        const periodsC = [cat, second].find((c) => c.distinct === 2);
        const other = periodsC === cat ? second : cat;
        if (periodsC) out.push(mk("slope", 0.86, t(`${periodsC.name} has only two values, so a slope chart shows the change`, `${periodsC.name} 값이 두 개뿐이라 슬로프 차트로 변화를 보여 줘요`), rows, { label: other.name, x: periodsC.name, value: v0.name }));
        if (colsCat.distinct >= 4 && colsCat.distinct <= 10 && rowsCat.distinct <= 3) out.push(mk("radar", 0.7, t("A radar chart compares several metrics by series", "레이더 차트로 지표 여러 개를 계열별로 비교해요"), rows, { axis: colsCat.name, series: rowsCat.name, value: v0.name }));
      }
    } else {
      const k = cat.distinct;
      const vals = rows.map((r) => toNumber(r[v0.name])).filter(Number.isFinite);
      const allPos = vals.every((v) => v >= 0);
      const hasNeg = vals.some((v) => v < 0);
      const sorted = [...vals].sort((a, b) => b - a);
      const tot = sorted.reduce((a, b) => a + b, 0) || 1;
      const top20 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.2))).reduce((a, b) => a + b, 0) / tot;
      // 폭포 차트는 시작이나 끝(이름이나 기간 라벨, 합계 표시 열)이 있을 때만 앞서요. 없으면 순서 없는 조각이라 막대가 나아요
      const first = String(rows[0]?.[cat.name] ?? "").trim();
      const last = String(rows[rows.length - 1]?.[cat.name] ?? "").trim();
      const ends = WATERFALL_START.test(first) || WATERFALL_END.test(last) || (isPeriod(first) && isPeriod(last)) || cats.some((c) => c !== cat && rows.some((r) => TOTAL_WORD.test(String(r[c.name]))));
      if (hasNeg && n >= 3) out.push(mk("waterfall", ends ? 0.9 : 0.78, t("Positive and negative values are mixed, so a waterfall separates the ups and downs", "양수와 음수가 섞여 있어 폭포 차트로 증감을 나눠요"), rows, { label: cat.name, value: v0.name }));
      if (allPos && k >= 2 && k <= 4) {
        out.push(mk("pie", 0.88, t(`With ${k} items, a pie chart shows the shares at a glance`, `항목이 ${k}개라 파이 차트로 비중이 바로 보여요`), rows, { label: cat.name, value: v0.name }));
        out.push(mk("donut", 0.86, t("A donut chart adds the total in the center", "도넛 차트로 가운데에 합계를 함께 보여 줘요"), rows, { label: cat.name, value: v0.name }));
        if (k <= 3) out.push(mk("waffle", 0.75, t("A waffle chart shows it in 100 cells, like a head count", "와플 차트로 100칸 중 몇 칸인지 사람 수처럼 보여 줘요"), rows, { label: cat.name, value: v0.name }));
      }
      if (allPos && k >= 5 && k <= 7) out.push(mk("donut", 0.7, t("A few more items, but a donut chart can still show the shares", "항목이 조금 많지만 도넛 차트로 비중을 볼 수 있어요"), rows, { label: cat.name, value: v0.name }));
      if (k > 12 && cat.unique) out.push(topBars(rows, cat.name, v0.name, t));
      else out.push(mk("bar", k <= 12 ? 0.85 : 0.7, t("A bar chart compares sizes across categories most accurately", "막대 차트로 범주끼리 크기를 가장 정확하게 비교해요"), rows, { x: cat.name, y: v0.name }, k > 8 ? { orientation: "horizontal", sort: true } : undefined));
      if (k >= 6 && k <= 20) out.push(mk("lollipop", 0.82, t("Many items, so a lollipop chart stays light", "항목이 많아도 롤리팝 차트는 가볍게 보여요"), rows, { label: cat.name, value: v0.name }));
      if (allPos && k >= 6 && top20 >= 0.5) out.push(mk("pareto", 0.86, t(`The top 20% make up ${Math.round(top20 * 100)}%, so a Pareto chart shows the concentration`, `상위 20%가 ${Math.round(top20 * 100)}%를 차지해서 파레토 차트로 집중도를 보여 줘요`), rows, { label: cat.name, value: v0.name }));
      if (allPos && k >= 6 && k <= 40) out.push(mk("treemap", 0.66, t("A treemap shows the shares as area", "트리맵으로 비중을 넓이로 보여 줘요"), rows, { label: cat.name, value: v0.name }));
      if (allPos && vals.every((v) => v <= 100) && k <= 6) out.push(mk("radialBar", 0.66, t("Values from 0 to 100 read as progress rings", "0~100 사이 값이라 달성률 고리로 보여 줘요"), rows, { label: cat.name, value: v0.name }));
    }
  }

  // 두 숫자 (전후)
  if (cat && nums.length >= 2 && !t0) {
    const a = nums.find((c) => BEFORE_RE.test(c.name));
    const b = nums.find((c) => AFTER_RE.test(c.name) && c !== a);
    const tg = nums.find((c) => TARGET_KPI.test(c.name));
    if (a && b) {
      out.push(mk("dumbbell", 0.9, t(`A dumbbell chart shows the gap between ${a.name} and ${b.name}`, `덤벨 차트로 ${a.name} 값과 ${b.name} 값의 차이를 보여 줘요`), rows, { label: cat.name, start: a.name, end: b.name }));
      out.push(mk("slope", 0.82, t("A slope chart shows the change between two points in time", "슬로프 차트로 두 시점 사이 변화를 보여 줘요"), rows, { label: cat.name }, { start: a.name, end: b.name }));
    }
    if (tg) {
      const actual = nums.find((c) => c !== tg && !/(poor|ok|good|나쁨|보통|좋음)/i.test(c.name));
      if (actual) out.push(mk("bullet", 0.88, t("There is a target field, so a bullet chart shows attainment", "목표 필드가 있어서 불릿 차트로 목표 달성 정도를 보여 줘요"), rows, { label: cat.name, value: actual.name, target: tg.name }));
    }
  }
  if (nums.length >= 1 && n === 1) {
    const tg = nums.find((c) => TARGET_KPI.test(c.name));
    const val = nums.find((c) => c !== tg) ?? nums[0];
    out.push(mk("gauge", 0.95, t("A single value works best as a large gauge", "값이 하나라서 게이지로 크게 보여 줘요"), rows, { value: val.name, ...(tg ? { target: tg.name } : {}) }));
  }

  // 관계
  if (nums.length >= 2 && !src) {
    const label = cats[0] ?? cols.find((c) => c.kind === "text");
    // 행이 6개보다 적으면 관계를 보기 어려워 점수를 낮추고, x·y 이름 열, 값 열 셋 이상, 20행 이상이면 관계가 분명해요
    const nx = nums.find((c) => /^x$/i.test(c.name));
    const ny = nums.find((c) => /^y$/i.test(c.name));
    const named = !!nx && !!ny;
    if (nums.length >= 4 && n <= 20000) out.push(mk("parallel", n < 6 ? 0.6 : nums.length >= 5 ? 0.84 : 0.7, t(`${nums.length} numeric metrics, so parallel coordinates compare them one line per row`, `숫자 지표가 ${nums.length}개라 평행 좌표로 한 줄씩 비교해요`), rows, label ? { label: label.name } : {}, { dimensions: nums.slice(0, 8).map((c) => c.name) }));
    const xs = named ? nx : nums[0];
    const ys = named ? ny : nums[1];
    const third = named ? undefined : nums[2];
    const enc: Record<string, string> = { x: xs.name, y: ys.name };
    if (third) enc.size = third.name;
    if (label) enc.label = label.name;
    out.push(mk(third ? "bubble" : "scatter", n < 6 ? 0.7 : named || nums.length >= 3 || n >= 20 ? 0.88 : 0.8, third ? t(`A bubble chart shows ${xs.name}, ${ys.name} and ${third.name} together`, `버블 차트로 ${xs.name}, ${ys.name}, ${third.name} 세 값을 함께 보여 줘요`) : t(`A scatter plot shows how ${xs.name} relates to ${ys.name}`, `산점도로 ${xs.name} 값과 ${ys.name} 값의 관계를 보여 줘요`), rows, enc));
  }

  // 같은 타입은 가장 높은 점수만
  const best = new Map<string, Suggestion>();
  for (const s of out) {
    const prev = best.get(s.type);
    if (!prev || s.score > prev.score) best.set(s.type, s);
  }
  const suggestions = [...best.values()].sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 5).map((s) => inLang(s, lang));
  return { profile, suggestions };
}
