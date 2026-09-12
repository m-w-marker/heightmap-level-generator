// Masken (→ Plan/Roadmap.md R8): Ebene = Neigung 0 / Normale oben; Rampe = bekannter Winkel; Kamm hell, Mulde dunkel
import { gradient, slopeDeg, normals, curvature, slopeBytes, normalBytes, curvatureBytes, curvatureScale, CURV_R, CURV_MIN } from '../src/masks.js';

let fail = 0;
function check(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); fail++; }
}
const maxAbs = (a, f) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - f(i))), 0);

const n = 65, cell = 0.5, maxH = 100; // 32 m Kante
const field = f => new Float32Array(n * n).map((_, i) => f(i % n, Math.floor(i / n)) / maxH); // f(x, y) in m → 0–1

// Ebene
{
    const h = field(() => 40), g = gradient(h, n, cell, maxH);
    check(maxAbs(slopeDeg(g), () => 0) < 1e-9, 'Ebene: Neigung 0');
    const nb = normalBytes(normals(g));
    check(nb[0] === 128 && nb[1] === 128 && nb[2] === 255 && nb[3] === 255, `Ebene: Normale (128,128,255) statt ${nb.slice(0, 3)}`);
    check(slopeBytes(slopeDeg(g)).every(v => v === 0), 'Ebene: Slope-Byte 0');
    const c = curvature(h, n, cell, maxH);
    check(curvatureScale(c) === CURV_MIN && curvatureBytes(c, curvatureScale(c)).every(v => v === 128), 'Ebene: Krümmung 128, Skala = Untergrenze');
}

// Rampe 30° entlang x und entlang y (Zeilen), bis zum Rand
for (const axis of ['x', 'y']) {
    const t = Math.tan(30 * Math.PI / 180);
    const h = field((x, y) => 10 + (axis === 'x' ? x : y) * cell * t), g = gradient(h, n, cell, maxH);
    const deg = slopeDeg(g);
    check(maxAbs(deg, () => 30) < 1e-3, `Rampe ${axis}: 30° (max Δ ${maxAbs(deg, () => 30)})`);
    check(slopeBytes(deg).every(v => v === Math.round(30 / 90 * 255)), `Rampe ${axis}: Slope-Byte ${Math.round(30 / 90 * 255)}`);
    // DirectX: Anstieg nach rechts → Normale kippt nach links (R < 128); Anstieg nach unten (Zeile +) → G < 128
    const nrm = normals(g), k = (n >> 1) * (n + 1), s = Math.sin(30 * Math.PI / 180);
    const [nx, ny, nz] = nrm.slice(3 * k, 3 * k + 3);
    const want = axis === 'x' ? [-s, 0] : [0, -s];
    check(Math.abs(nx - want[0]) < 1e-5 && Math.abs(ny - want[1]) < 1e-5 && Math.abs(nz - Math.cos(30 * Math.PI / 180)) < 1e-5,
        `Rampe ${axis}: Normale (${nx.toFixed(3)}, ${ny.toFixed(3)}, ${nz.toFixed(3)})`);
    // Krümmung einer Rampe = 0, wo das Mittelungsfenster ganz in der Map liegt
    const c = curvature(h, n, cell, maxH), r = Math.round(CURV_R / cell);
    let cMax = 0;
    for (let y = r; y < n - r; y++) for (let x = r; x < n - r; x++) cMax = Math.max(cMax, Math.abs(c[y * n + x]));
    check(cMax < 1e-3, `Rampe ${axis}: Krümmung innen 0 (max ${cMax})`);
}

// Kuppe und Mulde (Gauß ±5 m, σ 4 m) in der Mitte
for (const sign of [1, -1]) {
    const m = (n - 1) / 2;
    const h = field((x, y) => 50 + sign * 5 * Math.exp(-(((x - m) ** 2 + (y - m) ** 2) * cell * cell) / 32));
    const c = curvature(h, n, cell, maxH), b = curvatureBytes(c, curvatureScale(c))[m * n + m];
    check(sign > 0 ? b > 200 : b < 55, `${sign > 0 ? 'Kuppe hell' : 'Mulde dunkel'}: ${b}`);
}

if (fail) process.exit(1);
console.log('Masken: OK — Ebene 0° / (128,128,255), Rampe 30° in x und y (DirectX-Normale), Krümmung Rampe 0, Kuppe hell, Mulde dunkel');
