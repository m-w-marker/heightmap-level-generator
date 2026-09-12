// Hydrologie (→ Plan/Fluesse.md F1): Fluss im Tal bis zum Abfluss, Spiegel nie steigend; Grube → See auf Überlauf-Höhe;
// Meer als Abfluss; aus = nichts; deterministisch; Laufzeit auf 128²
import { hydrology, MAX_RIVERS, RIVER_POINTS } from '../src/hydro.js';
import { grids } from '../src/uniforms.js';

let fail = 0;
function check(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); fail++; }
}
// Map-Größe als Argument (→ Plan/MapGroesse.md): Positionen und Grundhöhe skalieren mit s (Szenen für 400 m gebaut),
// Gefälle/Formen in Metern; Raster wie in der App
const M = +(process.argv[2] ?? 512), s = M / 400, N = grids(M).pre, cs = M / N;
const OPTS = { waterLevel: 0, rimZone: 40, riverCatchment: 1, riverWidth: 6, lakeArea: 50 };
// f(x, y) in m über Zellzentren; Rauschen: deterministisches LCG
function field(f, noise = 0) {
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * noise;
    return { size: N, data: Float32Array.from({ length: N * N }, (_, i) => f((i % N + 0.5) * cs, ((i / N | 0) + 0.5) * cs) + rnd()) };
}
const river = (r, k) => [...r.rivers.subarray((k * RIVER_POINTS) * 4, (k + 1) * RIVER_POINTS * 4)];
const pt = (a, i) => a.slice(4 * i, 4 * i + 4);

// 1) Ebene fällt nach +x, V-Tal entlang y = 200·s → Hauptfluss im Tal, bis in die Randzone rechts
const VY = 200 * s;
const valley = (x, y) => 60 * s - 0.08 * x + 0.15 * Math.abs(y - VY);
{
    const r = hydrology(field(valley), M, OPTS);
    check(r.riverCount >= 1, `Tal: ${r.riverCount} Flüsse`);
    const a = river(r, 0);
    const first = pt(a, 0), last = pt(a, RIVER_POINTS - 1);
    let rise = 0, off = 0;
    for (let i = 1; i < RIVER_POINTS; i++) rise = Math.max(rise, pt(a, i)[2] - pt(a, i - 1)[2]);
    for (let i = RIVER_POINTS >> 2; i < RIVER_POINTS; i++) off = Math.max(off, Math.abs(pt(a, i)[1] - VY));
    check(rise <= 0, `Tal: Spiegel nie steigend (max Anstieg ${rise})`);
    check(off < 2 * cs, `Tal: Hauptfluss im Tal (max |y − ${VY}| ${off.toFixed(2)} m im unteren ¾)`);
    check(last[0] > M - OPTS.rimZone - cs && first[0] < last[0], `Tal: fließt nach +x bis zum Ringfuß (${first[0].toFixed(0)} → ${last[0].toFixed(0)} m)`);
    check(last[3] > first[3] && Math.abs(2 * last[3] - OPTS.riverWidth) < 0.5, `Tal: Breite wächst bis riverWidth (${(2 * first[3]).toFixed(2)} → ${(2 * last[3]).toFixed(2)} m)`);
    check(Math.abs(r.waterAt(last[0], last[1]) - last[2]) < 1e-4 && r.waterAt(200 * s, 60 * s) === OPTS.waterLevel, 'waterAt: am Fluss = Spiegel, abseits = waterLevel');
    const wetOnRiver = r.wet[Math.floor(pt(a, 20)[1] / cs) * N + Math.floor(pt(a, 20)[0] / cs)];
    check(wetOnRiver === 1 && r.wet[Math.floor(60 * s / cs) * N + Math.floor(200 * s / cs)] === 0, 'wet: Flusszelle nass, Hang trocken');
}

// 2) Grube am Hang (6 m tief, σ 12 m; 3 m füllt das Gefälle von 0,17 fast auf) → See, Spiegel = Höhe der Überlaufzelle;
// ohne lakeArea kein See
const pit = (x, y) => valley(x, y) - 6 * Math.exp(-((x - 150 * s) ** 2 + (y - 110 * s) ** 2) / (2 * 144));
{
    const t = field(pit), r = hydrology(t, M, OPTS);
    const cells = [];
    r.lakes.forEach((l, i) => { if (l > 0) cells.push(i); });
    const levels = new Set(cells.map(i => r.lakes[i]));
    const centre = Math.floor(110 * s / cs) * N + Math.floor(150 * s / cs);
    check(cells.length > 0 && r.lakes[centre] > t.data[centre] + 1, `Grube: See (${cells.length} Zellen), Mitte ${(r.lakes[centre] - t.data[centre]).toFixed(2)} m tief`);
    check(levels.size === 1, `Grube: ein Spiegel (${[...levels].join(', ')})`);
    const L = [...levels][0];
    let spill = false;
    for (const c of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const v = c + dy * N + dx;
        if (!r.lakes[v] && t.data[v] === L) spill = true;
    }
    check(spill, 'Grube: Spiegel = Höhe einer Nachbarzelle am Ufer (Überlauf)');
    check(cells.every(c => r.wet[c] === 1), 'Grube: Seezellen nass');
    check(hydrology(t, M, { ...OPTS, lakeArea: 0 }).lakes.every(l => l === 0), 'lakeArea 0 → kein See');
}

// 3) Meer: Tal fällt unter waterLevel → Fluss endet am Ufer, Spiegel nie unter waterLevel
{
    const sea = 40 * s, r = hydrology(field(valley), M, { ...OPTS, waterLevel: sea });
    const a = river(r, 0), last = pt(a, RIVER_POINTS - 1);
    check(r.riverCount >= 1 && last[2] >= sea && last[0] < M - OPTS.rimZone, `Meer: Mündung bei x ${last[0].toFixed(0)} m, Spiegel ${last[2].toFixed(2)} ≥ ${sea}`);
}

// 4) aus: riverCatchment 0 → keine Flüsse, wet nur Meer
{
    const r = hydrology(field(valley), M, { ...OPTS, riverCatchment: 0, lakeArea: 0 });
    check(r.riverCount === 0 && r.rivers.every(v => v === 0) && r.wet.every(w => w === 0), 'aus: keine Flüsse, nichts nass');
}

// 5) verrauscht (viele Senken): deterministisch, ≤ MAX_RIVERS, Laufzeit
{
    const t = field(pit, 1.5);
    const t0 = performance.now(), a = hydrology(t, M, OPTS), ms = performance.now() - t0;
    const b = hydrology(t, M, OPTS);
    check(a.riverCount === b.riverCount && a.rivers.every((v, i) => v === b.rivers[i]) && a.lakes.every((v, i) => v === b.lakes[i]), 'deterministisch');
    check(a.riverCount <= MAX_RIVERS, `≤ MAX_RIVERS (${a.riverCount})`);
    check(ms < 30, `Laufzeit ${ms.toFixed(1)} ms < 30`);
    var noisy = `${a.riverCount} Flüsse, ${a.lakes.filter(l => l > 0).length} Seezellen, ${ms.toFixed(1)} ms`;
}

if (fail) process.exit(1);
console.log(`Hydrologie (${M} m): OK — Tal-Fluss bis Ringfuß, Spiegel fallend, Breite wächst; Grube → See auf Überlauf-Höhe; Meer-Mündung; aus = nichts; verrauscht ${noisy}, deterministisch`);
