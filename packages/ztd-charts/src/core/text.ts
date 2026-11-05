/**
 * 글자 폭 추정. 서버와 브라우저에서 같은 값을 내야 레이아웃이 어긋나지 않아서
 * 캔버스 측정 대신 Pretendard 기준 글자군별 평균 폭을 써요.
 */
/** 한글, 한자처럼 굵기에 따라 폭이 거의 안 바뀌는 글자 */
function isWide(code: number): boolean {
  return (code >= 0xac00 && code <= 0xd7a3) || (code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f) || (code >= 0x4e00 && code <= 0x9fff);
}

function charWidth(code: number): number {
  if (code >= 0xac00 && code <= 0xd7a3) return 0.87;
  if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f)) return 0.8;
  if (code >= 0x4e00 && code <= 0x9fff) return 0.94;
  if (code >= 0x30 && code <= 0x39) return 0.585;
  if (code === 0x20) return 0.26;
  if (code === 0x2c || code === 0x2e || code === 0x3a || code === 0x3b || code === 0x27) return 0.26;
  if (code === 0x25) return 0.84;
  if (code === 0x2212) return 0.73;
  if (code === 0x2d) return 0.42;
  if (code === 0x2b || code === 0x3d) return 0.6;
  if (code === 0x28 || code === 0x29 || code === 0x5b || code === 0x5d) return 0.34;
  if (code === 0x2f) return 0.38;
  if (code === 0x20a9 || code === 0x24) return 0.62;
  if (code === 0x2026) return 0.82;
  if (code >= 0x41 && code <= 0x5a) {
    if (code === 0x49) return 0.28;
    if (code === 0x4d || code === 0x57) return 0.86;
    return 0.66;
  }
  if (code >= 0x61 && code <= 0x7a) {
    if (code === 0x69 || code === 0x6c || code === 0x6a) return 0.24;
    if (code === 0x6d || code === 0x77) return 0.84;
    if (code === 0x66 || code === 0x74 || code === 0x72) return 0.36;
    return 0.55;
  }
  return 0.6;
}

const cache = new Map<string, number>();

/** px 단위 추정 폭 */
export function textWidth(s: string | number, size: number, weight = 400): number {
  const str = String(s);
  const key = `${str}|${weight >= 600 ? 1 : 0}`;
  let em = cache.get(key);
  if (em === undefined) {
    let wide = 0;
    let rest = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (isWide(code)) wide += charWidth(code);
      else rest += charWidth(code);
    }
    em = wide + rest * (weight >= 600 ? 1.07 : 1);
    if (cache.size > 5000) cache.clear();
    cache.set(key, em);
  }
  return em * size;
}

/**
 * 폭에 맞게 자르고 말줄임. 앞뒤 빈칸은 떼고 재요 (SVG는 어차피 그리지 않아요).
 * 남는 글자가 한글 1자, 그 밖 2자 이하("티…", "Se…")면 알아볼 수 없어서 빈 글자를 돌려줘요. 이름은 툴팁과 스크린 리더 표에 있어요
 */
export function truncate(s: string, maxWidth: number, size: number, weight = 400): string {
  s = s.trim();
  if (textWidth(s, size, weight) <= maxWidth) return s;
  const ell = "…";
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(s.slice(0, mid) + ell, size, weight) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  // 서로게이트 쌍(이모지 등) 가운데서 자르지 않아요
  if (lo > 0 && (s.charCodeAt(lo - 1) & 0xfc00) === 0xd800) lo--;
  const kept = s.slice(0, lo).trimEnd();
  return kept.length < (isWide(kept.charCodeAt(0)) ? 2 : 3) ? "" : kept + ell;
}

/**
 * 옆에 붙는 글(값, 순위)은 두고 이름만 줄여요. 숫자가 잘리면 다른 값으로 읽히니까요 ("Our brand 1…").
 * 사용 예: [truncateBeside(name, "18%", room, 11.5, 800), "18%"].filter(Boolean).join(" ")
 */
export function truncateBeside(name: string, beside: string, maxWidth: number, size: number, weight = 400): string {
  return truncate(name, maxWidth - textWidth(` ${beside}`, size, weight), size, weight);
}

/**
 * 빈칸에서 maxLines 줄까지 나눠요. 앞줄은 폭에 드는 가장 긴 앞부분이고, 남는 글은 마지막 줄에 두고 넘치면 말줄임해요.
 * 첫 낱말부터 폭보다 길면 나누지 않고 한 줄로 말줄임해요
 */
export function wrapLines(s: string, maxWidth: number, size: number, maxLines = 2, weight = 400): string[] {
  const lines: string[] = [];
  let rest = s.trim();
  while (lines.length < maxLines - 1 && textWidth(rest, size, weight) > maxWidth) {
    let i = rest.lastIndexOf(" ");
    while (i > 0 && textWidth(rest.slice(0, i), size, weight) > maxWidth) i = rest.lastIndexOf(" ", i - 1);
    if (i <= 0) break;
    lines.push(rest.slice(0, i).trimEnd());
    rest = rest.slice(i + 1).trimStart();
  }
  return [...lines, truncate(rest, maxWidth, size, weight)];
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: Box, b: Box, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/** 글자 상자. anchor는 text-anchor, y는 가운데 기준 */
export function labelBox(text: string, x: number, y: number, size: number, anchor: "start" | "middle" | "end" = "start", weight = 400): Box {
  const w = textWidth(text, size, weight);
  const x0 = anchor === "start" ? x : anchor === "middle" ? x - w / 2 : x - w;
  return { x: x0, y: y - size * 0.6, w, h: size * 1.2 };
}

/**
 * 세로로 겹치는 라벨을 밀어내요. 원하는 y를 받아 겹치지 않는 y를 돌려줘요.
 * 끝 라벨(선 차트 오른쪽 이름표)처럼 한 줄로 늘어선 라벨에 써요.
 */
export function dodgeVertical(ys: number[], minGap: number, lo = -Infinity, hi = Infinity): number[] {
  const idx = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = new Array<number>(ys.length);
  const pos = idx.map((d) => Math.max(lo, Math.min(hi, d.y)));
  for (let iter = 0; iter < 30; iter++) {
    let moved = false;
    for (let k = 1; k < pos.length; k++) {
      const gap = pos[k] - pos[k - 1];
      if (gap < minGap) {
        const push = (minGap - gap) / 2;
        pos[k - 1] -= push;
        pos[k] += push;
        moved = true;
      }
    }
    for (let k = 0; k < pos.length; k++) pos[k] = Math.max(lo, Math.min(hi, pos[k]));
    if (!moved) break;
  }
  for (let k = 1; k < pos.length; k++) if (pos[k] - pos[k - 1] < minGap) pos[k] = pos[k - 1] + minGap;
  if (pos.length && pos[pos.length - 1] > hi) {
    const shift = pos[pos.length - 1] - hi;
    for (let k = 0; k < pos.length; k++) pos[k] -= shift;
  }
  idx.forEach((d, k) => {
    out[d.i] = pos[k];
  });
  return out;
}
