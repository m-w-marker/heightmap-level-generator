// Auto-Material des 3D-Terrains (→ Plan/Texturierung.md): three NodeMaterial (TSL), weil es unter WebGPU kein
// onBeforeCompile gibt. Terrain-Mesh ohne Transformation → lokal = Welt
import { MeshStandardNodeMaterial, DataArrayTexture, Vector3, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, NoColorSpace } from 'three/webgpu';
import { texture, uv, uniform, positionWorld, cameraPosition, normalLocal, transformNormalToView, mx_noise_float, float, vec2, vec3, clamp, max, pow, tan, smoothstep, mix, luminance, select, vertexColor, atan, fwidth } from 'three/tsl';
import { SHORE_RANGE, DASH_PERIOD } from './masks.js';
import { ROLES } from './biomes.js';

// Ebene im Texture-Array = Rolle = Ordner in public/textures/<biom> (austauschbar: albedo.jpg sRGB + normal.jpg OpenGL,
// beliebige Größe)
const L = Object.fromEntries(ROLES.map((l, i) => [l, i]));
const SHORE_WET = 0.3; // m über dem Ufer-Spiegel: Übergang Sandfarbe (unter Wasser) → Farbkarte
const BLEND_LUMA = 0.3, BLEND_SHARP = 4;
const ICE_ROUGH = 0.35; // glatter → die Risse der Detail-Normalen glitzern im Sonnenlicht
// Fahrbahn-Markierungen (Biome mit markings, → Plan/Biome.md): Mittellinie gestrichelt gelb, Randlinien weiß, in m
const LINE_W = 0.15, EDGE_IN = 0.3, DASH_LEN = 3, PAINT = 0.85; // PAINT < 1: abgefahrene Farbe, Belag scheint durch
const YELLOW = [0.78, 0.5, 0.06], WHITE = [0.75, 0.75, 0.72]; // linear
const TRI_SHARP = 4; // Triplanar: Achsen-Gewicht |N|^4 → schmale Übergangszone zwischen den Projektionen
const AT_SCALE = 0.29, AT_WAVE = 0.04; // Anti-Tiling: zweites Sample 3,4× größer; Mischmuster ~25 m
const AT_COS = Math.cos(0.61), AT_SIN = Math.sin(0.61); // gedreht, damit die Kachelkanten nicht parallel liegen // Höhen-Blend: helle Texel (Steine) setzen sich im Übergang durch statt weich zu mischen

// Alle Schichten einer Art als RGBA8-Array size², Zeile 0 = Bildoberkante; eigene Dateien werden auf size skaliert
async function loadArray(biome, kind, size, srgb, anisotropy) {
    const data = new Uint8Array(size * size * 4 * ROLES.length);
    const ctx = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
    for (const [i, l] of ROLES.entries()) {
        const r = await fetch(`${import.meta.env.BASE_URL}textures/${biome}/${l}/${kind}.jpg`);
        if (!r.ok) throw new Error(`textures/${biome}/${l}/${kind}.jpg: ${r.status}`);
        // 'none': Rohwerte, sonst verbiegt das Farbmanagement die Normalen
        const bmp = await createImageBitmap(await r.blob(), { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        data.set(ctx.getImageData(0, 0, size, size).data, i * size * size * 4);
    }
    // Mittelfarbe je Schicht (linear) für die Tönung auf die Farbkarte; jeder 7. Texel reicht
    const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    const mean = ROLES.map((_, i) => {
        const s = [0, 0, 0], o = i * size * size * 4;
        let k = 0;
        for (let p = 0; p < size * size; p += 7, k++) for (let c = 0; c < 3; c++) s[c] += srgb ? lin(data[o + 4 * p + c]) : data[o + 4 * p + c] / 255;
        return s.map(v => v / k);
    });
    const t = new DataArrayTexture(data, size, size, ROLES.length);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    t.needsUpdate = true;
    return { t, mean };
}

// colorTex = Farbtextur der Vorschau (RES², fern), maskTex = materialMask (RES²), roadUVTex = Straßen-Koordinaten (RES²,
// masks.js); alle per set*() tauschbar. ready: false, bis die Texturen geladen sind → so lange zeigt main das Farbmaterial
export function createTerrainMaterial(colorTex, maskTex, roadUVTex, anisotropy) {
    const u = {
        sand: uniform(1.5), green: uniform(45), rockH: uniform(85), scree: uniform(115), snow: uniform(140), // m über waterLevel
        rockLo: uniform(0.7), rockHi: uniform(1.2), // Neigung m/m
        waterLevel: uniform(15), gravelCurv: uniform(0), curvScale: uniform(1), texScale: uniform(4), texFade: uniform(150),
        texTint: uniform(1), // 1 = Mittelfarbe der Textur → Farbkarte (nah = fern, Rampe/Straßenfarbe gelten), 0 = Texturfarbe
        sandColor: uniform(new Vector3(0.5, 0.45, 0.2)), // linear, Sand der Farbrampe (unter Wasser)
        marks: uniform(0), halfWidth: uniform(2), // Markierungen an (1) / aus; halbe Fahrbahnbreite m zum Dekodieren
    };
    const mean = ROLES.map(() => uniform(new Vector3(1, 1, 1)));
    const color = texture(colorTex, uv()), mask = texture(maskTex, uv()), road = texture(roadUVTex, uv());
    const mat = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
    mat.colorNode = color;
    // Eis statt Wasser (Biome mit ice): Wasser-Mesh mit uv wie das Terrain, Alpha der Ecken = Tiefe → Ufer läuft aus wie beim
    // Wasser (opak gäbe im Flachwasser Zickzack zweier fast paralleler Flächen)
    const ice = new MeshStandardNodeMaterial({ roughness: ICE_ROUGH, metalness: 0, transparent: true });
    let albedo = null, normals = null;
    const self = { mat, ice, ready: false, size: 0 };

    // Linien prozedural aus roadUV: Querabstand linear gefiltert → scharfe Kante bei jeder Nähe. Pixel-Fußabdruck fw in m:
    // schmaler als ein Pixel → Linie fw breit, Deckung LINE_W / fw (vorgefiltert, fern kein Moiré)
    function markings(base) {
        const lat = road.r.mul(2).sub(1).mul(u.halfWidth);
        const along = atan(road.b.mul(2).sub(1), road.g.mul(2).sub(1)).mul(DASH_PERIOD / (2 * Math.PI)); // 0 = Strichmitte
        const fw = max(fwidth(positionWorld.xz).length(), 1e-4);
        const band = (d, w) => {
            const ww = max(fw, w);
            return float(1).sub(smoothstep(ww.sub(fw).mul(0.5), ww.add(fw).mul(0.5), d)).mul(float(w).div(ww));
        };
        const on = smoothstep(0.45, 0.55, road.a).mul(u.marks).mul(PAINT); // Linien enden, statt an Gabelungen halb zu verblassen
        const center = band(lat.abs(), LINE_W).mul(band(along.abs(), DASH_LEN));
        const edge = band(lat.abs().sub(u.halfWidth.sub(EDGE_IN + LINE_W / 2)).abs(), LINE_W);
        return mix(mix(base, vec3(...WHITE), edge.mul(on)), vec3(...YELLOW), center.mul(on));
    }

    function build() {
        const ramp = (h, a, b) => clamp(h.sub(a).div(max(b.sub(a), 0.01)), 0, 1); // linear wie die Farbrampe
        const h = positionWorld.y.sub(u.waterLevel);
        const slope = tan(mask.r.min(0.995).mul(Math.PI / 2));
        const dev = mask.g.sub(0.5).mul(2).mul(u.curvScale);
        const above = mask.a.mul(SHORE_RANGE);
        // Schichten übereinander in der Reihenfolge der Farbrampe: Höhe → Mulden-Kies → Ufer → Fels nach Neigung → Straße
        const over = [
            [L.rock, ramp(h, u.green, u.rockH)],
            [L.scree, ramp(h, u.rockH, u.scree)],
            [L.top, ramp(h, u.scree, u.snow)],
            [L.scree, select(u.gravelCurv.greaterThan(0), ramp(dev.negate(), u.gravelCurv, u.gravelCurv.mul(2)), float(0))],
            [L.shore, float(1).sub(ramp(above, float(0), u.sand))],
            [L.rock, ramp(slope, u.rockLo, u.rockHi)],
            [L.road, mask.b],
        ];
        let w = ROLES.map((_, i) => float(i === L.ground ? 1 : 0));
        for (const [k, a] of over) w = w.map((v, i) => v.mul(float(1).sub(a)).add(i === k ? a : 0));
        // Projektion: planar über XZ; Fels triplanar (Klippen, Böschungen), Achsen-Gewichte |N|⁴
        const N = normalLocal.normalize();
        const p = positionWorld.div(u.texScale), uvX = p.zy, uvY = p.xz, uvZ = p.xy;
        const bw = pow(N.abs(), vec3(TRI_SHARP)), bl = bw.div(bw.x.add(bw.y).add(bw.z));
        const tri = (smp, f) => f(smp(uvX), 'x').mul(bl.x).add(f(smp(uvY), 'y').mul(bl.y)).add(f(smp(uvZ), 'z').mul(bl.z));
        // Anti-Tiling: zweites Sample 1/AT_SCALE größer und gedreht, per Welt-Noise (AT_WAVE) eingemischt → die 4-m-Wiederholung
        // zerfällt an großen Flächen (Felswände, Wiesen). Normalen gleich gemischt, sonst liegen die Lichtkanten dort auf
        // einem anderen Muster als die sichtbaren Halme
        const anti = smoothstep(-0.3, 0.3, mx_noise_float(positionWorld.xz.mul(AT_WAVE)));
        const rot = v => vec2(v.x.mul(AT_COS).sub(v.y.mul(AT_SIN)), v.x.mul(AT_SIN).add(v.y.mul(AT_COS))).mul(AT_SCALE);
        const alb = i => st => mix(albedo.sample(st).depth(i), albedo.sample(rot(st)).depth(i), anti);
        const tex = ROLES.map((_, i) => i === L.rock ? tri(alb(i), s => s) : alb(i)(uvY));
        // Detail-Normalen: OpenGL-Normal Map (u, v, oben), v gespiegelt (Zeile 0 = Bildoberkante liegt bei v = 0);
        // Whiteout-Blend je Projektion (B. Golus) → Welt-Normale
        const unpack = s => vec3(s.x.mul(2).sub(1), s.y.mul(2).sub(1).negate(), s.z.mul(2).sub(1));
        const back = t => vec3(t.x.mul(AT_COS).add(t.y.mul(AT_SIN)), t.y.mul(AT_COS).sub(t.x.mul(AT_SIN)), t.z); // Drehung von rot() zurück
        const nor = i => st => mix(unpack(normals.sample(st).depth(i)), back(unpack(normals.sample(rot(st)).depth(i))), anti);
        const white = {
            x: t => vec3(t.z.abs().mul(N.x), t.y.add(N.y), t.x.add(N.z)), // uv = (z, y)
            y: t => vec3(t.x.add(N.x), t.z.abs().mul(N.y), t.y.add(N.z)), // uv = (x, z)
            z: t => vec3(t.x.add(N.x), t.y.add(N.y), t.z.abs().mul(N.z)), // uv = (x, y)
        };
        const nrm = ROLES.map((_, i) => (i === L.rock ? tri(nor(i), (t, a) => white[a](t)) : white.y(nor(i)(uvY))).normalize());
        const b = w.map((v, i) => pow(v.mul(luminance(tex[i].rgb).add(BLEND_LUMA)), BLEND_SHARP));
        const sum = b.reduce((a, v) => a.add(v)).max(1e-6);
        const near = b.reduce((a, v, i) => a.add(tex[i].rgb.mul(v)), vec3(0)).div(sum);
        const avg = b.reduce((a, v, i) => a.add(mean[i].mul(v)), vec3(0)).div(sum).max(1e-3);
        // unter Wasser auf die Sandfarbe statt aufs Wasser-Blau der Farbkarte (Blau liefert der Wasser-Mesh); weich über die
        // ersten SHORE_WET m, A ist linear gefiltert → keine Pixeltreppe an der Wasserlinie
        const target = mix(u.sandColor, color.rgb, smoothstep(0, SHORE_WET / SHORE_RANGE, mask.a));
        const tinted = near.mul(mix(vec3(1), target.div(avg), u.texTint));
        const fade = smoothstep(u.texFade.mul(0.5), u.texFade, positionWorld.distance(cameraPosition));
        mat.colorNode = mix(markings(tinted), color.rgb, fade);
        const detail = b.reduce((a, v, i) => a.add(nrm[i].mul(v)), vec3(0)).normalize();
        mat.normalNode = transformNormalToView(mix(detail, N, fade).normalize()); // Mesh ohne Transformation: lokal = Welt
        mat.needsUpdate = true;
        // Eis: Ufer-Textur planar, getönt auf die Farbkarte (zeigt unter Wasser die Eis-Farben des Bioms), fern die Farbkarte
        ice.colorNode = mix(tex[L.shore].rgb.mul(mix(vec3(1), color.rgb.div(mean[L.shore].max(1e-3)), u.texTint)), color.rgb, fade);
        ice.normalNode = transformNormalToView(mix(nrm[L.shore], N, fade).normalize());
        ice.opacityNode = vertexColor().a;
        ice.needsUpdate = true;
    }

    // size = Kantenlänge der Schicht-Texturen (1024 / 2048), biome = Ordner; lädt neu, erster Aufruf baut den Shader.
    // Nacheinander: schneller Biom-Wechsel → der zuletzt gewählte Satz bleibt stehen, nicht der zuletzt fertige
    let chain = Promise.resolve();
    self.load = (size, biome) => {
        const run = chain.then(() => loadNow(size, biome));
        chain = run.catch(() => {});
        return run;
    };
    async function loadNow(size, biome) {
        const [a, n] = [await loadArray(biome, 'albedo', size, true, anisotropy), await loadArray(biome, 'normal', size, false, anisotropy)];
        a.mean.forEach((c, i) => mean[i].value.set(...c));
        if (albedo) {
            albedo.value.dispose();
            normals.value.dispose();
            albedo.value = a.t;
            normals.value = n.t;
        } else {
            albedo = texture(a.t);
            normals = texture(n.t);
            build();
        }
        self.size = size;
        self.ready = true;
    }
    self.setColorTex = t => { color.value = t; };
    self.setMask = (t, curvScale) => { mask.value = t; u.curvScale.value = curvScale; };
    self.setRoadUV = (t, halfWidth) => { road.value = t; u.halfWidth.value = halfWidth; };
    // v: Rampen-Höhen (m über waterLevel), Fels-Neigung m/m, Wasserspiegel, Kies-Krümmung m, Kachel m, Überblendung m
    self.update = v => {
        for (const k of Object.keys(v)) if (u[k].value.isVector3) u[k].value.set(...v[k]); else u[k].value = v[k];
    };
    return self;
}
