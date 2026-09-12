// Node-Sanity für roadgen (→ Plan/TerrainStrassennetz.md N1/N2): Netz-Planung, Straßen Knoten→Knoten,
// in Map-Grenzen, deterministisch, Hügel-Umgehung, kein Parallelband, Level = Feld an der Position, Laufzeit
import { generateRoads, planNetwork, sampleTerrain, MAX_ROADS, ROAD_POINTS } from '../src/roadgen.js';

const seed = 1337;
const mapSize = 400;
const N = 128;
const opts = {
    waterLevel: 15, roadOffset: 2, roadTolerance: 0.7, levelSmoothing: 12, slopePenalty: 5, waterAvoid: 2, roadMaxGrade: 12,
    rimZone: 45, townCount: 6, townSpacing: 70, exitCount: 3, extraLinks: 2, reuse: 0.4,
};

let fail = 0;
function check(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); fail++; }
}

function same(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function flatTerrain() {
    return { size: N, data: new Float32Array(N * N).fill(30) };
}

// 60-m-Hügel bei (200,150), σ 25 m — Umgehung immer günstiger als Überquerung (5·2·60 m Strafe)
function bumpTerrain() {
    const data = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = (i + 0.5) * mapSize / N, y = (j + 0.5) * mapSize / N;
        const d = Math.hypot(x - 200, y - 150);
        data[j * N + i] = 30 + 60 * Math.exp(-((d / 25) ** 2));
    }
    return { size: N, data };
}

const road = (res, r) => res.points.subarray(r * ROAD_POINTS * 2, (r + 1) * ROAD_POINTS * 2);
function distToRoad(pts, x, y) {
    let d = Infinity;
    for (let i = 0; i + 2 < pts.length; i += 2) {
        const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
        const abx = bx - ax, aby = by - ay;
        const t = Math.min(Math.max(((x - ax) * abx + (y - ay) * aby) / Math.max(abx * abx + aby * aby, 1e-9), 0), 1);
        d = Math.min(d, Math.hypot(x - ax - abx * t, y - ay - aby * t));
    }
    return d;
}

const a = generateRoads(seed, mapSize, flatTerrain(), opts);
const a2 = generateRoads(seed, mapSize, flatTerrain(), opts);
check(same(a.points, a2.points), 'deterministisch: gleicher Seed → gleiche Straßen');
check(same(a.levels, a2.levels), 'deterministisch: gleicher Seed → gleiche Levels');
check(!same(a.points, generateRoads(seed + 1, mapSize, flatTerrain(), opts).points), 'anderer Seed → andere Straßen');
check(a.points.length === MAX_ROADS * ROAD_POINTS * 2, `feste Größe ${MAX_ROADS * ROAD_POINTS * 2} Floats`);
check(a.levels.length === MAX_ROADS * ROAD_POINTS, `Levels-Größe ${MAX_ROADS * ROAD_POINTS}`);
check(a.count >= 5 && a.count <= MAX_ROADS, `Straßenanzahl ${a.count} (5…${MAX_ROADS})`);
for (let r = 0; r < a.count; r++) {
    const pts = road(a, r), [A, B] = a.edges[r].map(i => a.nodes[i]);
    let inBounds = true;
    for (let i = 0; i < pts.length; i += 2)
        if (pts[i] < 0 || pts[i] > mapSize || pts[i + 1] < 0 || pts[i + 1] > mapSize) inBounds = false;
    check(inBounds, `Straße ${r}: alle ${ROAD_POINTS} Punkte in Map-Grenzen`);
    check(Math.hypot(pts[0] - A.x, pts[1] - A.y) < 0.5 && Math.hypot(pts[pts.length - 2] - B.x, pts[pts.length - 1] - B.y) < 0.5,
        `Straße ${r}: verbindet ihre Knoten`);
    for (let i = 0; i < ROAD_POINTS; i++)
        check(Math.abs(a.levels[r * ROAD_POINTS + i] - 32) < 0.01, `Straße ${r}: Level = 30 m + 2 m Offset`);
}

// Umgehung: keine Straße über den Hügelgrat — Max-Höhe entlang Pfad < 60 m (Grund 30 m + halbe Amplitude)
const bumpRes = generateRoads(seed, mapSize, bumpTerrain(), opts);
{
    const bump = bumpTerrain();
    for (let r = 0; r < bumpRes.count; r++) {
        const pts = road(bumpRes, r);
        let mx = 0;
        for (let i = 0; i < pts.length; i += 2) mx = Math.max(mx, sampleTerrain(bump, mapSize, pts[i], pts[i + 1]));
        check(mx < 60, `Straße ${r}: Max-Höhe entlang Pfad ${mx.toFixed(1)} m < 60 m (Hügelgrat 90 m)`);
    }
}

// Lichtungen (R12): je Ort ein Eintrag, Level = Mittel der Straßen-Enden am Ort (keine Stufe an der Einfahrt);
// Ort ohne Straße → Level-Feld + Offset
{
    const towns = bumpRes.nodes.filter(n => !n.exit);
    check(bumpRes.towns.length === towns.length && bumpRes.towns.every((t, k) => t.x === towns[k].x && t.y === towns[k].y),
        `towns = ${towns.length} Orte (ohne Ausfahrten)`);
    let worst = 0;
    bumpRes.towns.forEach((t, k) => {
        const ends = [];
        bumpRes.edges.forEach(([ia, ib], r) => {
            if (ia === k) ends.push(bumpRes.levels[r * ROAD_POINTS]);
            if (ib === k) ends.push(bumpRes.levels[r * ROAD_POINTS + ROAD_POINTS - 1]);
        });
        for (const e of ends) worst = Math.max(worst, Math.abs(e - t.level));
    });
    check(worst < opts.roadTolerance, `Orts-Level vs. Straßen-Enden max Δ ${worst.toFixed(2)} m < roadTolerance`);
    const lone = generateRoads(seed, mapSize, flatTerrain(), { ...opts, townCount: 1, exitCount: 0 });
    check(lone.count === 0 && lone.towns.length === 1 && Math.abs(lone.towns[0].level - 32) < 0.01, 'einzelner Ort ohne Straße: Level 30 m + 2 m Offset');
}

// Kein Parallelband: Punkte 3–15 m neben einer fremden Straße, deren Abstand dabei gleich bleibt
// (< 2 m Änderung zum Nachbarpunkt; Y-Einmündungen verjüngen sich stetig → zählen nicht), nicht am Knoten; < 5 %
for (const [name, res] of [['flach', a], ['Hügel', bumpRes]]) {
    let total = 0, par = 0;
    for (let r = 0; r < res.count; r++) {
        const pts = road(res, r);
        const dOther = (x, y) => { let d = Infinity; for (let o = 0; o < res.count; o++) if (o !== r) d = Math.min(d, distToRoad(road(res, o), x, y)); return d; };
        let prev = dOther(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) {
            const x = pts[i], y = pts[i + 1], d = dOther(x, y);
            const alongside = d >= 3 && d < 15 && Math.abs(d - prev) < 2;
            prev = d;
            if (res.nodes.some(n => Math.hypot(n.x - x, n.y - y) < 25)) continue;
            total++;
            if (alongside) par++;
        }
    }
    check(par <= 0.05 * total, `${name}: ${par}/${total} Punkte im Parallelband (≤ 5 %)`);
}

// Echte Schleifen (→ Plan/Schleifen.md): Zusatzstraßen entstehen und laufen abseits der Orte (> 25 m)
// höchstens zu 30 % auf fremder Trasse (< 5 m) — sonst sind sie unsichtbar
for (const [name, res] of [['flach', a], ['Hügel', bumpRes]]) {
    check(res.extra > 0, `${name}: ${res.extra} Zusatzstraßen`);
    for (let r = res.mst; r < res.mst + res.extra; r++) {
        const pts = road(res, r);
        let n = 0, on = 0;
        for (let i = 0; i < pts.length; i += 2) {
            const x = pts[i], y = pts[i + 1];
            if (res.nodes.some(v => Math.hypot(v.x - x, v.y - y) < 25)) continue;
            n++;
            let dmin = Infinity;
            for (let o = 0; o < res.count; o++) if (o !== r) dmin = Math.min(dmin, distToRoad(road(res, o), x, y));
            if (dmin < 5) on++;
        }
        check(on <= 0.3 * n, `${name}: Zusatzstraße ${r}: ${on}/${n} Punkte auf fremder Trasse (≤ 30 %)`);
    }
}

// Level an gleicher Stelle gleich (geglättetes Feld statt Mittel entlang der Polyline)
{
    let worst = 0;
    for (let r = 0; r < bumpRes.count; r++) for (let o = r + 1; o < bumpRes.count; o++) {
        const p = road(bumpRes, r), q = road(bumpRes, o);
        for (let i = 0; i < ROAD_POINTS; i++) for (let k = 0; k < ROAD_POINTS; k++) {
            if (Math.hypot(p[2 * i] - q[2 * k], p[2 * i + 1] - q[2 * k + 1]) < 1)
                worst = Math.max(worst, Math.abs(bumpRes.levels[r * ROAD_POINTS + i] - bumpRes.levels[o * ROAD_POINTS + k]));
        }
    }
    check(worst <= 0.3, `Level an gleicher Stelle (< 1 m Abstand): max Δ ${worst.toFixed(2)} m ≤ 0,3 m`);
}

// Rand-Ring geschlossen (→ Plan/PresetsAusfahrten.md A1): Gelände mit Ring wie heightmap.wgsl (40 m über
// rimZone); Ausfahrten am Ringfuß, keine Straße tiefer als 2 m in der Randzone
{
    const edgeDist = (x, y) => Math.min(x, y, mapSize - x, mapSize - y);
    const data = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const t = Math.min(edgeDist((i + 0.5) * mapSize / N, (j + 0.5) * mapSize / N) / opts.rimZone, 1);
        data[j * N + i] = 30 + 40 * (1 - t * t * (3 - 2 * t));
    }
    const res = generateRoads(seed, mapSize, { size: N, data }, opts);
    for (const n of res.nodes.filter(n => n.exit))
        check(Math.abs(edgeDist(n.x, n.y) - opts.rimZone) < 0.5, `Ausfahrt (${n.x.toFixed(0)},${n.y.toFixed(0)}) am Ringfuß`);
    let deepest = Infinity;
    for (let i = 0; i < res.count * ROAD_POINTS * 2; i += 2) deepest = Math.min(deepest, edgeDist(res.points[i], res.points[i + 1]));
    check(deepest >= opts.rimZone - 2, `Straßen bleiben aus dem Ring: min. Kantenabstand ${deepest.toFixed(1)} m ≥ ${opts.rimZone - 2} m`);
}

// Steigung (→ Plan/StrassenSteigung.md G1): Plateau 60 m (x < 200) | Ebene 20 m, Klippe 6 m breit; mit Lücke
// = Rampe über 300 m um y = GAP_Y (13 %). Straßen queren die Klippenlinie in der Lücke; Level-Schritt ≤ Maximum,
// auch ohne Lücke (Querung unvermeidbar → Rampe aus Abtrag + Auftrag)
{
    const GAP_Y = 280, GAP_CORE = 35, GAP_FADE = 40;
    const cliffTerrain = gap => {
        const data = new Float32Array(N * N);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const x = (i + 0.5) * mapSize / N, y = (j + 0.5) * mapSize / N;
            const g = gap ? Math.min(Math.max(1 - (Math.abs(y - GAP_Y) - GAP_CORE) / GAP_FADE, 0), 1) : 0;
            const w = 3 + 147 * g;
            data[j * N + i] = 20 + 40 * Math.min(Math.max((200 + w - x) / (2 * w), 0), 1);
        }
        return { size: N, data };
    };
    const copts = { ...opts, rimZone: 20, exitCount: 0, townCount: 6, townSpacing: 70 };
    const g = copts.roadMaxGrade / 100;
    for (const gap of [true, false]) {
        const res = generateRoads(seed, mapSize, cliffTerrain(gap), copts);
        let crossings = 0, outside = 0, worst = 0;
        for (let r = 0; r < res.count; r++) {
            const pts = road(res, r), lv = res.levels.subarray(r * ROAD_POINTS, (r + 1) * ROAD_POINTS);
            for (let i = 0; i + 1 < ROAD_POINTS; i++) {
                const ax = pts[2 * i], bx = pts[2 * i + 2], ds = Math.hypot(bx - ax, pts[2 * i + 3] - pts[2 * i + 1]);
                worst = Math.max(worst, Math.abs(lv[i + 1] - lv[i]) / Math.max(ds, 1e-6));
                if ((ax - 200) * (bx - 200) < 0) {
                    const y = pts[2 * i + 1] + (pts[2 * i + 3] - pts[2 * i + 1]) * (200 - ax) / (bx - ax);
                    crossings++;
                    if (Math.abs(y - GAP_Y) > GAP_CORE + GAP_FADE) outside++;
                }
            }
        }
        const name = gap ? 'Klippe mit Lücke' : 'Klippe ohne Lücke';
        check(crossings > 0, `${name}: mind. eine Straße quert die Klippenlinie (${crossings})`);
        if (gap) check(outside === 0, `${name}: ${outside}/${crossings} Querungen außerhalb der Lücke`);
        check(worst <= g + 1e-4, `${name}: max. Level-Steigung ${(100 * worst).toFixed(1)} % ≤ ${copts.roadMaxGrade} %`);
        // geteilte Rampe: fremde Straßenpunkte < 2 m entfernt → gleiches Level (sonst Sägezahn im Shader)
        let jump = 0;
        for (let r = 0; r < res.count; r++) for (let o = r + 1; o < res.count; o++) {
            const p = road(res, r), q = road(res, o);
            for (let i = 0; i < ROAD_POINTS; i++) for (let k = 0; k < ROAD_POINTS; k++)
                if (Math.hypot(p[2 * i] - q[2 * k], p[2 * i + 1] - q[2 * k + 1]) < 2)
                    jump = Math.max(jump, Math.abs(res.levels[r * ROAD_POINTS + i] - res.levels[o * ROAD_POINTS + k]));
        }
        check(jump <= 0.5, `${name}: Level fremder Straßen < 2 m entfernt: max Δ ${jump.toFixed(2)} m ≤ 0,5 m`);
    }
    // Rampe mittig und kurz: 40 m Sprung bei 30 % → je Seite H/(2g) ≈ 67 m (+ Glättung/Klippe); weiter weg Level =
    // Gelände + Offset (Mittel der g-Hüllen allein: Dämme bis H/g = 133 m)
    {
        const sopts = { ...copts, roadMaxGrade: 30 }, reach = 40 / (2 * 0.3) + 20;
        const res = generateRoads(seed, mapSize, cliffTerrain(false), sopts);
        let far = 0, dev = 0;
        for (let k = 0; k < res.count * ROAD_POINTS; k++) {
            const x = res.points[2 * k];
            if (Math.abs(x - 200) <= reach) continue;
            far++;
            dev = Math.max(dev, Math.abs(res.levels[k] - (x < 200 ? 60 : 20) - sopts.roadOffset));
        }
        check(far > 0 && dev <= 0.3, `Rampe mittig: ${far} Punkte > ${reach.toFixed(0)} m von der Klippe, max. Abweichung ${dev.toFixed(2)} m ≤ 0,3 m`);
    }
}

// Netz-Planung (→ Plan/TerrainStrassennetz.md N1): Orte trocken/flach/außerhalb Randzone, Mindestabstand,
// Ausfahrten am Rand, Graph zusammenhängend, deterministisch
{
    // flach 30 m + See (10 m) bei (130,130) r 55 + steiler Hügel bei (280,270)
    const data = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = (i + 0.5) * mapSize / N, y = (j + 0.5) * mapSize / N;
        data[j * N + i] = Math.hypot(x - 130, y - 130) < 55 ? 10 : 30 + 60 * Math.exp(-((Math.hypot(x - 280, y - 270) / 25) ** 2));
    }
    const terr = { size: N, data };
    const nopts = { waterLevel: 15, rimZone: 45, townCount: 6, townSpacing: 60, exitCount: 3, extraLinks: 2 };
    const net = planNetwork(seed, mapSize, terr, nopts);
    check(JSON.stringify(net) === JSON.stringify(planNetwork(seed, mapSize, terr, nopts)), 'Netz deterministisch');
    const towns = net.nodes.filter(n => !n.exit), exits = net.nodes.filter(n => n.exit);
    check(towns.length >= 3 && towns.length <= nopts.townCount, `Orte: ${towns.length} (3…${nopts.townCount})`);
    check(exits.length === nopts.exitCount, `Ausfahrten: ${exits.length} == ${nopts.exitCount}`);
    const edgeDist = n => Math.min(n.x, n.y, mapSize - n.x, mapSize - n.y);
    for (const t of towns) {
        const h = sampleTerrain(terr, mapSize, t.x, t.y);
        check(h >= nopts.waterLevel + 1, `Ort (${t.x.toFixed(0)},${t.y.toFixed(0)}) trocken (${h.toFixed(1)} m)`);
        check(h < 35, `Ort (${t.x.toFixed(0)},${t.y.toFixed(0)}) nicht am Hügel (${h.toFixed(1)} m)`);
        check(edgeDist(t) >= nopts.rimZone, `Ort (${t.x.toFixed(0)},${t.y.toFixed(0)}) außerhalb Randzone`);
    }
    for (let a = 0; a < towns.length; a++) for (let b = a + 1; b < towns.length; b++)
        check(Math.hypot(towns[a].x - towns[b].x, towns[a].y - towns[b].y) >= nopts.townSpacing, `Orte ${a}/${b} Mindestabstand`);
    for (const e of exits) check(Math.abs(edgeDist(e) - nopts.rimZone) < 1e-6, 'Ausfahrt liegt am Ringfuß');
    const root = net.nodes.map((_, i) => i);
    const find = i => (root[i] === i ? i : (root[i] = find(root[i])));
    for (const [a, b] of net.edges) root[find(a)] = find(b);
    check(net.nodes.every((_, i) => find(i) === find(0)), 'Netz zusammenhängend');
    check(net.edges.length <= towns.length - 1 + nopts.extraLinks + nopts.exitCount, `Kanten ${net.edges.length} ≤ MST + Extra + Ausfahrten`);
}

// Laufzeit: kaputter Heap fällt nicht funktional auf, sondern als Sekunden pro Straße (Budget < 500 ms)
{
    const bump = bumpTerrain();
    const big = { ...opts, townCount: 8, townSpacing: 50, extraLinks: 4, exitCount: 4 };
    let worst = 0, roads = 0;
    for (let s = 1000; s < 1020; s++) {
        const t = performance.now();
        roads = Math.max(roads, generateRoads(s, mapSize, bump, big).count);
        worst = Math.max(worst, performance.now() - t);
    }
    check(worst < 200, `generateRoads bis ${roads} Straßen: max ${worst.toFixed(0)} ms < 200 ms`);
}

if (fail) {
    console.error(`${fail} Checks fehlgeschlagen`);
    process.exit(1);
}
console.log(`roadgen-Sanity: OK — Netz (${a.count} Straßen), Knoten→Knoten, deterministisch, Hügel-Umgehung, kein Parallelband, Level-Feld, Orts-Level, Randzone, Laufzeit`);
