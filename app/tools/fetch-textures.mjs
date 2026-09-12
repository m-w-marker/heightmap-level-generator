// CC0-Texturen fürs Auto-Material laden (→ Plan/Texturierung.md): node tools/fetch-textures.mjs
// → public/textures/<schicht>/albedo.jpg + normal.jpg (NormalGL) + SOURCES.md. Neu codiert, weil die 2K-Originale
// 3–5 MB je Datei haben (~45 MB für jeden Seitenbesuch)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import jpeg from 'jpeg-js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'textures');
const Q_ALBEDO = 80, Q_NORMAL = 80; // 90 kostete +8 MB, am Gelände nicht sichtbar

// layer = Ordnername, den das Material lädt
const LAYERS = [
    { layer: 'grass', src: 'ambientcg', id: 'Grass004' },
    { layer: 'rock', src: 'ambientcg', id: 'Rock030' },
    { layer: 'gravel', src: 'ambientcg', id: 'Gravel022' },
    { layer: 'sand', src: 'polyhaven', id: 'coast_sand_01' },
    { layer: 'snow', src: 'ambientcg', id: 'Snow006' },
    { layer: 'road', src: 'polyhaven', id: 'gravel_road' },
];

async function get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return Buffer.from(await r.arrayBuffer());
}

// Zip: zentrales Verzeichnis lesen, Einträge mit passendem Namen entpacken (nur stored / deflate)
function unzip(buf, want) {
    let e = buf.length - 22;
    while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
    const count = buf.readUInt16LE(e + 10), out = {};
    for (let i = 0, p = buf.readUInt32LE(e + 16); i < count; i++) {
        const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
        const extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        const key = Object.keys(want).find(k => name.endsWith(want[k]));
        if (key) {
            const d = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), raw = buf.subarray(d, d + size);
            out[key] = method === 8 ? inflateRawSync(raw) : raw;
        }
        p += 46 + nameLen + extra + comment;
    }
    return out;
}

async function sources({ src, id }) {
    if (src === 'ambientcg') {
        const f = unzip(await get(`https://ambientcg.com/get?file=${id}_2K-JPG.zip`), { albedo: '_Color.jpg', normal: '_NormalGL.jpg' });
        return { ...f, url: `https://ambientcg.com/view?id=${id}` };
    }
    const base = `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/${id}/${id}`;
    return { albedo: await get(`${base}_diff_2k.jpg`), normal: await get(`${base}_nor_gl_2k.jpg`), url: `https://polyhaven.com/a/${id}` };
}

const rows = [];
let total = 0;
for (const l of LAYERS) {
    const s = await sources(l), dir = join(OUT, l.layer);
    mkdirSync(dir, { recursive: true });
    for (const [kind, q] of [['albedo', Q_ALBEDO], ['normal', Q_NORMAL]]) {
        if (!s[kind]) throw new Error(`${l.id}: ${kind} fehlt`);
        const img = jpeg.decode(s[kind], { maxMemoryUsageInMB: 1024 });
        const out = jpeg.encode(img, q).data;
        writeFileSync(join(dir, `${kind}.jpg`), out);
        total += out.length;
        console.log(`${l.layer}/${kind}.jpg ${img.width}×${img.height} ${(s[kind].length / 1e6).toFixed(1)} → ${(out.length / 1e6).toFixed(1)} MB`);
    }
    rows.push(`| ${l.layer} | ${l.src === 'ambientcg' ? 'ambientCG' : 'Poly Haven'} \`${l.id}\` | ${s.url} | CC0 |`);
}
writeFileSync(join(OUT, 'SOURCES.md'), `# Texturen (CC0)

Geladen und neu codiert (JPG Albedo ${Q_ALBEDO}, Normal ${Q_NORMAL}) von \`tools/fetch-textures.mjs\`. Je Schicht \`albedo.jpg\`
(sRGB) und \`normal.jpg\` (OpenGL-Konvention); eigene Texturen gleichen Namens beliebiger Größe ersetzen sie.

| Schicht | Quelle | URL | Lizenz |
|---|---|---|---|
${rows.join('\n')}
`);
console.log(`Summe ${(total / 1e6).toFixed(1)} MB`);
