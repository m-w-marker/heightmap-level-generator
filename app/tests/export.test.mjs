// Export-Daten (→ Plan/Roadmap.md R6, R7): .r16 = Uint16 little endian ohne Header; Resampling auf 2ⁿ+1
import { quantize16, encodeR16, resample, TARGETS, exportSizes, engineImport, flipRows } from '../src/export.js';

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

// centres: Quelle RES/2 (wie Flow-Map 512² → 1024²) auf Pixelzentren; lineares Feld bleibt linear (innen)
{
    const r = RES / 2, src = new Float32Array(r * r).map((_, i) => (i % r + 0.5) / r + 2 * (Math.floor(i / r) + 0.5) / r);
    const out = resample(src, r, RES, true);
    let err = 0;
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
        const u = (i + 0.5) / RES, v = (j + 0.5) / RES;
        if (Math.min(u, v, 1 - u, 1 - v) * r < 0.5) continue;
        err = Math.max(err, Math.abs(out[j * RES + i] - (u + 2 * v)));
    }
    check(out.length === RES * RES && err < 1e-5, `centres ${r} → ${RES}: lineares Feld innen max Δ ${err}`);
}

// --- Export-Ziele (→ Plan/ExportZiele.md): Größen je Engine, Import-Werte, Zeilen spiegeln ---
{
    const is2n1 = s => Number.isInteger(Math.log2(s - 1));
    for (const N of [512, 1024, 2048, 2560, 4096, 5120]) {
        const ue = exportSizes('unreal', N), un = exportSizes('unity', N);
        check(ue[0] === N + 1 && new Set(ue).size === ue.length, `Unreal ${N}: zuerst N+1 (${ue})`);
        check(un.length > 0 && un.every(s => is2n1(s) && s <= 4097 && s - 1 >= N / 2 && s - 1 <= 2 * N), `Unity ${N}: 2ⁿ+1 ≤ 4097 (${un})`);
        check(!is2n1(N + 1) || un[0] === N + 1, `Unity ${N}: exakt N+1 zuerst, wenn 2ⁿ+1 (${un})`);
        check(['godot', 'web'].every(t => exportSizes(t, N).join() === String(N)), `Godot/Web ${N}: nur native`);
    }
    check(exportSizes('unity', 5120).join() === '4097', 'Unity 5120 (1280 m ×2): nur 4097');
    const ue = engineImport('unreal', { mapSize: 512, n: 1025, cell: 0.5, maxH: 256 });
    check(ue.scaleX === 50 && ue.scaleY === 50 && ue.scaleZ === 50 && ue.locationZ === 12800, `Unreal 512 m / 1025 / maxH 256: Scale 50/50/50, Z 12800 cm (${JSON.stringify(ue)})`);
    // Probe: Wert 0 → −256 m · Z/100 + Location = 0; Wert 65535 → maxH
    const hAt = v => ((v - 32768) / 128 * ue.scaleZ + ue.locationZ) / 100;
    check(Math.abs(hAt(0)) < 1e-9 && Math.abs(hAt(65535) - 256) < 0.01, `Unreal: Wert 0 → ${hAt(0)} m, 65535 → ${hAt(65535).toFixed(3)} m`);
    const un = engineImport('unity', { mapSize: 1280, n: 2049, cell: 1280 / 2048, maxH: 120 });
    check(un.terrainWidth === 1280 && un.terrainHeight === 120 && un.heightmapResolution === 2049 && un.byteOrder === 'Windows', 'Unity: Terrain-Maße + Auflösung');
    check(engineImport('godot', { mapSize: 512, n: 1024, cell: 0.5, maxH: 80 }).vertexSpacing === 0.5, 'Godot: vertex_spacing = Abstand');
    const img = Uint8Array.from({ length: 3 * 3 * 2 }, (_, i) => i), f = flipRows(img, 3, 2);
    check(f instanceof Uint8Array && f.slice(0, 6).join() === '12,13,14,15,16,17' && flipRows(f, 3, 2).join() === img.join(), 'flipRows: Zeilen umgekehrt, zweimal = Original');
    check(TARGETS.unreal.normal === 'directx' && ['unity', 'godot', 'web'].every(t => TARGETS[t].normal === 'opengl') && TARGETS.unity.flip, 'Konventionen je Ziel');
}

if (fail) process.exit(1);
console.log(`Export-Daten: OK — .r16 ${w}×${h} = ${bytes.length} Byte, Min/Max 0/65535, little endian, bit-genau; Resampling ${SIZES.join('/')}: Ecken, Größe, linear; Pixelzentren aus halber Auflösung; Ziele Unreal/Unity/Godot/Web: Größen, Import-Werte, Zeilen`);
