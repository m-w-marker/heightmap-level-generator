// JS-Nachbau von hash/vnoise/fbm/ridge aus heightmap.wgsl — nur für Statistik (f64-sin ≠ f32-sin pro Wert,
// Verteilung gleich). NICHT für Werte, die bit-exakt zur GPU passen müssen (→ Plan/Roads.md „Prepass“).
const fract = x => x - Math.floor(x);
const hash = (x, y, s) => fract(Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453123);

function vnoise(x, y, s) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
    const top = a + (b - a) * ux, bot = c + (d - c) * ux;
    return (top + (bot - top) * uy) * 2 - 1;
}

export function fbm(x, y, s, octaves) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < octaves; i++) { v += amp * vnoise(x * f, y * f, s + i * 17.31); f *= 2.03; amp *= 0.5; }
    return v;
}

export function ridge(x, y, s, octaves) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < octaves; i++) {
        const n = vnoise(x * f, y * f, s + i * 17.31) * 0.5 + 0.5;
        v += amp * (1 - Math.abs(2 * n - 1));
        f *= 2.03; amp *= 0.5;
    }
    return v;
}

export const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Stichprobe im Noise-Raum: viele Gitterzellen (stationär), mehrere Seeds
export function sample(fn, seeds = 20, n = 96, extent = 24) {
    const v = new Float64Array(seeds * n * n);
    let k = 0;
    for (let s = 1; s <= seeds; s++)
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
            v[k++] = fn((i + 0.5) * extent / n, (j + 0.5) * extent / n, s * 97.13);
    return v.sort();
}

export const quantile = (sorted, p) => sorted[Math.floor(p * (sorted.length - 1))];
