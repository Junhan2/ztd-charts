// 글꼴이 없는 컴퓨터(리눅스 컨테이너 등)에서도 PNG의 글자가 빠지지 않도록 Pretendard 정적 글꼴과 OFL 라이선스를 fonts/에 복사해요.
// 굵기는 차트 SVG가 쓰는 400~800 다섯 가지예요. findFonts가 dist 옆의 fonts/를 읽고, package.json files에 fonts가 있어 npm 패키지에 같이 실려요
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
