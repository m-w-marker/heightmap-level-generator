import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import WGSL from './heightmap.wgsl?raw';
import { generateRoads, MAX_ROADS, ROAD_POINTS } from './roadgen.js';
import { encodeUniforms, ROADS_OFFSET, autoMaxH } from './uniforms.js';

// M1: Renderer + Szene (→ Plan/Build.md M1)
const renderer = new WebGPURenderer({ antialias: true });
try {
    await renderer.init();
} catch (e) {
    document.body.innerHTML = `<pre style="color:#f88;padding:20px">WebGPU not available:\n${e.message}</pre>`;
    throw e;
}

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
scene.fog = new THREE.Fog(0x0e1116, 600, 1600);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 4000);
camera.position.set(240, 280, 240);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.minDistance = 40;
controls.maxDistance = 1200;

// Sonne ≈ 30° hoch + schwächeres Himmelslicht → Relief auch bei flachen Hügeln lesbar
scene.add(new THREE.HemisphereLight(0xbdd7ff, 0x3a4a33, 0.7));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.8);
sun.position.set(220, 150, 120);
scene.add(sun);

// --- M2: Compute-Pipeline + 2D-Preview (→ Plan/Build.md M2) ---
const RES = 1024;
const MAP = 400;

const params = {
    seed: 1337,
    baseLevel: 30,
    hillAmp: 8,
    hillWave: 120,
    hillRoughness: 0.5, // Oktaven-Gain: 0.25 glatt rollend … 0.65 zerklüftet
    mountainAmp: 60,
    mountainWave: 180,
    clusterWave: 220,
    mountainCoverage: 30,
    cliffDrop: 20,
    cliffWave: 90,
    cliffWidth: 15,
    cliffAreaWave: 160,
    cliffCoverage: 30,
    rimAmp: 40,
    rimZone: 45,
    rimWave: 90,
    maxH: 0, // automatisch (autoMaxH) in generate()
    waterLevel: 15,
    roadWidth: 4,
    roadSlope: 35, // Böschungswinkel in °
    roadSlopeVar: 20, // ± ° entlang der Straße
    roadOffset: -0.3, // leicht eingesunken wie ein Feldweg (→ Plan/StrassenLandschaft.md)
    roadTolerance: 0.7,
    roadColor: '#9a8462',
    levelSmoothing: 6, // m Radius des Level-Felds
    slopePenalty: 4,
    waterAvoid: 2,
    townCount: 5,
    townSpacing: 80,
    exitCount: 3,
    extraLinks: 2,
    reuse: 0.4,
};

const uniformsData = new Float32Array(ROADS_OFFSET + 4 * MAX_ROADS * ROAD_POINTS);

const device = renderer.backend.device;
if (!device) throw new Error('No WebGPU device (WebGL fallback active?)');
const queue = device.queue;
device.addEventListener('uncapturederror', e => console.error('WebGPU:', e.error.message));

const heightBuf = device.createBuffer({
    size: RES * RES * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
});
const uniformsBuf = device.createBuffer({ size: uniformsData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const roadMaskBuf = device.createBuffer({ size: RES * RES * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

const shaderModule = device.createShaderModule({ code: WGSL });
const info = await shaderModule.getCompilationInfo();
for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`WGSL ${m.lineNum}:${m.linePos} ${m.message}`);
const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
});

const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: uniformsBuf } },
        { binding: 1, resource: { buffer: heightBuf } },
        { binding: 2, resource: { buffer: roadMaskBuf } },
    ],
});

let heights = new Float32Array(RES * RES);
let roadMask = new Float32Array(RES * RES);

const PRE = 128; // Prepass-Auflösung für das CPU-Routing (→ Plan/Roads.md)

// Readback: Staging MAP_READ + copyBufferToBuffer + mapAsync (→ .clinerules/wgsl.md)
async function readBuffer(buf, bytes) {
    const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buf, 0, staging, 0, bytes);
    queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return out;
}

let terrain128 = new Float32Array(PRE * PRE); // in Metern (→ Plan/Roads.md)

async function generate() {
    const t0 = performance.now();
    params.maxH = autoMaxH(params);

    // Prepass: 128² Roh-Terrain (ohne Straßen, mit Rand-Ring → Routing meidet ihn über slopePenalty)
    // → Routing-Daten für roadgen (→ Plan/PresetsAusfahrten.md)
    encodeUniforms({ ...params, mapSize: MAP, res: PRE, roadCount: 0 },
        new Float32Array(MAX_ROADS * ROAD_POINTS * 2), new Float32Array(MAX_ROADS * ROAD_POINTS), uniformsData);
    queue.writeBuffer(uniformsBuf, 0, uniformsData);
    const preEnc = device.createCommandEncoder();
    const prePass = preEnc.beginComputePass();
    prePass.setPipeline(pipeline);
    prePass.setBindGroup(0, bind);
    prePass.dispatchWorkgroups(PRE / 16, PRE / 16);
    prePass.end();
    queue.submit([preEnc.finish()]);
    const pre = await readBuffer(heightBuf, PRE * PRE * 4);
    for (let i = 0; i < pre.length; i++) terrain128[i] = pre[i] * params.maxH;

    // Prepass-Konsole-Check (→ Plan/Roads.md S1): Min/Max ≈ Final-Pass
    let pMn = Infinity, pMx = -Infinity;
    for (const h of terrain128) {
        if (h < pMn) pMn = h;
        if (h > pMx) pMx = h;
    }
    console.log(`Prepass 128²: min ${pMn.toFixed(1)} m · max ${pMx.toFixed(1)} m`);

    const tr = performance.now();
    const { points: roads, levels, count, nodes } = generateRoads(params.seed, MAP, { size: PRE, data: terrain128 }, params);
    console.log(`Road network: ${nodes.filter(n => !n.exit).length} towns · ${nodes.filter(n => n.exit).length} exits · ${count} roads · ${(performance.now() - tr).toFixed(0)} ms`);
    encodeUniforms({ ...params, mapSize: MAP, res: RES, roadCount: count }, roads, levels, uniformsData);
    queue.writeBuffer(uniformsBuf, 0, uniformsData);

    const bytes = RES * RES * 4;
    const staging = device.createBuffer({
        size: 2 * bytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(RES / 16, RES / 16);
    pass.end();
    encoder.copyBufferToBuffer(heightBuf, 0, staging, 0, bytes);
    encoder.copyBufferToBuffer(roadMaskBuf, 0, staging, bytes, bytes);
    queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const range = staging.getMappedRange();
    heights = new Float32Array(range.slice(0, bytes));
    roadMask = new Float32Array(range.slice(bytes, 2 * bytes));
    staging.unmap();
    staging.destroy();

    // Konsole-Check (→ Plan/Build.md M2 + M3)
    let mn = Infinity, mx = -Infinity, sum = 0, water = 0;
    let roadPx = 0, rMn = Infinity, rMx = -Infinity;
    for (let i = 0; i < heights.length; i++) {
        const h = heights[i] * params.maxH;
        if (h < mn) mn = h;
        if (h > mx) mx = h;
        sum += h;
        if (h < params.waterLevel) water++;
        const m = roadMask[i];
        if (m > 0.5) roadPx++;
        if (m >= 0.999) {
            if (h < rMn) rMn = h;
            if (h > rMx) rMx = h;
        }
    }
    console.log(
        `Heightmap 1024²: min ${mn.toFixed(1)} m · max ${mx.toFixed(1)} m · avg ${(sum / heights.length).toFixed(1)} m · water ${(100 * water / heights.length).toFixed(1)} %`
    );
    console.log(
        `Roads: ${(100 * roadPx / heights.length).toFixed(1)} % · road level ${rMn.toFixed(1)}–${rMx.toFixed(1)} m`
    );

    // Readback-Level vs. CPU-Level an den Polyline-Punkten (→ Plan/Roads.md S3); Fahrbahn darf im
    // Toleranzband liegen (→ Plan/StrassenLandschaft.md); Ausreißer nur an Kreuzungen erwartet
    const nPts = count * ROAD_POINTS, band = params.roadTolerance + 0.5;
    let dMax = 0, nOut = 0;
    for (let k = 0; k < nPts; k++) {
        const px = Math.min(Math.floor(roads[2 * k] / MAP * RES), RES - 1);
        const py = Math.min(Math.floor(roads[2 * k + 1] / MAP * RES), RES - 1);
        const d = Math.abs(heights[py * RES + px] * params.maxH - levels[k]);
        if (d > dMax) dMax = d;
        if (d > band) nOut++;
    }
    if (nPts > 0)
        console.log(`Road level GPU vs. CPU: max Δ ${dMax.toFixed(2)} m · ${nOut}/${nPts} points outside ±${band.toFixed(1)} m`);

    computeSlope();
    refreshView();
    console.log(`Regeneration: ${(performance.now() - t0).toFixed(0)} ms`);
}

// Preview + 3D-Mesh aus dem aktuellen Readback (auch bei reinem Farbwechsel, ohne Regeneration)
function refreshView() {
    updatePreview();
    if (terrain) {
        scene.remove(terrain);
        terrain.geometry.dispose();
    }
    terrain = buildTerrainMesh();
    scene.add(terrain);
}

// --- 2D-Preview (Farbcodierung nach Höhe) ---
const preview = document.getElementById('preview');
const pctx = preview.getContext('2d');
const pimg = pctx.createImageData(RES, RES);

// Farbrampe (Wasser/Sand/Gras/Fels/Schnee/Straße) — geteilt von 2D-Preview und 3D-Mesh, damit beide bei gleichem Seed identisch bleiben.
// In Metern über waterLevel, nicht relativ zu maxH (das ist automatisch → Farben würden je Preset wandern)
const STOPS = [
    [0, [194, 178, 128]],     // Sand (Ufer)
    [1.5, [108, 146, 72]],    // Gras
    [45, [72, 112, 54]],      // dunkles Grün
    [85, [112, 104, 92]],     // Fels
    [115, [150, 146, 138]],   // Schutt
    [140, [240, 244, 248]],   // Schnee
];
const ROCK = [110, 102, 92];
const ROCK_SLOPE = [0.7, 1.2]; // Hangneigung (m/m ≈ 35°–50°) → Überblendung zu Fels
const RELIEF_TINT = 0.06;      // Helligkeit pro m Kuppe/Mulde (±15 % max)

// '#rrggbb' → [r, g, b] 0–255, gecacht: terrainColor läuft 1M× pro Bild
let roadRGB = [0, 0, 0];
function setRoadColor() {
    const v = parseInt(params.roadColor.slice(1), 16);
    roadRGB = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
setRoadColor();

// schreibt 0–255-Werte (→ Plan/Build.md Datenfluss)
function terrainColor(out, o, hm, m, s, rel) {
    let r, g, b;
    if (hm < params.waterLevel) {
        const t = hm / params.waterLevel;
        r = 42 + 20 * t;
        g = 90 + 28 * t;
        b = 158 + 22 * t;
    } else {
        const n = hm - params.waterLevel;
        let a = STOPS[STOPS.length - 2], c = STOPS[STOPS.length - 1];
        for (let i = 0; i < STOPS.length - 1; i++) {
            if (n <= STOPS[i + 1][0]) { a = STOPS[i]; c = STOPS[i + 1]; break; }
        }
        const f = Math.min((n - a[0]) / (c[0] - a[0]), 1);
        r = a[1][0] + (c[1][0] - a[1][0]) * f;
        g = a[1][1] + (c[1][1] - a[1][1]) * f;
        b = a[1][2] + (c[1][2] - a[1][2]) * f;
        const k = Math.min(Math.max((s - ROCK_SLOPE[0]) / (ROCK_SLOPE[1] - ROCK_SLOPE[0]), 0), 1);
        r += (ROCK[0] - r) * k;
        g += (ROCK[1] - g) * k;
        b += (ROCK[2] - b) * k;
        const lit = 1 + Math.min(Math.max(rel * RELIEF_TINT, -0.15), 0.15);
        r *= lit;
        g *= lit;
        b *= lit;
    }
    if (m > 0.5) {
        const f = (m - 0.5) * 2; // weiche Fahrbahnkante
        r = r * (1 - f) + roadRGB[0] * f;
        g = g * (1 - f) + roadRGB[1] * f;
        b = b * (1 - f) + roadRGB[2] * f;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
}

// Aus dem Readback, einmal pro Regeneration (Kanten geclamped):
// slope = Hangneigung |∇h| in m/m (zentrale Differenzen); relief = Höhe − Mittel im Abstand RELIEF_R in m
// (> 0 Kuppe, < 0 Mulde) → Farbe heller/dunkler, macht flache Hügel lesbar
const RELIEF_R = 24; // px ≈ 9 m
let slope = new Float32Array(RES * RES);
let relief = new Float32Array(RES * RES);
function computeSlope() {
    const px = MAP / RES, k = params.maxH / (2 * px), H = params.maxH;
    const at = (x, y) => heights[Math.min(Math.max(y, 0), RES - 1) * RES + Math.min(Math.max(x, 0), RES - 1)];
    for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
        const gx = (at(x + 1, y) - at(x - 1, y)) * k;
        const gy = (at(x, y + 1) - at(x, y - 1)) * k;
        slope[y * RES + x] = Math.hypot(gx, gy);
        const avg = (at(x - RELIEF_R, y) + at(x + RELIEF_R, y) + at(x, y - RELIEF_R) + at(x, y + RELIEF_R)) / 4;
        relief[y * RES + x] = (at(x, y) - avg) * H;
    }
}

function updatePreview() {
    const d = pimg.data;
    for (let i = 0; i < RES * RES; i++) {
        terrainColor(d, i * 4, heights[i] * params.maxH, roadMask[i], slope[i], relief[i]);
        d[i * 4 + 3] = 255;
    }
    pctx.putImageData(pimg, 0, 0);
}

// --- M4: 3D-Terrain (→ Plan/Build.md M4) ---
const TN = 512; // Vertex je Kante; 1 Unit = 1 m
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
let terrain = null;

// Bilinear aus dem 1024²-Readback (Pixelzentren bei (p+0.5)/RES, Kanten geclamped)
function sampleBilinear(buf, u, v) {
    const fx = u * RES - 0.5, fy = v * RES - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const xa = Math.min(Math.max(x0, 0), RES - 1);
    const xb = Math.min(Math.max(x0 + 1, 0), RES - 1);
    const ya = Math.min(Math.max(y0, 0), RES - 1);
    const yb = Math.min(Math.max(y0 + 1, 0), RES - 1);
    const top = buf[ya * RES + xa] * (1 - tx) + buf[ya * RES + xb] * tx;
    const bot = buf[yb * RES + xa] * (1 - tx) + buf[yb * RES + xb] * tx;
    return top * (1 - ty) + bot * ty;
}

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function buildTerrainMesh() {
    const pos = new Float32Array(TN * TN * 3);
    const col = new Float32Array(TN * TN * 3);
    const idx = new Uint32Array((TN - 1) * (TN - 1) * 6);
    for (let j = 0; j < TN; j++) {
        for (let i = 0; i < TN; i++) {
            const o = (j * TN + i) * 3;
            const u = i / (TN - 1), v = j / (TN - 1);
            pos[o] = -MAP / 2 + u * MAP;
            pos[o + 1] = sampleBilinear(heights, u, v) * params.maxH;
            pos[o + 2] = -MAP / 2 + v * MAP;
            terrainColor(col, o, pos[o + 1], sampleBilinear(roadMask, u, v), sampleBilinear(slope, u, v), sampleBilinear(relief, u, v));
            // Vertex-Farben liest three als linear → sRGB-Rampe umrechnen, sonst doppelt aufgehellt (blass)
            col[o] = srgbToLinear(col[o] / 255);
            col[o + 1] = srgbToLinear(col[o + 1] / 255);
            col[o + 2] = srgbToLinear(col[o + 2] / 255);
        }
    }
    let ii = 0;
    for (let j = 0; j < TN - 1; j++) {
        for (let i = 0; i < TN - 1; i++) {
            const a = j * TN + i, b = a + 1, c = a + TN, d = c + 1;
            // (a,c,b)+(c,d,b): CCW von oben → Normals zeigen nach +Y
            idx[ii++] = a; idx[ii++] = c; idx[ii++] = b;
            idx[ii++] = c; idx[ii++] = d; idx[ii++] = b;
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, terrainMat);
}

// --- M5: GUI + Export (→ Plan/Build.md M5) ---
// Debounce + Coalescing: Slider-Drags triggern nur eine Regeneration, keine Überlappung
let genTimer = 0;
let genBusy = false;
let genDirty = false;
function scheduleGenerate() {
    clearTimeout(genTimer);
    genTimer = setTimeout(runGenerate, 150);
}
async function runGenerate() {
    if (genBusy) { genDirty = true; return; }
    genBusy = true;
    try {
        await generate();
    } catch (e) {
        console.error('generate:', e);
    } finally {
        genBusy = false;
        if (genDirty) { genDirty = false; runGenerate(); }
    }
}

function addNum(folder, key, min, max, step) {
    folder.add(params, key).min(min).max(max).step(step).name(key).onChange(scheduleGenerate);
}

const gui = new GUI({ title: 'Terrain' });
gui.add(params, 'seed').min(1).max(99999).step(1).name('Seed').onChange(scheduleGenerate);

// Presets = Standardwerte (gui.reset(), inkl. Seed) + Overrides (→ Plan/PresetsAusfahrten.md).
// Buttons statt Dropdown: ein Dropdown würde von gui.reset() mitgesetzt → onChange-Schleife.
const PRESETS = {
    'Rolling hills': { hillAmp: 9, hillWave: 90, hillRoughness: 0.35, mountainAmp: 25, mountainWave: 200, clusterWave: 250,
        mountainCoverage: 25, cliffDrop: 5, cliffWidth: 20, cliffCoverage: 10, rimAmp: 35, rimZone: 60,
        townCount: 6, townSpacing: 70, extraLinks: 3, roadSlopeVar: 15 },
    'Pasture': { baseLevel: 25, hillAmp: 4, hillWave: 100, hillRoughness: 0.3, mountainAmp: 0, mountainCoverage: 0,
        cliffDrop: 0, cliffCoverage: 0, rimAmp: 25, rimZone: 70, rimWave: 120, townCount: 4, townSpacing: 90, extraLinks: 1 },
    'Mountains': { baseLevel: 25, hillAmp: 12, hillRoughness: 0.6, mountainAmp: 120, mountainWave: 200, clusterWave: 260,
        mountainCoverage: 45, cliffDrop: 15, cliffCoverage: 15, rimAmp: 70, rimZone: 60,
        townCount: 4, townSpacing: 60, slopePenalty: 7, extraLinks: 1 },
    'Canyon / Plateaus': { baseLevel: 45, hillAmp: 3, hillRoughness: 0.35, mountainAmp: 0, mountainCoverage: 0,
        cliffDrop: 45, cliffWave: 120, cliffWidth: 8, cliffAreaWave: 220, cliffCoverage: 70, rimAmp: 30,
        townCount: 5, slopePenalty: 5, roadSlopeVar: 10 },
    'Lakes': { baseLevel: 18.5, hillAmp: 6, hillWave: 110, hillRoughness: 0.35, mountainAmp: 15, mountainCoverage: 10,
        cliffDrop: 4, cliffCoverage: 5, waterLevel: 16, rimAmp: 30, townCount: 5, waterAvoid: 4 },
};
function applyPreset(overrides) {
    gui.reset();
    Object.assign(params, overrides);
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    scheduleGenerate();
}
const fPreset = gui.addFolder('Presets');
fPreset.add({ reset: () => applyPreset({}) }, 'reset').name('Defaults');
for (const [name, p] of Object.entries(PRESETS)) fPreset.add({ apply: () => applyPreset(p) }, 'apply').name(name);
addNum(gui.addFolder('Base'), 'baseLevel', 0, 60, 0.5);
const fHuegel = gui.addFolder('Hills');
addNum(fHuegel, 'hillAmp', 0, 30, 0.5);
addNum(fHuegel, 'hillWave', 20, 400, 5);
addNum(fHuegel, 'hillRoughness', 0.25, 0.65, 0.01);
const fBerge = gui.addFolder('Mountains');
addNum(fBerge, 'mountainAmp', 0, 150, 5);
addNum(fBerge, 'mountainWave', 60, 500, 5);
addNum(fBerge, 'clusterWave', 60, 500, 5);
addNum(fBerge, 'mountainCoverage', 0, 100, 1);
const fCliff = gui.addFolder('Cliffs');
addNum(fCliff, 'cliffDrop', 0, 60, 0.5);
addNum(fCliff, 'cliffWave', 20, 300, 5);
addNum(fCliff, 'cliffWidth', 2, 60, 0.5);
addNum(fCliff, 'cliffAreaWave', 40, 400, 5);
addNum(fCliff, 'cliffCoverage', 0, 100, 1);
const fRoad = gui.addFolder('Roads');
// Maxima so, dass MST + Zusatz + Ausfahrten ≤ MAX_ROADS: (8 − 1) + 4 + 4 = 15
addNum(fRoad, 'townCount', 1, 8, 1);
addNum(fRoad, 'townSpacing', 30, 150, 5);
addNum(fRoad, 'exitCount', 0, 4, 1);
addNum(fRoad, 'extraLinks', 0, 4, 1);
addNum(fRoad, 'roadWidth', 1, 5, 0.5);
addNum(fRoad, 'roadSlope', 15, 60, 1);
addNum(fRoad, 'roadSlopeVar', 0, 30, 1);
addNum(fRoad, 'roadOffset', -2, 3, 0.1);
addNum(fRoad, 'roadTolerance', 0, 3, 0.1);
fRoad.addColor(params, 'roadColor').onChange(() => { setRoadColor(); refreshView(); });
addNum(fRoad, 'levelSmoothing', 0, 40, 1);
addNum(fRoad, 'slopePenalty', 0, 10, 0.5);
addNum(fRoad, 'waterAvoid', 0, 5, 0.5);
addNum(fRoad, 'reuse', 0.1, 1, 0.05);
const fRim = gui.addFolder('Border ring');
addNum(fRim, 'rimAmp', 0, 100, 1);
addNum(fRim, 'rimZone', 10, 150, 5);
addNum(fRim, 'rimWave', 20, 300, 5);
const fGlobal = gui.addFolder('Global');
fGlobal.add(params, 'maxH').name('maxH (auto)').disable().listen();
addNum(fGlobal, 'waterLevel', 0, 50, 0.5);
gui.add({ regenerate: runGenerate }, 'regenerate').name('Regenerate');
gui.add({ exportPng }, 'exportPng').name('Export PNG');

// Graustufen-PNG der rohen Heightmap (0–1 → 0–255), 1:1 zu den Preview-Daten
function exportPng() {
    const c = document.createElement('canvas');
    c.width = RES;
    c.height = RES;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(RES, RES);
    const d = img.data;
    for (let i = 0; i < heights.length; i++) {
        const v = Math.min(Math.max(Math.round(heights[i] * 255), 0), 255);
        d[i * 4] = v;
        d[i * 4 + 1] = v;
        d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    c.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `heightmap-${params.seed}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
    }, 'image/png');
}

runGenerate();

renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
