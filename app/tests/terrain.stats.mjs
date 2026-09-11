// Terrain-Kalibrierung (→ Plan/TerrainStrassennetz.md T1): Abdeckung in %, Hügel-Amplitude in m,
// kein Clamp oben (autoMaxH). Statistik über den JS-Nachbau des WGSL-Noise (tests/noise.mjs).
import { fbm, ridge, smoothstep, sample, quantile } from './noise.mjs';
import { PARAM_FIELDS, autoMaxH } from '../src/uniforms.js';

let fail = 0;
function check(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); fail++; }
}

// Abdeckung: Anteil fbm(3 Okt.) über der Schwelle ≈ Regler
const f3 = sample((x, y, s) => fbm(x, y, s + 3.7, 3), 30);
const above = thr => { let lo = 0, hi = f3.length; while (lo < hi) { const m = (lo + hi) >> 1; if (f3[m] <= thr) lo = m + 1; else hi = m; } return 1 - lo / f3.length; };
for (const pct of [0, 10, 30, 60, 100]) {
    const m = above(PARAM_FIELDS.mountainThr({ mountainCoverage: pct })) * 100;
    const c = above(PARAM_FIELDS.cliffThr({ cliffCoverage: pct })) * 100;
    check(Math.abs(m - pct) <= 5, `Berg-Abdeckung ${pct} % → gemessen ${m.toFixed(1)} %`);
    check(Math.abs(c - pct) <= 5, `Kanten-Abdeckung ${pct} % → gemessen ${c.toFixed(1)} %`);
}

// Hügel: p95 der Auslenkung ≈ hillAmp (±10 %), auch bei glatten/rauen Hügeln (Gain)
for (const g of [0.3, 0.5, 0.65]) {
    const amp = PARAM_FIELDS.hillAmp({ hillAmp: 17, hillRoughness: g });
    const d = sample((x, y, s) => Math.abs(fbm(x, y, s + 5.1, 5, g) * amp), 30);
    const p95 = quantile(d, 0.95);
    check(Math.abs(p95 - 17) <= 1.7, `Hügel (Gain ${g}) p95 ${p95.toFixed(1)} m ≈ hillAmp 17 m`);
}

// Kein Clamp oben: Nachbau von heightmap.wgsl Schritte 1–4 (ohne Straßen), 128², 20 Seeds
function maxHeight(p) {
    const u = {};
    for (const [k, f] of Object.entries(PARAM_FIELDS)) u[k] = f(p);
    const N = 128, S = p.mapSize;
    let mx = -Infinity;
    for (let seed = 1; seed <= 20; seed++) {
        const sd = seed * 4099;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const ux = (i + 0.5) / N, uy = (j + 0.5) / N, wx = ux * S, wy = uy * S;
            let h = u.baseLevel + fbm(wx * u.hillScale, wy * u.hillScale, sd, 5, u.hillGain) * u.hillAmp;
            const mm = smoothstep(u.mountainThr - 0.15, u.mountainThr + 0.15, fbm(wx * u.maskScale, wy * u.maskScale, sd + 101.3, 3));
            h += mm * ridge(wx * u.mountainScale, wy * u.mountainScale, sd + 202.7, 5) * u.mountainAmp;
            const cn = fbm(wx * u.cliffScale, wy * u.cliffScale, sd + 303.1, 4) * 0.5 + 0.5;
            const cm = smoothstep(u.cliffThr - 0.15, u.cliffThr + 0.15, fbm(wx * u.cliffMaskScale, wy * u.cliffMaskScale, sd + 404.9, 3));
            const band = Math.max(u.cliffWidth * u.cliffScale, 0.02);
            h += cm * (smoothstep(0.5 - band, 0.5 + band, cn) * 2 - 1) * u.cliffDrop * 0.5;
            const edge = Math.min(ux, uy, 1 - ux, 1 - uy) * S;
            const rimF = 1 - smoothstep(0, u.rimZone, edge);
            h += rimF * (0.55 + 0.6 * fbm(wx * u.rimScale, wy * u.rimScale, sd + 505.3, 3)) * u.rimAmp;
            if (h > mx) mx = h;
        }
    }
    return mx;
}
const base = {
    mapSize: 400, baseLevel: 30, hillAmp: 8, hillWave: 120, hillRoughness: 0.5, mountainAmp: 60, mountainWave: 180, clusterWave: 220,
    mountainCoverage: 30, cliffDrop: 20, cliffWave: 90, cliffWidth: 15, cliffAreaWave: 160, cliffCoverage: 30,
    rimAmp: 40, rimZone: 45, rimWave: 90,
};
const extreme = { ...base, baseLevel: 60, hillAmp: 30, hillRoughness: 0.65, mountainAmp: 150, mountainCoverage: 100, cliffDrop: 60, cliffCoverage: 100, rimAmp: 100, rimZone: 150 };
for (const [name, p] of [['Default', base], ['Extrem', extreme]]) {
    const mx = maxHeight(p), lim = autoMaxH(p);
    check(mx <= lim, `${name}: max Höhe ${mx.toFixed(1)} m ≤ maxH ${lim.toFixed(1)} m (kein Clamp oben)`);
    console.log(`  ${name}: max ${mx.toFixed(1)} m von maxH ${lim.toFixed(1)} m (${(100 * mx / lim).toFixed(0)} % genutzt)`);
}

if (fail) {
    console.error(`${fail} Checks fehlgeschlagen`);
    process.exit(1);
}
console.log('terrain-Stats: OK — Abdeckung ±5 %-Pkt., Hügel p95 ±10 %, kein Clamp oben');
