// CC0-Texturen fürs Auto-Material laden (→ Plan/Texturierung.md, Plan/Biome.md): node tools/fetch-textures.mjs <biom>
// → public/textures/<biom>/<rolle>/albedo.jpg + normal.jpg (NormalGL) + <biom>/SOURCES.md. Neu codiert, weil die
// 2K-Originale 3–5 MB je Datei haben (~45 MB für jeden Seitenbesuch)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import jpeg from 'jpeg-js';

const Q_ALBEDO = 80, Q_NORMAL = 80; // 90 kostete +8 MB, am Gelände nicht sichtbar
const Q_NORMAL_OF = { steppe: 70 }; // detailreiche Normalen → sonst > 20 MB je Biom

// je Biom Quelle je Rolle (= Ordnername, den das Material lädt, ROLES in biomes.js)
const SETS = {
    temperate: {
        ground: { src: 'ambientcg', id: 'Grass004' },
        rock: { src: 'ambientcg', id: 'Rock030' },
        scree: { src: 'ambientcg', id: 'Gravel022' },
        shore: { src: 'polyhaven', id: 'coast_sand_01' },
        top: { src: 'ambientcg', id: 'Snow006' },
        road: { src: 'polyhaven', id: 'gravel_road' },
    },
    steppe: {
        ground: { src: 'polyhaven', id: 'withered_grass' },
        rock: { src: 'polyhaven', id: 'rocks_ground_08' },
        scree: { src: 'polyhaven', id: 'dry_river_pebbles' },
        shore: { src: 'polyhaven', id: 'brown_mud_dry' },
        top: { src: 'polyhaven', id: 'dry_ground_01' },
        road: { src: 'polyhaven', id: 'asphalt_02' },
    },
    desert: {
        ground: { src: 'polyhaven', id: 'red_sand' }, // sand_01 kachelt auf großen Flächen sichtbar
        rock: { src: 'polyhaven', id: 'sandstone_cracks' },
        scree: { src: 'polyhaven', id: 'gravelly_sand' },
        shore: { src: 'polyhaven', id: 'mud_cracked_dry_riverbed_002' }, // Salzpfanne
        top: { src: 'polyhaven', id: 'sand_01' },
        road: { src: 'polyhaven', id: 'asphalt_01' },
    },
    snow: {
        ground: { src: 'ambientcg', id: 'Snow006' }, // snow_02: dunkle Zweige wiederholen sich
        rock: { src: 'polyhaven', id: 'rock_face_03' },
        scree: { src: 'polyhaven', id: 'rocks_ground_05' },
        shore: { src: 'ambientcg', id: 'Ice003' }, // auch die Eisfläche; Ice002 glitzert wie Scherben
        top: { src: 'ambientcg', id: 'Ice004' },
        road: { src: 'polyhaven', id: 'asphalt_snow' },
    },
};
const biome = process.argv[2];
if (!SETS[biome]) throw new Error(`Biom angeben: ${Object.keys(SETS).join(' | ')}`);
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'textures', biome);
const qNormal = Q_NORMAL_OF[biome] ?? Q_NORMAL;

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
for (const [role, l] of Object.entries(SETS[biome])) {
    const s = await sources(l), dir = join(OUT, role);
    mkdirSync(dir, { recursive: true });
    for (const [kind, q] of [['albedo', Q_ALBEDO], ['normal', qNormal]]) {
        if (!s[kind]) throw new Error(`${l.id}: ${kind} fehlt`);
        const img = jpeg.decode(s[kind], { maxMemoryUsageInMB: 1024 });
        const out = jpeg.encode(img, q).data;
        writeFileSync(join(dir, `${kind}.jpg`), out);
        total += out.length;
        console.log(`${biome}/${role}/${kind}.jpg ${img.width}×${img.height} ${(s[kind].length / 1e6).toFixed(1)} → ${(out.length / 1e6).toFixed(1)} MB`);
    }
    rows.push(`| ${role} | ${l.src === 'ambientcg' ? 'ambientCG' : 'Poly Haven'} \`${l.id}\` | ${s.url} | CC0 |`);
}
writeFileSync(join(OUT, 'SOURCES.md'), `# Texturen ${biome} (CC0)

Geladen und neu codiert (JPG Albedo ${Q_ALBEDO}, Normal ${qNormal}) von \`tools/fetch-textures.mjs ${biome}\`. Je Rolle
\`albedo.jpg\` (sRGB) und \`normal.jpg\` (OpenGL-Konvention); eigene Texturen gleichen Namens beliebiger Größe ersetzen sie.

| Rolle | Quelle | URL | Lizenz |
|---|---|---|---|
${rows.join('\n')}
`);
console.log(`Summe ${(total / 1e6).toFixed(1)} MB`);
