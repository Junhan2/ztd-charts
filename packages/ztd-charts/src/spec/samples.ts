/**
 * 차트마다 쓰는 예시 데이터. 모두 가상의 값이에요.
 * 기본 이름(pieSample …)은 영어 라벨이고, 숫자가 같은 한글판은 이름 끝에 Ko가 붙어요(pieSampleKo …).
 * 한글판은 영어판의 글자만 바꿔 만들어요 (relabel, 넓은 표의 필드 이름은 rekey, 또는 언어마다 이름을 받는 빌더).
 * 글자가 없는 sparkline, calendar, box, candlestick, histogram 예시는 한 벌이에요. 차트 타입으로 고르려면 localizeDef(def, lang).example.data.
 * 문서, 테스트, CLI init, MCP 예시가 같이 써요.
 */

/**
 * 행마다 글자 값을 ko(영어 -> 한글)로 바꾼 사본. 숫자, 필드, 키 순서는 그대로이고 ko에 없는 글자("PMax" 등)도 그대로예요.
 * 부르는 곳마다 앞에 PURE 표시를 달아서 쓰지 않는 한글판은 번들에서 빠져요
 */
function relabel<T extends object>(rows: readonly T[], ko: Record<string, string>): T[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) out[k] = typeof v === "string" && typeof ko[v] === "string" ? ko[v] : v;
    return out as T;
  });
}

/** 객체 열쇠를 한글로 (흐름 지도 자리 이름표). 값은 그대로예요 */
/* @__NO_SIDE_EFFECTS__ */
function relabelKeys<V>(obj: Record<string, V>, ko: Record<string, string>): Record<string, V> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [ko[k] ?? k, v]));
}

/**
 * 행마다 필드 이름을 ko(영어 -> 한글)로 바꾼 사본. 넓은 표(스카이라인)는 필드 이름이 곧 계열 이름이라 한글판은 필드 이름을 바꿔요.
 * 값, 키 순서, 행 수는 그대로예요
 */
function rekey<T extends object>(rows: readonly T[], ko: Record<string, string>): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [ko[k] ?? k, v])));
}

export const pieSample = [
  { device: "Mobile", sales: 72 },
  { device: "Desktop", sales: 23 },
  { device: "Tablet", sales: 5 },
];
export const pieSampleKo = /* @__PURE__ */ relabel(pieSample, { Mobile: "모바일", Desktop: "PC", Tablet: "태블릿" });

export const donutSample = [
  { type: "Purchase", count: 719 },
  { type: "Sign-up", count: 260 },
  { type: "Inquiry", count: 161 },
  { type: "Call", count: 100 },
];
export const donutSampleKo = /* @__PURE__ */ relabel(donutSample, { Purchase: "구매", "Sign-up": "회원가입", Inquiry: "문의", Call: "전화" });

export const funnelSample = [
  { stage: "Visit", users: 10000 },
  { stage: "Product view", users: 6200 },
  { stage: "Cart", users: 1900 },
  { stage: "Purchase", users: 760 },
];
export const funnelSampleKo = /* @__PURE__ */ relabel(funnelSample, { Visit: "방문", "Product view": "상품 조회", Cart: "장바구니", Purchase: "구매" });

export const waffleSample = [
  { segment: "New", customers: 38 },
  { segment: "Returning", customers: 62 },
];
export const waffleSampleKo = /* @__PURE__ */ relabel(waffleSample, { New: "신규", Returning: "재구매" });

/** 반원 와플(shape "arc", total 400) 예시: 400석 공연장에서 표 종류별로 팔린 좌석. 남은 100석은 빈자리예요 */
export const seatSample = [
  { ticket: "Early bird", seats: 118 },
  { ticket: "Standard", seats: 96 },
  { ticket: "Group", seats: 64 },
  { ticket: "VIP", seats: 22 },
];
export const seatSampleKo = /* @__PURE__ */ relabel(seatSample, { "Early bird": "얼리버드", Standard: "일반", Group: "단체" });

export const treemapSample = [
  { category: "Running shoes", product: "Cushion Run", share: 22 },
  { category: "Running shoes", product: "Race X", share: 14 },
  { category: "Running shoes", product: "Daily Run", share: 10 },
  { category: "Outdoor", product: "Trail", share: 14 },
  { category: "Outdoor", product: "Hiking boots", share: 10 },
  { category: "Apparel", product: "Jacket", share: 11 },
  { category: "Apparel", product: "T-shirt", share: 7 },
  { category: "Gear", product: "Socks", share: 7 },
  { category: "Gear", product: "Insoles", share: 5 },
];
export const treemapSampleKo = /* @__PURE__ */ relabel(treemapSample, {
  "Running shoes": "러닝화",
  Outdoor: "아웃도어",
  Apparel: "의류",
  Gear: "용품",
  "Cushion Run": "쿠셔닝 런",
  "Race X": "레이스 엑스",
  "Daily Run": "데일리 런",
  Trail: "트레일",
  "Hiking boots": "등산화",
  Jacket: "재킷",
  "T-shirt": "티셔츠",
  Socks: "양말",
  Insoles: "깔창",
});

export const sunburstSample = [
  { channel: "Search", campaign: "Brand", spend: 18 },
  { channel: "Search", campaign: "Generic", spend: 30 },
  { channel: "PMax", campaign: "All products", spend: 25 },
  { channel: "PMax", campaign: "Bestsellers", spend: 12 },
  { channel: "YouTube", campaign: "Remarketing", spend: 9 },
  { channel: "YouTube", campaign: "New users", spend: 6 },
];
export const sunburstSampleKo = /* @__PURE__ */ relabel(sunburstSample, { Search: "검색", YouTube: "유튜브", Brand: "브랜드", Generic: "일반", "All products": "전체 상품", Bestsellers: "베스트", Remarketing: "리마케팅", "New users": "신규" });

export const waterfallSample = [
  { item: "Sep", amount: 3200, kind: "total" },
  { item: "New", amount: 1100 },
  { item: "Repeat", amount: 450 },
  { item: "Discounts", amount: -380 },
  { item: "Refunds", amount: -270 },
  { item: "Oct", kind: "total" },
];
export const waterfallSampleKo = /* @__PURE__ */ relabel(waterfallSample, { Sep: "9월", New: "신규", Repeat: "재구매", Discounts: "할인", Refunds: "환불", Oct: "10월" });

export const paretoSample = [
  { keyword: "running shoes", spend: 54 },
  { keyword: "marathon shoes", spend: 25 },
  { keyword: "best sneakers", spend: 7 },
  { keyword: "cushioned shoes", spend: 4 },
  { keyword: "trail shoes", spend: 3 },
  { keyword: "light shoes", spend: 2.5 },
  { keyword: "running socks", spend: 2 },
  { keyword: "insoles", spend: 1.2 },
  { keyword: "running belt", spend: 0.8 },
  { keyword: "wristband", spend: 0.5 },
];
export const paretoSampleKo = /* @__PURE__ */ relabel(paretoSample, {
  "running shoes": "러닝화",
  "marathon shoes": "마라톤화",
  "best sneakers": "운동화 추천",
  "cushioned shoes": "쿠션화",
  "trail shoes": "트레일화",
  "light shoes": "경량화",
  "running socks": "러닝 양말",
  insoles: "깔창",
  "running belt": "러닝 벨트",
  wristband: "아대",
});

export const marimekkoSample = [
  { channel: "Search", device: "Mobile", sales: 26.1 },
  { channel: "Search", device: "Desktop", sales: 16.2 },
  { channel: "Search", device: "Tablet", sales: 2.7 },
  { channel: "PMax", device: "Mobile", sales: 25.9 },
  { channel: "PMax", device: "Desktop", sales: 7.7 },
  { channel: "PMax", device: "Tablet", sales: 1.4 },
  { channel: "Social", device: "Mobile", sales: 17.6 },
  { channel: "Social", device: "Desktop", sales: 1.8 },
  { channel: "Social", device: "Tablet", sales: 0.6 },
];
export const marimekkoSampleKo = /* @__PURE__ */ relabel(marimekkoSample, { Search: "검색", Social: "SNS", Mobile: "모바일", Desktop: "PC", Tablet: "태블릿" });

function heatmapRows(days: readonly string[], hours: readonly string[]) {
  return days.flatMap((day, di) =>
    hours.map((hour, hi) => {
      const base = [2, 1, 3, 14, 22, 18, 26, 31][hi];
      const weekend = di >= 5 ? (hi >= 4 ? 1.35 : 0.8) : 1;
      const fri = di === 4 && hi >= 6 ? 1.3 : 1;
      const v = Math.round(base * weekend * fri * (0.9 + ((di * 7 + hi * 3) % 5) * 0.06));
      return { day, hour, orders: v };
    }),
  );
}
/** 요일 x 시간대 주문 수 */
export const heatmapSample = /* @__PURE__ */ heatmapRows(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], ["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm"]);
export const heatmapSampleKo = /* @__PURE__ */ heatmapRows(["월", "화", "수", "목", "금", "토", "일"], ["0시", "3시", "6시", "9시", "12시", "15시", "18시", "21시"]);

export const radarSample = [
  { metric: "Speed", product: "Our app", score: 86 },
  { metric: "Stability", product: "Our app", score: 78 },
  { metric: "Design", product: "Our app", score: 92 },
  { metric: "Price", product: "Our app", score: 64 },
  { metric: "Support", product: "Our app", score: 70 },
  { metric: "Features", product: "Our app", score: 81 },
  { metric: "Speed", product: "Industry average", score: 72 },
  { metric: "Stability", product: "Industry average", score: 74 },
  { metric: "Design", product: "Industry average", score: 68 },
  { metric: "Price", product: "Industry average", score: 71 },
  { metric: "Support", product: "Industry average", score: 66 },
  { metric: "Features", product: "Industry average", score: 75 },
];
export const radarSampleKo = /* @__PURE__ */ relabel(radarSample, { Speed: "속도", Stability: "안정성", Design: "디자인", Price: "가격", Support: "지원", Features: "기능", "Our app": "우리 앱", "Industry average": "업계 평균" });

export const bubbleSample = [
  { campaign: "Brand search", cpc: 420, roas: 680, spend: 1800 },
  { campaign: "Generic search", cpc: 780, roas: 310, spend: 4200 },
  { campaign: "PMax all", cpc: 560, roas: 520, spend: 3600 },
  { campaign: "PMax best", cpc: 610, roas: 430, spend: 1500 },
  { campaign: "YouTube new", cpc: 340, roas: 180, spend: 2100 },
  { campaign: "Remarketing", cpc: 290, roas: 610, spend: 900 },
  { campaign: "Insta feed", cpc: 470, roas: 260, spend: 2600 },
  { campaign: "Insta reels", cpc: 390, roas: 340, spend: 1700 },
  { campaign: "Kakao biz", cpc: 520, roas: 240, spend: 1200 },
  { campaign: "Naver shopping", cpc: 690, roas: 470, spend: 2900 },
];
export const bubbleSampleKo = /* @__PURE__ */ relabel(bubbleSample, {
  "Brand search": "브랜드 검색",
  "Generic search": "일반 검색",
  "PMax all": "PMax 전체",
  "PMax best": "PMax 베스트",
  "YouTube new": "유튜브 신규",
  Remarketing: "리마케팅",
  "Insta feed": "인스타 피드",
  "Insta reels": "인스타 릴스",
  "Kakao biz": "카카오 비즈",
  "Naver shopping": "네이버 쇼핑",
});

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_KO = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

/** apps: [우리 앱, 경쟁 A, 경쟁 B]. 우리 앱에만 예상 범위 p5, p95가 있어요 (추세 둘레로 갈수록 넓어지는 90% 구간, 범위 띠 변형이 써요) */
function lineRows(apps: readonly string[]) {
  return MONTHS_EN.flatMap((_m, i) => [
    { month: `2025-${String(i + 1).padStart(2, "0")}`, app: apps[0], mau: Math.round((42 + i * 3.1 + Math.sin(i * 0.9) * 2.2) * 10) / 10, p5: Math.round((39.4 + i * 2.9) * 10) / 10, p95: Math.round((44.6 + i * 3.3) * 10) / 10 },
    { month: `2025-${String(i + 1).padStart(2, "0")}`, app: apps[1], mau: Math.round((55 + i * 0.9 + Math.cos(i * 0.7) * 1.8) * 10) / 10 },
    { month: `2025-${String(i + 1).padStart(2, "0")}`, app: apps[2], mau: Math.round((38 - i * 0.6 + Math.sin(i * 1.3) * 1.5) * 10) / 10 },
  ]);
}
/** 월별 MAU (만 명) */
export const lineSample = /* @__PURE__ */ lineRows(["Our app", "Rival A", "Rival B"]);
export const lineSampleKo = /* @__PURE__ */ lineRows(["우리 앱", "경쟁 A", "경쟁 B"]);

/** channels: [검색, SNS, 직접, 추천] */
function areaRows(months: readonly string[], channels: readonly string[]) {
  return months.flatMap((m, i) => [
    { month: m, channel: channels[0], visits: Math.round(120 + i * 6 + Math.sin(i) * 8) },
    { month: m, channel: channels[1], visits: Math.round(60 + i * 9 + Math.cos(i * 0.8) * 10) },
    { month: m, channel: channels[2], visits: Math.round(80 + Math.sin(i * 0.6) * 6) },
    { month: m, channel: channels[3], visits: Math.round(30 + i * 2) },
  ]);
}
/** 월별 채널 유입 (천 명) */
export const areaSample = /* @__PURE__ */ areaRows(MONTHS_EN, ["Search", "Social", "Direct", "Referral"]);
export const areaSampleKo = /* @__PURE__ */ areaRows(MONTHS_KO, ["검색", "SNS", "직접", "추천"]);

function streamRows(week: (n: number) => string, genres: readonly string[]) {
  return Array.from({ length: 20 }, (_, w) =>
    genres.map((g, gi) => {
      const peak = [4, 9, 14, 6, 17, 11][gi];
      const amp = [38, 30, 14, 20, 26, 22][gi];
      const v = 6 + amp * Math.exp(-((w - peak) ** 2) / (2 * (3 + gi) ** 2)) + ((w * (gi + 3)) % 4);
      return { week: week(w + 1), genre: g, hours: Math.round(v * 10) / 10 };
    }),
  ).flat();
}
/** 주별 장르 시청 시간 (만 시간) */
export const streamSample = /* @__PURE__ */ streamRows((n) => `W${n}`, ["Drama", "Variety", "Docs", "Anime", "Sports", "Movies"]);
export const streamSampleKo = /* @__PURE__ */ streamRows((n) => `${n}주`, ["드라마", "예능", "다큐", "애니", "스포츠", "영화"]);

export const barSample = [
  { quarter: "Q1", team: "Domestic", revenue: 42 },
  { quarter: "Q1", team: "Overseas", revenue: 18 },
  { quarter: "Q2", team: "Domestic", revenue: 48 },
  { quarter: "Q2", team: "Overseas", revenue: 24 },
  { quarter: "Q3", team: "Domestic", revenue: 51 },
  { quarter: "Q3", team: "Overseas", revenue: 33 },
  { quarter: "Q4", team: "Domestic", revenue: 55 },
  { quarter: "Q4", team: "Overseas", revenue: 41 },
];
export const barSampleKo = /* @__PURE__ */ relabel(barSample, { Q1: "1분기", Q2: "2분기", Q3: "3분기", Q4: "4분기", Domestic: "국내", Overseas: "해외" });

export const radialBarSample = [
  { goal: "Revenue", rate: 82 },
  { goal: "Sign-ups", rate: 64 },
  { goal: "Repeat buys", rate: 91 },
  { goal: "NPS", rate: 47 },
];
export const radialBarSampleKo = /* @__PURE__ */ relabel(radialBarSample, { Revenue: "매출", "Sign-ups": "신규 가입", "Repeat buys": "재구매" });

export const gaugeSample = [{ label: "Goal reached", value: 73, target: 85 }];
export const gaugeSampleKo = /* @__PURE__ */ relabel(gaugeSample, { "Goal reached": "목표 달성률" });

export const bulletSample = [
  { kpi: "Revenue (100M)", actual: 27.4, target: 30, poor: 18, ok: 25, good: 34 },
  { kpi: "Operating profit (100M)", actual: 4.1, target: 3.6, poor: 2, ok: 3, good: 5 },
  { kpi: "New customers (k)", actual: 12.8, target: 15, poor: 8, ok: 12, good: 18 },
  { kpi: "Satisfaction (pts)", actual: 4.3, target: 4.5, poor: 3.5, ok: 4.0, good: 5 },
];
export const bulletSampleKo = /* @__PURE__ */ relabel(bulletSample, { "Revenue (100M)": "매출(억)", "Operating profit (100M)": "영업이익(억)", "New customers (k)": "신규 고객(천)", "Satisfaction (pts)": "만족도(점)" });

export const sparklineSample = /* @__PURE__ */ Array.from({ length: 30 }, (_, i) => ({
  day: `2025-06-${String(i + 1).padStart(2, "0")}`,
  revenue: Math.round(1200 + i * 18 + Math.sin(i * 0.8) * 120 + (i % 7 === 5 ? 160 : 0)),
}));

export const slopeSample = [
  { brand: "Our brand", period: "2024", share: 18 },
  { brand: "Our brand", period: "2025", share: 27 },
  { brand: "Brand A", period: "2024", share: 31 },
  { brand: "Brand A", period: "2025", share: 28 },
  { brand: "Brand B", period: "2024", share: 24 },
  { brand: "Brand B", period: "2025", share: 21 },
  { brand: "Brand C", period: "2024", share: 15 },
  { brand: "Brand C", period: "2025", share: 14 },
  { brand: "Brand D", period: "2024", share: 12 },
  { brand: "Brand D", period: "2025", share: 10 },
];
export const slopeSampleKo = /* @__PURE__ */ relabel(slopeSample, { "Our brand": "우리 브랜드", "Brand A": "A사", "Brand B": "B사", "Brand C": "C사", "Brand D": "D사" });

export const dumbbellSample = [
  { region: "Seoul", before: 3.2, after: 4.6 },
  { region: "Gyeonggi", before: 2.8, after: 3.9 },
  { region: "Busan", before: 2.1, after: 2.6 },
  { region: "Daegu", before: 1.9, after: 2.2 },
  { region: "Incheon", before: 2.3, after: 3.1 },
  { region: "Gwangju", before: 1.6, after: 1.8 },
  { region: "Daejeon", before: 1.7, after: 2.4 },
];
export const dumbbellSampleKo = /* @__PURE__ */ relabel(dumbbellSample, { Seoul: "서울", Gyeonggi: "경기", Busan: "부산", Daegu: "대구", Incheon: "인천", Gwangju: "광주", Daejeon: "대전" });

export const lollipopSample = [
  { feature: "Search", usage: 82 },
  { feature: "Cart", usage: 74 },
  { feature: "Wishlist", usage: 61 },
  { feature: "Reviews", usage: 48 },
  { feature: "Coupons", usage: 39 },
  { feature: "Gifting", usage: 22 },
  { feature: "Live", usage: 14 },
];
export const lollipopSampleKo = /* @__PURE__ */ relabel(lollipopSample, { Search: "검색", Cart: "장바구니", Wishlist: "찜하기", Reviews: "리뷰", Coupons: "쿠폰함", Gifting: "선물하기", Live: "라이브" });

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gauss(rnd: () => number) {
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** names: [무료, 베이직, 프로] */
function beeswarmRows(names: readonly string[]) {
  const rnd = seeded(7);
  const plans = [
    { plan: names[0], mu: 9, sd: 4, n: 70 },
    { plan: names[1], mu: 17, sd: 5, n: 55 },
    { plan: names[2], mu: 26, sd: 6, n: 40 },
  ];
  return plans.flatMap((pl) => Array.from({ length: pl.n }, (_, i) => ({ id: `${pl.plan}-${i + 1}`, plan: pl.plan, minutes: Math.max(1, Math.round((pl.mu + gauss(rnd) * pl.sd) * 10) / 10) })));
}
/** 플랜별 사용자 세션 시간 (분) */
export const beeswarmSample = /* @__PURE__ */ beeswarmRows(["Free", "Basic", "Pro"]);
export const beeswarmSampleKo = /* @__PURE__ */ beeswarmRows(["무료", "베이직", "프로"]);

/** names: [서울, 경기, 강원, 충청, 전라, 경상, 제주] */
function ridgelineRows(names: readonly string[]) {
  const rnd = seeded(11);
  const regions = [
    { region: names[0], mu: 18, sd: 5 },
    { region: names[1], mu: 22, sd: 6 },
    { region: names[2], mu: 34, sd: 9 },
    { region: names[3], mu: 28, sd: 7 },
    { region: names[4], mu: 31, sd: 8 },
    { region: names[5], mu: 29, sd: 7 },
    { region: names[6], mu: 46, sd: 11 },
  ];
  return regions.flatMap((r) => Array.from({ length: 120 }, () => ({ region: r.region, hours: Math.max(2, Math.round((r.mu + gauss(rnd) * r.sd) * 10) / 10) })));
}
/** 지역별 배송 소요 시간 (시간) */
export const ridgelineSample = /* @__PURE__ */ ridgelineRows(["Seoul", "Gyeonggi", "Gangwon", "Chungcheong", "Jeolla", "Gyeongsang", "Jeju"]);
export const ridgelineSampleKo = /* @__PURE__ */ ridgelineRows(["서울", "경기", "강원", "충청", "전라", "경상", "제주"]);

// 두 번째 "Drop-off "는 끝에 빈칸이 있어요. 장바구니 뒤 이탈을 다른 노드로 그리려고요
export const sankeySample = [
  { source: "Search", target: "Product page", value: 4200 },
  { source: "Social", target: "Product page", value: 2600 },
  { source: "Social", target: "Promo page", value: 1400 },
  { source: "Direct", target: "Product page", value: 1800 },
  { source: "Direct", target: "Promo page", value: 600 },
  { source: "Product page", target: "Cart", value: 3900 },
  { source: "Product page", target: "Drop-off", value: 4700 },
  { source: "Promo page", target: "Cart", value: 900 },
  { source: "Promo page", target: "Drop-off", value: 1100 },
  { source: "Cart", target: "Purchase", value: 2900 },
  { source: "Cart", target: "Drop-off ", value: 1900 },
];
export const sankeySampleKo = /* @__PURE__ */ relabel(sankeySample, {
  Search: "검색",
  Social: "SNS",
  Direct: "직접",
  "Product page": "상품 상세",
  "Promo page": "이벤트",
  Cart: "장바구니",
  "Drop-off": "이탈",
  "Drop-off ": "이탈 ",
  Purchase: "구매",
});

/** 팀 사이 협업 요청 수 */
export const chordSample = [
  { from: "Design", to: "Engineering", value: 42 },
  { from: "Engineering", to: "Design", value: 28 },
  { from: "Product", to: "Design", value: 36 },
  { from: "Product", to: "Engineering", value: 54 },
  { from: "Engineering", to: "Product", value: 22 },
  { from: "Marketing", to: "Product", value: 31 },
  { from: "Marketing", to: "Design", value: 26 },
  { from: "Design", to: "Marketing", value: 12 },
  { from: "Data", to: "Product", value: 18 },
  { from: "Data", to: "Marketing", value: 24 },
  { from: "Engineering", to: "Data", value: 16 },
  { from: "Product", to: "Marketing", value: 14 },
];
export const chordSampleKo = /* @__PURE__ */ relabel(chordSample, { Design: "디자인", Engineering: "개발", Product: "기획", Marketing: "마케팅", Data: "데이터" });

/** 하루 커밋 수 (1년) */
export const calendarSample = /* @__PURE__ */ (() => {
  const rnd = seeded(3);
  const out: { date: string; commits: number }[] = [];
  const start = new Date(2025, 0, 1);
  for (let i = 0; i < 365; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const wd = d.getDay();
    const season = 1 + 0.5 * Math.sin((i / 365) * Math.PI * 2 - 1);
    const base = wd === 0 || wd === 6 ? 0.6 : 4.2;
    const burst = rnd() < 0.05 ? 8 : 0;
    const v = Math.max(0, Math.round(base * season + gauss(rnd) * 1.6 + burst));
    out.push({ date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, commits: v });
  }
  return out;
})();

function bumpRows(apps: readonly string[], months: readonly string[]) {
  const ranks = [
    [5, 4, 4, 3, 2, 2, 1],
    [1, 1, 2, 2, 3, 3, 3],
    [2, 3, 1, 1, 1, 1, 2],
    [3, 2, 3, 4, 4, 5, 5],
    [4, 5, 6, 5, 5, 4, 4],
    [6, 6, 5, 6, 6, 6, 6],
  ];
  return apps.flatMap((a, ai) => months.map((m, mi) => ({ month: m, app: a, rank: ranks[ai][mi] })));
}
/** 월별 앱스토어 순위 */
export const bumpSample = /* @__PURE__ */ bumpRows(["Our app", "App A", "App B", "App C", "App D", "App E"], /* @__PURE__ */ MONTHS_EN.slice(0, 7));
export const bumpSampleKo = /* @__PURE__ */ bumpRows(["우리 앱", "A앱", "B앱", "C앱", "D앱", "E앱"], /* @__PURE__ */ MONTHS_KO.slice(0, 7));

/** 지점별 응답 시간 (ms) */
export const boxSample = /* @__PURE__ */ (() => {
  const rnd = seeded(5);
  const apis = [
    { api: "/login", mu: 120, sd: 30 },
    { api: "/search", mu: 210, sd: 60 },
    { api: "/cart", mu: 150, sd: 35 },
    { api: "/pay", mu: 320, sd: 80 },
    { api: "/feed", mu: 180, sd: 45 },
  ];
  return apis.flatMap((a) =>
    Array.from({ length: 80 }, (_, i) => ({ api: a.api, ms: Math.max(30, Math.round(a.mu + gauss(rnd) * a.sd + (i % 37 === 0 ? a.sd * 3.2 : 0))) })),
  );
})();

/** API 요청 지연 시간 320건 (ms). 대부분 170ms 언저리이고, 25건마다 하나씩 캐시를 놓친 느린 요청이 꼬리를 만들어요 */
export const histogramSample = /* @__PURE__ */ (() => {
  const rnd = seeded(17);
  return Array.from({ length: 320 }, (_, i) => ({ ms: Math.round(i % 25 === 0 ? 650 + rnd() * 800 : Math.exp(Math.log(170) + gauss(rnd) * 0.42)) }));
})();

/** 노트북 모델 비교 */
export const parallelSample = [
  { model: "Air 13", price: 159, weight: 1.24, battery: 18, perf: 72, screen: 13.6 },
  { model: "Pro 14", price: 299, weight: 1.55, battery: 17, perf: 91, screen: 14.2 },
  { model: "Ultra 16", price: 389, weight: 2.14, battery: 14, perf: 97, screen: 16.2 },
  { model: "Slim 15", price: 189, weight: 1.51, battery: 15, perf: 70, screen: 15.3 },
  { model: "Gaming 17", price: 329, weight: 2.8, battery: 6, perf: 95, screen: 17.3 },
  { model: "Basic 14", price: 89, weight: 1.45, battery: 10, perf: 48, screen: 14 },
  { model: "2-in-1 13", price: 179, weight: 1.29, battery: 13, perf: 66, screen: 13.3 },
  { model: "Creator 16", price: 349, weight: 1.98, battery: 12, perf: 93, screen: 16 },
];
export const parallelSampleKo = /* @__PURE__ */ relabel(parallelSample, {
  "Air 13": "에어 13",
  "Pro 14": "프로 14",
  "Ultra 16": "울트라 16",
  "Slim 15": "슬림 15",
  "Gaming 17": "게이밍 17",
  "Basic 14": "베이직 14",
  "2-in-1 13": "투인원 13",
  "Creator 16": "크리에이터 16",
});

/** 결제 수단별 거래액 (억 원) */
export const segmentedSample = [
  { method: "Card", amount: 412 },
  { method: "Mobile pay", amount: 278 },
  { method: "Bank transfer", amount: 134 },
  { method: "Phone bill", amount: 45 },
  { method: "Other", amount: 27 },
];
export const segmentedSampleKo = /* @__PURE__ */ relabel(segmentedSample, { Card: "카드", "Mobile pay": "간편결제", "Bank transfer": "계좌이체", "Phone bill": "휴대폰", Other: "기타" });

/** 가상 종목의 일봉 60일 (원, 주) */
export const candlestickSample = /* @__PURE__ */ (() => {
  const rnd = seeded(23);
  const out: { date: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
  const d = new Date(2025, 8, 1);
  let close = 61200;
  while (out.length < 60) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) {
      const k = out.length;
      // 초반 조정, 중반 반등, 후반 상승 추세
      const drift = k < 18 ? -0.004 : k < 34 ? 0.003 : 0.0065;
      const open = Math.round((close * (1 + gauss(rnd) * 0.006)) / 100) * 100;
      const next = Math.round((open * (1 + drift + gauss(rnd) * 0.014)) / 100) * 100;
      const high = Math.round((Math.max(open, next) * (1 + Math.abs(gauss(rnd)) * 0.007)) / 100) * 100;
      const low = Math.round((Math.min(open, next) * (1 - Math.abs(gauss(rnd)) * 0.007)) / 100) * 100;
      const volume = Math.round((900 + Math.abs(next - open) / 20 + rnd() * 600) * 1000);
      out.push({ date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, open, high, low, close: next, volume });
      close = next;
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
})();

/** AI 에이전트의 하루 토큰 14일치. 2주 동안 약 51% 오르고, 10월 31일에 실패와 재시도가 튀어요 */
export const skylineSample = [
  { day: "2026-10-23", Input: 410000, Cached: 317223, Output: 186999, Reasoning: 79534, Failed: 11000, Retried: 10000 },
  { day: "2026-10-24", Input: 446030, Cached: 337921, Output: 202044, Reasoning: 87942, Failed: 15314, Retried: 9190 },
  { day: "2026-10-25", Input: 440886, Cached: 336150, Output: 202507, Reasoning: 87489, Failed: 15398, Retried: 6051 },
  { day: "2026-10-26", Input: 472300, Cached: 370227, Output: 221753, Reasoning: 92899, Failed: 13276, Retried: 4626 },
  { day: "2026-10-27", Input: 456358, Cached: 366468, Output: 216506, Reasoning: 88261, Failed: 9041, Retried: 5714 },
  { day: "2026-10-28", Input: 482495, Cached: 386711, Output: 226337, Reasoning: 92466, Failed: 8633, Retried: 9460 },
  { day: "2026-10-29", Input: 519595, Cached: 405554, Output: 238274, Reasoning: 100345, Failed: 12610, Retried: 12608 },
  { day: "2026-10-30", Input: 509048, Cached: 387050, Output: 230518, Reasoning: 99954, Failed: 16653, Retried: 11318 },
  { day: "2026-10-31", Input: 545022, Cached: 413595, Output: 248950, Reasoning: 108123, Failed: 90000, Retried: 126000 },
  { day: "2026-11-01", Input: 566932, Cached: 440538, Output: 264628, Reasoning: 111944, Failed: 17316, Retried: 5841 },
  { day: "2026-11-02", Input: 550201, Cached: 439688, Output: 260808, Reasoning: 106914, Failed: 12001, Retried: 6097 },
  { day: "2026-11-03", Input: 586400, Cached: 471716, Output: 276507, Reasoning: 112488, Failed: 10262, Retried: 10281 },
  { day: "2026-11-04", Input: 587529, Cached: 462627, Output: 271133, Reasoning: 113044, Failed: 12856, Retried: 13840 },
  { day: "2026-11-05", Input: 622545, Cached: 476047, Output: 282345, Reasoning: 121668, Failed: 19059, Retried: 14613 },
];
export const skylineSampleKo = /* @__PURE__ */ rekey(skylineSample, { Input: "입력", Cached: "캐시", Output: "출력", Reasoning: "추론", Failed: "실패", Retried: "재시도" });

/** names: [대형, 중형, 소형] 모델, request: 요청 이름 앞말. 모델이 번갈아 오는 요청 54개의 비용(센트, 정수로 반올림)과 응답 시간(ms) */
function scatterRows(names: readonly string[], request: string) {
  const rnd = seeded(29);
  const models = [
    { model: names[0], cost: [5, 14], base: 1400, perCent: 150, sd: 260 },
    { model: names[1], cost: [2, 7], base: 650, perCent: 150, sd: 170 },
    { model: names[2], cost: [1, 3], base: 280, perCent: 130, sd: 90 },
  ];
  return Array.from({ length: 54 }, (_, i) => {
    const m = models[i % 3];
    const cost = Math.round(m.cost[0] + rnd() * (m.cost[1] - m.cost[0]));
    const ms = Math.max(120, Math.round((m.base + cost * m.perCent + gauss(rnd) * m.sd) / 10) * 10);
    return { id: `${request} ${i + 1}`, model: m.model, cost, ms };
  });
}
/** 모델별 요청 비용(센트)과 응답 시간(ms) */
export const scatterSample = /* @__PURE__ */ scatterRows(["Large", "Medium", "Small"], "Request");
export const scatterSampleKo = /* @__PURE__ */ scatterRows(["대형", "중형", "소형"], "요청");

/**
 * names: [작은 요청, 큰 업로드] 경로 이름. 요청 4,000건의 크기(KB, 소수 한 자리)와 응답 시간(ms): 작은 요청 묶음과 큰 업로드 묶음 두 덩어리예요.
 * 육각 밀도(bin "hex") 예시. 고정 씨앗이라 언제나 같은 값이에요
 */
function scatterHexRows(names: readonly [string, string]) {
  const rnd = seeded(41);
  return Array.from({ length: 4000 }, (_, i) => {
    const upload = i % 5 >= 3;
    const kb = upload ? 270 + gauss(rnd) * 30 : Math.exp(3.8 + gauss(rnd) * 0.4);
    const ms = upload ? 520 + (kb - 270) * 0.5 + gauss(rnd) * 32 : 110 + kb * 1.5 + gauss(rnd) * 30;
    return { route: names[upload ? 1 : 0], kb: Math.round(Math.max(1, kb) * 10) / 10, ms: Math.max(20, Math.round(ms)) };
  });
}
/** 경로별 요청 크기(KB)와 응답 시간(ms), 4,000건 */
export const scatterHexSample = /* @__PURE__ */ scatterHexRows(["Search", "Upload"]);
export const scatterHexSampleKo = /* @__PURE__ */ scatterHexRows(["검색", "업로드"]);

/** 광역 지자체 16곳(2026-07-01 통합 뒤)의 다음 날 배송이 되는 주소 비율(%) */
export const tileMapSample = [
  { sido: "Seoul", rate: 96 },
  { sido: "Busan", rate: 91 },
  { sido: "Daegu", rate: 89 },
  { sido: "Incheon", rate: 94 },
  { sido: "Daejeon", rate: 90 },
  { sido: "Ulsan", rate: 86 },
  { sido: "Sejong", rate: 98 },
  { sido: "Gyeonggi", rate: 93 },
  { sido: "Gangwon", rate: 71 },
  { sido: "Chungbuk", rate: 80 },
  { sido: "Chungnam", rate: 78 },
  { sido: "Jeonbuk", rate: 74 },
  { sido: "Jeonnam-Gwangju", rate: 76 },
  { sido: "Gyeongbuk", rate: 72 },
  { sido: "Gyeongnam", rate: 82 },
  { sido: "Jeju", rate: 64 },
];
export const tileMapSampleKo = /* @__PURE__ */ relabel(tileMapSample, {
  Seoul: "서울",
  Busan: "부산",
  Daegu: "대구",
  Incheon: "인천",
  Daejeon: "대전",
  Ulsan: "울산",
  Sejong: "세종",
  Gyeonggi: "경기",
  Gangwon: "강원",
  Chungbuk: "충북",
  Chungnam: "충남",
  Jeonbuk: "전북",
  "Jeonnam-Gwangju": "전남광주",
  Gyeongbuk: "경북",
  Gyeongnam: "경남",
  Jeju: "제주",
});

/** 가상의 브랜드 12곳, 2015~2026년 연간 판매량(천 대). 빠르게 크는 브랜드가 아래에서 올라와 순위가 바뀌어요 */
function raceRows(brands: readonly string[]) {
  const rnd = seeded(31);
  const base = [420, 380, 350, 300, 120, 260, 240, 200, 180, 90, 150, 60];
  const growth = [0.02, 0.05, 0.03, 0.06, 0.2, 0.04, 0.07, 0.08, 0.05, 0.17, 0.09, 0.19];
  const level = base.slice();
  const out: { brand: string; year: number; sales: number }[] = [];
  for (let year = 2015; year <= 2026; year++) {
    brands.forEach((brand, i) => {
      out.push({ brand, year, sales: Math.round(level[i]) });
      level[i] *= 1 + growth[i] + (rnd() - 0.5) * 0.06;
    });
  }
  return out;
}
export const barRaceSample = /* @__PURE__ */ raceRows(["Northwind", "Aurora", "Kestrel", "Halcyon", "Lumen", "Orbit", "Pinnacle", "Quill", "Summit", "Vertex", "Willow", "Zephyr"]);
export const barRaceSampleKo = /* @__PURE__ */ raceRows(["노스윈드", "오로라", "케스트럴", "할시온", "루멘", "오르빗", "피너클", "퀼", "서밋", "버텍스", "윌로", "제퍼"]);

/** 서비스 사이 호출 수(분당, 천 건). 같은 쌍의 반대 방향 행(Payments → Orders)은 링크 하나로 합쳐 그려요 */
export const networkSample = [
  { from: "Web", to: "Gateway", calls: 42 },
  { from: "Mobile app", to: "Gateway", calls: 36 },
  { from: "Gateway", to: "Auth", calls: 30 },
  { from: "Gateway", to: "Search", calls: 18 },
  { from: "Gateway", to: "Catalog", calls: 22 },
  { from: "Gateway", to: "Cart", calls: 14 },
  { from: "Gateway", to: "Orders", calls: 12 },
  { from: "Gateway", to: "Logs", calls: 6 },
  { from: "Auth", to: "Users", calls: 20 },
  { from: "Search", to: "Catalog", calls: 16 },
  { from: "Catalog", to: "Cart", calls: 9 },
  { from: "Cart", to: "Orders", calls: 11 },
  { from: "Cart", to: "Payments", calls: 4 },
  { from: "Orders", to: "Payments", calls: 9 },
  { from: "Payments", to: "Orders", calls: 3 },
  { from: "Orders", to: "Shipping", calls: 8 },
  { from: "Orders", to: "Logs", calls: 3 },
  { from: "Payments", to: "Auth", calls: 6 },
  { from: "Payments", to: "Users", calls: 3 },
  { from: "Payments", to: "Billing", calls: 7 },
  { from: "Payments", to: "Notifications", calls: 5 },
  { from: "Payments", to: "Logs", calls: 4 },
  { from: "Shipping", to: "Notifications", calls: 3 },
  { from: "Users", to: "Notifications", calls: 2 },
  { from: "Billing", to: "Logs", calls: 2 },
];
export const networkSampleKo = /* @__PURE__ */ relabel(networkSample, {
  Web: "웹",
  "Mobile app": "앱",
  Gateway: "게이트웨이",
  Auth: "인증",
  Users: "회원",
  Search: "검색",
  Catalog: "상품",
  Cart: "장바구니",
  Orders: "주문",
  Payments: "결제",
  Billing: "정산",
  Shipping: "배송",
  Notifications: "알림",
  Logs: "로그",
});

/** 에이전트 실행 한 번의 단계(분). startAt, endAt은 같은 단계의 시각이고, run, state는 한 줄짜리 상태 띠 꼴에 써요 */
function timelineRows(names: Record<string, string>, states: Record<string, string>, run: string) {
  const steps: [string, number, number, string][] = [
    ["Plan", 0, 3, "Working"],
    ["Search code", 3, 8, "Working"],
    ["Edit files", 8, 15, "Working"],
    ["Run tests", 15, 18, "Working"],
    ["Fix failing test", 18, 22, "Fixing"],
    ["Run tests", 22, 24, "Working"],
    ["Open PR", 24, 25, "Working"],
    ["Wait for CI", 25, 43, "Waiting"],
    ["Merged", 43, 43, "Merged"],
  ];
  const at = (m: number) => `2026-11-10T${String(9 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return steps.map(([step, start, end, state]) => ({ step: names[step] ?? step, start, end, run, state: states[state] ?? state, startAt: at(start), endAt: at(end) }));
}
export const timelineSample = /* @__PURE__ */ timelineRows({}, {}, "Agent run");
export const timelineSampleKo = /* @__PURE__ */ timelineRows(
  { Plan: "계획 세우기", "Search code": "코드 검색", "Edit files": "파일 수정", "Run tests": "시험 실행", "Fix failing test": "실패 고치기", "Open PR": "PR 올리기", "Wait for CI": "CI 기다림", Merged: "합침" },
  { Working: "작업", Fixing: "고침", Waiting: "기다림", Merged: "합침" },
  "에이전트 실행",
);

/** 날짜로 적은 프로젝트 일정 (팀별 색, 출시는 하루짜리 사건) */
export const timelineScheduleSample = [
  { task: "Research", start: "2026-01-05", end: "2026-01-23", team: "Product" },
  { task: "Design", start: "2026-01-19", end: "2026-02-13", team: "Design" },
  { task: "Build", start: "2026-02-09", end: "2026-03-27", team: "Engineering" },
  { task: "Beta", start: "2026-03-23", end: "2026-04-10", team: "Engineering" },
  { task: "Launch", start: "2026-04-14", end: "2026-04-14", team: "Product" },
];

/** 결제 API가 멈추면 영향받는 화면 (서비스 6개, 화면 23개). users는 하루 사용자(천 명)라 트리맵, 선버스트로 바꿔 그려도 돼요 */
export const treeSample = [
  { service: "Orders", screen: "Checkout", users: 42 },
  { service: "Orders", screen: "Cart checkout", users: 31 },
  { service: "Orders", screen: "One-tap pay", users: 18 },
  { service: "Orders", screen: "Order history", users: 25 },
  { service: "Subscriptions", screen: "Start subscription", users: 9 },
  { service: "Subscriptions", screen: "Renewal", users: 12 },
  { service: "Subscriptions", screen: "Cancel and refund", users: 4 },
  { service: "Account", screen: "Payment methods", users: 11 },
  { service: "Account", screen: "Receipts", users: 7 },
  { service: "Account", screen: "Profile", users: 15 },
  { service: "Account", screen: "Notification settings", users: 5 },
  { service: "Support", screen: "Notices", users: 6 },
  { service: "Support", screen: "Chat", users: 8 },
  { service: "Support", screen: "FAQ", users: 10 },
  { service: "Support", screen: "Contact us", users: 3 },
  { service: "Search", screen: "Suggestions", users: 30 },
  { service: "Search", screen: "Filters", users: 22 },
  { service: "Search", screen: "Search bar", users: 48 },
  { service: "Products", screen: "Compare", users: 9 },
  { service: "Products", screen: "Wishlist", users: 14 },
  { service: "Products", screen: "Reviews", users: 20 },
  { service: "Products", screen: "Catalog", users: 52 },
  { service: "Products", screen: "Details", users: 60 },
];
export const treeSampleKo = /* @__PURE__ */ relabel(treeSample, {
  Orders: "주문",
  Subscriptions: "정기구독",
  Account: "마이페이지",
  Support: "고객센터",
  Search: "검색",
  Products: "상품",
  Checkout: "주문서",
  "Cart checkout": "장바구니 결제",
  "One-tap pay": "간편결제",
  "Order history": "주문 내역",
  "Start subscription": "구독 시작",
  Renewal: "갱신",
  "Cancel and refund": "해지 환불",
  "Payment methods": "결제 수단",
  Receipts: "영수증",
  Profile: "프로필",
  "Notification settings": "알림 설정",
  Notices: "공지",
  Chat: "채팅",
  "Contact us": "문의",
  Suggestions: "추천어",
  Filters: "필터",
  "Search bar": "검색창",
  Compare: "비교",
  Wishlist: "찜",
  Reviews: "리뷰",
  Catalog: "목록",
  Details: "상세",
});

/** 미국 주 50곳과 DC의 다음 날 배송이 되는 주소 비율(%) (타일 격자 지도의 기본 예시) */
export const tileMapUsSample = [
  { state: "AL", rate: 71 }, { state: "AK", rate: 38 }, { state: "AZ", rate: 82 }, { state: "AR", rate: 66 }, { state: "CA", rate: 91 }, { state: "CO", rate: 84 },
  { state: "CT", rate: 90 }, { state: "DE", rate: 88 }, { state: "DC", rate: 97 }, { state: "FL", rate: 86 }, { state: "GA", rate: 83 }, { state: "HI", rate: 44 },
  { state: "ID", rate: 63 }, { state: "IL", rate: 87 }, { state: "IN", rate: 79 }, { state: "IA", rate: 70 }, { state: "KS", rate: 68 }, { state: "KY", rate: 74 },
  { state: "LA", rate: 72 }, { state: "ME", rate: 61 }, { state: "MD", rate: 89 }, { state: "MA", rate: 92 }, { state: "MI", rate: 81 }, { state: "MN", rate: 80 },
  { state: "MS", rate: 62 }, { state: "MO", rate: 76 }, { state: "MT", rate: 52 }, { state: "NE", rate: 67 }, { state: "NV", rate: 81 }, { state: "NH", rate: 78 },
  { state: "NJ", rate: 94 }, { state: "NM", rate: 60 }, { state: "NY", rate: 93 }, { state: "NC", rate: 80 }, { state: "ND", rate: 50 }, { state: "OH", rate: 82 },
  { state: "OK", rate: 69 }, { state: "OR", rate: 77 }, { state: "PA", rate: 86 }, { state: "RI", rate: 90 }, { state: "SC", rate: 75 }, { state: "SD", rate: 54 },
  { state: "TN", rate: 78 }, { state: "TX", rate: 85 }, { state: "UT", rate: 79 }, { state: "VT", rate: 58 }, { state: "VA", rate: 87 }, { state: "WA", rate: 85 },
  { state: "WV", rate: 59 }, { state: "WI", rate: 75 }, { state: "WY", rate: 47 },
];

/** 나라별 결제 완료율(%) (단계구분도 기본 예시) */
export const choroplethSample = [
  { country: "United States", rate: 3.8 }, { country: "Canada", rate: 4.8 }, { country: "Mexico", rate: 2.1 }, { country: "Brazil", rate: 1.9 }, { country: "Argentina", rate: 1.6 },
  { country: "Chile", rate: 2.3 }, { country: "Colombia", rate: 1.8 }, { country: "Peru", rate: 1.5 }, { country: "United Kingdom", rate: 4.1 }, { country: "Ireland", rate: 3.9 },
  { country: "France", rate: 3.2 }, { country: "Germany", rate: 3.6 }, { country: "Netherlands", rate: 4.4 }, { country: "Spain", rate: 2.8 }, { country: "Italy", rate: 2.6 },
  { country: "Poland", rate: 2.9 }, { country: "Sweden", rate: 4.2 }, { country: "Norway", rate: 4 }, { country: "Finland", rate: 3.7 }, { country: "Türkiye", rate: 2.2 },
  { country: "Egypt", rate: 1.2 }, { country: "Nigeria", rate: 0.9 }, { country: "Kenya", rate: 1.4 }, { country: "South Africa", rate: 2 }, { country: "Morocco", rate: 1.3 },
  { country: "Saudi Arabia", rate: 2.7 }, { country: "United Arab Emirates", rate: 3.5 }, { country: "India", rate: 1.7 }, { country: "Indonesia", rate: 1.6 }, { country: "Vietnam", rate: 1.9 },
  { country: "Thailand", rate: 2.2 }, { country: "Philippines", rate: 1.8 }, { country: "China", rate: 2.5 }, { country: "Japan", rate: 3.3 }, { country: "South Korea", rate: 3.9 },
  { country: "Australia", rate: 3.9 }, { country: "New Zealand", rate: 3.6 },
];

/** 유럽 나라별 결제 완료율(%) (focus: "europe" 예시) */
export const choroplethEuropeSample = [
  { country: "United Kingdom", rate: 4.1 }, { country: "Ireland", rate: 3.9 }, { country: "France", rate: 3.2 }, { country: "Germany", rate: 3.6 }, { country: "Netherlands", rate: 4.4 },
  { country: "Belgium", rate: 3.5 }, { country: "Spain", rate: 2.8 }, { country: "Portugal", rate: 2.7 }, { country: "Italy", rate: 2.6 }, { country: "Switzerland", rate: 3.8 },
  { country: "Austria", rate: 3.4 }, { country: "Poland", rate: 2.9 }, { country: "Czechia", rate: 3 }, { country: "Hungary", rate: 2.4 }, { country: "Romania", rate: 2.1 },
  { country: "Greece", rate: 2.3 }, { country: "Sweden", rate: 4.2 }, { country: "Norway", rate: 4 }, { country: "Denmark", rate: 4.3 }, { country: "Finland", rate: 3.7 },
];

/** 결제 완료율(%) 꼴로 바꾼 미국 주, 한국 시도 예시 (다음 날 배송 비율 예시의 값을 20으로 나눠 소수 한 자리) */
const toConversion = <T extends { rate: number }>(rows: readonly T[]): T[] => rows.map((r) => ({ ...r, rate: Math.round(r.rate / 2) / 10 }));
export const choroplethUsSample = /* @__PURE__ */ toConversion(tileMapUsSample);
export const choroplethKrSample = /* @__PURE__ */ toConversion(tileMapSample);
export const choroplethKrSampleKo = /* @__PURE__ */ toConversion(tileMapSampleKo);

/** 가상의 배송 구역 네 곳 (사용자 GeoJSON 예시: 구멍이 있는 구역, 조각이 둘인 구역). 경위도 도 */
export const choroplethZones = {
  type: "FeatureCollection" as const,
  features: [
    { type: "Feature", properties: { zone: "North", label: "North zone" }, geometry: { type: "Polygon", coordinates: [[[10, 50.6], [10.6, 50.6], [10.6, 51], [10, 51], [10, 50.6]]] } },
    { type: "Feature", properties: { zone: "East", label: "East zone" }, geometry: { type: "Polygon", coordinates: [[[10.6, 50.2], [11.2, 50.2], [11.2, 51], [10.6, 51], [10.6, 50.2]], [[10.8, 50.5], [11, 50.5], [11, 50.7], [10.8, 50.7], [10.8, 50.5]]] } },
    { type: "Feature", properties: { zone: "South", label: "South zone" }, geometry: { type: "Polygon", coordinates: [[[10, 50.2], [10.6, 50.2], [10.6, 50.6], [10, 50.6], [10, 50.2]]] } },
    { type: "Feature", properties: { zone: "Lakes", label: "Lakes zone" }, geometry: { type: "MultiPolygon", coordinates: [[[[10.8, 50.5], [11, 50.5], [11, 50.7], [10.8, 50.7], [10.8, 50.5]]], [[[10.1, 50.05], [10.4, 50.05], [10.4, 50.15], [10.1, 50.15], [10.1, 50.05]]]] } },
  ],
};
export const choroplethZonesSample = [
  { zone: "North", rate: 3.1 },
  { zone: "East", rate: 4.2 },
  { zone: "South", rate: 2.4 },
  { zone: "Lakes", rate: 1.8 },
];

/** 도시별 월간 활성 사용자 (기호 지도 기본 예시). 경위도는 도 */
export const symbolMapSample = [
  { city: "Tokyo", continent: "Asia", lon: 139.69, lat: 35.69, users: 1_180_000 },
  { city: "São Paulo", continent: "Americas", lon: -46.63, lat: -23.55, users: 820_000 },
  { city: "Jakarta", continent: "Asia", lon: 106.85, lat: -6.21, users: 710_000 },
  { city: "New York", continent: "Americas", lon: -74.01, lat: 40.71, users: 640_000 },
  { city: "Mumbai", continent: "Asia", lon: 72.88, lat: 19.08, users: 600_000 },
  { city: "London", continent: "Europe", lon: -0.13, lat: 51.51, users: 560_000 },
  { city: "Seoul", continent: "Asia", lon: 126.98, lat: 37.57, users: 520_000 },
  { city: "Mexico City", continent: "Americas", lon: -99.13, lat: 19.43, users: 450_000 },
  { city: "Los Angeles", continent: "Americas", lon: -118.24, lat: 34.05, users: 430_000 },
  { city: "Lagos", continent: "Africa", lon: 3.38, lat: 6.52, users: 410_000 },
  { city: "Cairo", continent: "Africa", lon: 31.24, lat: 30.04, users: 380_000 },
  { city: "Paris", continent: "Europe", lon: 2.35, lat: 48.86, users: 310_000 },
  { city: "Istanbul", continent: "Europe", lon: 28.98, lat: 41.01, users: 250_000 },
  { city: "Sydney", continent: "Oceania", lon: 151.21, lat: -33.87, users: 210_000 },
  { city: "Singapore", continent: "Asia", lon: 103.82, lat: 1.35, users: 180_000 },
];

/** 나라별 월간 활성 사용자 (기호 지도에 경위도 없이 나라 이름으로) */
export const symbolMapCountrySample = [
  { country: "United States", users: 2_400_000 }, { country: "Brazil", users: 1_300_000 }, { country: "India", users: 1_900_000 }, { country: "Indonesia", users: 1_100_000 },
  { country: "Japan", users: 1_500_000 }, { country: "Germany", users: 700_000 }, { country: "United Kingdom", users: 820_000 }, { country: "France", users: 560_000 },
  { country: "Nigeria", users: 640_000 }, { country: "Egypt", users: 430_000 }, { country: "Mexico", users: 900_000 }, { country: "Australia", users: 380_000 },
  { country: "South Africa", users: 290_000 }, { country: "Argentina", users: 340_000 }, { country: "Türkiye", users: 520_000 }, { country: "Canada", users: 610_000 },
];

/** 미국 매장별 월 매출 (us-states 예시: 알래스카, 하와이 매장은 옮겨 붙인 자리에 놓여요) */
export const symbolMapUsSample = [
  { store: "New York", lon: -74.01, lat: 40.71, revenue: 4_200_000 }, { store: "Los Angeles", lon: -118.24, lat: 34.05, revenue: 3_600_000 }, { store: "Chicago", lon: -87.63, lat: 41.88, revenue: 2_500_000 },
  { store: "Houston", lon: -95.37, lat: 29.76, revenue: 2_100_000 }, { store: "Phoenix", lon: -112.07, lat: 33.45, revenue: 1_300_000 }, { store: "Seattle", lon: -122.33, lat: 47.61, revenue: 1_700_000 },
  { store: "Miami", lon: -80.19, lat: 25.76, revenue: 1_900_000 }, { store: "Denver", lon: -104.99, lat: 39.74, revenue: 1_100_000 }, { store: "Atlanta", lon: -84.39, lat: 33.75, revenue: 1_400_000 },
  { store: "Boston", lon: -71.06, lat: 42.36, revenue: 1_600_000 }, { store: "Minneapolis", lon: -93.27, lat: 44.98, revenue: 800_000 }, { store: "Anchorage", lon: -149.9, lat: 61.22, revenue: 300_000 },
  { store: "Honolulu", lon: -157.86, lat: 21.31, revenue: 650_000 },
];

/** 유럽 도시별 월간 활성 사용자 (focus: "europe" 예시) */
export const symbolMapEuropeSample = [
  { city: "London", lon: -0.13, lat: 51.51, users: 560_000 }, { city: "Paris", lon: 2.35, lat: 48.86, users: 310_000 }, { city: "Berlin", lon: 13.4, lat: 52.52, users: 290_000 },
  { city: "Madrid", lon: -3.7, lat: 40.42, users: 240_000 }, { city: "Rome", lon: 12.5, lat: 41.9, users: 170_000 }, { city: "Amsterdam", lon: 4.9, lat: 52.37, users: 210_000 },
  { city: "Warsaw", lon: 21.01, lat: 52.23, users: 130_000 }, { city: "Stockholm", lon: 18.07, lat: 59.33, users: 150_000 }, { city: "Lisbon", lon: -9.14, lat: 38.72, users: 90_000 },
  { city: "Athens", lon: 23.73, lat: 37.98, users: 80_000 }, { city: "Dublin", lon: -6.26, lat: 53.35, users: 120_000 }, { city: "Vienna", lon: 16.37, lat: 48.21, users: 100_000 },
];

/** 한국 도시별 월간 활성 사용자 (기호 지도 한국 변형과 한국어 예시) */
export const symbolMapKrSample = [
  { city: "Seoul", lon: 126.98, lat: 37.57, users: 1_820_000 }, { city: "Busan", lon: 129.08, lat: 35.18, users: 600_000 }, { city: "Incheon", lon: 126.7, lat: 37.46, users: 520_000 },
  { city: "Daegu", lon: 128.6, lat: 35.87, users: 410_000 }, { city: "Daejeon", lon: 127.38, lat: 36.35, users: 300_000 }, { city: "Gwangju", lon: 126.85, lat: 35.16, users: 280_000 },
  { city: "Suwon", lon: 127.03, lat: 37.26, users: 330_000 }, { city: "Ulsan", lon: 129.31, lat: 35.54, users: 190_000 }, { city: "Cheongju", lon: 127.49, lat: 36.64, users: 140_000 },
  { city: "Jeonju", lon: 127.15, lat: 35.82, users: 120_000 }, { city: "Gangneung", lon: 128.88, lat: 37.75, users: 60_000 }, { city: "Jeju", lon: 126.53, lat: 33.5, users: 150_000 },
];
const KR_CITIES: Record<string, string> = {
  Seoul: "서울", Busan: "부산", Incheon: "인천", Daegu: "대구", Daejeon: "대전", Gwangju: "광주", Suwon: "수원", Ulsan: "울산", Cheongju: "청주", Jeonju: "전주",
  Gangneung: "강릉", Jeju: "제주", Changwon: "창원", Wonju: "원주", "Icheon hub": "이천 센터",
};
export const symbolMapKrSampleKo = /* @__PURE__ */ relabel(symbolMapKrSample, KR_CITIES);

/** 항구 사이 컨테이너 물동량(TEU) (흐름 지도 기본 예시). 자리는 flowMapPlaces */
export const flowMapSample = [
  { from: "Shanghai", to: "Los Angeles", teu: 412_000 },
  { from: "Shanghai", to: "Rotterdam", teu: 268_000 },
  { from: "Singapore", to: "Rotterdam", teu: 231_000 },
  { from: "Busan", to: "Los Angeles", teu: 205_000 },
  { from: "Shanghai", to: "Singapore", teu: 174_000 },
  { from: "Singapore", to: "Dubai", teu: 140_000 },
  { from: "Rotterdam", to: "New York", teu: 121_000 },
  { from: "Los Angeles", to: "Shanghai", teu: 96_000 },
  { from: "Dubai", to: "Hamburg", teu: 88_000 },
  { from: "Shanghai", to: "Santos", teu: 70_000 },
  { from: "Santos", to: "Rotterdam", teu: 54_000 },
];
/** 항구 자리 [경도, 위도] */
export const flowMapPlaces: Record<string, [number, number]> = {
  Shanghai: [121.47, 31.23], Singapore: [103.82, 1.35], Rotterdam: [4.48, 51.92], "Los Angeles": [-118.24, 34.05], Busan: [129.08, 35.18],
  Dubai: [55.27, 25.2], "New York": [-74.01, 40.71], Santos: [-46.33, -23.96], Hamburg: [9.99, 53.55],
};

/** 미국 주 사이 화물(톤) (흐름 지도 us-states 예시: 자리는 주 이름이라 경위도가 없어요. 알래스카, 하와이로 가는 흐름도 있어요) */
export const flowMapUsSample = [
  { from: "California", to: "Texas", tons: 52_000 }, { from: "Texas", to: "Illinois", tons: 38_000 }, { from: "California", to: "Washington", tons: 24_000 },
  { from: "Illinois", to: "New York", tons: 31_000 }, { from: "Georgia", to: "Florida", tons: 27_000 }, { from: "Texas", to: "California", tons: 22_000 },
  { from: "New York", to: "Massachusetts", tons: 15_000 }, { from: "Washington", to: "Alaska", tons: 9_000 }, { from: "California", to: "Hawaii", tons: 11_000 },
  { from: "Illinois", to: "Colorado", tons: 12_000 }, { from: "Texas", to: "Georgia", tons: 17_000 },
];

/** 유럽 공항 사이 항공 화물(톤) (흐름 지도 focus: "europe" 예시) */
export const flowMapEuropeSample = [
  { from: "Frankfurt", to: "London", tons: 4_200 }, { from: "London", to: "Frankfurt", tons: 2_600 }, { from: "Frankfurt", to: "Madrid", tons: 2_100 },
  { from: "Paris", to: "Rome", tons: 1_800 }, { from: "Frankfurt", to: "Warsaw", tons: 1_500 }, { from: "Paris", to: "Lisbon", tons: 1_200 },
  { from: "Frankfurt", to: "Stockholm", tons: 1_100 }, { from: "Istanbul", to: "Frankfurt", tons: 1_700 }, { from: "Paris", to: "Athens", tons: 900 },
  { from: "London", to: "Dublin", tons: 800 }, { from: "Frankfurt", to: "Helsinki", tons: 600 },
];
export const flowMapEuropePlaces: Record<string, [number, number]> = {
  Frankfurt: [8.68, 50.11], London: [-0.13, 51.51], Madrid: [-3.7, 40.42], Paris: [2.35, 48.86], Rome: [12.5, 41.9], Warsaw: [21.01, 52.23],
  Lisbon: [-9.14, 38.72], Stockholm: [18.07, 59.33], Istanbul: [28.98, 41.01], Athens: [23.73, 37.98], Dublin: [-6.26, 53.35], Helsinki: [24.94, 60.17],
};

/** 이천 물류 센터에서 나간 물량(천 상자) (흐름 지도 한국 변형과 한국어 예시) */
export const flowMapKrSample = [
  { from: "Icheon hub", to: "Busan", boxes: 412 }, { from: "Icheon hub", to: "Daegu", boxes: 268 }, { from: "Icheon hub", to: "Gwangju", boxes: 231 },
  { from: "Icheon hub", to: "Daejeon", boxes: 205 }, { from: "Icheon hub", to: "Changwon", boxes: 174 }, { from: "Icheon hub", to: "Jeonju", boxes: 121 },
  { from: "Icheon hub", to: "Wonju", boxes: 96 }, { from: "Icheon hub", to: "Jeju", boxes: 88 }, { from: "Icheon hub", to: "Gangneung", boxes: 54 },
];
export const flowMapKrSampleKo = /* @__PURE__ */ relabel(flowMapKrSample, KR_CITIES);
export const flowMapKrPlaces: Record<string, [number, number]> = {
  "Icheon hub": [127.44, 37.27], Busan: [129.08, 35.18], Daegu: [128.6, 35.87], Gwangju: [126.85, 35.16], Daejeon: [127.38, 36.35],
  Changwon: [128.68, 35.23], Jeonju: [127.15, 35.82], Wonju: [127.95, 37.34], Jeju: [126.53, 33.5], Gangneung: [128.88, 37.75],
};
/** 한국어 이름을 열쇠로 한 같은 자리 */
export const flowMapKrPlacesKo = /* @__PURE__ */ relabelKeys(flowMapKrPlaces, KR_CITIES);
