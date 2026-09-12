// RAW-Export (→ Plan/Roadmap.md R6): .r16 = Uint16 little endian ohne Header, gleiche Werte wie PNG16
import { quantize16, encodeR16 } from '../src/export.js';

let fail = 0;
function check(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); fail++; }
}

// Rampe 0…1 über eine nicht-quadratische Fläche, dazu Ausreißer außerhalb 0–1 (werden geklemmt)
const w = 1024, h = 513, n = w * h;
const heights = new Float32Array(n).map((_, i) => i / (n - 1));
heights[1] = -0.2;
heights[2] = 1.3;
const px = quantize16(heights);
const bytes = encodeR16(px);

check(bytes.length === n * 2, `Größe ${bytes.length} ≠ ${n * 2}`);
let mn = Infinity, mx = -Infinity;
for (const v of px) { if (v < mn) mn = v; if (v > mx) mx = v; }
check(mn === 0 && mx === 65535, `Min/Max ${mn}/${mx} ≠ 0/65535`);
check(px[1] === 0 && px[2] === 65535, 'Ausreißer geklemmt');

// little endian: niederwertiges Byte zuerst; Rückweg bit-genau
const k = n >> 1, dv = new DataView(bytes.buffer);
check(bytes[2 * k] === (px[k] & 255) && bytes[2 * k + 1] === px[k] >> 8, 'Byte-Reihenfolge little endian');
let same = true;
for (let i = 0; i < n; i++) if (dv.getUint16(2 * i, true) !== px[i]) { same = false; break; }
check(same, 'Rückweg bit-genau');
check(Math.abs(px[k] - heights[k] * 65535) <= 0.5, 'Quantisierung rundet');

if (fail) process.exit(1);
console.log(`RAW-Export: OK — .r16 ${w}×${h} = ${bytes.length} Byte, Min/Max 0/65535, little endian, bit-genau`);
