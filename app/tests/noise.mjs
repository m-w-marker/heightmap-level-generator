// JS-Nachbau von hash/vnoise/fbm/ridge aus heightmap.wgsl — Hash bit-gleich (u32), Interpolation in f64 statt f32.
// Nur für Statistik, NICHT für Werte, die bit-exakt zur GPU passen müssen (→ Plan/Roads.md „Prepass“).
const mix32 = v => {
    let x = v >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
};
// = layerKey() in heightmap.wgsl: Seed (ganzzahlig) + Ebene 0 Hügel · 1 Bergmaske · 2 Ridge · 3 Kante · 4 Kantenmaske · 5 Rand
export const layerKey = (seed, layer) => mix32(mix32(seed) + layer);
const hash = (ix, iy, key) => (mix32(ix ^ mix32(iy ^ key)) >>> 8) / 16777216;

function vnoise(x, y, key) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, key), b = hash(ix + 1, iy, key), c = hash(ix, iy + 1, key), d = hash(ix + 1, iy + 1, key);
    const top = a + (b - a) * ux, bot = c + (d - c) * ux;
    return (top + (bot - top) * uy) * 2 - 1;
}

export function fbm(x, y, key, octaves, gain = 0.5) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < octaves; i++) { v += amp * vnoise(x * f, y * f, mix32(key + i)); f *= 2.03; amp *= gain; }
    return v;
}

export function ridge(x, y, key, octaves) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < octaves; i++) {
        const n = vnoise(x * f, y * f, mix32(key + i)) * 0.5 + 0.5;
        v += amp * (1 - Math.abs(2 * n - 1));
        f *= 2.03; amp *= 0.5;
    }
    return v;
}

export const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Stichprobe im Noise-Raum: viele Gitterzellen (stationär), mehrere Seeds (fn bekommt den ganzzahligen Seed)
export function sample(fn, seeds = 20, n = 96, extent = 24) {
    const v = new Float64Array(seeds * n * n);
    let k = 0;
    for (let s = 1; s <= seeds; s++)
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
            v[k++] = fn((i + 0.5) * extent / n, (j + 0.5) * extent / n, s);
    return v.sort();
}

export const quantile = (sorted, p) => sorted[Math.floor(p * (sorted.length - 1))];
