/**
 * Labels for South Korea's provincial-level divisions (kr-sido and kr-sido-2025 of the tile grid map).
 * Each row is [id (short English name), short Korean name, other accepted names...]. Accepted names are official names, former official names, English names and ISO 3166-2 codes.
 * On 2026-07-01, Gwangju Metropolitan City and South Jeolla Province merged into Jeonnam Gwangju Integrated Special City. The merged region has no confirmed ISO code yet, so none is listed.
 */
export const KR_REGIONS: readonly (readonly string[])[] = [
  ["Seoul", "서울", "서울특별시", "서울시", "KR-11"],
  ["Busan", "부산", "부산광역시", "부산시", "KR-26"],
  ["Daegu", "대구", "대구광역시", "대구시", "KR-27"],
  ["Incheon", "인천", "인천광역시", "인천시", "KR-28"],
  // "광주시" is not accepted because it clashes with Gwangju-si in Gyeonggi-do
  ["Gwangju", "광주", "광주광역시", "KR-29"],
  ["Daejeon", "대전", "대전광역시", "대전시", "KR-30"],
  ["Ulsan", "울산", "울산광역시", "울산시", "KR-31"],
  ["Sejong", "세종", "세종특별자치시", "세종시", "KR-50"],
  ["Gyeonggi", "경기", "경기도", "Gyeonggi-do", "KR-41"],
  ["Gangwon", "강원", "강원특별자치도", "강원도", "Gangwon-do", "KR-51", "KR-42"],
  ["Chungbuk", "충북", "충청북도", "Chungcheongbuk-do", "North Chungcheong", "KR-43"],
  ["Chungnam", "충남", "충청남도", "Chungcheongnam-do", "South Chungcheong", "KR-44"],
  ["Jeonbuk", "전북", "전북특별자치도", "전라북도", "Jeollabuk-do", "North Jeolla", "KR-52", "KR-45"],
  ["Jeonnam", "전남", "전라남도", "Jeollanam-do", "South Jeolla", "KR-46"],
  ["Gyeongbuk", "경북", "경상북도", "Gyeongsangbuk-do", "North Gyeongsang", "KR-47"],
  ["Gyeongnam", "경남", "경상남도", "Gyeongsangnam-do", "South Gyeongsang", "KR-48"],
  ["Jeju", "제주", "제주특별자치도", "제주도", "Jeju-do", "KR-49"],
  ["Jeonnam-Gwangju", "전남광주", "전남광주통합특별시", "Jeonnam Gwangju", "Gwangju-Jeonnam", "광주전남"],
];

/** Grid layouts. Each row lists ids from the left; "-" is an empty cell */
export const KR_LAYOUTS: Readonly<Record<string, readonly string[]>> = {
  "kr-sido": ["Incheon Seoul Gyeonggi Gangwon", "Chungnam Sejong Chungbuk Gyeongbuk", "Jeonbuk Daejeon Daegu Ulsan", "Jeonnam-Gwangju Gyeongnam Busan -", "Jeju - - -"],
  "kr-sido-2025": ["Incheon Seoul Gyeonggi Gangwon", "Chungnam Sejong Chungbuk Gyeongbuk", "Jeonbuk Daejeon Daegu Ulsan", "Gwangju Jeonnam Gyeongnam Busan", "- Jeju - -"],
};

/** Grid → the pre-merger grid and the ids of the regions merged away in between. In kr-sido, Gwangju and Jeonnam were merged into one (2026-07-01) */
export const KR_MERGED: Readonly<Record<string, { before: string; ids: readonly string[] }>> = {
  "kr-sido": { before: "kr-sido-2025", ids: ["Gwangju", "Jeonnam"] },
};
