// GPU-Erosion (→ Plan/Erosion.md): Puffer + Pipelines für erosion.wgsl, ein Submit je Lauf
import WGSL from './erosion.wgsl?raw';
import { EROSION_FLOATS, encodeErosion, grids } from './uniforms.js';

const STEPS = ['fluxStep', 'water', 'erode', 'carry', 'thermal']; // Reihenfolge je Iteration (→ erosion.wgsl)

export function createErosion(device) {
    // Puffer einmal für die größte Map (→ Plan/Aufloesung.md), je Lauf nur n² genutzt
    const cells = grids(Infinity).ero ** 2;
    const storage = bytes => device.createBuffer({ size: cells * bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    // Reihenfolge = Bindings 1–7 in erosion.wgsl
    const bufs = { b: storage(4), bTmp: storage(4), state: storage(16), sedTmp: storage(4), flux: storage(16), flow: storage(4), delta: storage(4) };
    const ubuf = device.createBuffer({ size: EROSION_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const data = new Float32Array(EROSION_FLOATS);

    // explizites Layout: alle Kernel teilen eine Bind-Group ('auto' gäbe je Entry ein eigenes)
    const layout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ...Object.keys(bufs).map((_, k) => ({ binding: k + 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }))],
    });
    const module = device.createShaderModule({ code: WGSL });
    module.getCompilationInfo().then(info => {
        for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`erosion.wgsl ${m.lineNum}:${m.linePos} ${m.message}`);
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipes = Object.fromEntries([...STEPS, 'finish'].map(n =>
        [n, device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint: n } })]));
    const bind = device.createBindGroup({
        layout,
        entries: [ubuf, ...Object.values(bufs)].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });

    // raw: GPU-Puffer mit n² Roh-Höhen in m ab Byte 0 (n = grids(p.mapSize).ero); p = params.
    // Ergebnis in delta (erodiert − roh, m) und flow; erode = false → nur Wasser für die Flow-Map
    function run(raw, p, erode) {
        const n = grids(p.mapSize).ero, groups = n / 16;
        encodeErosion(p, erode, data);
        device.queue.writeBuffer(ubuf, 0, data);
        const enc = device.createCommandEncoder();
        enc.copyBufferToBuffer(raw, 0, bufs.b, 0, n * n * 4);
        enc.copyBufferToBuffer(raw, 0, bufs.delta, 0, n * n * 4);
        for (const k of ['bTmp', 'state', 'sedTmp', 'flux', 'flow']) enc.clearBuffer(bufs[k], 0, n * n * (k === 'state' || k === 'flux' ? 16 : 4));
        const pass = enc.beginComputePass();
        pass.setBindGroup(0, bind);
        const step = n => {
            pass.setPipeline(pipes[n]);
            pass.dispatchWorkgroups(groups, groups);
        };
        for (let k = 0; k < p.erosionIterations; k++) STEPS.forEach(step);
        step('finish');
        pass.end();
        device.queue.submit([enc.finish()]);
    }

    return { run, delta: bufs.delta, flow: bufs.flow };
}
