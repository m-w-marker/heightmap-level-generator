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
// wie ein Unreal-Landscape (2ⁿ+1) es erwartet → Ecken = Eck-Pixel des Originals
export function resample(buf, res, n) {
    if (n === res) return buf;
    const out = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = sampleBilinear(buf, res, i / (n - 1), j / (n - 1));
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
