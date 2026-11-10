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
