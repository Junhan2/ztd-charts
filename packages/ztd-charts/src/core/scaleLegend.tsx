import type { Painter } from "../theme/context";
import { Txt } from "./ChartFrame";
import { scaleSwatch, type ColorScaleOptions } from "./palette";
import { textWidth } from "./text";

/** Width of the color scale legend: n cells and the labels at both ends */
export function scaleLegendWidth(steps: number, labels: readonly [string, string]): number {
  return textWidth(labels[0], 10) + 10 + steps * 14 + textWidth(labels[1], 10);
}

/**
 * Color scale legend at the top (heatmap, tile grid map). Each cell takes its scaleSwatch color, with labels at both ends.
 * right is the x where the right label ends; min is the opacity of the faintest cell (the same value as the chart cells)
 */
export function ScaleLegend({ p, right, steps, scale, labels, min }: { p: Painter; right: number; steps: number; scale: ColorScaleOptions; labels: readonly [string, string]; min: number }) {
  const center = scale.center;
  // Reference x of the cell row: the first cell starts 6 left of it, and the left label ends 10 left of it (the same calculation order as heatmap, so the coordinates match exactly)
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
