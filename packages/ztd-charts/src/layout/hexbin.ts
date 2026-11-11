import { clamp, r2 } from "../core/geometry";

/*
 * 산점도 육각 밀도(options.bin "hex")의 계산. 점을 화면 좌표(축 눈금을 거친 뒤)에서 꼭짓점이 위아래인 육각 칸에 세요.
 * 그래서 로그 축도 그대로 돼요. 산점도 그림과 작은 여러 개의 같은 색 척도(둘 다 charts/scatter-hex.tsx)가 같이 써요
 */

/**
 * 크기 없는 점 그림(bubble.tsx의 PointChart)의 여백(px): 육각 밀도의 위쪽 범례 줄, 아래 x축 글자 줄, 축 범위 안쪽 여유.
 * 작은 여러 개의 같은 색 척도(hexFacetPlan)가 차트와 같은 그림 영역에서 칸을 세려고 같은 값을 써요
 */
export const HEX_TOP = 20;
export const PLOT_BOTTOM = 24;
export const DOT_PAD = 4;

/** 칸 폭(px, 마주 보는 두 변 사이)의 기본값과 범위. 4보다 작으면 칸이 수만 개라 그림이 커지기만 하고, 200보다 크면 칸 하나가 그림을 덮어요 */
export const HEX_SIZE = 16;
export const HEX_MIN = 4;
export const HEX_MAX = 200;

/** 칸 폭. 숫자가 아니거나 유한하지 않으면 기본값, 범위 밖이면 가까운 끝이에요 */
export function hexSize(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, HEX_MIN, HEX_MAX) : HEX_SIZE;
}

/** 칸 하나. col, row는 격자 자리(홀수 줄은 반 칸 오른쪽), cx, cy는 가운데(px) */
export interface HexCell {
  col: number;
  row: number;
  cx: number;
  cy: number;
  count: number;
}

/** 격자: 칸 폭 w, 꼭짓점까지 반지름 r = w/√3, 줄 간격 1.5r. 왼쪽 위 (x0, y0)가 0번 줄 0번 칸의 가운데예요 */
export interface HexGrid {
  w: number;
  r: number;
  x0: number;
  y0: number;
}

/**
 * 격자 칸 수의 상한. hexBins는 격자 칸마다 정수 하나(4바이트)를 잡아서, 서버 렌더에 아주 큰 폭이나 높이(스펙 options.height 등)가 와도
 * 메모리가 약 0.8MB를 넘지 않게 해요. 보통 크기(2400 × 1000px까지 폭 4)는 이보다 작아서 칸 폭이 그대로예요
 */
export const HEX_MAX_CELLS = 200_000;

/** 폭 w 칸으로 그림 영역 box를 덮는 격자 칸 수 (hexBins가 잡는 배열 길이) */
function cellsFor(w: number, box: { x0: number; x1: number; y0: number; y1: number }): number {
  const cols = Math.max(1, Math.ceil((box.x1 - box.x0) / w) + 3);
  const rows = Math.max(1, Math.ceil((box.y1 - box.y0) / ((1.5 * w) / Math.sqrt(3))) + 3);
  return cols * rows;
}

/**
 * 그림 영역 box의 격자. 칸 폭은 hexSize(size)이고, 그 폭으로는 격자 칸이 HEX_MAX_CELLS를 넘으면 넘지 않을 때까지 넓혀요.
 * 그래서 칸 수와 메모리는 그림 크기와 상관없이 정해진 한도 안이에요. 툴팁과 낭독은 이 격자(실제로 그린 칸)로 범위를 적어요
 */
export function hexGrid(size: unknown, box: { x0: number; x1: number; y0: number; y1: number }): HexGrid {
  let w = hexSize(size);
  if (cellsFor(w, box) > HEX_MAX_CELLS) {
    // 넓이 기준으로 한 번에 가까이 간 뒤, 가장자리 칸 몫까지 맞을 때까지 조금씩 넓혀요
    w = Math.max(w, Math.sqrt(((box.x1 - box.x0) * (box.y1 - box.y0) * Math.sqrt(3)) / 1.5 / HEX_MAX_CELLS));
    while (cellsFor(w, box) > HEX_MAX_CELLS) w *= 1.02;
  }
  return { w, r: w / Math.sqrt(3), x0: box.x0, y0: box.y0 };
}

/** 칸의 가운데 (px) */
export function hexCenter(g: HexGrid, col: number, row: number): [number, number] {
  return [g.x0 + (col + (row & 1) / 2) * g.w, g.y0 + row * 1.5 * g.r];
}

/**
 * 점이 드는 칸 [col, row]. 가장 가까운 두 줄에서 각각 가장 가까운 칸을 고르고, 가운데까지 실제 거리가 짧은 쪽이에요.
 * 육각 칸은 가운데가 가장 가까운 점의 모임이라 이 둘 중 하나가 맞아요(세 줄 떨어진 칸은 늘 더 멀어요)
 */
export function hexOf(g: HexGrid, x: number, y: number): [number, number] {
  hexInto(g, x, y, SPOT);
  return [SPOT[0], SPOT[1]];
}

/** hexOf의 몸통: 배열을 새로 만들지 않고 out에 [col, row]를 적어요. 점이 100만 개인 hexBins 반복에서 써요 */
const SPOT = new Int32Array(2);
function hexInto(g: HexGrid, x: number, y: number, out: Int32Array): void {
  const dy = 1.5 * g.r;
  const fy = (y - g.y0) / dy;
  const fx = (x - g.x0) / g.w;
  const j1 = Math.round(fy);
  const j2 = fy < j1 ? j1 - 1 : j1 + 1;
  const i1 = Math.round(fx - (j1 & 1) / 2);
  const i2 = Math.round(fx - (j2 & 1) / 2);
  // 두 후보 칸 가운데까지 거리 (hexCenter와 같은 식)
  const ax = g.x0 + (i1 + (j1 & 1) / 2) * g.w - x;
  const ay = g.y0 + j1 * dy - y;
  const bx = g.x0 + (i2 + (j2 & 1) / 2) * g.w - x;
  const by = g.y0 + j2 * dy - y;
  const first = ax * ax + ay * ay <= bx * bx + by * by;
  out[0] = first ? i1 : i2;
  out[1] = first ? j1 : j2;
}

/**
 * 점을 칸에 한 번에 세요. xs, ys는 화면 좌표이고 [x0, x1] × [y0, y1] 밖의 점과 유한하지 않은 점은 빼요.
 * 칸마다 수는 촘촘한 정수 배열에 세서 점이 100만 개여도 한 번 돌고, 빈 칸은 돌려주지 않아요. 순서는 줄, 칸 순서예요
 */
export function hexBins(g: HexGrid, xs: ArrayLike<number>, ys: ArrayLike<number>, box: { x0: number; x1: number; y0: number; y1: number }): HexCell[] {
  // 가장자리 점은 바깥 칸(-1번, 마지막 + 1번)에도 들어서 앞뒤로 한 칸씩 더 둬요.
  // 격자는 hexGrid가 HEX_MAX_CELLS 안으로 맞춘 것이고, 다른 영역을 넘겨도 배열은 그 한도에서 멈춰요(넘는 줄의 점은 세지 않아요)
  const cols = Math.max(1, Math.ceil((box.x1 - g.x0) / g.w) + 3);
  const rows = Math.min(Math.max(1, Math.ceil((box.y1 - g.y0) / (1.5 * g.r)) + 3), Math.max(1, Math.floor(HEX_MAX_CELLS / cols)));
  const counts = new Int32Array(Math.min(cols * rows, HEX_MAX_CELLS));
  const at = new Int32Array(2);
  for (let k = 0; k < xs.length; k++) {
    const x = xs[k];
    const y = ys[k];
    if (!(x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1)) continue;
    hexInto(g, x, y, at);
    const c = at[0] + 1;
    const rr = at[1] + 1;
    if (c >= 0 && c < cols && rr >= 0 && rr < rows) counts[rr * cols + c]++;
  }
  const out: HexCell[] = [];
  for (let idx = 0; idx < counts.length; idx++) {
    const n = counts[idx];
    if (!n) continue;
    const col = (idx % cols) - 1;
    const row = Math.floor(idx / cols) - 1;
    const [cx, cy] = hexCenter(g, col, row);
    out.push({ col, row, cx, cy, count: n });
  }
  return out;
}

/** 칸 사이 틈(px). 히트맵 칸과 같은 생각으로 칸이 작을수록 좁히고, 아주 작으면 없애요 */
export function hexGap(w: number): number {
  return w > 14 ? 1.5 : w > 6 ? 1 : 0;
}

/**
 * 같은 색 칸을 모은 경로 하나. 칸마다 "M가운데 위 꼭짓점" 뒤에 같은 상대 좌표 여섯 변이라 칸이 수천 개여도 짧아요.
 * gap만큼 칸을 줄여서 이웃 칸 사이에 고른 틈이 생겨요
 */
export function hexPath(g: HexGrid, cells: readonly Pick<HexCell, "cx" | "cy">[], gap = 0): string {
  const r = Math.max(0.1, g.r - gap / Math.sqrt(3));
  const hw = r2((r * Math.sqrt(3)) / 2);
  const hr = r2(r / 2);
  const rr = r2(r);
  const shape = `l${hw},${hr}v${rr}l-${hw},${hr}l-${hw}-${hr}v-${rr}z`;
  let d = "";
  for (const c of cells) d += `M${r2(c.cx)},${r2(c.cy - r)}${shape}`;
  return d;
}

/**
 * 화살표 방향(d, 화면 방향이라 아래가 +y. scatter-kit의 arrowStep)의 이웃 칸. 그 방향 45도 안의 칸 중 가운데가 가장 가까운 칸이라, 빈 칸은 건너뛰고 다음 칸으로 가요.
 * 위아래는 바로 윗줄(아랫줄)의 두 칸이 같은 거리라서, 짝수 줄은 오른쪽, 홀수 줄은 왼쪽을 골라 여러 번 눌러도 옆으로 흘러가지 않아요.
 * 그 방향에 칸이 없으면 -1
 */
export function hexNeighbor(cells: readonly Pick<HexCell, "cx" | "cy" | "row">[], from: number, d: readonly [number, number]): number {
  const a = cells[from];
  if (!a) return -1;
  const lean = a.row & 1 ? -1 : 1;
  let best = -1;
  let bd = Infinity;
  let bLean = -Infinity;
  for (let k = 0; k < cells.length; k++) {
    const dx = cells[k].cx - a.cx;
    const dy = cells[k].cy - a.cy;
    const along = dx * d[0] + dy * d[1];
    const across = Math.abs(dx * d[1] - dy * d[0]);
    if (along <= 0 || across > along + 1e-6) continue;
    const dist = Math.round((dx * dx + dy * dy) * 1e4);
    const l = Math.sign(dx) * lean;
    if (dist < bd || (dist === bd && l > bLean)) {
      bd = dist;
      bLean = l;
      best = k;
    }
  }
  return best;
}
