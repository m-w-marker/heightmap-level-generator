// Farbkarte (→ Plan/Farbkarte.md): nass = Ufer-Farbe der Rampe statt Wasser-Blau, ohne Kante an der Uferlinie;
// Straße = Straßenfarbe; Größe n² · 4; Vorschau (colorize) behält das Wasser-Blau
import { colorize, colormapBytes } from '../src/colormap.js';
import { shoreDist } from '../src/masks.js';
import { BIOMES } from '../src/biomes.js';

let fail = 0;
function check(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); fail++; }
}
const px = (d, i) => Array.from(d.slice(4 * i, 4 * i + 4));
const same = (a, b) => a.every((v, k) => v === b[k]);

// Rampe aus dem Meer, flach je Zeile ohne Neigung und Relief: h = 12 m + x, nass bis x = 2, x = 3 genau auf dem Spiegel
const n = 9, maxH = 100, sea = 15, road = [60, 60, 60], R = 4 * n + 8; // Straßenpixel trocken am rechten Rand
const h = new Float32Array(n * n).map((_, i) => (12 + i % n) / maxH);
const m = new Float32Array(n * n), zero = new Float32Array(n * n), wat = new Float32Array(n * n);
m[R] = 1;
const W = new Float64Array(n * n).fill(sea), S = Float64Array.from(h, v => shoreDist(v * maxH, sea, sea));

for (const [name, bio] of Object.entries(BIOMES)) {
    const stops = [0, 1.5, 45, 85, 115, 140].map((v, i) => [v, bio.ramp[i]]);
    const ramp = { stops, bio, rockSlope: [0.7, 1.2], road };
    const c = colormapBytes(n, ramp, h, m, zero, zero, maxH, W, sea, S);
    const p = new Uint8ClampedArray(n * n * 4);
    colorize(p, n, ramp, h, m, zero, zero, maxH, wat, sea, S);
    const sand = [...bio.ramp[0], 255], blue = [];
    for (let i = 0; i < n * n; i++) if (i % n < 3) blue.push(px(p, i));
    check(c.length === n * n * 4, `${name}: Größe ${c.length} ≠ n² · 4`);
    check(same(px(c, 4 * n + 1), sand), `${name}: nasser Pixel ${px(c, 4 * n + 1)} ≠ Sand ${sand}`);
    check(same(px(c, 4 * n + 2), px(c, 4 * n + 3)), `${name}: Kante an der Uferlinie ${px(c, 4 * n + 2)} / ${px(c, 4 * n + 3)}`);
    check(blue.every(b => !same(b, sand)), `${name}: Vorschau zeigt nass kein Wasser-Blau`);
    let wet = false;
    for (let i = 0; i < n * n; i++) if (blue.some(b => same(b, px(c, i)))) wet = true;
    check(!wet, `${name}: Wasser-Blau in der Farbkarte`);
    check(same(px(c, R), [...road, 255]), `${name}: Straßenpixel ${px(c, R)} ≠ ${road}`);
    check(same(px(p, R), px(c, R)) && same(px(p, 4 * n + 5), px(c, 4 * n + 5)), `${name}: trocken wie die Vorschau`);
}

if (fail) process.exit(1);
console.log('Farbkarte: OK — nass = Ufer-Farbe ohne Kante, kein Wasser-Blau, Straße = Straßenfarbe, n² · 4, trocken wie die Vorschau (4 Biome)');
