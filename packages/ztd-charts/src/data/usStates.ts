/**
 * The 50 US states and Washington DC (us-states of the tile grid map, map ztd-charts/geo/us-states).
 * Each row is [postal abbreviation, English name, FIPS code]. Names match the US Census Bureau spelling (us-atlas)
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

/** Accepted names beyond the postal abbreviation, name, FIPS and the "US-CA" form (ISO 3166-2) */
const US_ALIASES: Readonly<Record<string, readonly string[]>> = { DC: ["Washington, D.C.", "Washington DC", "D.C."] };

/** Accepted names for one state row (besides the name and postal abbreviation): FIPS, "US-CA", other names. Shared by the tile grid and the map */
export function usStateKeys([postal, , fips]: readonly [string, string, string]): string[] {
  return [fips, `US-${postal}`, ...(US_ALIASES[postal] ?? [])];
}

/**
 * The us-states layout of the tile grid map (8 rows × 11 cells). Each row lists postal abbreviations from the left; "-" is an empty cell.
 * A hand-made layout where neighboring states sit next to each other vertically and horizontally (Alaska top left, Hawaii bottom left)
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
