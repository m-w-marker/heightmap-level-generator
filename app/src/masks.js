// Masken aus der Heightmap (→ Plan/Roadmap.md R8), geteilt von Export und Texturierung (R11); ohne DOM, in Node testbar.
// h: Höhen 0–1, n² zeilenweise (Zeile j = Map +y); cell: m zwischen zwei Samples; maxH: m bei h = 1

export const CURV_R = 10;    // m Radius des Mittelwerts: Kuppe/Mulde relativ zur Umgebung
export const CURV_MIN = 0.05; // m: Untergrenze der Skala → fast ebene Map zieht kein Rauschen auf volle Helligkeit

// Gradient in m/m: zentrale Differenzen, am Rand einseitig → eine Rampe bleibt bis zum Rand exakt
export function gradient(h, n, cell, maxH) {
    const gx = new Float32Array(n * n), gy = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
        const ya = Math.max(y - 1, 0), yb = Math.min(y + 1, n - 1);
        for (let x = 0; x < n; x++) {
            const xa = Math.max(x - 1, 0), xb = Math.min(x + 1, n - 1), i = y * n + x;
            gx[i] = (h[y * n + xb] - h[y * n + xa]) * maxH / ((xb - xa) * cell);
            gy[i] = (h[yb * n + x] - h[ya * n + x]) * maxH / ((yb - ya) * cell);
        }
    }
    return { gx, gy };
}

// Farbrampe von Vorschau + 3D-Farbtextur (einmal pro Regeneration, Kanten geclamped statt einseitig wie gradient() →
// Vorschau bleibt pixelgleich): slope = |∇h| in m/m (zentrale Differenzen); relief = Höhe − Mittel im Abstand RELIEF_M
// in m (> 0 Kuppe, < 0 Mulde) → Farbe heller/dunkler, macht flache Hügel lesbar
export const RELIEF_M = 9.375; // m (= 24 px bei 0,39 m/px, jetzt 19 px); fest in m, sonst wüchse die Tönung mit der Map
export function slopeRelief(h, n, maxH, mapSize) {
    const px = mapSize / n, k = maxH / (2 * px), r = Math.max(Math.round(RELIEF_M / px), 1);
    const s = new Float32Array(n * n), rel = new Float32Array(n * n);
    const at = (x, y) => h[Math.min(Math.max(y, 0), n - 1) * n + Math.min(Math.max(x, 0), n - 1)];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const gx = (at(x + 1, y) - at(x - 1, y)) * k;
        const gy = (at(x, y + 1) - at(x, y - 1)) * k;
        s[y * n + x] = Math.hypot(gx, gy);
        const avg = (at(x - r, y) + at(x + r, y) + at(x, y - r) + at(x, y + r)) / 4;
        rel[y * n + x] = (at(x, y) - avg) * maxH;
    }
    return { slope: s, relief: rel };
}

// Hangneigung in Grad (0 = eben, 90 = senkrecht)
export function slopeDeg({ gx, gy }) {
    return gx.map((x, i) => Math.atan(Math.hypot(x, gy[i])) * 180 / Math.PI);
}

// Einheits-Normale im Tangentenraum, DirectX-Konvention wie Unreal: x = Spalte →, y = Zeile ↓ („green down“), z = oben
export function normals({ gx, gy }) {
    const out = new Float32Array(gx.length * 3);
    for (let i = 0; i < gx.length; i++) {
        const l = Math.hypot(gx[i], gy[i], 1);
        out[3 * i] = -gx[i] / l;
        out[3 * i + 1] = -gy[i] / l;
        out[3 * i + 2] = 1 / l;
    }
    return out;
}

// Höhe − Mittel im Quadrat ±CURV_R (m): > 0 Kamm/Kuppe, < 0 Mulde/Rinne; Summed-Area-Table → O(n²) auch bei 2049²,
// am Rand nur die Samples innerhalb der Map
export function curvature(h, n, cell, maxH, radius = CURV_R) {
    const r = Math.max(1, Math.round(radius / cell)), w = n + 1;
    const sat = new Float64Array(w * w); // Float64: Summe über 4M Werte, Float32 verliert sonst die Differenz
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
        sat[(y + 1) * w + x + 1] = h[y * n + x] + sat[y * w + x + 1] + sat[(y + 1) * w + x] - sat[y * w + x];
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
        const y0 = Math.max(y - r, 0), y1 = Math.min(y + r + 1, n);
        for (let x = 0; x < n; x++) {
            const x0 = Math.max(x - r, 0), x1 = Math.min(x + r + 1, n);
            const sum = sat[y1 * w + x1] - sat[y0 * w + x1] - sat[y1 * w + x0] + sat[y0 * w + x0];
            out[y * n + x] = (h[y * n + x] - sum / ((y1 - y0) * (x1 - x0))) * maxH;
        }
    }
    return out;
}

// 8-Bit-Skala = p99 von |Abweichung| dieser Map: feste Meter übersteuern Canyon (p99 ≈ 16 m) oder lassen Pasture
// (≈ 0,8 m) grau → Wert in die Metadaten, damit die Engine zurückrechnen kann
export function curvatureScale(c) {
    const a = Float32Array.from(c, Math.abs).sort();
    return Math.max(a[Math.floor(0.99 * (a.length - 1))], CURV_MIN);
}

// Flow-Map (→ Plan/Erosion.md): Σ Wassertiefe · |v| der Erosions-Simulation; Skala = p99 je Map wie curvatureScale,
// log → Rinnen und breite Täler beide sichtbar (linear wären nur die Talböden hell)
export const flowScale = f => Math.max(Float32Array.from(f).sort()[Math.floor(0.99 * (f.length - 1))], 1e-6);

// Flächen-Masken (→ Plan/StadtStrassenMasken.md): weiche Kante statt Schwarz-Weiß, harte Grenze = Schwelle 128
export const WATER_FADE = 0.4; // m Wassertiefe bis voll: Water mask und Deckkraft des Wasser-Meshes
export const TOWN_FADE = 4;    // m weicher Rand der Town mask = TOWN_FADE in heightmap.wgsl (Layout-Test prüft)

// --- 8 Bit für den Export ---
const byte = v => Math.round(Math.min(Math.max(v, 0), 1) * 255);
export const unitBytes = f => Uint8Array.from(f, byte); // Anteil 0–1 (Road/Town mask)
// h 0–1, level = Wasserspiegel m je Pixel → 0 am Ufer, 255 ab WATER_FADE Tiefe
export const waterBytes = (h, level, maxH) => Uint8Array.from(h, (v, i) => byte((level[i] - v * maxH) / WATER_FADE));
export const flowBytes = (f, scale) => Uint8Array.from(f, v => byte(Math.log1p(Math.max(v, 0)) / Math.log1p(scale)));
export const slopeBytes = deg => Uint8Array.from(deg, d => byte(d / 90));
export const curvatureBytes = (c, scale) => Uint8Array.from(c, v => byte(0.5 + v / (2 * scale)));
// Material-Maske des 3D-Auto-Materials (→ Plan/Texturierung.md), RGBA8 linear, dieselben Codierungen wie der Export:
// R Neigung °/90 (slope in m/m), G Krümmung 128 ± dev/curvScale, B roadMask, A Höhe über dem örtlichen Wasserspiegel
export const SHORE_RANGE = 10; // m bei A = 255 (Sand-Regler bis 5 m → 4 cm je Stufe)
export function materialMask(slope, curv, curvScale, road, above) {
    const out = new Uint8Array(slope.length * 4);
    for (let i = 0, o = 0; i < slope.length; i++, o += 4) {
        out[o] = byte(Math.atan(slope[i]) * 2 / Math.PI);
        out[o + 1] = byte(0.5 + curv[i] / (2 * curvScale));
        out[o + 2] = byte(road[i]);
        out[o + 3] = byte(above[i] / SHORE_RANGE);
    }
    return out;
}
// RGBA, A = 255 (encodePng kann Grau oder RGBA); rgb = n · 0.5 + 0.5; openGL: G gespiegelt („green up“, Unity/Godot/three)
export function normalBytes(nrm, openGL = false) {
    const out = new Uint8Array(nrm.length / 3 * 4), g = openGL ? -1 : 1;
    for (let i = 0, o = 0; i < nrm.length; i += 3, o += 4) {
        out[o] = byte(nrm[i] * 0.5 + 0.5);
        out[o + 1] = byte(g * nrm[i + 1] * 0.5 + 0.5);
        out[o + 2] = byte(nrm[i + 2] * 0.5 + 0.5);
        out[o + 3] = 255;
    }
    return out;
}
