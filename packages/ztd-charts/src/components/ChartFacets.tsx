import { useContext, useId, useMemo, type ComponentType, type CSSProperties } from "react";
import { CardTitleContext } from "../core/cardTitle";
// 패널은 늘 ChartFrame을 쓰는 차트라서 같은 숨김 스타일을 가져다 써도 번들이 늘지 않아요
import { SR_ONLY } from "../core/ChartFrame";
import { cssEntrance, useCssEntrance } from "../core/css";
import { isBrowser } from "../core/env";
import { FACET_GAP, FACET_ROW_GAP, FACET_TITLE_H, FACET_TITLE_SIZE, planFacets, type FacetScale, type FacetType } from "../core/facet";
import { useHydrated, useMeasuredNode, useReducedMotion } from "../core/hooks";
import { langOf } from "../core/i18n";
import type { Highlight, Row } from "../core/types";
import { useChartLocale, useChartTheme } from "../theme/context";

/** 패널이 차례로 나타나는 간격과 길이(ms) */
const STAGGER = 60;
const FADE_MS = 420;

export interface ChartFacetsProps<T = Row> {
  /**
   * 패널마다 그릴 차트 컴포넌트: LineChart, AreaChart, BarChart, ScatterChart.
   * 컴포넌트를 직접 넘겨서 쓰지 않는 차트는 번들에 들어가지 않아요
   */
  chart: ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** chart의 종류. 같은 값 축을 차트와 같은 규칙(쌓기, 0 포함)으로 재는 데 써요 */
  type: FacetType;
  /** 모든 패널의 행. by 값으로 나눠요 */
  data: readonly T[];
  /** 패널을 나눌 필드. 값이 처음 나오는 순서로 패널 하나씩, 24개까지 */
  by: string;
  /** 한 줄 패널 수의 최대값. 없으면 패널 폭 140px 이상으로 들어가는 만큼. 마지막 줄이 혼자 남지 않게 고르게 나눠요 */
  columns?: number;
  /** "shared"(기본): 모든 패널이 같은 값 축(날짜, 숫자 x도)이고 값 축 글자는 왼쪽 열, x 글자는 아래 줄에만. "free": 패널마다 자기 데이터에 맞추고 축 글자를 모두 그려요 */
  scale?: FacetScale;
  /** 패널마다 넘길 차트 프롭 (x, y, series, format, unit, curve …). data, width, height, highlight, syncId, ariaLabel은 패널마다 정해요 */
  chartProps?: Record<string, unknown>;
  /** by 값(또는 by 값 배열)이면 그 패널만 강조색, 나머지 패널은 무채색. 다른 값은 패널마다 그대로 넘겨요 */
  highlight?: Highlight<T>;
  /** 패널을 묶는 이름. 없으면 데이터와 채널로 정한 고정 이름 (짚은 x를 모든 패널이 함께 보여 줘요) */
  syncId?: string;
  /** 전체 폭(px). 없으면 부모 폭에 맞춰요 */
  width?: number;
  /** 패널 하나의 높이(px). 없으면 패널 폭에 맞춰 120~180px */
  height?: number;
  /** 패널 이름의 앞부분: "<title>, <값>". 없으면 감싼 ChartCard의 제목 */
  title?: string;
  /** 묶음 설명(화면 낭독기). 없으면 패널들로 한 문장을 만들어요 */
  description?: string;
  /** 제목 줄 값과 설명의 로캘. 없으면 chartProps.locale, ThemeProvider 순서 */
  locale?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * 작은 여러 개: by 값마다 같은 차트를 한 칸씩 격자로 그려요. 같은 값 축, 하나로 묶인 짚은 x, 패널 단위 강조.
 * 패널마다 키보드 탐색, 라이브 영역, 숨긴 표가 있는 온전한 차트이고 Tab은 읽는 순서(왼쪽에서 오른쪽, 위에서 아래)로 옮겨요.
 * 예: <ChartCard title="Weekly orders"><ChartFacets chart={LineChart} type="line" data={rows} by="region" chartProps={{ x: "week", y: "orders" }} highlight="West" /></ChartCard>
 */
export function ChartFacets<T = Row>(props: ChartFacetsProps<T>) {
  const p = useChartTheme();
  const cp = props.chartProps ?? {};
  const [, ref, measured] = useMeasuredNode<HTMLDivElement>(props.width);
  const width = props.width ?? (measured || 480);
  const locale = useChartLocale(props.locale ?? (cp.locale as string | undefined));
  const lang = langOf(locale);
  const cardTitle = useContext(CardTitleContext);
  const title = props.title ?? cardTitle;
  const plan = useMemo(
    () => planFacets({ type: props.type, data: props.data as readonly Row[], by: props.by, columns: props.columns, scale: props.scale, chartProps: cp, highlight: props.highlight as Highlight<Row> | undefined, syncId: props.syncId, width, height: props.height, title, locale, lang }),
    // chartProps는 렌더마다 새 객체일 수 있어요. 차트가 받는 값이라 바뀌면 다시 짜요
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.type, props.data, props.by, props.columns, props.scale, JSON.stringify(cp, (_, v) => (typeof v === "function" ? String(v) : v)), props.highlight, props.syncId, width, props.height, title, locale, lang],
  );
  const descId = `${useId().replace(/:/g, "")}fd`;
  // 패널은 공용 등장(cssEntrance)으로 차례로 나타나요. 동작 줄이기와 서버 그림을 이어받은 첫 그림에서는 끝 모습 그대로예요
  const reduced = useReducedMotion((cp.reducedMotion as "auto" | boolean | undefined) ?? "auto");
  const hydrated = useHydrated();
  const entrance = useCssEntrance({ motion: { enabled: cp.animate !== false && !reduced && isBrowser }, hydrated }, { waiting: false, generation: 0 });
  const Chart = props.chart;
  return (
    <div ref={ref} role="group" aria-label={title} aria-describedby={descId} className={props.className} style={{ position: "relative", width: "100%", ...props.style }}>
      <p id={descId} style={SR_ONLY}>
        {props.description ?? plan.description}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${plan.cols}, minmax(0, 1fr))`, columnGap: FACET_GAP, rowGap: FACET_ROW_GAP }}>
        {plan.panels.map((pn, i) => {
          const ink = p.paint(pn.isPicked ? "accentText" : plan.isPanelPick ? "muted" : "ink");
          return (
            <div key={pn.value} data-facet={pn.value} style={{ minWidth: 0, ...cssEntrance(entrance, false, "fade", i * STAGGER, FADE_MS) }}>
              {/* 패널 이름은 차트의 이름("<제목>, <값>")에 들어 있어서 화면 낭독기는 건너뛰어요 */}
              <div aria-hidden="true" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: FACET_TITLE_H, fontSize: FACET_TITLE_SIZE, fontWeight: 700, lineHeight: `${FACET_TITLE_H}px`, color: ink }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pn.label}</span>
                {pn.last !== undefined ? <span style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>{pn.last}</span> : null}
              </div>
              <Chart {...cp} {...pn.props} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
