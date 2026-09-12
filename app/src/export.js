// Export-Daten ohne DOM (→ .clinerules/export.md), in Node testbar

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
