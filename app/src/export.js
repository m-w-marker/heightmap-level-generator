// Export-Daten ohne DOM (→ .clinerules/export.md), in Node testbar

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
    web: { label: 'Web / three.js', normal: 'opengl', flip: false },
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
