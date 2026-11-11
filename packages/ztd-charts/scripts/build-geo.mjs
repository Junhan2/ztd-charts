// 내장 지도 경계(src/geo/maps/*.ts)를 원본에서 다시 만들어요: node scripts/build-geo.mjs [받은 원본을 둘 폴더]
// 원본은 판을 고정한 주소에서 받고 sha256으로 확인해요. 저장소에는 원본을 두지 않고, 만든 파일만 둬요 (출처와 이용 조건은 NOTICE.md)
// 만드는 일: 쓰지 않는 지역 빼기(미국 자치령), 광주와 전남 합치기(2026-07-01 통합), 선 단순화(미국 주, 한국 시도), 좌표 다시 눈금 맞추기, 압축
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = process.argv[2] ?? join(tmpdir(), "ztd-geo-src");
mkdirSync(cache, { recursive: true });

const SOURCES = {
  world: "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json",
  us: "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json",
  kr: "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/KOR/ADM1/geoBoundaries-KOR-ADM1.topojson",
  // 독도: geoBoundaries KOR ADM1에 없어서 Natural Earth 1:10m 작은 섬(퍼블릭 도메인)에서 가져와요
  islands: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_minor_islands.geojson",
};
// 받은 원본의 sha256. 처음 받을 때 적고, 그 뒤로는 다르면 멈춰요
const hashFile = join(root, "scripts/geo-sources.json");
const HASHES = existsSync(hashFile) ? JSON.parse(readFileSync(hashFile, "utf8")) : {};

async function source(key) {
  const url = SOURCES[key];
  const file = join(cache, url.split("/").pop());
  if (!existsSync(file)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const buf = readFileSync(file);
  const hash = createHash("sha256").update(buf).digest("hex");
  if (HASHES[key] && HASHES[key] !== hash) throw new Error(`${file}: sha256 ${hash}, expected ${HASHES[key]}`);
  HASHES[key] = hash;
  return JSON.parse(buf.toString("utf8"));
}

/** TopoJSON 선을 경위도 점 배열로 */
function arcsOf(topo) {
  const [sx, sy] = topo.transform?.scale ?? [1, 1];
  const [tx, ty] = topo.transform?.translate ?? [0, 0];
  return topo.arcs.map((a) => {
    let x = 0;
    let y = 0;
    return a.map(([dx, dy]) => (topo.transform ? [(x += dx) * sx + tx, (y += dy) * sy + ty] : [dx, dy]));
  });
}
/** 도형의 다각형 목록 (다각형마다 고리마다 선 번호) */
const polysOf = (g) => (g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : []);
const ringPoints = (arcs, ring) => ring.flatMap((a, k) => (a >= 0 ? arcs[a] : [...arcs[~a]].reverse()).slice(k ? 1 : 0));
function ringArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  return s / 2;
}
function inside(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 더글러스-포이커 단순화. 경도는 위도의 cos로 줄여서 재요. 양끝 점은 늘 남아서 이웃 지역과 경계가 어긋나지 않아요 */
function simplify(pts, tol) {
  if (pts.length < 3 || !tol) return pts;
  const k = Math.cos((pts.reduce((s, p) => s + p[1], 0) / pts.length) * (Math.PI / 180));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = [pts[a][0] * k, pts[a][1]];
    const [bx, by] = [pts[b][0] * k, pts[b][1]];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * k - ax;
      const py = pts[i][1] - ay;
      const d = len ? Math.abs(px * dy - py * dx) / len : Math.hypot(px, py);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  // 닫힌 선(첫 점 = 끝 점)은 가운데 점 하나를 더 남겨요 (고리가 납작해지지 않게)
  if (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) keep[Math.floor(pts.length / 3)] = keep[Math.floor((2 * pts.length) / 3)] = 1;
  return pts.filter((_, i) => keep[i]);
}

/**
 * 지역 목록([{ row, polys }], polys는 다각형마다 고리마다 선 번호)과 선을 압축한 꼴로.
 * 선은 단순화하고 step 눈금으로 맞춘 뒤, 이어진 같은 점을 빼요. 점이 3개가 안 되는 고리와 넓이가 0인 고리는 빼고, 바깥 고리가 빠진 다각형도 빼요
 */
function encode(regions, arcs, { step, tol = 0, keep = new Set() }) {
  const used = [...new Set(regions.flatMap((r) => r.polys.flat(2).map((a) => (a < 0 ? ~a : a))))].sort((a, b) => a - b);
  let minX = Infinity;
  let minY = Infinity;
  for (const i of used)
    for (const [x, y] of arcs[i]) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
    }
  const tx = Math.floor(minX / step) * step;
  const ty = Math.floor(minY / step) * step;
  const q = new Map();
  for (const i of used) {
    const pts = simplify(arcs[i], keep.has(i) ? 0 : tol).map(([x, y]) => [Math.round((x - tx) / step), Math.round((y - ty) / step)]);
    const out = pts.filter((p, k) => k === 0 || p[0] !== pts[k - 1][0] || p[1] !== pts[k - 1][1]);
    if (out.length < 2) out.push(out[0]);
    q.set(i, out);
  }
  const qArcs = (i) => q.get(i);
  const keptPolys = (polys) =>
    polys
      .map((rings) =>
        rings.filter((ring) => {
          const pts = ring.flatMap((a, k) => (a >= 0 ? qArcs(a) : [...qArcs(~a)].reverse()).slice(k ? 1 : 0));
          return new Set(pts.map((p) => p.join())).size >= 3 && ringArea(pts) !== 0;
        }),
      )
      .filter((rings, k) => rings.length && rings[0] === polys[k][0]);
  const finalRegions = regions.map((r) => ({ ...r, polys: keptPolys(r.polys) }));
  // 남은 선만 다시 번호를 매겨요
  const left = [...new Set(finalRegions.flatMap((r) => r.polys.flat(2).map((a) => (a < 0 ? ~a : a))))].sort((a, b) => a - b);
  const index = new Map(left.map((a, k) => [a, k]));
  const ints = [];
  for (const a of left) {
    const pts = qArcs(a);
    ints.push(pts.length);
    let px = 0;
    let py = 0;
    for (const [x, y] of pts) {
      ints.push(x - px, y - py);
      px = x;
      py = y;
    }
  }
  const shapes = [];
  for (const r of finalRegions) {
    shapes.push(r.polys.length);
    for (const rings of r.polys) {
      shapes.push(rings.length);
      for (const ring of rings) {
        shapes.push(ring.length);
        for (const a of ring) shapes.push(a < 0 ? ~index.get(~a) : index.get(a));
      }
    }
  }
  const points = left.reduce((s, a) => s + qArcs(a).length, 0);
  return { t: [round(step), round(tx), round(ty)], arcs: pack(ints), shapes: pack(shapes), points, arcCount: left.length, regions: finalRegions };
}
const round = (n) => Number(n.toFixed(6));

/** 정수 목록을 글자로: 지그재그(0, -1, 1, -2 …)로 음수를 없애고, 한 글자에 5비트씩 (6번째 비트는 이어짐). 글자표는 base64url */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function pack(ints) {
  let s = "";
  for (const n of ints) {
    let z = n >= 0 ? n * 2 : -n * 2 - 1;
    while (z >= 32) {
      s += B64[32 + (z % 32)];
      z = Math.floor(z / 32);
    }
    s += B64[z];
  }
  return s;
}

/** 두 지역(다각형 목록)을 하나로: 둘이 같이 쓰는 선을 지우고 남은 선을 고리로 다시 이어요. 다른 고리 안에 든 고리는 구멍이에요 */
function merge(polysA, polysB, arcs) {
  const refs = [...polysA, ...polysB].flat(2);
  const count = new Map();
  for (const a of refs) count.set(a < 0 ? ~a : a, (count.get(a < 0 ? ~a : a) ?? 0) + 1);
  const left = refs.filter((a) => count.get(a < 0 ? ~a : a) === 1);
  const pts = (a) => (a >= 0 ? arcs[a] : [...arcs[~a]].reverse());
  const key = (p) => p.join();
  const byStart = new Map();
  for (const a of left) {
    const k = key(pts(a)[0]);
    byStart.set(k, [...(byStart.get(k) ?? []), a]);
  }
  const usedArc = new Set();
  const rings = [];
  for (const a of left) {
    if (usedArc.has(a)) continue;
    const ring = [];
    let cur = a;
    while (cur !== undefined && !usedArc.has(cur)) {
      usedArc.add(cur);
      ring.push(cur);
      const end = pts(cur).at(-1);
      cur = (byStart.get(key(end)) ?? []).find((b) => !usedArc.has(b));
    }
    const first = pts(ring[0])[0];
    const last = pts(ring.at(-1)).at(-1);
    if (key(first) !== key(last)) throw new Error("merge: ring did not close");
    rings.push(ring);
  }
  const geo = rings.map((r) => ringPoints(arcs, r));
  const holes = rings.map((_, i) => geo.some((g, j) => j !== i && Math.abs(ringArea(g)) > Math.abs(ringArea(geo[i])) && inside(geo[i][0], g)));
  return rings
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => !holes[i])
    .map(({ r, i }) => [r, ...rings.filter((_, j) => holes[j] && inside(geo[j][0], geo[i]))]);
}

// ── 세계 ──────────────────────────────────────────────────────────────
// 줄마다 ISO 3166-1 숫자, 알파-2, 알파-3, UN M49 대륙 (AF 아프리카, AM 아메리카, AS 아시아, EU 유럽, OC 오세아니아, AN 남극)
const ISO = `242 FJ FJI OC|834 TZ TZA AF|732 EH ESH AF|124 CA CAN AM|840 US USA AM|398 KZ KAZ AS|860 UZ UZB AS|598 PG PNG OC|360 ID IDN AS|032 AR ARG AM|152 CL CHL AM|180 CD COD AF|706 SO SOM AF|404 KE KEN AF|729 SD SDN AF|148 TD TCD AF|332 HT HTI AM|214 DO DOM AM|643 RU RUS EU|044 BS BHS AM|238 FK FLK AM|578 NO NOR EU|304 GL GRL AM|260 TF ATF AF|626 TL TLS AS|710 ZA ZAF AF|426 LS LSO AF|484 MX MEX AM|858 UY URY AM|076 BR BRA AM|068 BO BOL AM|604 PE PER AM|170 CO COL AM|591 PA PAN AM|188 CR CRI AM|558 NI NIC AM|340 HN HND AM|222 SV SLV AM|320 GT GTM AM|084 BZ BLZ AM|862 VE VEN AM|328 GY GUY AM|740 SR SUR AM|250 FR FRA EU|218 EC ECU AM|630 PR PRI AM|388 JM JAM AM|192 CU CUB AM|716 ZW ZWE AF|072 BW BWA AF|516 NA NAM AF|686 SN SEN AF|466 ML MLI AF|478 MR MRT AF|204 BJ BEN AF|562 NE NER AF|566 NG NGA AF|120 CM CMR AF|768 TG TGO AF|288 GH GHA AF|384 CI CIV AF|324 GN GIN AF|624 GW GNB AF|430 LR LBR AF|694 SL SLE AF|854 BF BFA AF|140 CF CAF AF|178 CG COG AF|266 GA GAB AF|226 GQ GNQ AF|894 ZM ZMB AF|454 MW MWI AF|508 MZ MOZ AF|748 SZ SWZ AF|024 AO AGO AF|108 BI BDI AF|376 IL ISR AS|422 LB LBN AS|450 MG MDG AF|275 PS PSE AS|270 GM GMB AF|788 TN TUN AF|012 DZ DZA AF|400 JO JOR AS|784 AE ARE AS|634 QA QAT AS|414 KW KWT AS|368 IQ IRQ AS|512 OM OMN AS|548 VU VUT OC|116 KH KHM AS|764 TH THA AS|418 LA LAO AS|104 MM MMR AS|704 VN VNM AS|408 KP PRK AS|410 KR KOR AS|496 MN MNG AS|356 IN IND AS|050 BD BGD AS|064 BT BTN AS|524 NP NPL AS|586 PK PAK AS|004 AF AFG AS|762 TJ TJK AS|417 KG KGZ AS|795 TM TKM AS|364 IR IRN AS|760 SY SYR AS|051 AM ARM AS|752 SE SWE EU|112 BY BLR EU|804 UA UKR EU|616 PL POL EU|040 AT AUT EU|348 HU HUN EU|498 MD MDA EU|642 RO ROU EU|440 LT LTU EU|428 LV LVA EU|233 EE EST EU|276 DE DEU EU|100 BG BGR EU|300 GR GRC EU|792 TR TUR AS|008 AL ALB EU|191 HR HRV EU|756 CH CHE EU|442 LU LUX EU|056 BE BEL EU|528 NL NLD EU|620 PT PRT EU|724 ES ESP EU|372 IE IRL EU|540 NC NCL OC|090 SB SLB OC|554 NZ NZL OC|036 AU AUS OC|144 LK LKA AS|156 CN CHN AS|158 TW TWN AS|380 IT ITA EU|208 DK DNK EU|826 GB GBR EU|352 IS ISL EU|031 AZ AZE AS|268 GE GEO AS|608 PH PHL AS|458 MY MYS AS|096 BN BRN AS|705 SI SVN EU|246 FI FIN EU|703 SK SVK EU|203 CZ CZE EU|232 ER ERI AF|392 JP JPN AS|600 PY PRY AM|887 YE YEM AS|682 SA SAU AS|010 AQ ATA AN|196 CY CYP AS|504 MA MAR AF|818 EG EGY AF|434 LY LBY AF|231 ET ETH AF|262 DJ DJI AF|800 UG UGA AF|646 RW RWA AF|070 BA BIH EU|807 MK MKD EU|688 RS SRB EU|499 ME MNE EU|780 TT TTO AM|728 SS SSD AF`;
// 숫자 코드가 없는 세 곳: 이름으로 맞춰요. 코소보는 널리 쓰는 사용자 지정 코드 XK, XKX
const NO_ISO = { Kosovo: ["XKX", "Kosovo", "EU", "XK", "Republic of Kosovo"], "N. Cyprus": ["Northern Cyprus", "Northern Cyprus", "AS", "N. Cyprus", "Turkish Republic of Northern Cyprus"], Somaliland: ["Somaliland", "Somaliland", "AF"] };
// 보여 줄 이름: CLDR 영어 이름(Intl.DisplayNames)을 기본으로, 차트에 어색한 것만 바꿔요
const NAME = { COD: "DR Congo", COG: "Congo", MMR: "Myanmar", BIH: "Bosnia and Herzegovina", PSE: "Palestine", CIV: "Côte d'Ivoire", TLS: "Timor-Leste" };
// 데이터에서 자주 보는 다른 이름 (ISO 3166 영어 이름, 흔한 줄임말과 옛 이름)
const ALIAS = {
  USA: ["United States of America", "USA", "U.S.", "U.S.A.", "America"],
  GBR: ["UK", "U.K.", "Great Britain", "Britain", "United Kingdom of Great Britain and Northern Ireland"],
  KOR: ["Korea, Republic of", "Republic of Korea", "Korea", "Korea, South", "S. Korea"],
  PRK: ["Korea, Democratic People's Republic of", "Democratic People's Republic of Korea", "DPRK", "Korea, North", "N. Korea"],
  RUS: ["Russian Federation"],
  IRN: ["Iran, Islamic Republic of", "Islamic Republic of Iran"],
  VNM: ["Viet Nam"],
  LAO: ["Lao People's Democratic Republic", "Lao PDR"],
  SYR: ["Syrian Arab Republic"],
  BOL: ["Bolivia, Plurinational State of"],
  VEN: ["Venezuela, Bolivarian Republic of"],
  TZA: ["Tanzania, United Republic of", "United Republic of Tanzania"],
  MDA: ["Moldova, Republic of", "Republic of Moldova"],
  COD: ["Congo, The Democratic Republic of the", "Congo, Democratic Republic of the", "Democratic Republic of the Congo", "DRC", "Congo-Kinshasa", "Congo (Kinshasa)", "Congo, Dem. Rep."],
  COG: ["Republic of the Congo", "Congo-Brazzaville", "Congo (Brazzaville)", "Congo, Rep."],
  CZE: ["Czech Republic"],
  MKD: ["Macedonia", "Republic of North Macedonia"],
  SWZ: ["Swaziland"],
  CIV: ["Cote d'Ivoire", "Ivory Coast"],
  TUR: ["Turkey", "Turkiye"],
  MMR: ["Burma"],
  TLS: ["East Timor"],
  BRN: ["Brunei Darussalam"],
  PSE: ["State of Palestine", "Palestine, State of", "Palestinian Territories"],
  TWN: ["Taiwan, Province of China"],
  BIH: ["Bosnia & Herzegovina"],
  FLK: ["Falkland Islands (Malvinas)"],
  ATF: ["French Southern and Antarctic Lands"],
  NLD: ["The Netherlands", "Holland"],
  BHS: ["The Bahamas"],
  GMB: ["The Gambia"],
  ARE: ["UAE", "U.A.E."],
  CHN: ["People's Republic of China", "PRC"],
  SVK: ["Slovak Republic"],
  KGZ: ["Kyrgyz Republic"],
};
const FOCUS = {
  // [서, 남, 동, 북] 경위도 상자와 중앙 경선. 상자 밖 지역은 그리지 않고, 상자 안의 다른 대륙 지역은 옅은 바탕으로만 그려요
  europe: { box: [-25, 34, 45, 71.5], lon0: 10, group: "EU" },
  asia: { box: [25, -11, 150, 56], lon0: 90, group: "AS" },
  africa: { box: [-19, -36, 53, 38], lon0: 17, group: "AF" },
  americas: { box: [-170, -56, -30, 84], lon0: -90, group: "AM" },
  oceania: { box: [110, -48, 185, 2], lon0: 150, group: "OC" },
};

async function buildWorld() {
  const topo = await source("world");
  const arcs = arcsOf(topo);
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const iso = new Map(ISO.split("|").map((l) => l.split(" ")).map(([n, a2, a3, c]) => [n, { a2, a3, c }]));
  const regions = topo.objects.countries.geometries.map((g) => {
    const src = g.properties.name;
    let row;
    let group;
    if (g.id) {
      const c = iso.get(g.id);
      if (!c) throw new Error(`no ISO row for ${g.id} ${src}`);
      const cldr = names.of(c.a2);
      const name = NAME[c.a3] ?? cldr.replace(" & ", " and ");
      row = [c.a3, name, c.a2, g.id, ...new Set([cldr, src, ...(ALIAS[c.a3] ?? [])].filter((n) => n && ![name, c.a3, c.a2, g.id].includes(n)))];
      group = c.c;
    } else {
      const [id, name, c, ...rest] = NO_ISO[src];
      row = [id, name, ...new Set([src, ...rest].filter((n) => n !== name && n !== id))];
      group = c;
    }
    return { row, group, polys: polysOf(g) };
  });
  // 이름이 한 나라에만 있는지 봐요 (CLDR 이름과 다른 이름이 겹치면 맞추기가 앞 나라로 가요)
  const seen = new Map();
  for (const r of regions) for (const n of r.row) {
    const k = n.toLowerCase();
    if (seen.has(k) && seen.get(k) !== r.row[0]) throw new Error(`name ${n} is used by ${seen.get(k)} and ${r.row[0]}`);
    seen.set(k, r.row[0]);
  }
  const enc = encode(regions, arcs, { step: 0.01 });
  const focus = Object.fromEntries(Object.entries(FOCUS).map(([k, f]) => [k, { box: f.box, lon0: f.lon0, ids: enc.regions.filter((r) => r.group === f.group).map((r) => r.row[0]).join(" ") }]));
  return { enc, focus };
}

// ── 미국 주 ───────────────────────────────────────────────────────────
async function buildUs() {
  const topo = await source("us");
  const arcs = arcsOf(topo);
  const table = readFileSync(join(root, "src/data/usStates.ts"), "utf8");
  const rows = [...table.matchAll(/\["([A-Z]{2})", "([^"]+)", "(\d{2})"\]/g)].map((m) => ({ postal: m[1], name: m[2], fips: m[3] }));
  if (rows.length !== 51) throw new Error(`usStates.ts: ${rows.length} rows`);
  const byFips = new Map(topo.objects.states.geometries.map((g) => [g.id, g]));
  const regions = rows.map((r) => {
    const g = byFips.get(r.fips);
    if (!g || g.properties.name !== r.name) throw new Error(`us-atlas ${r.fips}: ${g?.properties.name} != ${r.name}`);
    return { row: [r.postal], polys: polysOf(g) };
  });
  return { enc: encode(regions, arcs, { step: 0.01, tol: 0.03 }) };
}

// ── 한국 시도 ─────────────────────────────────────────────────────────
async function buildKr() {
  const topo = await source("kr");
  const arcs = arcsOf(topo);
  const geoms = Object.values(topo.objects)[0].geometries;
  const byIso = new Map(geoms.map((g) => [g.properties.shapeISO, g]));
  // geoBoundaries의 ISO 코드 → krRegions.ts의 id. 강원(KR-42), 전북(KR-45)은 옛 코드로 와요
  const ID = { "KR-11": "Seoul", "KR-26": "Busan", "KR-27": "Daegu", "KR-28": "Incheon", "KR-30": "Daejeon", "KR-31": "Ulsan", "KR-50": "Sejong", "KR-41": "Gyeonggi", "KR-42": "Gangwon", "KR-43": "Chungbuk", "KR-44": "Chungnam", "KR-45": "Jeonbuk", "KR-47": "Gyeongbuk", "KR-48": "Gyeongnam", "KR-49": "Jeju" };
  const regions = Object.entries(ID).map(([code, id]) => ({ row: [id], polys: polysOf(byIso.get(code)) }));
  // 광주(KR-29)와 전남(KR-46)을 전남광주로 (2026-07-01). 순서는 krRegions.ts 와 같게 맨 끝
  const merged = merge(polysOf(byIso.get("KR-46")), polysOf(byIso.get("KR-29")), arcs);
  regions.push({ row: ["Jeonnam-Gwangju"], polys: merged });
  // 독도(경북 울릉군)를 경북의 다각형 하나로 더해요. Natural Earth 작은 섬 가운데 무게중심이 131.86°E, 37.24°N 근처인 것 하나예요
  const islands = await source("islands");
  const near = islands.features.filter((f) => {
    if (f.geometry?.type !== "Polygon") return false;
    const r = f.geometry.coordinates[0];
    const cx = r.reduce((t, p) => t + p[0], 0) / r.length;
    const cy = r.reduce((t, p) => t + p[1], 0) / r.length;
    return Math.abs(cx - 131.865) < 0.03 && Math.abs(cy - 37.242) < 0.03;
  });
  if (near.length !== 1) throw new Error(`Dokdo: ${near.length} Natural Earth minor islands near 131.865E 37.242N`);
  arcs.push(near[0].geometry.coordinates[0]);
  const dokdo = arcs.length - 1;
  regions.find((r) => r.row[0] === "Gyeongbuk").polys.push([[dokdo]]);
  // 독도는 아주 작아서 단순화하지 않아요 (단순화하면 점이 모자라 빠져요)
  return { enc: encode(regions, arcs, { step: 0.001, tol: 0.004, keep: new Set([dokdo]) }) };
}

function write(file, name, comment, body) {
  const text = `// scripts/build-geo.mjs 가 만든 파일이에요. 손으로 고치지 말고 스크립트를 고쳐서 다시 만들어 주세요\n// ${comment}\n${body}\n`;
  writeFileSync(join(root, "src/geo/maps", file), text);
  console.log(`${name}: ${Buffer.byteLength(text)} B`);
}
const topoText = (e) => `{ t: ${JSON.stringify(e.t)}, arcs: ${JSON.stringify(e.arcs)}, shapes: ${JSON.stringify(e.shapes)} }`;

mkdirSync(join(root, "src/geo/maps"), { recursive: true });
const w = await buildWorld();
write(
  "worldData.ts",
  "world",
  `Natural Earth 1:110m 나라 경계(퍼블릭 도메인), world-atlas 2.0.2(ISC) 판. 나라 ${w.enc.regions.length}곳, 선 ${w.enc.arcCount}개, 점 ${w.enc.points}개`,
  `import type { GeoMap } from "../types";\n\n/** 줄마다 [id(ISO 알파-3), 영어 이름, 받는 이름...] */\nexport const WORLD_REGIONS: GeoMap["regions"] = ${JSON.stringify(w.enc.regions.map((r) => r.row))};\nexport const WORLD_FOCUS: NonNullable<GeoMap["focus"]> = ${JSON.stringify(w.focus)};\nexport const WORLD_TOPO: GeoMap["topo"] = ${topoText(w.enc)};`,
);
const u = await buildUs();
write("usStatesData.ts", "us-states", `미국 인구조사국 주 경계(퍼블릭 도메인), us-atlas 3.0.1(ISC)의 states-10m을 단순화. 주 50곳과 DC, 선 ${u.enc.arcCount}개, 점 ${u.enc.points}개`, `import type { GeoMap } from "../types";\n\nexport const US_TOPO: GeoMap["topo"] = ${topoText(u.enc)};`);
const k = await buildKr();
write("krSidoData.ts", "kr-sido", `geoBoundaries KOR ADM1(퍼블릭 도메인, Natural Earth 기반)을 단순화하고 광주와 전남을 합침. 독도는 Natural Earth 1:10m 작은 섬(퍼블릭 도메인)에서 경북에 더함. 시도 ${k.enc.regions.length}곳, 선 ${k.enc.arcCount}개, 점 ${k.enc.points}개`, `import type { GeoMap } from "../types";\n\nexport const KR_TOPO: GeoMap["topo"] = ${topoText(k.enc)};`);
writeFileSync(hashFile, `${JSON.stringify(HASHES, null, 2)}\n`);
