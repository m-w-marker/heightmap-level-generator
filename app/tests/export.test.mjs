// Export-Daten (→ Plan/Roadmap.md R6, R7): .r16 = Uint16 little endian ohne Header; Resampling auf 2ⁿ+1
import { quantize16, encodeR16, resample } from '../src/export.js';

let fail = 0;
function check(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); fail++; }
}

// --- R6: RAW ---
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

// --- R7: Resampling ---
// Zufallsfeld RES²: Ecken = Eck-Pixel, Größe n², n == RES → dasselbe Feld; lineares Feld bleibt linear (innen)
const RES = 64, SIZES = [RES / 2 + 1, RES + 1, 2 * RES + 1];
const field = new Float32Array(RES * RES).map((_, i) => ((i * 2654435761) % 1000) / 1000);
check(resample(field, RES, RES) === field, 'n == RES → Original 1:1');
const corner = (b, r) => [b[0], b[r - 1], b[(r - 1) * r], b[r * r - 1]];
for (const s of SIZES) {
    const out = resample(field, RES, s);
    check(out.length === s * s, `${s}: Länge ${out.length}`);
    check(corner(out, s).every((v, i) => Math.abs(v - corner(field, RES)[i]) < 1e-6), `${s}: Ecken = Ecken des Originals`);
}
// f(x, y) = x + 2y über Pixelzentren → im Inneren (mind. ½ Pixel vom Rand) exakt bilinear reproduziert
const lin = new Float32Array(RES * RES).map((_, i) => (i % RES + 0.5) / RES + 2 * (Math.floor(i / RES) + 0.5) / RES);
for (const s of SIZES) {
    const out = resample(lin, RES, s);
    let err = 0;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
        const u = i / (s - 1), v = j / (s - 1);
        if (Math.min(u, v, 1 - u, 1 - v) * RES < 0.5) continue;
        err = Math.max(err, Math.abs(out[j * s + i] - (u + 2 * v)));
    }
    check(err < 1e-5, `${s}: lineares Feld innen max Δ ${err}`);
}

if (fail) process.exit(1);
console.log(`Export-Daten: OK — .r16 ${w}×${h} = ${bytes.length} Byte, Min/Max 0/65535, little endian, bit-genau; Resampling ${SIZES.join('/')}: Ecken, Größe, linear`);
