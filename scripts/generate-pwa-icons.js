const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const dir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

function getSvg(size, padding = 0) {
  const innerSize = size - padding * 2;
  const radius = Math.round(size * 0.22);
  
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#7c3aed" />
        <stop offset="100%" stop-color="#5b21b6" />
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#grad)" rx="${padding === 0 ? radius : 0}" />
    <g transform="translate(${padding}, ${padding})">
      <svg width="${innerSize}" height="${innerSize}" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </g>
  </svg>`;
}

async function build() {
  await sharp(Buffer.from(getSvg(192))).png().toFile(path.join(dir, 'icon-192.png'));
  await sharp(Buffer.from(getSvg(192, 32))).png().toFile(path.join(dir, 'icon-192-maskable.png'));
  await sharp(Buffer.from(getSvg(512))).png().toFile(path.join(dir, 'icon-512.png'));
  await sharp(Buffer.from(getSvg(512, 85))).png().toFile(path.join(dir, 'icon-512-maskable.png'));
  await sharp(Buffer.from(getSvg(180))).png().toFile(path.join(dir, 'apple-touch-icon.png'));
  console.log('✅ Icons generated successfully in public/icons/');
}

build().catch(console.error);
