// Copies the static Pretendard fonts and the OFL license into fonts/ so PNG text does not go missing on machines without fonts (Linux containers and the like).
// The weights are the five the chart SVGs use, 400 to 800. findFonts reads fonts/ next to dist, and fonts is in package.json files, so it ships in the npm package
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(dirname(createRequire(import.meta.url).resolve("pretendard/package.json")), "dist");
const dir = join(root, "fonts");
const WEIGHTS = ["Regular", "Medium", "SemiBold", "Bold", "ExtraBold"];
mkdirSync(dir, { recursive: true });
for (const w of WEIGHTS) copyFileSync(join(src, "public/static", `Pretendard-${w}.otf`), join(dir, `Pretendard-${w}.otf`));
copyFileSync(join(src, "LICENSE.txt"), join(dir, "LICENSE.txt"));
console.log(`fonts: Pretendard ${WEIGHTS.length} weights + LICENSE.txt -> fonts/`);
