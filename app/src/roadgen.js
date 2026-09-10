// Seed-basierte Straßen-Polylines auf der CPU (→ Plan/Build.md M3)
// Random Walk von der Map-Kante → äquidistant auf 32 Punkte resampled.
// Feste Größe 8×32 — WGSL hardcodiert array<vec2, 256> und die Loop.

export const MAX_ROADS = 8;
export const ROAD_POINTS = 32;

// Deterministischer PRNG: gleicher Seed → gleiche Straßen
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Punktliste (x, y, …) auf n Punkte mit gleichem Bogenabstand resample
function resample(pts, n) {
    const m = pts.length / 2;
    const cum = new Float64Array(m);
    for (let i = 1; i < m; i++) {
        cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    }
    const total = cum[m - 1];
    const out = new Float32Array(n * 2);
    let seg = 0;
    for (let i = 0; i < n; i++) {
        const s = (total * i) / (n - 1);
        while (seg < m - 2 && cum[seg + 1] < s) { seg++; }
        const len = cum[seg + 1] - cum[seg];
        const t = len > 1e-9 ? (s - cum[seg]) / len : 0;
        out[2 * i] = pts[2 * seg] + (pts[2 * seg + 2] - pts[2 * seg]) * t;
        out[2 * i + 1] = pts[2 * seg + 1] + (pts[2 * seg + 3] - pts[2 * seg + 1]) * t;
    }
    return out;
}

export function generateRoads(seed, mapSize, count) {
    const rand = mulberry32(seed);
    const n = Math.min(Math.max(count, 0), MAX_ROADS);
    const out = new Float32Array(MAX_ROADS * ROAD_POINTS * 2);
    for (let r = 0; r < n; r++) {
        // Start an zufälliger Kante, Richtung grob nach innen
        const edge = Math.floor(rand() * 4);
        const t = rand();
        let x, y, dir;
        if (edge === 0) { x = t * mapSize; y = 0; dir = Math.PI / 2 + (rand() - 0.5); }
        else if (edge === 1) { x = mapSize; y = t * mapSize; dir = Math.PI + (rand() - 0.5); }
        else if (edge === 2) { x = t * mapSize; y = mapSize; dir = -Math.PI / 2 + (rand() - 0.5); }
        else { x = 0; y = t * mapSize; dir = rand() - 0.5; }

        const STEPS = 60;
        const pts = new Float32Array((STEPS + 1) * 2);
        pts[0] = x; pts[1] = y;
        for (let s = 1; s <= STEPS; s++) {
            dir += (rand() - 0.5) * 1.2; // Meandern
            const step = 12 + rand() * 12;
            x += Math.cos(dir) * step;
            y += Math.sin(dir) * step;
            // An Map-Kanten reflektieren
            if (x < 0) { x = -x; dir = -dir; }
            else if (x > mapSize) { x = 2 * mapSize - x; dir = -dir; }
            if (y < 0) { y = -y; dir = Math.PI - dir; }
            else if (y > mapSize) { y = 2 * mapSize - y; dir = Math.PI - dir; }
            pts[2 * s] = x;
            pts[2 * s + 1] = y;
        }
        out.set(resample(pts, ROAD_POINTS), r * ROAD_POINTS * 2);
    }
    return out;
}