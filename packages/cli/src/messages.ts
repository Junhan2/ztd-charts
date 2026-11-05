import { plural } from "ztd-charts/server";
import type { ColumnProfile } from "ztd-charts/spec";

/** CLI 문구. 영어가 원본이고 --locale ko면 한국어 */
export const VERSION = "0.2.1";

export const SCHEMA_URL = "https://unpkg.com/ztd-charts/schema/chart-spec.schema.json";

const en = {
  help: `ztd-charts ${VERSION}  CLI for 33 React chart types

Usage
  ztd-charts list [--group proportion] [--level basic] [--json]
  ztd-charts info <type> [--json]          Chart description, options, example spec, React code
  ztd-charts schema [type] [--out file]    JSON Schema (all charts or one)
  ztd-charts example <type> [--out file]   Example spec JSON
  ztd-charts validate <spec.json> [--json]
  ztd-charts render <spec.json> --out chart.svg|chart.png|chart.html
         [--width 720] [--height 240] [--theme dark|light] [--scale 2]
         [--no-frame] [--interactive] [--font path.otf]
  ztd-charts init [dir] [--type pie] [--force]
  ztd-charts suggest <data.csv|data.json|URL> [--limit 5] [--json] [--out-dir dir]

Every command
  --locale <code>   Language of messages and chart text, and number format: en (default) or ko

Examples
  ztd-charts init
  ztd-charts suggest charts/sales.csv --out-dir charts
  ztd-charts render charts/01-line.json --out line.png --theme light
  ztd-charts render charts/01-line.json --out line.svg --locale ko
`,
  needSpec: "Missing the spec file path",
  noFile: (f: string) => `File not found: ${f}`,
  badJson: (m: string) => `Couldn't read the JSON: ${m}`,
  needType: (cmd: string) => `Missing the chart type. For example: ztd-charts ${cmd} pie`,
  unknownChart: (t: string) => `Unknown chart: ${t}. Run ztd-charts list to see all types`,
  unknownCommand: (c: string) => `Unknown command: ${c}`,
  needValue: (flag: string) => `--${flag} needs a value`,
  badNumber: (flag: string, v: string) => `--${flag} takes a number above 0. Got: ${v}`,
  badTheme: (v: string) => `--theme takes dark or light. Got: ${v}`,
  badOut: (file: string) => `Can't save ${file}: end the file name with .svg, .png or .html`,
  unknownFilter: (flag: string, v: string, choices: string[]) => `--${flag} takes one of: ${choices.join(", ")}. Got: ${v}`,
  error: (m: string) => `Error: ${m}`,
  /** list 표 머리와 칸 너비 */
  listHead: ["type", "name", "level", "group", "summary"],
  listWidths: [12, 22, 14, 14],
  listFoot: (n: number) => `\n${n} charts. Details: ztd-charts info <type>`,
  useWhen: "Use when",
  avoidWhen: "Avoid when",
  required: "required",
  optional: "optional",
  flagWidth: 10,
  ownOptions: "options (this chart)",
  defaultValue: (v: string) => ` (default ${v})`,
  commonOptions: "Common options",
  exampleSpec: "Example spec",
  saved: (p: string) => `Saved: ${p}`,
  valid: (file: string, type: string, warnings: number) => `✓ ${file}: valid ${type} spec${warnings ? ` (${plural(warnings, "warning")})` : ""}`,
  skipped: (p: string) => `Skipped (already exists): ${p}`,
  created: (p: string) => `Created: ${p}`,
  next: "Next: npm i ztd-charts\nNeeds React 18 or later. The remaining steps are in charts/README.md",
  needData: "Missing a data file or URL. For example: ztd-charts suggest data.csv",
  column: (c: ColumnProfile) => `${c.name} (${c.kind === "number" ? "number" : c.kind === "date" ? "date" : c.kind === "category" ? `category, ${plural(c.distinct, "value")}` : "text"})`,
  data: (rows: number, cols: string) => `Data: ${plural(rows, "row")}, columns ${cols}\n`,
  noFit: "No chart fits this data. Check the column names and formats",
  score: "score",
  /** 데이터 주소 가져오기 (render의 data.url, suggest의 URL) */
  fetchFailed: (url: string, m: string) => `Couldn't load data from ${url}: ${m}`,
  httpOnly: "only http:// and https:// addresses can be fetched",
  timeout: (s: number) => `no response within ${s} seconds`,
  tooLarge: (mb: number) => `the response is larger than ${mb} MB`,
  /** ztd-charts init이 만드는 예시 파일 */
  init: (type: string) => ({
    "charts/sales.csv": "month,channel,revenue\n2025-01,Search,120\n2025-01,Social,64\n2025-02,Search,128\n2025-02,Social,75\n2025-03,Search,131\n2025-03,Social,92\n2025-04,Search,140\n2025-04,Social,104\n",
    "charts/Dashboard.tsx": dashboard(type, {
      comment: "Example: load straight from a CSV (or REST JSON) URL",
      provider: `theme="dark"`,
      card: `title="Monthly revenue" subtitle="By channel ($K)" takeaway="Social is growing fast"`,
      line: `highlight="Social" unit="K"`,
    }),
    "charts/README.md": `# Getting started\n\n1. Install the library: \`npm i ztd-charts\`\n2. Add the dashboard: put \`Dashboard.tsx\` in your app and copy \`sales.csv\` to \`public/charts/\`. The dashboard loads \`/charts/sales.csv\`.\n3. Check the spec: \`npx ztd-charts-cli validate charts/${type}.spec.json\`\n4. Render an image: \`npx ztd-charts-cli render charts/${type}.spec.json --out ${type}.png\`\n5. Get chart ideas for your own data: \`npx ztd-charts-cli suggest charts/sales.csv\`\n`,
  }),
};

export type CliText = typeof en;

const ko: CliText = {
  help: `ztd-charts ${VERSION}  React 차트 33종을 위한 CLI

사용법
  ztd-charts list [--group 비율] [--level 기본] [--json]
  ztd-charts info <type> [--json]          차트 설명, 옵션, 예시 스펙, React 코드
  ztd-charts schema [type] [--out file]    JSON Schema (전체 또는 차트 하나)
  ztd-charts example <type> [--out file]   예시 스펙 JSON
  ztd-charts validate <spec.json> [--json]
  ztd-charts render <spec.json> --out chart.svg|chart.png|chart.html
         [--width 720] [--height 240] [--theme dark|light] [--scale 2]
         [--no-frame] [--interactive] [--font path.otf]
  ztd-charts init [dir] [--type pie] [--force]
  ztd-charts suggest <data.csv|data.json|URL> [--limit 5] [--json] [--out-dir dir]

모든 명령
  --locale <code>   안내 문구, 차트 글자, 숫자 형식의 언어: en(기본) 또는 ko

예시
  ztd-charts init --locale ko
  ztd-charts suggest charts/sales.csv --out-dir charts --locale ko
  ztd-charts render charts/01-line.json --out line.png --theme light --locale ko
`,
  needSpec: "스펙 파일 경로를 넣어 주세요",
  noFile: (f) => `파일이 없어요: ${f}`,
  badJson: (m) => `JSON을 읽지 못했어요: ${m}`,
  needType: (cmd) => `차트 종류를 넣어 주세요. 예: ztd-charts ${cmd} pie`,
  unknownChart: (t) => `알 수 없는 차트: ${t}. ztd-charts list로 차트 종류를 확인해 주세요`,
  unknownCommand: (c) => `알 수 없는 명령: ${c}`,
  needValue: (flag) => `--${flag} 뒤에 값을 넣어 주세요`,
  badNumber: (flag, v) => `--${flag}에는 0보다 큰 숫자를 넣어 주세요. 받은 값: ${v}`,
  badTheme: (v) => `--theme에는 dark나 light를 넣어 주세요. 받은 값: ${v}`,
  badOut: (file) => `파일 이름을 .svg, .png, .html 중 하나로 끝내 주세요. 받은 이름: ${file}`,
  unknownFilter: (flag, v, choices) => `--${flag}에는 다음 중 하나를 넣어 주세요: ${choices.join(", ")}. 받은 값: ${v}`,
  error: (m) => `오류: ${m}`,
  listHead: ["type", "이름", "수준", "묶음", "설명"],
  listWidths: [12, 18, 6, 6],
  listFoot: (n) => `\n${n}종. 자세히: ztd-charts info <type>`,
  useWhen: "쓸 때",
  avoidWhen: "피할 때",
  required: "필수",
  optional: "선택",
  flagWidth: 6,
  ownOptions: "options(차트 전용)",
  defaultValue: (v) => `, 기본 ${v}`,
  commonOptions: "공통 옵션",
  exampleSpec: "예시 스펙",
  saved: (p) => `저장: ${p}`,
  valid: (file, type, warnings) => `✓ ${file}: 올바른 ${type} 스펙${warnings ? `(경고 ${warnings}개)` : ""}`,
  skipped: (p) => `건너뜀(이미 있음): ${p}`,
  created: (p) => `만듦: ${p}`,
  next: "다음: npm i ztd-charts\nReact 18 이상이 필요해요. 이어서 할 일은 charts/README.md에 있어요",
  needData: "데이터 파일이나 URL을 넣어 주세요. 예: ztd-charts suggest data.csv",
  column: (c) => `${c.name}(${c.kind === "number" ? "숫자" : c.kind === "date" ? "날짜" : c.kind === "category" ? `범주 ${c.distinct}개` : "글"})`,
  data: (rows, cols) => `데이터: ${rows}행, 열 ${cols}\n`,
  noFit: "어울리는 차트를 찾지 못했어요. 열 이름과 형식을 확인해 주세요",
  score: "점수",
  fetchFailed: (url, m) => `${url}에서 데이터를 가져오지 못했어요: ${m}`,
  httpOnly: "http://, https:// 주소만 가져올 수 있어요",
  timeout: (s) => `${s}초 안에 응답이 없어요`,
  tooLarge: (mb) => `응답이 ${mb}MB보다 커요`,
  init: (type) => ({
    "charts/sales.csv": "month,channel,revenue\n2025-01,검색,120\n2025-01,SNS,64\n2025-02,검색,128\n2025-02,SNS,75\n2025-03,검색,131\n2025-03,SNS,92\n2025-04,검색,140\n2025-04,SNS,104\n",
    "charts/Dashboard.tsx": dashboard(type, {
      comment: "예시: CSV(또는 REST JSON) 주소에서 바로 불러와요",
      provider: `theme="dark" locale="ko-KR"`,
      card: `title="월 매출" subtitle="채널별(만 원)" takeaway="SNS가 빠르게 커져요"`,
      line: `highlight="SNS" unit="만"`,
    }),
    "charts/README.md": `# 차트 시작하기\n\n1. 라이브러리 설치: \`npm i ztd-charts\`\n2. 대시보드 추가: \`Dashboard.tsx\`를 앱에 넣고 \`sales.csv\`를 \`public/charts/\`에 복사해 주세요. 대시보드가 \`/charts/sales.csv\`를 불러와요.\n3. 스펙 검사: \`npx ztd-charts-cli validate charts/${type}.spec.json\`\n4. 이미지 생성: \`npx ztd-charts-cli render charts/${type}.spec.json --out ${type}.png --locale ko\`\n5. 차트 추천: \`npx ztd-charts-cli suggest charts/sales.csv --locale ko\`\n`,
  }),
};

/** 예시 대시보드 컴포넌트 (언어마다 글만 달라요) */
function dashboard(type: string, t: { comment: string; provider: string; card: string; line: string }): string {
  return `"use client";

import { Chart, ChartCard, ChartGrid, ChartState, LineChart, ThemeProvider, useChartData } from "ztd-charts";
import spec from "./${type}.spec.json";

// ${t.comment}
export function Dashboard() {
  const sales = useChartData("/charts/sales.csv");
  return (
    <ThemeProvider ${t.provider} paint>
      <ChartGrid columns={2}>
        <Chart spec={spec as never} />
        <ChartCard number="02" ${t.card} level="basic" replay>
          <ChartState loading={sales.loading} error={sales.error} empty={sales.empty} onRetry={sales.reload}>
            <LineChart data={sales.data} x="month" y="revenue" series="channel" ${t.line} />
          </ChartState>
        </ChartCard>
      </ChartGrid>
    </ThemeProvider>
  );
}
`;
}

export const CLI_TEXT = { en, ko };
