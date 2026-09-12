// Auto-Material des 3D-Terrains (→ Plan/Texturierung.md): three NodeMaterial (TSL), weil es unter WebGPU kein
// onBeforeCompile gibt. Terrain-Mesh ohne Transformation → lokal = Welt
import { MeshStandardNodeMaterial, DataArrayTexture, Vector3, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, NoColorSpace } from 'three/webgpu';
import { texture, uv, uniform, positionWorld, cameraPosition, float, vec3, clamp, max, pow, tan, smoothstep, mix, luminance, select } from 'three/tsl';
import { SHORE_RANGE } from './masks.js';

// Ebene im Texture-Array = Ordner in public/textures (austauschbar: albedo.jpg sRGB + normal.jpg OpenGL, beliebige Größe)
export const LAYERS = ['grass', 'rock', 'gravel', 'sand', 'snow', 'road'];
const L = Object.fromEntries(LAYERS.map((l, i) => [l, i]));
const SHORE_WET = 0.3; // m über dem Ufer-Spiegel: Übergang Sandfarbe (unter Wasser) → Farbkarte
const BLEND_LUMA = 0.3, BLEND_SHARP = 4; // Höhen-Blend: helle Texel (Steine) setzen sich im Übergang durch statt weich zu mischen

// Alle Schichten einer Art als RGBA8-Array size², Zeile 0 = Bildoberkante; eigene Dateien werden auf size skaliert
async function loadArray(kind, size, srgb, anisotropy) {
    const data = new Uint8Array(size * size * 4 * LAYERS.length);
    const ctx = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
    for (const [i, l] of LAYERS.entries()) {
        const r = await fetch(`${import.meta.env.BASE_URL}textures/${l}/${kind}.jpg`);
        if (!r.ok) throw new Error(`textures/${l}/${kind}.jpg: ${r.status}`);
        // 'none': Rohwerte, sonst verbiegt das Farbmanagement die Normalen
        const bmp = await createImageBitmap(await r.blob(), { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        data.set(ctx.getImageData(0, 0, size, size).data, i * size * size * 4);
    }
    // Mittelfarbe je Schicht (linear) für die Tönung auf die Farbkarte; jeder 7. Texel reicht
    const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    const mean = LAYERS.map((_, i) => {
        const s = [0, 0, 0], o = i * size * size * 4;
        let k = 0;
        for (let p = 0; p < size * size; p += 7, k++) for (let c = 0; c < 3; c++) s[c] += srgb ? lin(data[o + 4 * p + c]) : data[o + 4 * p + c] / 255;
        return s.map(v => v / k);
    });
    const t = new DataArrayTexture(data, size, size, LAYERS.length);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    t.needsUpdate = true;
    return { t, mean };
}

// colorTex = Farbtextur der Vorschau (RES², fern), maskTex = materialMask (RES²); beide per set*() tauschbar.
// ready: false, bis die Texturen geladen sind → so lange zeigt main das Farbmaterial
export function createTerrainMaterial(colorTex, maskTex, anisotropy) {
    const u = {
        sand: uniform(1.5), green: uniform(45), rockH: uniform(85), scree: uniform(115), snow: uniform(140), // m über waterLevel
        rockLo: uniform(0.7), rockHi: uniform(1.2), // Neigung m/m
        waterLevel: uniform(15), gravelCurv: uniform(0), curvScale: uniform(1), texScale: uniform(4), texFade: uniform(150),
        texTint: uniform(1), // 1 = Mittelfarbe der Textur → Farbkarte (nah = fern, Rampe/Straßenfarbe gelten), 0 = Texturfarbe
        sandColor: uniform(new Vector3(0.5, 0.45, 0.2)), // linear, Sand der Farbrampe (unter Wasser)
    };
    const mean = LAYERS.map(() => uniform(new Vector3(1, 1, 1)));
    const color = texture(colorTex, uv()), mask = texture(maskTex, uv());
    const mat = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
    mat.colorNode = color;
    let albedo = null;
    const self = { mat, ready: false, size: 0 };

    function build() {
        const ramp = (h, a, b) => clamp(h.sub(a).div(max(b.sub(a), 0.01)), 0, 1); // linear wie die Farbrampe
        const h = positionWorld.y.sub(u.waterLevel);
        const slope = tan(mask.r.min(0.995).mul(Math.PI / 2));
        const dev = mask.g.sub(0.5).mul(2).mul(u.curvScale);
        const above = mask.a.mul(SHORE_RANGE);
        // Schichten übereinander in der Reihenfolge der Farbrampe: Höhe → Mulden-Kies → Ufer → Fels nach Neigung → Straße
        const over = [
            [L.rock, ramp(h, u.green, u.rockH)],
            [L.gravel, ramp(h, u.rockH, u.scree)],
            [L.snow, ramp(h, u.scree, u.snow)],
            [L.gravel, select(u.gravelCurv.greaterThan(0), ramp(dev.negate(), u.gravelCurv, u.gravelCurv.mul(2)), float(0))],
            [L.sand, float(1).sub(ramp(above, float(0), u.sand))],
            [L.rock, ramp(slope, u.rockLo, u.rockHi)],
            [L.road, mask.b],
        ];
        let w = LAYERS.map((_, i) => float(i === L.grass ? 1 : 0));
        for (const [k, a] of over) w = w.map((v, i) => v.mul(float(1).sub(a)).add(i === k ? a : 0));
        const st = positionWorld.xz.div(u.texScale);
        const tex = LAYERS.map((_, i) => albedo.sample(st).depth(i));
        const b = w.map((v, i) => pow(v.mul(luminance(tex[i].rgb).add(BLEND_LUMA)), BLEND_SHARP));
        const sum = b.reduce((a, v) => a.add(v)).max(1e-6);
        const near = b.reduce((a, v, i) => a.add(tex[i].rgb.mul(v)), vec3(0)).div(sum);
        const avg = b.reduce((a, v, i) => a.add(mean[i].mul(v)), vec3(0)).div(sum).max(1e-3);
        // unter Wasser auf die Sandfarbe statt aufs Wasser-Blau der Farbkarte (Blau liefert der Wasser-Mesh); weich über die
        // ersten SHORE_WET m, A ist linear gefiltert → keine Pixeltreppe an der Wasserlinie
        const target = mix(u.sandColor, color.rgb, smoothstep(0, SHORE_WET / SHORE_RANGE, mask.a));
        const tinted = near.mul(mix(vec3(1), target.div(avg), u.texTint));
        const d = positionWorld.distance(cameraPosition);
        mat.colorNode = mix(tinted, color.rgb, smoothstep(u.texFade.mul(0.5), u.texFade, d));
        mat.needsUpdate = true;
    }

    // size = Kantenlänge der Schicht-Texturen (1024 / 2048); lädt neu, erster Aufruf baut den Shader
    self.load = async size => {
        const { t, mean: m } = await loadArray('albedo', size, true, anisotropy);
        m.forEach((c, i) => mean[i].value.set(...c));
        if (albedo) {
            albedo.value.dispose();
            albedo.value = t;
        } else {
            albedo = texture(t);
            build();
        }
        self.size = size;
        self.ready = true;
    };
    self.setColorTex = t => { color.value = t; };
    self.setMask = (t, curvScale) => { mask.value = t; u.curvScale.value = curvScale; };
    // v: Rampen-Höhen (m über waterLevel), Fels-Neigung m/m, Wasserspiegel, Kies-Krümmung m, Kachel m, Überblendung m
    self.update = v => {
        for (const k of Object.keys(v)) if (u[k].value.isVector3) u[k].value.set(...v[k]); else u[k].value = v[k];
    };
    return self;
}
