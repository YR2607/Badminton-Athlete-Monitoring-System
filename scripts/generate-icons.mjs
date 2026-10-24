// Generates PWA/app icons: white shuttlecock on the accent color.
// Usage: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const ACCENT = "#2563eb";
const OUT = "public/icons";

mkdirSync(OUT, { recursive: true });

/** Shuttlecock glyph (white) centred on a 1024x1024 canvas. */
function shuttle(scale = 1) {
  const cx = 512;
  const blades = [];
  for (let i = 0; i < 5; i++) {
    const topX = 330 + i * 91; // fan tips
    const botX = 470 + i * 21; // attach points near the cork
    blades.push(
      `<path d="M ${topX - 27} 262 L ${topX + 27} 262 L ${botX + 11} 592 L ${botX - 11} 592 Z" fill="#fff"/>`,
    );
  }
  return `
  <g transform="translate(${cx - 512 * scale} ${330 - 330 * scale}) scale(${scale})">
    ${blades.join("\n")}
    <path d="M 302 272 Q 512 160 722 272" stroke="#fff" stroke-width="36" fill="none" stroke-linecap="round"/>
    <rect x="398" y="572" width="228" height="22" rx="11" fill="#bfdbfe"/>
    <path d="M 402 588 a 110 82 0 0 0 220 0 z" fill="#fff"/>
  </g>`;
}

const rounded = (size, svg) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}">
  <rect width="1024" height="1024" rx="225" fill="${ACCENT}"/>
  ${svg}
</svg>`;

const square = (size, svg) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}">
  <rect width="1024" height="1024" fill="${ACCENT}"/>
  ${svg}
</svg>`;

const jobs = [
  // regular launcher icons (rounded corners)
  [`${OUT}/icon-192.png`, 192, rounded(192, shuttle())],
  [`${OUT}/icon-512.png`, 512, rounded(512, shuttle())],
  // Android maskable + iOS touch icon want full-bleed squares
  [`${OUT}/icon-maskable-512.png`, 512, square(512, shuttle(0.8))],
  [`${OUT}/apple-touch-icon.png`, 180, square(180, shuttle())],
  // in-app favicon
  [`src/app/icon.png`, 64, rounded(64, shuttle())],
  [`src/app/apple-icon.png`, 180, square(180, shuttle())],
];

for (const [file, size, svg] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
  console.log("wrote", file);
}
