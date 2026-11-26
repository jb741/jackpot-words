// Draws the app icon (synthwave sun over a neon grid with three reel tiles) and writes PNGs.
//   node tools/icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
function sdRound(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r, qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Color of the icon at (x, y) in 0..1 (y down). `pad` shrinks the art for maskable icons.
function shade(x, y, pad) {
  x = (x - 0.5) / (1 - pad * 2) + 0.5;
  y = (y - 0.5) / (1 - pad * 2) + 0.5;
  const H = 0.6;
  let c;
  if (y < H) {
    c = mix3(hex('#12002e'), hex('#4a0a5e'), sstep(0, H, y));
    c = mix3(c, hex('#b0145e'), sstep(H - 0.12, H, y) * 0.8);
    const dx = x - 0.5, dy = y - 0.42, r = Math.hypot(dx, dy);
    const R = 0.27;
    if (r < R) {
      const t = (dy / R) * 0.5 + 0.5; // 0 top .. 1 bottom
      let s = mix3(hex('#ffe35a'), hex('#ff6a2a'), sstep(0.0, 0.5, t));
      s = mix3(s, hex('#ff1f7a'), sstep(0.5, 1.0, t));
      let gap = false;
      if (dy > -0.02) {
        const k = (dy + 0.02) / (R + 0.02);
        const st = ((dy * 30) % 1 + 1) % 1;
        gap = st < k * 0.55;
      }
      if (!gap) c = s;
    } else {
      const halo = Math.exp(-(r - R) * 14) * 0.5;
      c = mix3(c, hex('#ff2bd6'), halo);
    }
  } else {
    c = hex('#0a0018');
    const d = y - H + 0.002;
    const z = 0.08 / d;
    const wx = (x - 0.5) * z * 6;
    const fx = Math.abs(((wx % 1) + 1.5) % 1 - 0.5);
    const fz = Math.abs((((z + 0.0) % 1) + 1.5) % 1 - 0.5);
    const lw = 0.03 + 0.02 / z;
    const line = Math.max(1 - sstep(0, lw, fx), 1 - sstep(0, lw * 1.2, fz));
    const fade = sstep(0, 0.12, d);
    c = mix3(c, hex('#ff2bd6'), line * fade);
    c = mix3(c, hex('#b0145e'), (1 - sstep(0, 0.03, d)) * 0.8);
  }
  // three reel tiles: green, blue, red
  const tiles = [['#16ee6c', '#d2ffe6'], ['#2a63ff', '#c0d4ff'], ['#d01a37', '#ffa3b1']];
  const ty = 0.76, ts = 0.11;
  tiles.forEach(([fill, edge], i) => {
    const tx = 0.5 + (i - 1) * 0.245;
    const d = sdRound(x - tx, y - ty, ts, ts, 0.035);
    if (d < 0.02) {
      const glow = Math.exp(-Math.max(d, 0) * 60) * 0.6;
      c = mix3(c, hex(fill), glow * (d > 0 ? 1 : 0));
    }
    if (d < 0) {
      const f = hex(fill);
      const g = 0.7 + 0.5 * (1 - (y - (ty - ts)) / (2 * ts));
      let cc = [f[0] * g, f[1] * g, f[2] * g];
      if (d > -0.014) cc = hex(edge);
      c = cc;
    }
  });
  return c.map((v) => Math.min(1, Math.max(0, v)));
}

function png(size, pad = 0) {
  const ss = 3;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let j = 0; j < size; j++) {
    raw[j * (size * 3 + 1)] = 0;
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = shade((i + (sx + 0.5) / ss) / size, (j + (sy + 0.5) / ss) / size, pad);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = j * (size * 3 + 1) + 1 + i * 3;
      raw[o] = Math.round((r / (ss * ss)) * 255);
      raw[o + 1] = Math.round((g / (ss * ss)) * 255);
      raw[o + 2] = Math.round((b / (ss * ss)) * 255);
    }
  }
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(ROOT, 'icons/apple-touch-icon.png'), png(180));
writeFileSync(join(ROOT, 'icons/icon-192.png'), png(192));
writeFileSync(join(ROOT, 'icons/icon-512.png'), png(512));
writeFileSync(join(ROOT, 'icons/icon-maskable-512.png'), png(512, 0.1));
console.log('icons written');
