import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildPanel, seedGrid } from './ui.js';
import { encodePng } from './png.js';
import { quantize16, encodeR16, sampleBilinear, resample, TARGETS, exportSizes, engineImport, flipRows } from './export.js';
import { gradient, slopeDeg, normals, curvature, slopeBytes, normalBytes, curvatureBytes, curvatureScale, CURV_R, flowScale, flowBytes } from './masks.js';
import WGSL from './heightmap.wgsl?raw';
import { generateRoads, MAX_ROADS, ROAD_POINTS } from './roadgen.js';
import { encodeUniforms, UNIFORM_FLOATS, grids, autoMaxH } from './uniforms.js';
import { hydrology } from './hydro.js';
import { createErosion } from './erosion.js';
import { createWalk } from './walk.js';

// M1: Renderer + Szene (→ Plan/Build.md M1)
function noWebGPU(detail) {
    document.body.innerHTML = `<pre style="color:#f88;background:#0e1116;margin:0;height:100%;padding:20px;white-space:pre-wrap">`
        + `WebGPU not available${detail ? ':\n' + detail : '.'}\n\n`
        + `This tool needs a browser with WebGPU (desktop Chrome/Edge 113+, Safari 26+, Firefox 141+ on Windows)\n`
        + `and a secure context (https or localhost).</pre>`;
}
const renderer = new WebGPURenderer({ antialias: true });
try {
    await renderer.init();
} catch (e) {
    noWebGPU(e.message);
    throw e;
}
// ohne WebGPU fällt three still auf WebGL2 zurück, dann fehlt backend.device für die Compute-Shader
if (!renderer.backend.isWebGPUBackend) {
    noWebGPU();
    throw new Error('WebGPU not available (WebGL fallback)');
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
// Kamera, Nebel und Zoomgrenzen je Map-Größe (bei 400 m: Nebel 600–1600, far 4000, Zoom 40–1200, Start 240/280/240);
// beim ersten Bild und wenn sich mapSize ändert (→ Plan/MapGroesse.md)
let viewSize = 0;
function fitView(size) {
    scene.fog.near = 1.5 * size;
    scene.fog.far = 4 * size;
    camera.far = 10 * size;
    camera.updateProjectionMatrix();
    controls.minDistance = 0.1 * size;
    controls.maxDistance = 3 * size;
    camera.position.set(0.6 * size, 0.7 * size, 0.6 * size);
    controls.target.set(0, 0, 0);
    controls.update();
    viewSize = size;
}
// headless-Prüfung: Kamera setzen, Readback lesen
if (import.meta.env.DEV) window.dbg = { camera, controls, scene, get heights() { return heights; }, get roadMask() { return roadMask; }, get maxH() { return params.maxH; },
    get params() { return params; }, get terrain128() { return terrain128; }, get water() { return water; } };

// Sonne ≈ 30° hoch + schwächeres Himmelslicht → Relief auch bei flachen Hügeln lesbar
scene.add(new THREE.HemisphereLight(0xbdd7ff, 0x3a4a33, 0.7));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.8);
sun.position.set(220, 150, 120);
scene.add(sun);

// --- M2: Compute-Pipeline + 2D-Preview (→ Plan/Build.md M2) ---
// Raster wachsen mit der Map (→ Plan/Aufloesung.md): GPU-Puffer einmal für die größte, RES/TN = aktuelle große Map
const GMAX = grids(Infinity);

const params = {
    // Start = flaches Hügelland mit etwas Wasser (Seed 1337: ~5 %); Presets setzen ihre Terrain-Werte selbst
    seed: 1337,
    mapSize: 512, // m Kantenlänge = 1024 px à 0,5 m; Raster wachsen mit (→ Plan/Pixel05.md)
    baseLevel: 17.5, // 2,5 m über waterLevel → Senken werden Seen
    hillAmp: 6,
    hillWave: 110,
    hillRoughness: 0.4, // Oktaven-Gain: 0.25 glatt rollend … 0.65 zerklüftet
    mountainAmp: 18,
    mountainWave: 180,
    clusterWave: 220,
    mountainCoverage: 12,
    cliffDrop: 4,
    cliffWave: 90,
    cliffWidth: 15,
    cliffAreaWave: 160,
    cliffCoverage: 8,
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
    roadMaxGrade: 12, // % max. Fahrbahn-Steigung (→ Plan/StrassenSteigung.md)
    waterAvoid: 2,
    townCount: 5,
    townSpacing: 80,
    clearingRadius: 8, // m flach um jeden Ort (→ Plan/Roadmap.md R12); größer wirkt am Hang wie ein Platz im Berg
    exitCount: 3,
    extraLinks: 2,
    reuse: 0.4,
    riverCatchment: 0, // % der Map als Einzugsgebiet einer Quelle; 0 = keine Flüsse/Seen → Maps wie vorher (→ Plan/Fluesse.md)
    riverWidth: 6,     // m an der größten Mündung
    lakeArea: 300,     // m² Mindestfläche eines Bergsees (wirkt nur mit Flüssen)
    erosionStrength: 0, // % (0 = aus → Maps wie vor der Erosion, → Plan/Erosion.md)
    erosionIterations: 300,
    screeAngle: 90, // ° Schuttwinkel der thermischen Erosion; 90 = aus, darunter werden Abrisskanten zu Schutthängen
};
// Basis jedes Presets; ohne maxH: sonst stünde es bis zur nächsten Regeneration auf 0 (flache Map, Export mit maxH 0)
const { maxH: _, ...DEFAULTS } = params;
let { res: RES, tn: TN } = grids(params.mapSize); // Heightmap px / Mesh-Ecken je Kante der angezeigten Map

const uniformsData = new Float32Array(UNIFORM_FLOATS);

const device = renderer.backend.device;
if (!device) throw new Error('No WebGPU device (WebGL fallback active?)');
const queue = device.queue;
device.addEventListener('uncapturederror', e => console.error('WebGPU:', e.error.message));

const uniformsBuf = device.createBuffer({ size: uniformsData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
// See-Spiegelfeld pre² aus hydrology() (→ Plan/Fluesse.md)
const lakesBuf = device.createBuffer({ size: GMAX.pre * GMAX.pre * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const erosion = createErosion(device);

const shaderModule = device.createShaderModule({ code: WGSL });
const info = await shaderModule.getCompilationInfo();
for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`WGSL ${m.lineNum}:${m.linePos} ${m.message}`);
const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
});

// Roh-Terrain für die Erosion (Entry raw, eigenes auto-Layout: nur Uniform + heights)
const rawPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: shaderModule, entryPoint: 'raw' } });

// Ausgänge res² (heights, roadMask, Wasserspiegel m je Pixel) für die größte Map; ein Export mit Detail ×2 lässt sie einmalig
// wachsen (→ Plan/ExportZiele.md). Nur innerhalb von serial() aufrufen → kein Pass läuft auf einem zerstörten Puffer
let heightBuf, roadMaskBuf, waterBuf, bind, rawBind, bufRes = 0;
function ensureBuffers(res) {
    if (res <= bufRes) return;
    if (res * res * 4 > device.limits.maxStorageBufferBindingSize) throw new Error(`${res}² px exceeds the GPU storage buffer limit`);
    for (const b of [heightBuf, roadMaskBuf, waterBuf]) b?.destroy();
    [heightBuf, roadMaskBuf, waterBuf] = [0, 1, 2].map(() =>
        device.createBuffer({ size: res * res * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }));
    bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [uniformsBuf, heightBuf, roadMaskBuf, erosion.delta, waterBuf, lakesBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    rawBind = device.createBindGroup({
        layout: rawPipeline.getBindGroupLayout(0),
        entries: [uniformsBuf, heightBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    bufRes = res;
}
ensureBuffers(GMAX.res);

let heights = new Float32Array(RES * RES);
let roadMask = new Float32Array(RES * RES);
let water = new Float32Array(RES * RES); // Spiegel von See/Fluss m je Pixel, 0 = nur Meer (→ spiegel())


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

let terrain128 = new Float32Array(0); // Prepass pre² in Metern (→ Plan/Roads.md)

// Nacheinander statt überlappend: erosion.delta muss über das await des Prepass bis zum Final-Pass stehen bleiben,
// eine parallele Seed-Vorschau würde es überschreiben
let gpuChain = Promise.resolve();
function serial(fn) {
    const run = gpuChain.then(fn);
    gpuChain = run.catch(() => {});
    return run;
}
const computeMap = (p, res) => serial(() => computeMapNow(p, res));

const NO_ROADS = new Float32Array(MAX_ROADS * ROAD_POINTS * 2), NO_LEVELS = new Float32Array(MAX_ROADS * ROAD_POINTS);
const NO_LAKES = new Float32Array(GMAX.pre * GMAX.pre);

// Roh-Terrain ero² nach heightBuf → Erosion → erosion.delta / erosion.flow (→ Plan/Erosion.md)
function runErosion(p, erode) {
    const ero = grids(p.mapSize).ero;
    encodeUniforms({ ...p, res: ero, roadCount: 0, clearingCount: 0, riverCount: 0 }, NO_ROADS, NO_LEVELS, [], null, uniformsData);
    queue.writeBuffer(uniformsBuf, 0, uniformsData);
    dispatch(ero, rawPipeline, rawBind);
    erosion.run(heightBuf, p, erode);
}

// (Erosion →) Prepass → Straßennetz → Final-Pass in res² für p (maxH gesetzt); auch für die Seed-Vorschau (→ Plan/Roadmap.md R13).
// Je Pass laufen writeBuffer, Dispatch und Kopie ohne await dazwischen (→ .clinerules/wgsl.md)
async function computeMapNow(p, res) {
    const t0 = performance.now();
    ensureBuffers(res);
    const erosionOn = p.erosionStrength > 0; // aus → heutiger Pfad bitgleich
    const PRE = grids(p.mapSize).pre; // Zellen bleiben 3,1 m (→ Plan/Aufloesung.md)
    if (erosionOn) runErosion(p, true);
    // Prepass: pre² Roh-Terrain (+ Erosion, ohne Straßen, mit Rand-Ring; die Randzone sperrt das Routing selbst)
    // → Routing-Daten für roadgen (→ Plan/PresetsAusfahrten.md)
    encodeUniforms({ ...p, res: PRE, roadCount: 0, clearingCount: 0, riverCount: 0, erosionOn }, NO_ROADS, NO_LEVELS, [], null, uniformsData);
    queue.writeBuffer(uniformsBuf, 0, uniformsData);
    dispatch(PRE);
    const terrain = (await readBuffer(heightBuf, PRE * PRE * 4)).map(h => h * p.maxH);
    const tr = performance.now(); // Dispatch + Readback: Zeitstempel erst nach mapAsync, sonst nur Submit gemessen

    // Flüsse + Seen auf demselben Gelände wie das Routing → Straßen meiden sie und bleiben über dem Spiegel (→ Plan/Fluesse.md)
    const hydro = p.riverCatchment > 0 ? hydrology({ size: PRE, data: terrain }, p.mapSize, p) : null;
    const net = generateRoads(p.seed, p.mapSize, { size: PRE, data: terrain }, hydro ? { ...p, wet: hydro.wet, waterAt: hydro.waterAt } : p);
    const tg = performance.now();
    encodeUniforms({ ...p, res, roadCount: net.count, clearingCount: net.towns.length, riverCount: hydro?.riverCount ?? 0, erosionOn },
        net.points, net.levels, net.towns, hydro?.rivers ?? null, uniformsData);
    queue.writeBuffer(uniformsBuf, 0, uniformsData);
    queue.writeBuffer(lakesBuf, 0, hydro?.lakes ?? NO_LAKES.subarray(0, PRE * PRE)); // aus → Nullen, sonst stünden die Seen des letzten Laufs
    dispatch(res);
    // Kopien laufen in Submit-Reihenfolge nach dem Dispatch
    const [h, m, w] = await Promise.all([heightBuf, roadMaskBuf, waterBuf].map(b => readBuffer(b, res * res * 4)));
    return { terrain, net, hydro, heights: h, roadMask: m, water: w, gpuMs: tr - t0 + performance.now() - tg, roadMs: tg - tr };
}

async function generate() {
    const t0 = performance.now();
    params.maxH = autoMaxH(params);
    const g = grids(params.mapSize), size = params.mapSize;
    // Kopie: Regler/Preset während der awaits → sonst Straßen des neuen Stands auf dem Terrain des alten
    const map = await computeMap({ ...params }, g.res);
    if (params.mapSize !== size) return; // Mesh passte nicht mehr zur Map-Größe; die dabei geplante Regeneration zeigt die neue
    ({ terrain: terrain128, heights, roadMask, water } = map);
    hiSrc = null;
    if (g.res !== RES) {
        resizeView(g);
        refreshSizes();
    }
    const { points: roads, levels, count, nodes, towns } = map.net;
    if (map.hydro) console.log(`Hydrology: ${map.hydro.riverCount} rivers · ${map.hydro.lakes.filter(l => l > 0).length} lake cells (${g.pre}²)`);
    if (import.meta.env.DEV) Object.assign(window.dbg, { hydro: map.hydro, net: map.net });

    // Prepass-Konsole-Check (→ Plan/Roads.md S1): Min/Max ≈ Final-Pass
    let pMn = Infinity, pMx = -Infinity;
    for (const h of terrain128) {
        if (h < pMn) pMn = h;
        if (h > pMx) pMx = h;
    }
    console.log(`Prepass ${g.pre}²: min ${pMn.toFixed(1)} m · max ${pMx.toFixed(1)} m`);
    console.log(`Road network: ${towns.length} towns · ${nodes.filter(n => n.exit).length} exits · ${count} roads · ${map.roadMs.toFixed(0)} ms`);

    logStats(roads, levels, count);
    ({ slope, relief } = slopeRelief(heights, RES, params.maxH, params.mapSize));
    refreshView();
    if (terrain) {
        scene.remove(terrain);
        terrain.geometry.dispose();
    }
    terrain = buildTerrainMesh();
    scene.add(terrain);
    if (params.mapSize !== viewSize) fitView(params.mapSize);
    if (waterMesh) {
        scene.remove(waterMesh);
        waterMesh.geometry.dispose();
    }
    waterMesh = buildWaterMesh();
    if (waterMesh) scene.add(waterMesh);
    const totalMs = performance.now() - t0;
    console.log(`Regeneration: ${totalMs.toFixed(0)} ms`);
    panel.status(`GPU ${map.gpuMs.toFixed(0)} ms · Roads ${map.roadMs.toFixed(0)} ms · Total ${totalMs.toFixed(0)} ms`);
}

function dispatch(res, pl = pipeline, bg = bind) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pl);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(res / 16, res / 16); // Workgroup 16×16 (→ .clinerules/projekt.md)
    pass.end();
    queue.submit([encoder.finish()]);
}

function logStats(roads, levels, count) {
    // Konsole-Check (→ Plan/Build.md M2 + M3)
    let mn = Infinity, mx = -Infinity, sum = 0, wet = 0;
    let roadPx = 0, rMn = Infinity, rMx = -Infinity;
    for (let i = 0; i < heights.length; i++) {
        const h = heights[i] * params.maxH;
        if (h < mn) mn = h;
        if (h > mx) mx = h;
        sum += h;
        if (h < spiegel(water[i], params.waterLevel)) wet++;
        const m = roadMask[i];
        if (m > 0.5) roadPx++;
        if (m >= 0.999) {
            if (h < rMn) rMn = h;
            if (h > rMx) rMx = h;
        }
    }
    console.log(
        `Heightmap ${RES}²: min ${mn.toFixed(1)} m · max ${mx.toFixed(1)} m · avg ${(sum / heights.length).toFixed(1)} m · water ${(100 * wet / heights.length).toFixed(1)} %`
    );
    console.log(roadPx
        ? `Roads: ${(100 * roadPx / heights.length).toFixed(1)} % · road level ${rMn.toFixed(1)}–${rMx.toFixed(1)} m`
        : 'Roads: none');

    // Readback-Level vs. CPU-Level an den Polyline-Punkten (→ Plan/Roads.md S3); Fahrbahn darf im
    // Toleranzband liegen (→ Plan/StrassenLandschaft.md); Ausreißer nur an Kreuzungen erwartet
    const nPts = count * ROAD_POINTS, band = params.roadTolerance + 0.5;
    let dMax = 0, nOut = 0;
    for (let k = 0; k < nPts; k++) {
        const px = Math.min(Math.floor(roads[2 * k] / params.mapSize * RES), RES - 1);
        const py = Math.min(Math.floor(roads[2 * k + 1] / params.mapSize * RES), RES - 1);
        const d = Math.abs(heights[py * RES + px] * params.maxH - levels[k]);
        if (d > dMax) dMax = d;
        if (d > band) nOut++;
    }
    if (nPts > 0)
        console.log(`Road level GPU vs. CPU: max Δ ${dMax.toFixed(2)} m · ${nOut}/${nPts} points outside ±${band.toFixed(1)} m`);
}

// Preview + 3D-Farbtextur aus dem aktuellen Readback (auch bei reinem Farbwechsel, ohne Regeneration)
function refreshView() {
    updatePreview();
    terrainTex.needsUpdate = true;
}

// --- 2D-Preview (Farbcodierung nach Höhe) ---
const preview = document.getElementById('preview');
const pctx = preview.getContext('2d');
let pimg = pctx.createImageData(RES, RES);

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

// Fels-Anteil nach Hangneigung — geteilt von Farbrampe und Splatmap
const rockWeight = s => Math.min(Math.max((s - ROCK_SLOPE[0]) / (ROCK_SLOPE[1] - ROCK_SLOPE[0]), 0), 1);
// Fahrbahn-Anteil aus roadMask (weiche Kante) — geteilt von Farbrampe und Splatmap. Ganze Maskenkante (1 m = 2 px): nur die
// innere Hälfte war bei 0,5 m/px 1 px breit → Sägezahn am Straßenrand (→ Plan/Pixel05.md)
const roadWeight = m => Math.min(Math.max(m, 0), 1);

// Wasserspiegel eines Pixels: See/Fluss aus dem Readback, sonst das Meer (→ Plan/Fluesse.md)
const spiegel = (w, waterLevel) => w || waterLevel;

// schreibt 0–255-Werte (→ Plan/Build.md Datenfluss); W = Wasserspiegel des Pixels
function terrainColor(out, o, hm, m, s, rel, W) {
    let r, g, b;
    if (hm < W) {
        const t = hm / W;
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
        const k = rockWeight(s);
        r += (ROCK[0] - r) * k;
        g += (ROCK[1] - g) * k;
        b += (ROCK[2] - b) * k;
        const lit = 1 + Math.min(Math.max(rel * RELIEF_TINT, -0.15), 0.15);
        r *= lit;
        g *= lit;
        b *= lit;
    }
    if (m > 0) {
        const f = roadWeight(m);
        r = r * (1 - f) + roadRGB[0] * f;
        g = g * (1 - f) + roadRGB[1] * f;
        b = b * (1 - f) + roadRGB[2] * f;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
}

// Aus dem Readback h (n², 0–1), einmal pro Regeneration (Kanten geclamped):
// slope = Hangneigung |∇h| in m/m (zentrale Differenzen); relief = Höhe − Mittel im Abstand RELIEF_M in m
// (> 0 Kuppe, < 0 Mulde) → Farbe heller/dunkler, macht flache Hügel lesbar
// vereinfacht: eigene Neigung statt masks.js – Zusammenführen mit R11 (→ Plan/Roadmap.md)
const RELIEF_M = 9.375; // m (= 24 px bei 0,39 m/px, jetzt 19 px); fest in m, sonst wüchse die Tönung mit der Map (→ Plan/MapGroesse.md)
let slope = new Float32Array(RES * RES);
let relief = new Float32Array(RES * RES);
function slopeRelief(h, n, maxH, mapSize) {
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

// Farbrampe → RGBA-Pixel (Alpha 255) für n² Werte
function colorize(d, n, h, m, s, rel, maxH, wat, waterLevel) {
    for (let i = 0; i < n * n; i++) {
        terrainColor(d, i * 4, h[i] * maxH, m[i], s[i], rel[i], spiegel(wat[i], waterLevel));
        d[i * 4 + 3] = 255;
    }
}

function updatePreview() {
    colorize(pimg.data, RES, heights, roadMask, slope, relief, params.maxH, water, params.waterLevel);
    pctx.putImageData(pimg, 0, 0);
}

// --- M4: 3D-Terrain (→ Plan/Build.md M4) ---
// TN = Vertex je Kante (RES/2); 1 Unit = 1 m
// Farben = die RES²-Preview als Textur (→ Plan/Roadmap.md R9): Vertex-Farben auf TN² zeichnen Straßenränder als Sägezahn.
// Textur-Texel k liegt bei (k + 0.5) / RES wie in sampleBilinear → uv = (u, v) ohne Versatz
function makeTerrainTex() {
    const t = new THREE.DataTexture(new Uint8Array(pimg.data.buffer), RES, RES);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = renderer.getMaxAnisotropy();
    return t;
}
let terrainTex = makeTerrainTex();
const terrainMat = new THREE.MeshStandardMaterial({ map: terrainTex, roughness: 1, metalness: 0 });
let terrain = null;

// Andere Map-Größe → andere Raster (→ Plan/Aufloesung.md): Vorschau-Canvas und Farbtextur neu anlegen (Texturgröße ist fest)
function resizeView(g) {
    ({ res: RES, tn: TN } = g);
    preview.width = preview.height = RES;
    pimg = pctx.createImageData(RES, RES);
    terrainTex.dispose();
    terrainTex = makeTerrainTex();
    terrainMat.map = terrainTex;
    terrainMat.needsUpdate = true;
}

function buildTerrainMesh() {
    const pos = new Float32Array(TN * TN * 3);
    const uv = new Float32Array(TN * TN * 2);
    const idx = new Uint32Array((TN - 1) * (TN - 1) * 6);
    for (let j = 0; j < TN; j++) {
        for (let i = 0; i < TN; i++) {
            const o = (j * TN + i) * 3;
            const u = i / (TN - 1), v = j / (TN - 1);
            pos[o] = -params.mapSize / 2 + u * params.mapSize;
            pos[o + 1] = sampleBilinear(heights, RES, u, v) * params.maxH;
            pos[o + 2] = -params.mapSize / 2 + v * params.mapSize;
            uv[(j * TN + i) * 2] = u;
            uv[(j * TN + i) * 2 + 1] = v;
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
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, terrainMat);
}

// Wasserspiegel als eigenes Mesh (→ Plan/Fluesse.md): Vertex-Gitter wie das Terrain, y = Spiegel des Pixels; nur Dreiecke
// mit mindestens einer nassen Ecke → trockenes Land wird nicht doppelt gezeichnet, unter dem Gelände verdeckt der Tiefentest.
// vereinfacht: nicht im glTF-Export (nur Terrain)
const waterMat = new THREE.MeshStandardMaterial({ color: 0x3d78b0, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.78, vertexColors: true });
const WATER_SINK = 0.05; // m unter dem Gelände für trockene Randecken
const WATER_FADE = 0.4;  // m Wassertiefe bis volle Deckkraft
let waterMesh = null;
// Bei 1280 m sind das 1,6 Mio. Ecken → direkt in die Puffer schreiben (keine Array-Literale je Ecke/Viereck), Normale
// konstant nach oben statt computeVertexNormals (Wasser ist fast eben): 630 → ~100 ms (→ Plan/Aufloesung.md)
function buildWaterMesh() {
    const ground = terrain.geometry.attributes.position.array, sea = params.waterLevel;
    const pos = new Float32Array(TN * TN * 3), wet = new Uint8Array(TN * TN), idx = new Uint32Array((TN - 1) * (TN - 1) * 6);
    let ni = 0;
    // Spiegel je Ecke = Maximum der 4 umliegenden Texel, nicht bilinear: bilinear mischt am Rand des nassen Streifens den
    // Fluss- mit dem Meeresspiegel → Randecken zu tief, gezackte Fläche
    const at = (x, y) => spiegel(water[Math.min(Math.max(y, 0), RES - 1) * RES + Math.min(Math.max(x, 0), RES - 1)], sea);
    for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
        const k = j * TN + i, fx = i / (TN - 1) * RES - 0.5, fy = j / (TN - 1) * RES - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy);
        const y = Math.max(at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1));
        wet[k] = y > ground[3 * k + 1];
        pos[3 * k] = ground[3 * k];
        // trockene Ecke knapp unter dem Gelände statt auf ihrem (tieferen) Spiegel → die Fläche schneidet das Ufer an der
        // Höhenlinie; sonst fällt sie am Rand des nassen Flussstreifens als Wand auf Meereshöhe ab
        pos[3 * k + 1] = wet[k] ? y : ground[3 * k + 1] - WATER_SINK;
        pos[3 * k + 2] = ground[3 * k + 2];
    }
    for (let j = 0; j < TN - 1; j++) for (let i = 0; i < TN - 1; i++) {
        const a = j * TN + i, b = a + 1, c = a + TN, d = c + 1;
        if (!(wet[a] || wet[b] || wet[c] || wet[d])) continue;
        idx[ni++] = a; idx[ni++] = c; idx[ni++] = b; // Wicklung wie das Terrain
        idx[ni++] = c; idx[ni++] = d; idx[ni++] = b;
    }
    if (!ni) return null;
    // Alpha nach Wassertiefe: das Ufer läuft aus statt als Zickzack der Gitterlinien (zwei fast parallele Flächen)
    const col = new Float32Array(TN * TN * 4).fill(1), nrm = new Float32Array(TN * TN * 3);
    for (let k = 0; k < TN * TN; k++) {
        col[4 * k + 3] = Math.min(Math.max((pos[3 * k + 1] - ground[3 * k + 1]) / WATER_FADE, 0), 1);
        nrm[3 * k + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setIndex(new THREE.BufferAttribute(idx.slice(0, ni), 1));
    return new THREE.Mesh(geo, waterMat);
}

// Höhe des angezeigten Meshes (Dreiecke wie oben) in m; der RES²-Readback weicht an Böschungen ±12 cm davon ab
function meshHeight(x, z) {
    const p = terrain.geometry.attributes.position.array;
    const M = params.mapSize;
    const fi = Math.min(Math.max((x / M + 0.5) * (TN - 1), 0), TN - 1), fj = Math.min(Math.max((z / M + 0.5) * (TN - 1), 0), TN - 1);
    const i = Math.min(Math.floor(fi), TN - 2), j = Math.min(Math.floor(fj), TN - 2), s = fi - i, t = fj - j;
    const y = (i, j) => p[(j * TN + i) * 3 + 1];
    const a = y(i, j), b = y(i + 1, j), c = y(i, j + 1), d = y(i + 1, j + 1);
    return s + t <= 1 ? a + (b - a) * s + (c - a) * t : d + (c - d) * (1 - s) + (b - d) * (1 - t);
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
    panel.busy(true);
    record();
    try {
        await generate();
    } catch (e) {
        console.error('generate:', e);
    } finally {
        genBusy = false;
        panel.busy(false);
        if (genDirty) { genDirty = false; runGenerate(); }
    }
}

// Presets = Startwerte (inkl. Seed) + Overrides (→ Plan/PresetsAusfahrten.md, Plan/UI.md)
const PRESETS = {
    'Rolling hills': { baseLevel: 30, hillAmp: 9, hillWave: 90, hillRoughness: 0.35, mountainAmp: 25, mountainWave: 200, clusterWave: 250,
        mountainCoverage: 25, cliffDrop: 5, cliffWidth: 20, cliffCoverage: 10, rimAmp: 35, rimZone: 60,
        townCount: 6, townSpacing: 70, extraLinks: 3, roadSlopeVar: 15 },
    'Pasture': { baseLevel: 25, hillAmp: 4, hillWave: 100, hillRoughness: 0.3, mountainAmp: 0, mountainCoverage: 0,
        cliffDrop: 0, cliffCoverage: 0, rimAmp: 25, rimZone: 70, rimWave: 120, townCount: 4, townSpacing: 90, extraLinks: 1 },
    'Mountains': { baseLevel: 25, hillAmp: 12, hillWave: 120, hillRoughness: 0.6, mountainAmp: 100, mountainWave: 200, clusterWave: 260,
        mountainCoverage: 45, cliffDrop: 15, cliffCoverage: 15, rimAmp: 70, rimZone: 60,
        townCount: 4, townSpacing: 60, slopePenalty: 7, extraLinks: 1 },
    'Canyon / Plateaus': { baseLevel: 45, hillAmp: 3, hillWave: 120, hillRoughness: 0.35, mountainAmp: 0, mountainCoverage: 0,
        cliffDrop: 45, cliffWave: 120, cliffWidth: 8, cliffAreaWave: 220, cliffCoverage: 70, rimAmp: 30,
        townCount: 5, slopePenalty: 5, roadSlopeVar: 10, roadMaxGrade: 25 }, // 12 % → Rampen ~375 m je Klippe
    'Lakes': { baseLevel: 18.5, hillAmp: 6, hillWave: 110, hillRoughness: 0.35, mountainAmp: 15, mountainCoverage: 10,
        cliffDrop: 4, cliffCoverage: 5, waterLevel: 16, rimAmp: 30, townCount: 5, waterAvoid: 4 },
};
// Schuttwinkel 65°: kappt die 1-Zellen-Grate starker Erosion, Abrisskanten bleiben steil (→ Plan/Erosion.md)
PRESETS['Eroded mountains'] = { ...PRESETS.Mountains, erosionStrength: 70, erosionIterations: 400, screeAngle: 65 };
// Flüsse folgen den Erosionsrinnen (→ Plan/Fluesse.md)
PRESETS['River valley'] = { ...PRESETS['Rolling hills'], erosionStrength: 40, riverCatchment: 1.5, riverWidth: 7 };
function applyPreset(overrides) {
    Object.assign(params, DEFAULTS, overrides);
    setRoadColor();
    panel.refresh();
    scheduleGenerate();
}
// Save/Load als JSON: alle params außer maxH (automatisch) (→ Plan/SaveLoad.md)
const SAVE_KEYS = Object.keys(params).filter(k => k !== 'maxH');
// 2: Integer-Noise-Hash → gleicher Seed ergibt ein anderes Terrain als in Version 1 (Dateien ohne Feld)
// 3: 0,5 m/px statt 0,39 → Routing-Raster und Pixel anders, Straßen weichen ab (→ Plan/Pixel05.md)
const SAVE_VERSION = 3;
// Fremde JSON (von Hand / aus der GUI kopiert): Schlüssel ohne Groß-/Kleinschreibung ("Seed"), Zahlen oft als
// String → Typ vom Default erzwingen, sonst "45" + 10 = "4510" im Routing; Farbe mit '#'
function pickParams(obj) {
    const src = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
    return Object.fromEntries(SAVE_KEYS.filter(k => k.toLowerCase() in src)
        .map(k => [k, src[k.toLowerCase()]])
        .map(([k, v]) => [k, typeof params[k] === 'number' ? Number(v) : String(v).replace(/^#?/, '#')])
        .filter(([, v]) => !Number.isNaN(v)));
}
// jede JSON in app/presets/ = eigener Eintrag (Save-Format, → Plan/SaveLoad.md)
const ALL_PRESETS = { Defaults: {}, ...PRESETS };
const FILE_PRESETS = import.meta.glob('../presets/*.json', { eager: true, import: 'default' });
for (const [path, p] of Object.entries(FILE_PRESETS))
    ALL_PRESETS[path.slice(path.lastIndexOf('/') + 1, -'.json'.length)] = pickParams(p);

// Undo/Redo: Snapshots von pickParams, ein Eintrag je Regeneration (Slider-Drag = einer), Farbe entprellt
const HISTORY_MAX = 100;
const undoStack = [];
let undoPos = -1;
let colorTimer = 0;
function record() {
    // URL = aktueller Stand → Reload/Link verliert nichts; vor dem Vergleich, sonst bliebe sie nach Undo/Redo (Stand schon im Stack) alt
    history.replaceState(null, '', '#' + shareHash());
    const s = JSON.stringify(pickParams(params));
    if (s === undoStack[undoPos]) return;
    undoStack.splice(undoPos + 1, Infinity, s);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    undoPos = undoStack.length - 1;
}

// Share-Link: alle Save-Schlüssel im Hash (nicht nur Abweichungen → Links überleben geänderte Defaults)
function shareHash() {
    return new URLSearchParams({ version: SAVE_VERSION, ...pickParams(params) }).toString();
}
function applyHash() {
    const q = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
    if (!Object.keys(q).length || location.hash.slice(1) === shareHash()) return false;
    if ((+q.version || 1) < SAVE_VERSION) console.warn(`Link: Version ${q.version ?? 1} < ${SAVE_VERSION} — gleicher Seed, anderes Terrain`);
    applyPreset(pickParams(q));
    return true;
}
window.addEventListener('hashchange', applyHash); // Link in denselben Tab eingefügt → kein Reload
async function copyLink() {
    record();
    await navigator.clipboard.writeText(location.href);
}
function undoRedo(step) {
    record(); // noch nicht erfasste Änderung (entprellte Farbe) zuerst sichern, sonst springt Undo über sie
    const p = undoPos + step;
    if (p < 0 || p >= undoStack.length) return;
    undoPos = p;
    applyPreset(JSON.parse(undoStack[p])); // → runGenerate → record() findet denselben Stand, kein neuer Eintrag
}
window.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.target.tagName === 'INPUT') return; // in Eingabefeldern bleibt das Text-Undo des Browsers
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) undoRedo(-1);
    else if (k === 'y' || (k === 'z' && e.shiftKey)) undoRedo(1);
    else return;
    e.preventDefault();
});

// Seed-Vergleich (→ Plan/Roadmap.md R13): dieselbe Pipeline wie die große Map (Prepass 128² → Netz → Final-Pass),
// Final-Pass nur THUMB² — bei 128² (3 m/px) zerfallen 4-m-Straßen in Punkte
const THUMB = 256;
const COMPARE_COUNT = 12;
async function drawThumb(seed, canvas) {
    const p = { ...params, seed, maxH: autoMaxH(params) };
    const m = await computeMap(p, THUMB);
    const { slope: s, relief: rel } = slopeRelief(m.heights, THUMB, p.maxH, p.mapSize);
    const ctx = canvas.getContext('2d'), img = ctx.createImageData(THUMB, THUMB);
    colorize(img.data, THUMB, m.heights, m.roadMask, s, rel, p.maxH, m.water, p.waterLevel);
    ctx.putImageData(img, 0, 0);
}

// Export (→ Plan/ExportZiele.md): Ziel-Engine bestimmt Größen, Normal-Konvention und Zeilenrichtung. Quelle = N² Readback;
// Größe n == N → Pixelzentren 1:1, sonst Vertex-Gitter auf den Map-Ecken (resample). Nicht in Save/Link
const exp = { target: 'unreal', size: 0, detail: 1 };
// Detail ×2: Final-Pass in 2·RES neu (dieselbe Pipeline, schärfere Straßen-/Uferkanten), gecacht bis zur nächsten Regeneration
let hiSrc = null;
async function exportSource() {
    if (exp.detail === 1) return { N: RES, heights, roadMask, water, slope };
    const N = 2 * RES, p = { ...params };
    hiSrc ??= computeMap(p, N).then(m => ({ N, heights: m.heights, roadMask: m.roadMask, water: m.water,
        slope: slopeRelief(m.heights, N, p.maxH, p.mapSize).slope }), e => { hiSrc = null; throw e; });
    return hiSrc;
}
const cellSize = (n, N) => params.mapSize / (n === N ? n : n - 1); // m zwischen zwei Samples
function exportN(N) {
    const list = exportSizes(exp.target, N);
    return list.includes(exp.size) ? exp.size : list[0];
}
// Feld der Quelle auf das Export-Gitter, Zeilen je Ziel
function onGrid(buf, res, n, centres = n === res) {
    const r = resample(buf, res, n, centres);
    return TARGETS[exp.target].flip ? flipRows(r, n) : r;
}
function refreshSizes() {
    const N = RES * exp.detail;
    panel.sizes(exportSizes(exp.target, N).map(n => [n, `${n} px · ${+cellSize(n, N).toFixed(3)} m`]), exportN(N));
}

const panel = buildPanel(params, {
    change: scheduleGenerate,
    color: () => {
        setRoadColor();
        refreshView();
        clearTimeout(colorTimer);
        colorTimer = setTimeout(record, 400);
    },
    presets: Object.keys(ALL_PRESETS),
    preset: name => applyPreset(ALL_PRESETS[name]),
    save: saveSettings,
    load: () => loadInput.click(),
    link: copyLink,
    walk: () => walk.start(),
    compare: () => seedGrid(THUMB, COMPARE_COUNT, params.seed, drawThumb, s => {
        params.seed = s;
        panel.refresh();
        scheduleGenerate();
    }),
    exportTargets: Object.fromEntries(Object.entries(TARGETS).map(([k, t]) => [k, t.label])),
    exportTarget: t => { exp.target = t; refreshSizes(); },
    exportDetail: d => { exp.detail = d; refreshSizes(); },
    exportSize: n => { exp.size = n; },
    exports: {
        'Heightmap PNG (16-bit)': exportPng16,
        'Heightmap RAW (.r16)': exportR16,
        'Splatmap PNG (RGBA)': exportSplatmap,
        'Slope mask PNG': () => exportMask('slope'),
        'Normal map PNG': () => exportMask('normal'),
        'Curvature mask PNG': () => exportMask('curvature'),
        'Flow map PNG': exportFlow,
        'Metadata JSON': exportMeta,
        '3D mesh glTF (.glb)': exportGlb,
        'Heightmap PNG (8-bit preview)': exportPng,
    },
    regenerate: runGenerate,
});
panel.guis.World.add(params, 'maxH').name('Max height (auto, m)').decimals(1).disable().listen();
refreshSizes();

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
}

// id: Dialog merkt sich den zuletzt gewählten Ordner (Projektordner vorwählen kann ein Browser nicht)
async function saveSettings() {
    const json = JSON.stringify({ version: SAVE_VERSION, ...pickParams(params) }, null, 2);
    const name = `heightmap-${params.seed}.json`;
    if (!window.showSaveFilePicker) return download(new Blob([json], { type: 'application/json' }), name);
    try {
        const file = await window.showSaveFilePicker({
            id: 'presets', suggestedName: name,
            types: [{ description: 'Terrain settings', accept: { 'application/json': ['.json'] } }],
        });
        const w = await file.createWritable();
        await w.write(json);
        await w.close();
    } catch (e) {
        if (e.name !== 'AbortError') console.error('Save:', e);
    }
}

const loadInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
loadInput.addEventListener('change', async () => {
    const f = loadInput.files[0];
    loadInput.value = ''; // sonst löst dieselbe Datei beim nächsten Mal kein change aus
    if (!f) return;
    try {
        const obj = JSON.parse(await f.text());
        const v = obj.version ?? 1;
        if (v < SAVE_VERSION) console.warn(`Load ${f.name}: Version ${v} < ${SAVE_VERSION} — gleicher Seed, anderes Terrain`);
        applyPreset(pickParams(obj));
    } catch (e) {
        console.error(`Load ${f.name}:`, e.message);
    }
});

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
    c.toBlob(blob => download(blob, `heightmap-${params.seed}-8bit.png`), 'image/png');
}

async function exportPng16() {
    const src = await exportSource(), n = exportN(src.N);
    download(await encodePng(n, n, quantize16(onGrid(src.heights, src.N, n)), 1, 16), `heightmap-${params.seed}-${n}-16bit.png`);
}

async function exportR16() {
    const src = await exportSource(), n = exportN(src.N);
    download(new Blob([encodeR16(quantize16(onGrid(src.heights, src.N, n)))], { type: 'application/octet-stream' }), `heightmap-${params.seed}-${n}.r16`);
}

// Splatmap RGBA: R Straße · G Fels · B Wasser + Ufer (bis zur Sand-Grenze der Farbrampe) · A Rest (Gras);
// Vorrang Straße > Wasser > Fels, Summe je Pixel = 255 (→ Plan/Export.md). Eingaben resamplen, nicht RGBA → Summe bleibt 255.
// Wasser = Meer, Seen, Flüsse: Spiegel je Pixel resamplen, nicht die 0-codierten Rohwerte (0 = Meer) (→ Plan/Fluesse.md)
async function exportSplatmap() {
    const src = await exportSource(), n = exportN(src.N), N = src.N;
    const hs = onGrid(src.heights, N, n), ms = onGrid(src.roadMask, N, n), ss = onGrid(src.slope, N, n);
    const ws = src.water.some(w => w > 0) ? onGrid(Float32Array.from(src.water, w => spiegel(w, params.waterLevel)), N, n) : null;
    const px = new Uint8Array(n * n * 4), shore = STOPS[1][0];
    for (let i = 0; i < n * n; i++) {
        const h = hs[i] * params.maxH;
        const road = roadWeight(ms[i]);
        const wet = Math.min(Math.max(1 - (h - (ws ? ws[i] : params.waterLevel)) / shore, 0), 1);
        const water = (1 - road) * wet;
        const rock = (1 - road) * (1 - wet) * rockWeight(ss[i]); // (1 − wet), nicht (1 − water): sonst Summe > 1
        const R = Math.floor(road * 255), G = Math.floor(rock * 255), B = Math.floor(water * 255);
        px[i * 4] = R;
        px[i * 4 + 1] = G;
        px[i * 4 + 2] = B;
        px[i * 4 + 3] = 255 - R - G - B; // floor → Summe ≤ 255, A ≥ 0
    }
    download(await encodePng(n, n, px, 4, 8), `splatmap-${params.seed}-${n}.png`);
}

// Masken (Neigung, Normale, Krümmung) auf dem Export-Gitter, aus den schon gespiegelten Höhen → in sich stimmig;
// Konvention in exportMeta (→ .clinerules/export.md)
function curvatureExport(src, n) {
    const c = curvature(onGrid(src.heights, src.N, n), n, cellSize(n, src.N), params.maxH);
    return { c, scale: curvatureScale(c) };
}
async function exportMask(kind) {
    const src = await exportSource(), n = exportN(src.N);
    let px;
    if (kind === 'curvature') {
        const { c, scale } = curvatureExport(src, n);
        px = curvatureBytes(c, scale);
    } else {
        const g = gradient(onGrid(src.heights, src.N, n), n, cellSize(n, src.N), params.maxH);
        px = kind === 'slope' ? slopeBytes(slopeDeg(g)) : normalBytes(normals(g), TARGETS[exp.target].normal === 'opengl');
    }
    download(await encodePng(n, n, px, kind === 'normal' ? 4 : 1, 8), `${kind}-${params.seed}-${n}.png`);
}

// Flow-Map der aktuellen Einstellungen auf dem Export-Gitter: Simulation neu (deterministisch → dieselbe wie bei der
// Regeneration); Erosion aus → nur Wasser, Terrain unberührt (→ Plan/Erosion.md).
// vereinfacht: Simulation läuft vor den Straßen – sie lenken das Wasser in der Flow-Map nicht um
async function flowExport(src, n) {
    const ero = grids(params.mapSize).ero;
    const f = await serial(() => {
        runErosion({ ...params }, params.erosionStrength > 0);
        return readBuffer(erosion.flow, ero * ero * 4);
    });
    const r = onGrid(f, ero, n, n === src.N); // native = Pixelzentren wie die Heightmap, sonst Vertex-Gitter
    return { f: r, scale: flowScale(r) };
}
async function exportFlow() {
    const src = await exportSource(), n = exportN(src.N), { f, scale } = await flowExport(src, n);
    download(await encodePng(n, n, flowBytes(f, scale), 1, 8), `flow-${params.seed}-${n}.png`);
}

// Das angezeigte Mesh (TN², 1 Unit = 1 m, Mitte im Ursprung) + Farbtextur eingebettet (→ .clinerules/export.md).
// vereinfacht: immer TN² statt Export-Größe – 2049² wären ~250 MB Puffer im Browser
async function exportGlb() {
    const glb = await new GLTFExporter().parseAsync(terrain, { binary: true });
    download(new Blob([glb], { type: 'model/gltf-binary' }), `terrain-${params.seed}.glb`);
}

// Maßstab + Konvention für die Engine, dazu alle Einstellungen (Save-Format) → reproduzierbar
async function exportMeta() {
    const src = await exportSource(), n = exportN(src.N), grid = n === src.N, t = TARGETS[exp.target], cell = cellSize(n, src.N);
    const meta = {
        version: SAVE_VERSION,
        target: t.label,
        detail: exp.detail, // 2 = Map für den Export in doppelter Auflösung gerechnet
        import: engineImport(exp.target, { mapSize: params.mapSize, n, cell, maxH: params.maxH }), // Werte für den Import-Dialog
        mapSize: params.mapSize,
        resolution: n,
        cellSize: cell,
        maxH: params.maxH,
        waterLevel: params.waterLevel,
        height: `height_m = value / 65535 * maxH (16-bit PNG; .r16 = raw uint16 little endian, no header); value / 255 * maxH (8-bit preview, always ${RES}, rows top-down)`,
        pixels: (grid
            ? 'pixel (i, j) = map ((i + 0.5) / resolution * mapSize, (j + 0.5) / resolution * mapSize) (cell centres)'
            : 'pixel (i, j) = map (i / (resolution - 1) * mapSize, j / (resolution - 1) * mapSize) (vertices, first/last on the map edges)')
            + (t.flip ? '; rows bottom-up: file row 0 = map y = mapSize (three.js +z edge) = Unity z 0, so the terrain is not mirrored'
                : '; row j = map y (three.js +z)'),
        curvatureScale: curvatureExport(src, n).scale, // m, je Map (→ masks.curvature)
        flowScale: (await flowExport(src, n)).scale, // je Map (→ masks.flow)
        masks: {
            slope: 'slope_deg = value / 255 * 90 (8-bit gray, 0 = flat)',
            normal: t.normal === 'opengl'
                ? 'tangent space, OpenGL ("green up"): n = rgb / 255 * 2 - 1, R = +column, G = -row (up in the image), B = up'
                : 'tangent space, DirectX / Unreal ("green down"): n = rgb / 255 * 2 - 1, R = +column, G = +row, B = up; flip G for OpenGL / Blender',
            curvature: `height - mean height within ±${CURV_R} m; value = 128 + dev / curvatureScale * 127.5, clamped; curvatureScale = 99th percentile of |dev| of this map (bright = ridge, dark = hollow)`,
            flow: 'where rain water ran in the erosion simulation (sum of depth * speed, before roads); value = 255 * log(1 + flow) / log(1 + flowScale), clamped; flowScale = 99th percentile of this map; bright = gullies and valley floors',
            import: 'masks are linear data: import without sRGB (Unreal: Masks / Linear Color; normal map: Normalmap compression)',
        },
        settings: pickParams(params),
    };
    download(new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }), `heightmap-${params.seed}-${n}-meta.json`);
}

if (!applyHash()) runGenerate();

const walk = createWalk(camera, renderer.domElement, controls, meshHeight, () => params.mapSize / 2);
if (import.meta.env.DEV) Object.assign(window.dbg, { walk, erosion, readBuffer });

let lastT = 0;
renderer.setAnimationLoop(t => {
    const dt = Math.min((t - lastT) / 1000, 0.1); // Tab im Hintergrund → kein Sprung
    lastT = t;
    if (walk.active) walk.update(dt);
    else controls.update(); // update() prüft enabled nicht und würde lookAt(target) erzwingen
    renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
