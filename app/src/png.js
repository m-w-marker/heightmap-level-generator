// PNG-Encoder ohne Abhängigkeit (→ Plan/Export.md): Graustufen 16 Bit / RGBA 8 Bit.
// Canvas kann kein 16 Bit und multipliziert Alpha vor → RGB unter A = 0 ginge verloren.

const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// Länge · Typ · Daten · CRC(Typ + Daten), Zahlen Big-Endian
function chunk(type, data) {
    const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

// pixels zeilenweise: Uint16Array bei bitDepth 16, Uint8Array bei 8; channels 1 (Grau) oder 4 (RGBA) → Blob
export async function encodePng(width, height, pixels, channels, bitDepth) {
    const stride = width * channels * bitDepth / 8;
    const raw = new Uint8Array(height * (stride + 1)); // je Zeile Filterbyte 0 (keins)
    for (let y = 0; y < height; y++) {
        const o = y * (stride + 1) + 1, n = width * channels, s = y * n;
        if (bitDepth === 16) for (let i = 0; i < n; i++) { raw[o + 2 * i] = pixels[s + i] >> 8; raw[o + 2 * i + 1] = pixels[s + i] & 255; }
        else raw.set(pixels.subarray(s, s + n), o);
    }
    // 'deflate' = zlib-Format, wie PNG es verlangt
    const idat = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
    v.setUint32(0, width);
    v.setUint32(4, height);
    ihdr[8] = bitDepth;
    ihdr[9] = channels === 1 ? 0 : 6; // Farbtyp: 0 Grau, 6 RGBA; Kompression/Filter/Interlace = 0
    return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))],
        { type: 'image/png' });
}
