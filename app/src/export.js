// Export-Daten ohne DOM (→ .clinerules/export.md), in Node testbar
import { ROAD_POINTS } from './roadgen.js';
import { RIVER_POINTS, RIVER_SINK } from './hydro.js';

// Bilinear aus einem res²-Feld (Pixelzentren bei (p+0.5)/res, Kanten geclamped); u, v in 0–1
export function sampleBilinear(buf, res, u, v) {
    const fx = u * res - 0.5, fy = v * res - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const xa = Math.min(Math.max(x0, 0), res - 1);
    const xb = Math.min(Math.max(x0 + 1, 0), res - 1);
    const ya = Math.min(Math.max(y0, 0), res - 1);
    const yb = Math.min(Math.max(y0 + 1, 0), res - 1);
    const top = buf[ya * res + xa] * (1 - tx) + buf[ya * res + xb] * tx;
    const bot = buf[yb * res + xa] * (1 - tx) + buf[yb * res + xb] * tx;
    return top * (1 - ty) + bot * ty;
}

// n == res → Original 1:1 (Pixelzentren); sonst Vertex-Gitter mit Samples auf den Map-Ecken (u = i / (n − 1)),
// wie ein Unreal-Landscape (2ⁿ+1) es erwartet → Ecken = Eck-Pixel des Originals.
// centres: Ziel-Raster sind Pixelzentren ((i + 0.5) / n) — für Quellen in anderer Auflösung als das Original (Flow-Map 512²)
export function resample(buf, res, n, centres = n === res) {
    if (n === res && centres) return buf;
    const out = new Float32Array(n * n), u = centres ? i => (i + 0.5) / n : i => i / (n - 1);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = sampleBilinear(buf, res, u(i), u(j));
    return out;
}

// heights 0–1 → 0–65535; Stufe maxH / 65535 (≈ 2 mm) statt maxH / 255 (≈ 0,45 m bei 114 m)
export function quantize16(heights) {
    const px = new Uint16Array(heights.length);
    for (let i = 0; i < px.length; i++) px[i] = Math.round(Math.min(Math.max(heights[i], 0), 1) * 65535);
    return px;
}

// .r16 (Unreal/World Machine): rohe Uint16 zeilenweise, little endian, ohne Header → Größe = w · h · 2
export function encodeR16(px) {
    const out = new Uint8Array(px.length * 2), v = new DataView(out.buffer);
    for (let i = 0; i < px.length; i++) v.setUint16(2 * i, px[i], true);
    return out;
}

// --- Export-Ziele (→ Plan/ExportZiele.md) ---
// normal: Konvention der Normal Map; flip: Zeilen gespiegelt schreiben (Unity liest Zeile 0 als z = 0, linkshändig)
export const TARGETS = {
    unreal: { label: 'Unreal', normal: 'directx', flip: false },
    unity: { label: 'Unity', normal: 'opengl', flip: true },
    godot: { label: 'Godot (Terrain3D)', normal: 'opengl', flip: false },
    web: { label: 'Web (WebGPU / three.js)', normal: 'opengl', flip: false }, // glTF-Konvention
};
const UE_SIZES = [505, 1009, 2017, 4033, 8129]; // Unreal-Empfehlung: ganze Komponenten
const UNITY_SIZES = [513, 1025, 2049, 4097];    // Unity nimmt nur 2ⁿ+1, höchstens 4097

// Export-Größen für N native Pixel, erste = Default. n == N → Pixelzentren, sonst Vertex-Gitter auf den Map-Ecken (resample)
export function exportSizes(target, N) {
    const near = s => s - 1 >= N / 2 && s - 1 <= 2 * N;
    if (target === 'unreal') return [N + 1, ...UE_SIZES.filter(s => near(s) && s !== N + 1)];
    if (target === 'unity') return UNITY_SIZES.filter(near).sort((a, b) => Math.abs(a - 1 - N) - Math.abs(b - 1 - N));
    return [N];
}

// Werte für den Import-Dialog der Engine; cell = m zwischen zwei Samples, n = Export-Größe
export function engineImport(target, { mapSize, n, cell, maxH }) {
    if (target === 'unreal') return {
        file: 'Heightmap PNG (16-bit) or .r16', scaleX: cell * 100, scaleY: cell * 100,
        scaleZ: maxH * 100 / 512, // 16 Bit = 512 m bei Z-Scale 100
        locationZ: maxH * 50,     // cm: Wert 0 (sonst −256 m · Z/100) liegt auf Höhe 0
    };
    if (target === 'unity') return {
        file: '.r16', depth: 16, byteOrder: 'Windows', flipVertically: false, heightmapResolution: n,
        terrainWidth: mapSize, terrainLength: mapSize, terrainHeight: maxH,
    };
    if (target === 'godot') return { file: '.r16', vertexSpacing: cell, heightRange: [0, maxH] };
    return { file: '3D mesh glTF (.glb) or Heightmap PNG (16-bit)', cellSize: cell, heightScale: maxH };
}

// Zeilen umkehren (ch Werte je Pixel), gleicher Typ
export function flipRows(buf, n, ch = 1) {
    const out = new buf.constructor(buf.length), row = n * ch;
    for (let j = 0; j < n; j++) out.set(buf.subarray(j * row, (j + 1) * row), (n - 1 - j) * row);
    return out;
}

// --- Layout JSON (→ Plan/StadtStrassenMasken.md) ---
// Neutrale Konvention wie das .glb-Mesh: m, Mitte 0, x = Spalte →, y oben, z = Zeile ↓. Export-Sample (i, j) liegt bei
// x = x0 + i·dx, z = z0 + j·dz: n == N → Pixelzentren, sonst Vertex-Gitter auf den Map-Ecken (resample); flip → Zeilen umgekehrt
export function exportGrid(mapSize, n, N, flip) {
    const cell = mapSize / (n === N ? n : n - 1), e = n === N ? cell / 2 - mapSize / 2 : -mapSize / 2;
    return { resolution: n, cellSize: cell, samples: n === N ? 'centres' : 'vertices', x0: e, dx: cell, z0: flip ? -e : e, dz: flip ? -cell : cell };
}

const cm = v => Math.round(v * 100) / 100;

// Seen = zusammenhängende Zellen (8er-Nachbarn) des Spiegelfelds lakeRes² (0 = kein See), wie hydrology() sie bildet
function lakeList(lakes, mapSize) {
    const L = Math.round(Math.sqrt(lakes.length)), cs = mapSize / L, seen = new Uint8Array(lakes.length), out = [];
    for (let s = 0; s < lakes.length; s++) {
        if (seen[s] || !(lakes[s] > 0)) continue;
        const stack = [s];
        let level = 0, k = 0, sx = 0, sz = 0, x0 = L, z0 = L, x1 = 0, z1 = 0;
        seen[s] = 1;
        while (stack.length) {
            const c = stack.pop(), cx = c % L, cz = (c / L) | 0;
            level = Math.max(level, lakes[c]);
            k++; sx += cx; sz += cz;
            x0 = Math.min(x0, cx); z0 = Math.min(z0, cz); x1 = Math.max(x1, cx); z1 = Math.max(z1, cz);
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
                const x = cx + dx, z = cz + dz, v = z * L + x;
                if (x >= 0 && z >= 0 && x < L && z < L && !seen[v] && lakes[v] > 0) { seen[v] = 1; stack.push(v); }
            }
        }
        const m = v => cm(v * cs - mapSize / 2);
        out.push({ id: `lake${out.length}`, level: cm(level), area: Math.round(k * cs * cs),
            centre: [m(sx / k + 0.5), cm(level), m(sz / k + 0.5)], bbox: [m(x0), m(z0), m(x1 + 1), m(z1 + 1)] });
    }
    return out;
}

// net = generateRoads(), hydro = hydrology() oder null, heights = N² (0–1) der Export-Quelle → Höhen der Punkte darauf
export function layout({ net, hydro, heights, N, mapSize, maxH, waterLevel, roadWidth, clearingRadius }) {
    const h = (mx, my) => cm(sampleBilinear(heights, N, mx / mapSize, my / mapSize) * maxH);
    const pos = (mx, my) => [cm(mx - mapSize / 2), h(mx, my), cm(my - mapSize / 2)];
    // Knoten: Orte (= net.towns, gleiche Reihenfolge) und Ausfahrten eigener Zählung
    let nT = 0, nE = 0;
    const ids = net.nodes.map(n => n.exit ? `exit${nE++}` : `town${nT++}`);
    const roads = net.edges.map(([a, b], r) => {
        const points = [], level = [];
        for (let i = 0; i < ROAD_POINTS; i++) {
            const k = r * ROAD_POINTS + i;
            points.push(pos(net.points[2 * k], net.points[2 * k + 1]));
            level.push(cm(net.levels[k]));
        }
        return { id: `road${r}`, from: ids[a], to: ids[b], width: roadWidth, points, level };
    });
    const touching = node => roads.filter(r => r.from === ids[node] || r.to === ids[node]).map(r => r.id);
    const towns = [], exits = [];
    net.nodes.forEach((n, i) => {
        if (n.exit) {
            const road = touching(i);
            if (road.length) exits.push({ id: ids[i], position: pos(n.x, n.y), road: road[0] });
        } else {
            const t = net.towns[towns.length];
            towns.push({ id: ids[i], position: pos(n.x, n.y), level: cm(t.level), radius: clearingRadius, roads: touching(i) });
        }
    });
    const rivers = [];
    for (let r = 0; r < (hydro?.riverCount ?? 0); r++) {
        const points = [];
        for (let i = 0; i < RIVER_POINTS; i++) {
            const o = (r * RIVER_POINTS + i) * 4, v = hydro.rivers;
            points.push([cm(v[o] - mapSize / 2), cm(v[o + 2] - RIVER_SINK), cm(v[o + 1] - mapSize / 2), cm(2 * v[o + 3])]);
        }
        rivers.push({ id: `river${r}`, points });
    }
    return { towns, exits, roads, rivers, lakes: hydro ? lakeList(hydro.lakes, mapSize) : [], sea: { level: waterLevel } };
}
