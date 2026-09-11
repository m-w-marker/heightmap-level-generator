// PNG-Encoder (→ Plan/Export.md E1): eigener Decoder (zlib) liest Werte bit-genau zurück, CRCs stimmen
import { inflateSync, crc32 } from 'node:zlib';
import { encodePng } from '../src/png.js';

let fail = 0;
function check(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); fail++; }
}

async function decode(blob) {
    const b = new Uint8Array(await blob.arrayBuffer()), v = new DataView(b.buffer);
    check([137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => b[i] === x), 'PNG-Signatur');
    let p = 8, ihdr, idat = [];
    while (p < b.length) {
        const len = v.getUint32(p), type = String.fromCharCode(...b.subarray(p + 4, p + 8));
        check(v.getUint32(p + 8 + len) === crc32(b.subarray(p + 4, p + 8 + len)), `CRC ${type}`);
        if (type === 'IHDR') ihdr = { w: v.getUint32(p + 8), h: v.getUint32(p + 12), depth: b[p + 16], color: b[p + 17] };
        if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
        p += 12 + len;
    }
    return { ihdr, raw: inflateSync(Buffer.concat(idat)) };
}

// 16 Bit Grau, 37×5 (ungerade Breite), Werte über den ganzen Bereich inkl. 0 und 65535
{
    const w = 37, h = 5, px = new Uint16Array(w * h).map((_, i) => (i * 2654435761) % 65536);
    px[0] = 0; px[1] = 65535;
    const { ihdr, raw } = await decode(await encodePng(w, h, px, 1, 16));
    check(ihdr.w === w && ihdr.h === h && ihdr.depth === 16 && ihdr.color === 0, `IHDR 16 Bit Grau ${JSON.stringify(ihdr)}`);
    let ok = raw.length === h * (1 + 2 * w);
    for (let y = 0; y < h && ok; y++) {
        ok = raw[y * (1 + 2 * w)] === 0;
        for (let x = 0; x < w && ok; x++) ok = ((raw[y * (1 + 2 * w) + 1 + 2 * x] << 8) | raw[y * (1 + 2 * w) + 2 + 2 * x]) === px[y * w + x];
    }
    check(ok, '16 Bit: Werte bit-genau zurück (Big-Endian, Filter 0)');
}

// RGBA 8 Bit inkl. A = 0 mit RGB ≠ 0 (Canvas würde das verlieren)
{
    const w = 3, h = 2, px = new Uint8Array([255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const { ihdr, raw } = await decode(await encodePng(w, h, px, 4, 8));
    check(ihdr.depth === 8 && ihdr.color === 6, 'IHDR RGBA 8 Bit');
    const back = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) back.set(raw.subarray(y * (1 + 4 * w) + 1, (y + 1) * (1 + 4 * w)), y * w * 4);
    check(back.every((x, i) => x === px[i]), 'RGBA: Werte bit-genau zurück, RGB unter A = 0 bleibt');
}

if (fail) {
    console.error(`${fail} Checks fehlgeschlagen`);
    process.exit(1);
}
console.log('PNG-Encoder: OK — 16 Bit Grau + RGBA 8 Bit bit-genau, CRCs');
