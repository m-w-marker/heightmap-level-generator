// Export-Daten (→ Plan/Roadmap.md R6, R7): .r16 = Uint16 little endian ohne Header; Resampling auf 2ⁿ+1
import { quantize16, encodeR16, resample, TARGETS, exportSizes, engineImport, flipRows, exportGrid, layout } from '../src/export.js';
import { ROAD_POINTS } from '../src/roadgen.js';
import { MAX_RIVERS, RIVER_POINTS, RIVER_SINK } from '../src/hydro.js';

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

// --- Layout JSON (→ Plan/StadtStrassenMasken.md) ---
// exportGrid: Export-Sample (i, j) liegt bei x0 + i·dx, z0 + j·dz — gegen resample (+ flipRows) mit f = x + 2z, innen
{
    const M = 32, N = RES, f = (x, z) => x + 2 * z;
    const src = new Float32Array(N * N).map((_, i) => f((i % N + 0.5) / N * M - M / 2, (Math.floor(i / N) + 0.5) / N * M - M / 2));
    for (const s of [N, N + 1, 2 * N + 1]) for (const flip of [false, true]) {
        const g = exportGrid(M, s, N, flip), r = resample(src, N, s), out = flip ? flipRows(r, s) : r;
        let err = 0;
        for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
            const x = g.x0 + i * g.dx, z = g.z0 + j * g.dz;
            if (M / 2 - Math.max(Math.abs(x), Math.abs(z)) < M / N / 2) continue; // Rand: geclamped
            err = Math.max(err, Math.abs(out[j * s + i] - f(x, z)));
        }
        check(err < 1e-4 && g.resolution === s && g.samples === (s === N ? 'centres' : 'vertices'), `exportGrid ${s}${flip ? ' gespiegelt' : ''}: max Δ ${err}`);
    }
    const g = exportGrid(512, 1025, 1024, false);
    check(g.x0 === -256 && g.cellSize === 0.5 && exportGrid(512, 1025, 1024, true).z0 === 256, 'exportGrid Vertex: erste Ecke auf dem Map-Rand, gespiegelt bei +z');
}
// layout: Achsen (Mitte 0, z = Zeile), Höhe aus der Heightmap, Verbindungen Ort ↔ Straße ↔ Ausfahrt, Fluss-Spiegel, Seen
{
    const M = 100, line = (a, b) => Array.from({ length: ROAD_POINTS }, (_, i) => [a[0] + (b[0] - a[0]) * i / (ROAD_POINTS - 1), a[1] + (b[1] - a[1]) * i / (ROAD_POINTS - 1)]);
    const nodes = [{ x: 30, y: 40, exit: false }, { x: 70, y: 40, exit: false }, { x: 5, y: 40, exit: true }, { x: 95, y: 90, exit: true }];
    const edges = [[0, 1], [2, 0]];
    const pts = [...line([30, 40], [70, 40]), ...line([5, 40], [30, 40])];
    const net = { nodes, edges, points: Float32Array.from(pts.flat()), levels: new Float32Array(pts.length).fill(21), towns: [{ x: 30, y: 40, level: 22 }, { x: 70, y: 40, level: 23 }] };
    const rivers = new Float32Array(MAX_RIVERS * RIVER_POINTS * 4);
    for (let i = 0; i < RIVER_POINTS; i++) rivers.set([10 + i, 80, 20, 2], i * 4);
    const L = 10, lakes = new Float32Array(L * L); // Zellen 10 m: See A 2×1 bei Spalte 1–2 / Zeile 1, See B 1 Zelle Diagonale-Nachbarn
    lakes[1 * L + 1] = lakes[1 * L + 2] = 18; lakes[6 * L + 6] = lakes[7 * L + 7] = 19;
    const H = 4, heights = new Float32Array(H * H).fill(0.5);
    const o = layout({ net, hydro: { riverCount: 1, rivers, lakes }, heights, N: H, mapSize: M, maxH: 60, waterLevel: 15, roadWidth: 4, clearingRadius: 8 });
    const [t0, t1] = o.towns, r0 = o.roads[0], r1 = o.roads[1];
    check(JSON.stringify(t0.position) === '[-20,30,-10]' && t0.level === 22 && t0.radius === 8, `Ort: Mitte 0, y = Heightmap, z = Zeile (${JSON.stringify(t0)})`);
    check(r0.from === 'town0' && r0.to === 'town1' && r1.from === 'exit0' && r1.to === 'town0' && r0.width === 4 && r0.points.length === ROAD_POINTS, 'Straßen: von/nach, Breite, Punkte');
    check(JSON.stringify(r1.points[0]) === '[-45,30,-10]' && r0.level.every(v => v === 21), `Straße: Punkte [x, y, z], level (${JSON.stringify(r1.points[0])})`);
    check(t0.roads.join() === 'road0,road1' && t1.roads.join() === 'road0', `Ort ↔ Straßen (${t0.roads}/${t1.roads})`);
    check(o.exits.length === 1 && o.exits[0].id === 'exit0' && o.exits[0].road === 'road1', 'Ausfahrt ohne Straße entfällt, sonst mit Straße');
    const rp = o.rivers[0].points;
    check(o.rivers.length === 1 && rp.length === RIVER_POINTS && JSON.stringify(rp[0]) === JSON.stringify([-40, 20 - RIVER_SINK, 30, 4]), `Fluss: [x, Spiegel − RIVER_SINK, z, Breite] (${JSON.stringify(rp[0])})`);
    const [la, lb] = o.lakes;
    check(o.lakes.length === 2 && la.level === 18 && la.area === 200 && JSON.stringify(la.bbox) === '[-40,-40,-20,-30]' && JSON.stringify(la.centre) === '[-30,18,-35]',
        `See A: Spiegel, Fläche, bbox, Mitte (${JSON.stringify(la)})`);
    check(lb.area === 200 && lb.level === 19, `See B: Diagonal-Nachbarn = ein See (${JSON.stringify(lb)})`);
    const none = layout({ net: { ...net, edges: [], towns: net.towns }, hydro: null, heights, N: H, mapSize: M, maxH: 60, waterLevel: 15, roadWidth: 4, clearingRadius: 0 });
    check(none.roads.length === 0 && none.exits.length === 0 && none.rivers.length === 0 && none.lakes.length === 0 && none.towns[0].roads.length === 0, 'ohne Straßen / Hydrologie: leere Listen');
}

if (fail) process.exit(1);
console.log(`Export-Daten: OK — .r16 ${w}×${h} = ${bytes.length} Byte, Min/Max 0/65535, little endian, bit-genau; Resampling ${SIZES.join('/')}: Ecken, Größe, linear; Pixelzentren aus halber Auflösung; Ziele Unreal/Unity/Godot/Web: Größen, Import-Werte, Zeilen; Layout: Gitter, Achsen, Verbindungen, Flüsse, Seen`);
