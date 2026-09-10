import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WGSL from './heightmap.wgsl?raw';
import { generateRoads } from './roadgen.js';

// M1: Renderer + Szene (→ Plan/Build.md M1)
const renderer = new WebGPURenderer({ antialias: true });
try {
    await renderer.init();
} catch (e) {
    document.body.innerHTML = `<pre style="color:#f88;padding:20px">WebGPU nicht verfügbar:\n${e.message}</pre>`;
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

scene.add(new THREE.HemisphereLight(0xbdd7ff, 0x3a4a33, 1.1));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(180, 260, 120);
scene.add(sun);

// --- M2: Compute-Pipeline + 2D-Preview (→ Plan/Build.md M2) ---
const RES = 1024;
const MAP = 400;

const params = {
    seed: 1337,
    baseLevel: 30,
    hillAmp: 8,
    hillWave: 120,
    mountainAmp: 60,
    mountainWave: 180,
    clusterWave: 220,
    cliffDrop: 20,
    cliffWave: 90,
    cliffWidth: 15,
    cliffAreaWave: 160,
    rimAmp: 40,
    rimZone: 45,
    rimWave: 90,
    maxH: 120,
    waterLevel: 15,
    roadCount: 4,
    roadWidth: 10,
    roadSlope: 5,
    roadLevel: 26,
};

const uniformsData = new Float32Array(540);
function encodeUniforms(roads) {
    const u = uniformsData;
    // Muss 1:1 mit struct Params in heightmap.wgsl übereinstimmen (21 Felder).
    // roads liegt bei Byte 96: vec4-Array wird auf 16 Byte aligniert (→ Plan/Build.md M3)
    u[0] = params.seed;
    u[1] = MAP;
    u[2] = RES;
    u[3] = params.maxH;
    u[4] = params.baseLevel;
    u[5] = params.hillAmp;
    u[6] = 1 / params.hillWave;
    u[7] = params.mountainAmp;
    u[8] = 1 / params.mountainWave;
    u[9] = 1 / params.clusterWave;
    u[10] = params.cliffDrop;
    u[11] = 1 / params.cliffWave;
    u[12] = params.cliffWidth;
    u[13] = 1 / params.cliffAreaWave;
    u[14] = params.rimAmp;
    u[15] = params.rimZone;
    u[16] = 1 / params.rimWave;
    u[17] = params.roadCount;
    u[18] = params.roadWidth / 2;
    u[19] = params.roadSlope;
    u[20] = params.roadLevel;
    // u[21..23]: frei (Buffer bleibt 540 floats)
    // roads: 1 Punkt = vec4(x, z, 0, 0) — vec2-Arrays sind im uniform-Adressraum ungültig
    for (let k = 0; k < 256; k++) {
        u[24 + 4 * k] = roads[2 * k];
        u[25 + 4 * k] = roads[2 * k + 1];
    }
}

const device = renderer.backend.device;
const queue = device.queue;
if (!device) throw new Error('Kein WebGPU-Device (WebGL-Fallback aktiv?)');

const heightBuf = device.createBuffer({
    size: RES * RES * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
});
const uniformsBuf = device.createBuffer({ size: 540 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const roadMaskBuf = device.createBuffer({ size: RES * RES * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
        module: device.createShaderModule({ code: WGSL }),
        entryPoint: 'main',
    },
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

async function generate() {
    const roads = generateRoads(params.seed, MAP, params.roadCount);
    encodeUniforms(roads);
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
        `Heightmap 1024²: min ${mn.toFixed(1)} m · max ${mx.toFixed(1)} m · Ø ${(sum / heights.length).toFixed(1)} m · Wasser ${(100 * water / heights.length).toFixed(1)} %`
    );
    console.log(
        `Straßen: ${(100 * roadPx / heights.length).toFixed(1)} % · Road-Level ${rMn.toFixed(1)}–${rMx.toFixed(1)} m (Ziel ${params.roadLevel} m ± 0,5)`
    );

    updatePreview();
}

// --- 2D-Preview (Farbcodierung nach Höhe) ---
const preview = document.getElementById('preview');
const pctx = preview.getContext('2d');
const pimg = pctx.createImageData(RES, RES);

const STOPS = [
    [0.0, [196, 178, 128]],   // Sand
    [0.25, [98, 142, 74]],    // Gras
    [0.5, [64, 108, 56]],     // dunkles Grün
    [0.7, [118, 110, 98]],    // Fels
    [0.85, [160, 156, 148]],  // Schutt
    [1.0, [242, 246, 250]],   // Schnee
];

function heightColor(hm, out, o) {
    if (hm < params.waterLevel) {
        const t = hm / params.waterLevel;
        out[o] = 42 + 20 * t;
        out[o + 1] = 90 + 28 * t;
        out[o + 2] = 158 + 22 * t;
        return;
    }
    const n = Math.min(hm / params.maxH, 1);
    let a = STOPS[0], b = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i++) {
        if (n >= STOPS[i][0] && n <= STOPS[i + 1][0]) { a = STOPS[i]; b = STOPS[i + 1]; break; }
    }
    const f = (n - a[0]) / (b[0] - a[0]);
    out[o] = a[1][0] + (b[1][0] - a[1][0]) * f;
    out[o + 1] = a[1][1] + (b[1][1] - a[1][1]) * f;
    out[o + 2] = a[1][2] + (b[1][2] - a[1][2]) * f;
}

function updatePreview() {
    const d = pimg.data;
    for (let i = 0; i < RES * RES; i++) {
        heightColor(heights[i] * params.maxH, d, i * 4);
        const m = roadMask[i];
        if (m > 0.5) {
            const f = (m - 0.5) * 2; // weiche Kante in der Böschungszone
            d[i * 4] = d[i * 4] * (1 - f) + 66 * f;
            d[i * 4 + 1] = d[i * 4 + 1] * (1 - f) + 66 * f;
            d[i * 4 + 2] = d[i * 4 + 2] * (1 - f) + 72 * f;
        }
        d[i * 4 + 3] = 255;
    }
    pctx.putImageData(pimg, 0, 0);
}

generate();

renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
