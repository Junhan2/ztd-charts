import type { Painter } from "../theme/context";
import { Txt } from "./ChartFrame";
import { scaleSwatch, type ColorScaleOptions } from "./palette";
import { textWidth } from "./text";

/** 색 척도 범례의 폭: 칸 n개와 양끝 이름 */
export function scaleLegendWidth(steps: number, labels: readonly [string, string]): number {
  return textWidth(labels[0], 10) + 10 + steps * 14 + textWidth(labels[1], 10);
}

/**
 * 위쪽 색 척도 범례 (히트맵, 타일 격자 지도). 칸마다 scaleSwatch 색이고, 양끝에 이름을 달아요.
 * right는 오른쪽 이름이 끝나는 x, min은 가장 옅은 칸의 불투명도예요 (차트 칸과 같은 값)
 */
export function ScaleLegend({ p, right, steps, scale, labels, min }: { p: Painter; right: number; steps: number; scale: ColorScaleOptions; labels: readonly [string, string]; min: number }) {
  const center = scale.center;
  // 칸 줄의 기준 x: 첫 칸은 여기서 6 왼쪽, 왼쪽 이름은 10 왼쪽에서 끝나요 (heatmap과 같은 계산 순서라 좌표가 그대로예요)
  const start = right - steps * 14 - textWidth(labels[1], 10);
  return (
    <g aria-hidden="true">
      {Array.from({ length: steps }, (_, k) => {
        const s = scaleSwatch(p, center === undefined ? k / (steps - 1) : (2 * k) / (steps - 1) - 1, min, scale);
        return <rect key={k} x={start - 6 + k * 14} y={3} width={12} height={9} rx={2} fill={s.fill} opacity={s.opacity} />;
      })}
      <Txt x={start - 10} y={7.5} anchor="end" size={10} fill={p.paint("muted")}>
        {labels[0]}
      </Txt>
      <Txt x={right} y={7.5} anchor="end" size={10} fill={p.paint("muted")}>
        {labels[1]}
      </Txt>
    </g>
  );
}
