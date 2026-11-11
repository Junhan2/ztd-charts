/**
 * 미국 주 50곳과 워싱턴 DC (타일 격자 지도의 us-states, 지도 ztd-charts/geo/us-states).
 * 줄마다 [우편 약자, 영어 이름, FIPS 코드]예요. 이름은 미국 인구조사국 표기(us-atlas)와 같아요
 */
export const US_STATES: readonly (readonly [string, string, string])[] = [
  ["AL", "Alabama", "01"],
  ["AK", "Alaska", "02"],
  ["AZ", "Arizona", "04"],
  ["AR", "Arkansas", "05"],
  ["CA", "California", "06"],
  ["CO", "Colorado", "08"],
  ["CT", "Connecticut", "09"],
  ["DE", "Delaware", "10"],
  ["DC", "District of Columbia", "11"],
  ["FL", "Florida", "12"],
  ["GA", "Georgia", "13"],
  ["HI", "Hawaii", "15"],
  ["ID", "Idaho", "16"],
  ["IL", "Illinois", "17"],
  ["IN", "Indiana", "18"],
  ["IA", "Iowa", "19"],
  ["KS", "Kansas", "20"],
  ["KY", "Kentucky", "21"],
  ["LA", "Louisiana", "22"],
  ["ME", "Maine", "23"],
  ["MD", "Maryland", "24"],
  ["MA", "Massachusetts", "25"],
  ["MI", "Michigan", "26"],
  ["MN", "Minnesota", "27"],
  ["MS", "Mississippi", "28"],
  ["MO", "Missouri", "29"],
  ["MT", "Montana", "30"],
  ["NE", "Nebraska", "31"],
  ["NV", "Nevada", "32"],
  ["NH", "New Hampshire", "33"],
  ["NJ", "New Jersey", "34"],
  ["NM", "New Mexico", "35"],
  ["NY", "New York", "36"],
  ["NC", "North Carolina", "37"],
  ["ND", "North Dakota", "38"],
  ["OH", "Ohio", "39"],
  ["OK", "Oklahoma", "40"],
  ["OR", "Oregon", "41"],
  ["PA", "Pennsylvania", "42"],
  ["RI", "Rhode Island", "44"],
  ["SC", "South Carolina", "45"],
  ["SD", "South Dakota", "46"],
  ["TN", "Tennessee", "47"],
  ["TX", "Texas", "48"],
  ["UT", "Utah", "49"],
  ["VT", "Vermont", "50"],
  ["VA", "Virginia", "51"],
  ["WA", "Washington", "53"],
  ["WV", "West Virginia", "54"],
  ["WI", "Wisconsin", "55"],
  ["WY", "Wyoming", "56"],
];

/** 우편 약자, 이름, FIPS, "US-CA" 꼴(ISO 3166-2) 말고 더 받는 이름 */
const US_ALIASES: Readonly<Record<string, readonly string[]>> = { DC: ["Washington, D.C.", "Washington DC", "D.C."] };

/** 주 한 줄의 받는 이름 (이름과 우편 약자 말고): FIPS, "US-CA", 다른 이름. 타일 격자와 지도가 같이 써요 */
export function usStateKeys([postal, , fips]: readonly [string, string, string]): string[] {
  return [fips, `US-${postal}`, ...(US_ALIASES[postal] ?? [])];
}

/**
 * 타일 격자 지도의 us-states 배치 (8줄 × 11칸). 줄마다 왼쪽부터 우편 약자이고 "-"는 빈 칸이에요.
 * 이웃한 주가 위아래, 좌우로 이웃하게 직접 정한 배치예요 (알래스카는 왼쪽 위, 하와이는 왼쪽 아래)
 */
export const US_LAYOUT: readonly string[] = [
  "AK - - - - - - - - - ME",
  "- - - - - WI - - - VT NH",
  "WA ID MT ND MN IL MI - NY MA -",
  "OR NV WY SD IA IN OH PA NJ CT RI",
  "CA UT CO NE MO KY WV VA MD DE -",
  "- AZ NM KS AR TN NC SC DC - -",
  "- - - OK LA MS AL GA - - -",
  "HI - - TX - - - FL - - -",
];
