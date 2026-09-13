// Farbrampe der 2D-Vorschau (Wasser/Sand/Gras/Fels/Schnee/Straße), rein → im Node-Test prüfbar (→ Plan/Farbkarte.md).
// ramp = { stops: [[m über waterLevel, [r, g, b]], …], bio: BIOMES[…], rockSlope: [lo, hi] m/m, road: [r, g, b] }, von main
// aus den Material-Reglern gebaut; dieselben Stufen nimmt das Auto-Material (material.js)
export const RELIEF_TINT = 0.06; // Helligkeit pro m Kuppe/Mulde (±15 % max)

// Wasserspiegel eines Pixels: See/Fluss aus dem Readback, sonst das Meer (→ Plan/Fluesse.md)
export const spiegel = (w, waterLevel) => w || waterLevel;
// Fels-Anteil nach Hangneigung — geteilt von Farbrampe und Splatmap
export const rockWeight = (s, [lo, hi]) => Math.min(Math.max((s - lo) / (hi - lo), 0), 1);
// Fahrbahn-Anteil aus roadMask (weiche Kante) — geteilt von Farbrampe und Splatmap. Ganze Maskenkante (1 m = 2 px): nur die
// innere Hälfte war bei 0,5 m/px 1 px breit → Sägezahn am Straßenrand (→ Plan/Pixel05.md)
export const roadWeight = m => Math.min(Math.max(m, 0), 1);

// schreibt 0–255-Werte (→ Plan/Build.md Datenfluss); W = Wasserspiegel des Pixels, S = Ufer-Abstand m;
// blue = false: kein Wasser-Blau, nass (S = 0) trägt die Ufer-Farbe
export function terrainColor(out, o, ramp, waterLevel, hm, m, s, rel, W, S, blue = true) {
    const { stops: STOPS, bio, road } = ramp;
    let r, g, b;
    if (blue && hm < W) {
        const t = hm / W, D = bio.water.deep, F = bio.water.shallow;
        r = D[0] + (F[0] - D[0]) * t;
        g = D[1] + (F[1] - D[1]) * t;
        b = D[2] + (F[2] - D[2]) * t;
    } else {
        // Sand bis sandHeight Ufer-Abstand (Meer, See, Fluss) wie Splatmap und Textur; darüber die Rampe ab Meereshöhe.
        // Ohne See in der Nähe ist S = hm − waterLevel → dieselbe Rechnung wie vorher: Sand → Gras linear über STOPS[1]
        const shore = S / STOPS[1][0];
        const n = Math.max(hm - waterLevel, shore < 1 ? STOPS[1][0] : 0);
        let a = STOPS[STOPS.length - 2], c = STOPS[STOPS.length - 1];
        for (let i = 0; i < STOPS.length - 1; i++) {
            if (n <= STOPS[i + 1][0]) { a = STOPS[i]; c = STOPS[i + 1]; break; }
        }
        const f = Math.min((n - a[0]) / (c[0] - a[0]), 1);
        r = a[1][0] + (c[1][0] - a[1][0]) * f;
        g = a[1][1] + (c[1][1] - a[1][1]) * f;
        b = a[1][2] + (c[1][2] - a[1][2]) * f;
        if (shore < 1) {
            const S = STOPS[0][1];
            r = S[0] + (r - S[0]) * shore;
            g = S[1] + (g - S[1]) * shore;
            b = S[2] + (b - S[2]) * shore;
        }
        const k = rockWeight(s, ramp.rockSlope), R = bio.rock;
        r += (R[0] - r) * k;
        g += (R[1] - g) * k;
        b += (R[2] - b) * k;
        const lit = 1 + Math.min(Math.max(rel * RELIEF_TINT, -0.15), 0.15);
        r *= lit;
        g *= lit;
        b *= lit;
    }
    if (m > 0) {
        const f = roadWeight(m);
        r = r * (1 - f) + road[0] * f;
        g = g * (1 - f) + road[1] * f;
        b = b * (1 - f) + road[2] * f;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
}

// Farbrampe → RGBA-Pixel (Alpha 255) für n² Werte; d = Uint8ClampedArray (rundet wie das Canvas)
export function colorize(d, n, ramp, h, m, s, rel, maxH, wat, waterLevel, shore) {
    for (let i = 0; i < n * n; i++) {
        terrainColor(d, i * 4, ramp, waterLevel, h[i] * maxH, m[i], s[i], rel[i], spiegel(wat[i], waterLevel), shore[i]);
        d[i * 4 + 3] = 255;
    }
}

// Farbkarte für den Export: wie colorize, ohne Wasser-Blau; W = Spiegel je Pixel (schon auf dem Export-Raster)
export function colormapBytes(n, ramp, h, m, s, rel, maxH, W, waterLevel, shore) {
    const d = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < n * n; i++) {
        terrainColor(d, i * 4, ramp, waterLevel, h[i] * maxH, m[i], s[i], rel[i], W[i], shore[i], false);
        d[i * 4 + 3] = 255;
    }
    return d;
}
