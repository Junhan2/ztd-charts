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
  /** Whether the dates are spaced in whole days */
  daily?: boolean;
  /** Has two or more values, all different (item names, sequence numbers) */
  unique?: boolean;
  /** Numbers never decrease in row order (time steps, sequence numbers) */
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
/** A YYYYMMDD number or string (20240315) */
const YMD = /^\d{8}$/;
const RANK_RE = /(rank|순위|등수)/i;
const STAGE_RE = /(stage|step|funnel|단계|스텝)/i;
const PARENT_RE = /^(parent|manager|reports_?to|부모|상위)/i;
const BEFORE_RE = /(before|prev|start|이전|전|작년|기존|old)/i;
const AFTER_RE = /(after|next|end|이후|후|올해|신규|new)/i;
const TARGET_KPI = /(target|goal|목표)/i;
/** Names of the start and end date columns of a timeline */
const SPAN_START = /(start|begin|from|opened|시작|착수)/i;
const SPAN_END = /(end|finish|until|due|closed|stop|끝|종료|마감)/i;
/** Markers that Excel and others put in empty cells ("-", "n/a", "#N/A", "null") */
const MISSING = /^(-|—|–|n\/?a|#n\/a|na|null|nan|none)$/i;
/** Names of identifiers rather than sequence numbers, so they are not used as x */
const ID_NAME = /^(id|no|번호|#|key|코드|code)$/i;
/** Start and end labels of a waterfall chart (without them, the values are unordered parts, not changes) */
const WATERFALL_START = /^(시작|start|begin|opening|기초|전월|작년|이전|prev)/i;
const WATERFALL_END = /^(끝|end|합계|total|closing|현재|이번)/i;
/** Period labels: years, quarters, "3월", English month names (prefixes too, but not "Marketing") */
const isPeriod = (s: string) => /^(\d{4}|q[1-4])$/i.test(s) || MONTH_KO.test(s) || monthOf(s) > 0;
const TOTAL_WORD = /^(total|합계|시작|start|end|끝)$/i;
/** Number of top items shown as bars when there are many items */
const TOP_N = 7;

export function profileData(rows: readonly Record<string, unknown>[]): DataProfile {
  const sample = rows.slice(0, 5000);
  const names = uniq(sample.slice(0, 200).flatMap((r) => Object.keys(r ?? {})));
  const columns = names.map((name): ColumnProfile => {
    const vals = sample.map((r) => r?.[name]);
    // Empty-cell markers such as "-" and "n/a" count as empty too (they are empty when drawn as well)
    const present = vals.filter((v) => v !== null && v !== undefined && v !== "" && !(typeof v === "string" && MISSING.test(v.trim())));
    const nulls = vals.length - present.length;
    const nums = present.map((v) => toNumber(v));
    const numOk = present.length ? nums.filter(Number.isFinite).length / present.length : 0;
    const distinct = new Set(present.map((v) => String(v))).size;
    const unique = present.length > 1 && distinct === present.length;
    // "1월"…"12월" are ordered time values (not pie slices)
    if (present.length && present.every((v) => typeof v === "string" && MONTH_KO.test(v.trim()))) return { name, kind: "date", distinct, nulls, daily: false, unique };
    // Year columns (2019) and YYYYMMDD numbers in a column named like a date (20240315) are time too
    const years = YEAR_NAME.test(name) && nums.every(isYear);
    const compact = years || (DATE_NAME.test(name) && present.every((v) => YMD.test(String(v).trim()) && toDate(v)));
    // Same notations the charts read as a date axis (dots, Korean style, quarters, English month names)
    const looksDate = present.length > 0 && (compact || (present.every((v) => v instanceof Date || (typeof v === "string" && isDateText(v.trim()))) && present.filter((v) => toDate(v)).length / present.length > 0.9));
    if (looksDate) {
      const ts = present.map((v) => toDate(v)?.getTime() ?? NaN).filter(Number.isFinite).sort((a, b) => a - b);
      const gaps = ts.slice(1).map((t, i) => t - ts[i]).filter((g) => g > 0);
      const med = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
      return { name, kind: "date", distinct, nulls, min: ts[0], max: ts[ts.length - 1], daily: med > 0 && med <= 86400000 * 1.5, unique };
    }
    // Same rule as the validator: over half numbers makes a numeric column, and the remaining text is drawn as empty
    if (numOk >= 0.5 && !(typeof present[0] === "string" && /^0\d/.test(String(present[0])))) {
      const f = nums.filter(Number.isFinite);
      return { name, kind: "number", distinct, nulls, min: Math.min(...f), max: Math.max(...f), negatives: f.some((v) => v < 0), integer: f.every((v) => Number.isInteger(v)), unique, sorted: f.every((v, i) => i === 0 || v >= f[i - 1]) };
    }
    const avgLen = present.reduce<number>((a, v) => a + String(v).length, 0) / Math.max(1, present.length);
    // Short names that are all different are item names, so they are a category even when there are hundreds
    return { name, kind: (distinct <= Math.max(60, present.length * 0.6) || unique) && avgLen < 40 ? "category" : "text", distinct, nulls, unique };
  });
  return { rows: rows.length, columns };
}

/** Average number of category values per x. Close to 1 means the category is an attribute of x, so it is not split into series (first 5,000 rows) */
function perX(rows: readonly Record<string, unknown>[], x: string, c: string): number {
  const sample = rows.slice(0, 5000);
  const xs = new Set(sample.map((r) => String(r[x])));
  // Prefix the x length so a pair never collides with another wherever the boundary between x and the category value falls
  const pairs = new Set(sample.map((r) => `${String(r[x]).length}:${String(r[x])}${String(r[c])}`));
  return pairs.size / Math.max(1, xs.size);
}

function mk(type: string, score: number, reason: string, rows: readonly Record<string, unknown>[], encoding: Record<string, string | string[]>, options?: Record<string, unknown>): Suggestion {
  const def = getChartDef(type)!;
  return { type, name: def.name, score: Math.round(score * 100) / 100, reason, spec: { type, data: rows.slice(0, 5000) as Record<string, unknown>[], encoding, ...(options ? { options } : {}), card: { title: def.name, takeaway: def.summary, level: def.level } } };
}

/**
 * With many items (more than 12 distinct names), the top 7 as horizontal bars. When the rest sum to less than the largest bar, they are added as one "Other" row;
 * when larger, the bars would flatten, so only the top 8 are kept and the rest dropped. The spec data is those 8 rows (within the 8 rows MCP shows)
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

/** One suggestion's chart name, card title and summary in that language. A Korean spec also gets options.locale "ko-KR" */
function inLang(s: Suggestion, lang: Lang): Suggestion {
  if (lang === "en") return s;
  const def = localizeDef(getChartDef(s.type)!, lang);
  return { ...s, name: def.name, spec: withKoLocale({ ...s.spec, card: { ...s.spec.card, title: def.name, takeaway: def.summary } }) };
}

/**
 * Suggests fitting charts in score order from the shape of the data.
 * The reason, chart name and card text are English; with { lang: "ko" } they are Korean and the spec's options.locale is "ko-KR".
 */
export function suggestCharts(rows: readonly Record<string, unknown>[], opts: { limit?: number; lang?: Lang } = {}): { profile: DataProfile; suggestions: Suggestion[] } {
  const lang = opts.lang ?? "en";
  /** The English and Korean versions of the same reason */
  const t = (en: string, ko: string) => (lang === "ko" ? ko : en);
  const profile = profileData(rows);
  const cols = profile.columns;
  const n = profile.rows;
  // Value columns with fewer empty cells first
  const numsAll = cols.filter((c) => c.kind === "number" && !RANK_RE.test(c.name)).sort((a, b) => a.nulls - b.nulls);
  const ranksC = cols.filter((c) => c.kind === "number" && RANK_RE.test(c.name));
  // With no date column and two or more value columns, a numeric column that never decreases and has all different values (20+ rows, not an identifier name) is a time-step x
  const seq = cols.some((c) => c.kind === "date") || numsAll.length < 2 || n < 20 ? undefined : numsAll.find((c) => c.sorted && c.unique && !ID_NAME.test(c.name));
  const dates = seq ? [seq] : cols.filter((c) => c.kind === "date");
  const nums = numsAll.filter((c) => c !== seq);
  const cats = cols.filter((c) => c.kind === "category");
  const out: Suggestion[] = [];
  const v0 = nums[0];
  if (!n || !cols.length) return { profile, suggestions: [] };

  // Flow: source/target
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
  // A network draws even without values (1 per row). With more than 10 nodes it is easier to read than sankey or chord
  if (src && dst) {
    const nodes = new Set(rows.flatMap((r) => [String(r[src.name]), String(r[dst.name])])).size;
    const strong = nodes > 10 || !v0;
    out.push(
      mk(
        "network",
        strong ? 0.9 : 0.7,
        strong ? t(`${nodes} nodes linked by ${src.name}→${dst.name}: a network shows who is connected to whom and who is central`, `${src.name}→${dst.name}로 이어진 노드 ${nodes}개: 네트워크로 누가 누구와 이어져 있고 누가 가운데인지 보여 줘요`) : t("A network shows the structure of the links rather than their amount", "네트워크로 흐름의 양보다 이어진 모양을 보여 줘요"),
        rows,
        { source: src.name, target: dst.name, ...(v0 && { value: v0.name }) },
      ),
    );
  }

  // Start and end: two date columns named start and end plus a name column make a timeline (schedules, run logs)
  const startC = dates.find((c) => SPAN_START.test(c.name));
  const endC = dates.find((c) => c !== startC && SPAN_END.test(c.name));
  const itemC = cats.find((c) => c.distinct >= 2) ?? cols.find((c) => c.kind === "text");
  if (startC && endC && itemC) {
    const statusC = cats.find((c) => c !== itemC && c.distinct >= 2 && c.distinct <= 8);
    out.push(mk("timeline", 0.94, t(`${startC.name} and ${endC.name} mark when each ${itemC.name} ran, so a timeline shows what ran when and what overlapped`, `${startC.name}부터 ${endC.name}까지 ${itemC.name}마다 언제 이어졌는지라서 타임라인으로 무엇이 언제, 겹쳐서 이어졌는지 보여 줘요`), rows, { label: itemC.name, start: startC.name, end: endC.name, ...(statusC ? { group: statusC.name } : {}) }));
  }

  // Hierarchy: id and parent id (org charts, folder tables). When most parent cells are values of the id column, it is a tree
  const parentCol = cols.find((c) => PARENT_RE.test(c.name));
  const idCol = parentCol && cols.find((c) => c !== parentCol && c.unique);
  if (parentCol && idCol) {
    const ids = new Set(rows.map((r) => String(r[idCol.name])));
    const refs = rows.map((r) => r[parentCol.name]).filter((v) => v !== null && v !== undefined && v !== "");
    if (refs.length && refs.filter((v) => ids.has(String(v))).length >= refs.length * 0.8) {
      const name = cats.find((c) => c !== idCol && c !== parentCol && c.unique) ?? idCol;
      out.push(mk("tree", 0.95, t(`Each row points to its ${parentCol.name}, so a tree draws the structure`, `행마다 ${parentCol.name} 값으로 부모를 가리켜서 트리로 구조를 그려요`), rows, { label: name.name, id: idCol.name, parent: parentCol.name }));
    }
  }

  // Time
  const t0 = dates[0];
  if (t0 && v0) {
    // A category is a series only when several of its values attach to one x. With one channel per month, the line is not split; a separate bar of totals per channel is suggested instead
    const small = cats.filter((c) => c.distinct >= 2 && c.distinct <= 12);
    const seriesCat = small.find((c) => perX(rows, t0.name, c.name) >= 1.5);
    const attrCat = seriesCat ? undefined : small[0];
    const span = (t0.max ?? 0) - (t0.min ?? 0);
    // YYYYMMDD numbers (20240315) and non-ISO date strings ("2025.03.01") are marked to be read as dates.
    // The charts read them as dates anyway, but marking them keeps the validator from warning that "text became dates" (only line, area and stream accept xType)
    const head = rows.slice(0, 50).map((r) => String(r[t0.name] ?? "").trim());
    const xt = head.some((v) => YMD.test(v) || (isDateText(v) && !ISO_DATE_RE.test(v))) ? { xType: "date" } : undefined;
    if (t0.daily && span > 86400000 * 60 && !seriesCat) out.push(mk("calendar", 0.9, t("Daily values over more than two months show weekday and seasonal patterns in a calendar heatmap", "하루 단위 값이 두 달 넘게 있어 캘린더 히트맵으로 요일, 계절 패턴이 보여요"), rows, { date: t0.name, value: v0.name }));
    if (seriesCat) {
      out.push(mk("line", 0.93, t(`Compares the ${t0.name} trend by ${seriesCat.name} (one highlighted line, the rest gray)`, `${t0.name} 흐름을 ${seriesCat.name}별로 비교해요(강조 한 줄, 나머지는 회색)`), rows, { x: t0.name, y: v0.name, series: seriesCat.name }, xt));
      out.push(mk("area", 0.8, t("If the series add up to something meaningful, stacked areas show how the mix changes", "계열 합이 의미 있으면 쌓은 영역으로 구성 변화를 봐요"), rows, { x: t0.name, y: v0.name, series: seriesCat.name }, xt));
      if (seriesCat.distinct >= 5) out.push(mk("stream", 0.72, t("With many series, a streamgraph can show the rhythm of the flow", "계열이 많아서 스트림그래프로 흐름의 리듬을 보여 줄 수 있어요"), rows, { x: t0.name, y: v0.name, series: seriesCat.name }, xt));
      if (seriesCat.distinct >= 5) out.push(mk("barRace", 0.62, t(`To tell how the ${seriesCat.name} ranking changed in a talk or a video, a bar race plays it step by step`, `${seriesCat.name} 순위가 바뀐 이야기를 발표나 영상으로 전하려면 막대 레이스로 시점마다 재생해요`), rows, { label: seriesCat.name, value: v0.name, frame: t0.name }));
    } else {
      out.push(mk("line", 0.9, t(`A line chart shows ${v0.name} over ${t0.name}`, `라인 차트로 ${t0.name}에 따른 ${v0.name} 추이를 봐요`), rows, { x: t0.name, y: nums.length > 1 && nums.length <= 6 ? nums.map((c) => c.name) : v0.name }, nums.length <= 1 ? { ...xt, area: true } : xt));
      if (attrCat) {
        const [tn, cn] = [t0.name, attrCat.name];
        out.push(mk("bar", 0.85, t(`Each ${tn} has one ${cn}, so the line is not split by ${cn}. A bar adds up ${v0.name} by ${cn}`, `${tn}마다 ${cn} 값이 하나라 선을 ${cn}별로 나누지 않아요. 막대로 ${cn}별 ${v0.name} 합계를 보여 줘요`), rows, { x: cn, y: v0.name }, { aggregate: "sum", sort: true }));
      }
      out.push(mk("sparkline", 0.6, t("A sparkline fits the trend next to a KPI", "스파크라인으로 KPI 옆에 작은 추세선을 넣어요"), rows, { x: t0.name, y: v0.name }));
    }
  }

  // Rank flow
  const rk = ranksC[0];
  const timeCat = dates[0] ?? cats.find((c) => DATE_NAME.test(c.name));
  const item = cats.find((c) => c !== timeCat && c.distinct >= 3 && c.distinct <= 12);
  if (rk && timeCat && item) out.push(mk("bump", 0.94, t(`There is a ${rk.name} field, so a bump chart shows the rank changes`, `${rk.name} 필드가 있어서 범프 차트로 순위 변화를 보여 줘요`), rows, { x: timeCat.name, series: item.name, rank: rk.name }));

  // Category + value
  const cat = cats.find((c) => c !== src && c !== dst && !STAGE_RE.test(c.name)) ?? cats[0];
  const stage = cats.find((c) => STAGE_RE.test(c.name));
  if (stage && v0 && !src) {
    const vals = rows.map((r) => toNumber(r[v0.name]));
    const decreasing = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
    if (decreasing) out.push(mk("funnel", 0.96, t("Values shrink at every stage, so a funnel shows the drop-off", "단계마다 값이 줄어서 퍼널 차트로 이탈을 보여 줘요"), rows, { label: stage.name, value: v0.name }));
  }
  if (cat && v0 && !t0 && !src) {
    const perCat = n / Math.max(1, cat.distinct);
    // A second category needs two or more values, and when the first also has all-different names, it must not be just another name column (alias, code)
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
        out.push(mk("tree", 0.7, t(`A tree shows which ${child.name} sits under which ${parent.name}, when the links matter more than the shares`, `몫보다 어느 ${child.name}이 어느 ${parent.name} 아래에 있는지가 중요하면 트리로 이어짐을 보여 줘요`), rows, { group: parent.name, label: child.name }));
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
      // Waterfall ranks first only when there is a start or end (a name or period label, a total-marker column). Without one, the values are unordered parts, so bars are better
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

  // Two numbers (before and after)
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

  // Relationship
  if (nums.length >= 2 && !src) {
    const label = cats[0] ?? cols.find((c) => c.kind === "text");
    // With fewer than 6 rows a relationship is hard to see, so the score drops; columns named x and y, three or more value columns, or 20+ rows make the relationship clear
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

  // Keep only the highest score per type
  const best = new Map<string, Suggestion>();
  for (const s of out) {
    const prev = best.get(s.type);
    if (!prev || s.score > prev.score) best.set(s.type, s);
  }
  const suggestions = [...best.values()].sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 5).map((s) => inLang(s, lang));
  return { profile, suggestions };
}
