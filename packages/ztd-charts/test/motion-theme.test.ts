import { describe, expect, it } from "vitest";
import { MotionEngine, resample } from "../src/core/motion";
import { contrastRatio, mixHex, parseColor } from "../src/theme/color";
import { darkTheme, lightTheme, themeToCssVars, type ChartTheme } from "../src/theme/tokens";

describe("모션 엔진", () => {
  const mk = (to: number[], from?: number[]) => [{ key: "a", to, from, data: null }];

  it("spring은 duration 안에 목표에 닿고 넘치지 않아요", () => {
    const e = new MotionEngine<null>();
    e.configure("spring", 900);
    e.hold(mk([100], [0]));
    e.start(0);
    let prev = 0;
    for (let t = 16; t <= 1100; t += 16) {
      e.step(t);
      const v = e.get("a")![0];
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(v).toBeLessThanOrEqual(100 + 1e-9);
      prev = v;
    }
    expect(e.get("a")![0]).toBe(100);
    expect(e.animating).toBe(false);
  });

  it("중간에 목표가 바뀌면 위치와 속도가 끊기지 않아요", () => {
    const e = new MotionEngine<null>();
    e.configure("spring", 900);
    e.hold(mk([100], [0]));
    e.start(0);
    e.step(200);
    const before = e.get("a")![0];
    e.step(216);
    const v1 = e.get("a")![0] - before;
    e.update(mk([20]), 216);
    e.step(216);
    expect(e.get("a")![0]).toBeCloseTo(before + v1, 6);
    e.step(232);
    const v2 = e.get("a")![0] - (before + v1);
    // The direction changes, but the first frame's velocity carries over (no sudden stop)
    expect(Math.abs(v2 - v1)).toBeLessThan(Math.abs(v1) * 0.6 + 1);
  });

  it("easeOut은 정해진 시간에 끝나요", () => {
    const e = new MotionEngine<null>();
    e.configure("easeOut", 500);
    e.hold(mk([10], [0]));
    e.start(0);
    e.step(250);
    expect(e.get("a")![0]).toBeGreaterThan(5);
    e.step(500);
    expect(e.get("a")![0]).toBe(10);
  });

  it("지연, 새 항목(enter), 빠진 항목(exit)", () => {
    const e = new MotionEngine<string>();
    e.configure("easeOut", 100);
    e.hold([
      { key: "a", to: [1], from: [0], data: "a" },
      { key: "b", to: [1], from: [0], delay: 100, data: "b" },
    ]);
    e.start(0);
    e.step(50);
    expect(e.get("b")![0]).toBe(0);
    e.step(300);
    e.update([{ key: "b", to: [2], data: "b" }, { key: "c", to: [5], enter: [0], data: "c" }], 300);
    expect(e.items().find((i) => i.key === "a")?.exiting).toBe(true);
    e.step(600);
    expect(e.get("a")).toBeUndefined();
    expect(e.get("c")![0]).toBe(5);
  });

  it("sameTargets와 resample", () => {
    const e = new MotionEngine<null>();
    e.snap(mk([1, 2]));
    expect(e.sameTargets(mk([1, 2]))).toBe(true);
    expect(e.sameTargets(mk([1, 3]))).toBe(false);
    expect(resample([0, 10], 3)).toEqual([0, 5, 10]);
  });
});

describe("테마 대비 (WCAG AA)", () => {
  const pairs = (t: ChartTheme): [string, string, string, number][] => [
    ["ink / panel", t.ink, t.panel, 4.5],
    ["muted / panel", t.muted, t.panel, 4.5],
    ["muted / bg", t.muted, t.bg, 4.5],
    ["accentText / panel", t.accentText, t.panel, 4.5],
    ["onAccent / accent", t.onAccent, t.accent, 4.5],
    ["onInk / ink", t.onInk, t.ink, 4.5],
    ["onNeutralStrong / neutralStrong", t.onNeutralStrong, t.neutralStrong, 4.5],
    ["ink / neutral", t.ink, t.neutral, 4.5],
    ["ink / neutralSoft", t.ink, t.neutralSoft, 4.5],
    ["accent / panel (도형 3:1)", t.accent, t.panel, 3],
    ["accent2 / panel (도형 3:1)", t.accent2, t.panel, 3],
    ["accent3 / panel (도형 3:1)", t.accent3, t.panel, 3],
    ["accent2 / neutralSoft (바닥 위 도형 3:1)", t.accent2, t.neutralSoft, 3],
    ["accent3 / neutralSoft (바닥 위 도형 3:1)", t.accent3, t.neutralSoft, 3],
  ];
  for (const t of [darkTheme, lightTheme]) {
    for (const [name, fg, bg, min] of pairs(t)) {
      it(`${t.name}: ${name} ≥ ${min}`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
      });
    }
    it(`${t.name}: 중급 배지 글자 / tint ≥ 4.5`, () => {
      expect(contrastRatio(t.accentText, t.tint, t.panel)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("dim은 패널 위 작은 글자에 AA 미달이라 글자는 muted를 써요", () => {
    for (const t of [darkTheme, lightTheme]) {
      expect(contrastRatio(t.dim, t.panel)).toBeLessThan(4.5);
      expect(contrastRatio(t.muted, t.panel)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("색 도구", () => {
  it("parseColor, 대비, 섞기", () => {
    expect(parseColor("#0B8FD8")).toEqual([11, 143, 216, 1]);
    expect(parseColor("var(--ztd-accent, #fff)")).toEqual([255, 255, 255, 1]);
    expect(parseColor("rgba(11, 143, 216, 0.12)")?.[3]).toBeCloseTo(0.12);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(mixHex("#000000", "#FFFFFF", 1)).toBe("#000000");
    expect(mixHex("#000000", "#FFFFFF", 0)).toBe("#FFFFFF");
  });
  it("themeToCssVars", () => {
    const v = themeToCssVars({ accent: "#00A3FF", accentText: "#0077BB", radius: 10 });
    expect(v).toEqual({ "--ztd-accent": "#00A3FF", "--ztd-accent-text": "#0077BB", "--ztd-radius": "10px" });
  });
});
