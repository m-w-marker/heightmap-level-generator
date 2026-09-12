// Panel: Toolbar + Tabs, je Tab ein lil-gui (→ Plan/UI.md). Hier nur Aufbau + Metadaten, Logik kommt als Callbacks.
import { GUI } from 'lil-gui';
import { MAX_TOWNS } from './roadgen.js';

// Tab → Gruppe → [Schlüssel, Label, min, max, step, Tooltip]; Gruppe 'Advanced' startet zugeklappt.
// Schlüssel = params/JSON-Name (unverändert → alte Saves laden weiter)
export const TABS = {
    Terrain: {
        Hills: [
            ['hillAmp', 'Height (m)', 0, 30, 0.5, 'Typical hill height (95th percentile).'],
            ['hillWave', 'Size (m)', 20, 400, 5, 'Distance between hill tops.'],
        ],
        Mountains: [
            ['mountainAmp', 'Height (m)', 0, 100, 5, 'Typical peak height on top of the hills.'],
            ['mountainCoverage', 'Coverage (%)', 0, 100, 1, 'Share of the map covered by mountain groups.'],
        ],
        Cliffs: [
            ['cliffDrop', 'Drop (m)', 0, 60, 0.5, 'Height step between plateaus.'],
            ['cliffCoverage', 'Coverage (%)', 0, 100, 1, 'Share of the map that has cliffs.'],
        ],
        Erosion: [
            ['erosionStrength', 'Strength (%)', 0, 100, 1, 'Rain and scree wear the terrain: gullies, softer slopes, debris fans. 0 = off.'],
            ['erosionIterations', 'Duration', 20, 600, 10, 'Simulation steps: longer = deeper, longer channels, slower generation.'],
            ['screeAngle', 'Scree angle (°)', 20, 90, 1, 'Steeper slopes shed material until they reach this angle; 90 = off. ~65 trims sharp ridges of strong erosion, lower turns cliffs into scree.'],
        ],
        Advanced: [
            ['hillRoughness', 'Hill roughness', 0.25, 0.65, 0.01, 'Detail per octave: 0.25 smooth rolling … 0.65 rugged.'],
            ['mountainWave', 'Ridge size (m)', 60, 500, 5, 'Wavelength of the mountain ridges.'],
            ['clusterWave', 'Mountain group size (m)', 60, 500, 5, 'Size of the areas that hold mountains.'],
            ['cliffWave', 'Plateau size (m)', 20, 300, 5, 'Wavelength of plateaus and cliff lines.'],
            ['cliffWidth', 'Cliff width (m)', 2, 60, 0.5, 'Horizontal width of a drop.'],
            ['cliffAreaWave', 'Cliff area size (m)', 40, 400, 5, 'Size of the areas that hold cliffs.'],
        ],
    },
    Roads: {
        // Maxima so, dass MST + Zusatz + Ausfahrten ≤ MAX_ROADS: (MAX_TOWNS − 1) + 4 + 4 = 15
        'Road network': [
            ['townCount', 'Towns', 0, MAX_TOWNS, 1, 'Flat, dry spots that get connected by roads. 0 = no roads.'],
            ['clearingRadius', 'Town clearing (m)', 0, 40, 1, 'Radius of the flat ground around each town, on the level of its roads; edges like the road banks. 0 = off.'],
            ['exitCount', 'Map exits', 0, 4, 1, 'Roads that leave the map at the foot of the border ring.'],
            ['extraLinks', 'Loops', 0, 4, 1, 'Extra shortcuts between towns, only where the way round is long.'],
            ['roadMaxGrade', 'Max grade (%)', 4, 30, 1, 'Steepest allowed climb; a steeper step becomes a ramp.'],
        ],
        'Road edges': [
            ['roadWidth', 'Width (m)', 1, 5, 0.5, 'Width of the driving surface.'],
            ['roadSlope', 'Bank angle (°)', 15, 60, 1, 'Slope of cuts and fills right next to the road.'],
            ['roadSlopeVar', 'Angle variation (°)', 0, 30, 1, 'Varies the bank angle along the road: soft shoulder vs. sharp edge.'],
            ['roadTolerance', 'Follow terrain (m)', 0, 3, 0.1, 'How far the road may ride up and down with the terrain before cutting.'],
            ['levelSmoothing', 'Level smoothing (m)', 0, 40, 1, 'Radius of the terrain smoothing the road level is taken from.'],
            ['roadOffset', 'Offset (m)', -2, 3, 0.1, 'Road sunk (−) or raised (+) against the terrain.'],
            ['roadColor', 'Color', 0, 0, 0, 'Road color in the preview (no regeneration).'],
        ],
        Advanced: [
            ['townSpacing', 'Town spacing (m)', 30, 150, 5, 'Minimum distance between towns.'],
            ['reuse', 'Road sharing', 0.1, 1, 0.05, 'Routing cost on existing roads: low = new roads merge into them.'],
            ['slopePenalty', 'Climb penalty', 0, 10, 0.5, 'Extra routing cost per metre of climb.'],
            ['waterAvoid', 'Water avoidance', 0, 5, 0.5, 'Extra routing cost below the water level.'],
        ],
    },
    World: {
        Map: [
            ['mapSize', 'Map size (m)', 256, 1280, 64, 'Edge length of the square map. Hills, roads and rivers keep their size in metres; a larger map shows more of the same landscape at the same detail (0.5 m per pixel, 2560 px at 1280 m) and takes longer to generate.'],
        ],
        'Water & ground': [
            ['waterLevel', 'Water level (m)', 0, 50, 0.5, 'Everything below is water.'],
            ['baseLevel', 'Ground level (m)', 0, 60, 0.5, 'Ground height before hills; its distance to the water level decides lakes.'],
        ],
        'Rivers & lakes': [
            ['riverCatchment', 'River sources (% catchment)', 0, 10, 0.1, 'A river starts where this share of the map drains through one spot; smaller = more, longer rivers. 0 = no rivers or lakes.'],
            ['riverWidth', 'River width (m)', 2, 15, 0.5, 'Width at the largest river mouth; rivers narrow towards their sources.'],
            ['lakeArea', 'Min. lake area (m²)', 0, 3000, 50, 'Hollows at least this large fill up to their outflow and become lakes. 0 = no lakes.'],
        ],
        'Border ring': [
            ['rimAmp', 'Height (m)', 0, 100, 1, 'Height of the closed ring that hides the horizon.'],
            ['rimZone', 'Width (m)', 10, 150, 5, 'How far the ring reaches in from the map edge.'],
        ],
        Advanced: [
            ['rimWave', 'Ring variation size (m)', 20, 300, 5, 'Wavelength of the height variation along the ring.'],
        ],
    },
    // ohne Regeneration (cb.material): Farben der Vorschau, Splatmap und Texturen; Ansicht (Textures, Größe) hängt main.js an
    Material: {
        'Rock & snow': [
            ['rockSlope', 'Rock from (°)', 15, 70, 1, 'Slopes steeper than this start to turn into rock.'],
            ['rockBlend', 'Rock blend (°)', 2, 40, 1, 'Extra steepness until the slope is fully rock.'],
            ['snowHeight', 'Snow line (m)', 20, 300, 5, 'Height above the water level where the ground is fully snow; the scree and rock zones below move with it.'],
            ['snowBlend', 'Snow blend (m)', 5, 80, 1, 'Height over which scree turns into snow.'],
        ],
        Ground: [
            ['sandHeight', 'Shore sand (m)', 0, 5, 0.1, 'Sand on the shore up to this height above the local water level (sea, lake, river).'],
            ['gravelCurv', 'Gravel in hollows (m)', 0, 3, 0.05, 'Hollows deeper than this get gravel (3D textures only). 0 = off.'],
        ],
        Textures: [
            ['texScale', 'Tile size (m)', 1, 16, 0.5, 'Size of one texture repeat on the ground.'],
            ['texFade', 'Texture distance (m)', 30, 600, 10, 'Beyond this camera distance the flat color map is shown instead of the textures.'],
            ['texTint', 'Map color', 0, 1, 0.05, 'Tints the textures with the color map (rock, snow and road colors apply up close, no seam at the texture distance). 0 = the textures\' own colors.'],
        ],
    },
};

function el(tag, props = {}, ...kids) {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
}

// Auswahl als Menü: nach der Wahl zurück auf den Platzhalter → dieselbe Wahl löst erneut aus
function menu(id, placeholder, items, pick) {
    const s = el('select', { id, title: placeholder }, el('option', { value: '', textContent: placeholder, disabled: true, selected: true }),
        ...items.map(n => el('option', { value: n, textContent: n })));
    s.addEventListener('change', () => {
        const v = s.value;
        s.value = '';
        pick(v);
    });
    return s;
}

const randomSeed = () => 1 + Math.floor(Math.random() * 99999);

// Seed-Vergleich (→ Plan/Roadmap.md R13): Overlay mit count Kacheln (erste = aktueller Seed), draw(seed, canvas) async
// nacheinander; Klick → pick(seed); „More“ würfelt neu, Esc / ✕ schließt
export function seedGrid(size, count, current, draw, pick) {
    const grid = el('div', { className: 'grid' });
    let batch = 0;
    const close = () => {
        overlay.remove();
        removeEventListener('keydown', esc);
    };
    const esc = e => { if (e.key === 'Escape') close(); };
    async function fill() {
        const my = ++batch; // „More“ während des Zeichnens → alte Runde bricht ab
        const seeds = [current, ...Array.from({ length: count - 1 }, randomSeed)];
        const tiles = seeds.map(s => {
            const c = el('canvas', { width: size, height: size });
            const b = el('button', { className: 'tile', title: `Use seed ${s}` }, c, el('span', { textContent: s === current ? `${s} (current)` : s }));
            b.addEventListener('click', () => { close(); pick(s); });
            return [s, c, b];
        });
        grid.replaceChildren(...tiles.map(t => t[2]));
        for (const [s, c] of tiles) {
            if (my !== batch || !overlay.isConnected) return;
            await draw(s, c);
        }
    }
    const btn = (text, title, fn) => {
        const b = el('button', { textContent: text, title });
        b.addEventListener('click', fn);
        return b;
    };
    const overlay = el('div', { id: 'seedGrid' },
        el('div', { className: 'bar' }, el('span', { textContent: 'Compare seeds (current settings) — click a map to use its seed' }),
            btn('More', 'New random seeds', fill), btn('✕', 'Close (Esc)', close)),
        grid);
    document.body.append(overlay);
    addEventListener('keydown', esc);
    fill();
}

// cb: change(), color(), material(), presets: [Namen], preset(name), save(), load(), link(), walk(), compare(), exports: {Label: fn},
//     exportTargets: {key: Label}, exportTarget(key), exportDetail(1|2), exportSize(px), regenerate()
// → { guis: {Tab: GUI}, refresh(), status(text), sizes(options, selected), busy(on) }
export function buildPanel(params, cb) {
    const seed = el('input', { id: 'seed', type: 'number', min: 1, max: 99999, step: 1, value: params.seed, title: 'Seed (seed)' });
    seed.addEventListener('change', () => {
        params.seed = Math.min(Math.max(Math.round(+seed.value) || 1, 1), 99999);
        seed.value = params.seed;
        cb.change();
    });
    const button = (text, title, fn) => {
        const b = el('button', { textContent: text, title });
        b.addEventListener('click', fn);
        return b;
    };
    const dice = button('🎲', 'Random seed', () => {
        params.seed = randomSeed();
        seed.value = params.seed;
        cb.change();
    });
    const compare = button('⊞', 'Compare seeds: previews of random seeds, click one to use it', cb.compare);
    const regen = button('↻', 'Regenerate', cb.regenerate);
    const walk = button('🚶', 'Walk on the terrain: mouse = look, WASD / arrows = move, Shift = run, Esc = back', cb.walk);
    const link = button('Link', 'Copy a link with all settings (same map in any browser)', async () => {
        try {
            await cb.link();
            link.textContent = '✓';
        } catch (e) {
            console.error('Link:', e.message);
            link.textContent = '✗';
        }
        setTimeout(() => { link.textContent = 'Link'; }, 1200);
    });
    // Export-Ziel + Größe: Einstellungen, kein Menü → Auswahl bleibt stehen; Größen füllt main je Ziel und Map (sizes())
    const target = el('select', { id: 'exportTarget', title: 'Target engine: sets the export sizes, the normal map convention, the row order and the import values in the metadata' },
        ...Object.entries(cb.exportTargets).map(([k, t]) => el('option', { value: k, textContent: t })));
    target.addEventListener('change', () => cb.exportTarget(target.value));
    const detail = el('select', { id: 'exportDetail', title: 'Detail ×2: the map is computed again at double resolution for the export (0.25 m per pixel): sharper road, bank, cliff and river edges; hills gain no new detail' },
        el('option', { value: 1, textContent: '×1' }), el('option', { value: 2, textContent: '×2' }));
    detail.addEventListener('change', () => cb.exportDetail(+detail.value));
    const size = el('select', { id: 'exportRes', title: 'Export size in pixels and spacing (heightmap, RAW, splatmap, masks, metadata)' });
    size.addEventListener('change', () => cb.exportSize(+size.value));
    const status = el('div',{ id: 'status', className: 'row', title: 'Last generation: GPU passes incl. readback, road network, total' });
    const toolbar = el('div', { className: 'toolbar' },
        el('div', { className: 'row' }, el('label', { textContent: 'Seed', htmlFor: 'seed' }), seed, dice, compare, regen, walk),
        el('div', { className: 'row' }, menu('preset', 'Preset…', cb.presets, cb.preset),
            button('Save', 'Save all settings as JSON', cb.save), button('Load', 'Load settings from JSON', cb.load), link),
        el('div', { className: 'row' }, menu('export', 'Export…', Object.keys(cb.exports), name => cb.exports[name]()), detail),
        el('div', { className: 'row' }, el('label', { textContent: 'For', htmlFor: 'exportTarget' }), target, size),
        status);

    const tabBar = el('div', { className: 'tabs' });
    const body = el('div', { className: 'tab-body' });
    const guis = {};
    for (const [tab, groups] of Object.entries(TABS)) {
        const gui = new GUI({ container: body, width: 300, title: tab });
        gui.domElement.classList.add('tab-gui');
        for (const [group, rows] of Object.entries(groups)) {
            const f = gui.addFolder(group);
            if (group === 'Advanced') f.close();
            for (const [key, label, min, max, step, tip] of rows) {
                const c = typeof params[key] === 'string'
                    ? f.addColor(params, key).onChange(cb.color)
                    : f.add(params, key, min, max, step).onChange(tab === 'Material' ? cb.material : cb.change);
                c.name(label);
                c.domElement.title = `${tip} (${key})`;
                c.domElement.dataset.key = key;
            }
        }
        guis[tab] = gui;
        const b = button(tab, '', () => show(tab));
        b.dataset.tab = tab;
        tabBar.append(b);
    }
    function show(tab) {
        for (const [t, g] of Object.entries(guis)) g.show(t === tab); // lil-gui-CSS übersteuert das hidden-Attribut
        for (const b of tabBar.children) b.classList.toggle('active', b.dataset.tab === tab);
    }
    show('Terrain');
    document.body.append(el('div', { id: 'panel' }, toolbar, tabBar, body));

    return {
        guis,
        refresh() {
            seed.value = params.seed;
            for (const g of Object.values(guis)) g.controllersRecursive().forEach(c => c.updateDisplay());
        },
        status(text) { status.textContent = text; },
        // options: [[px, Label]], selected: px
        sizes(options, selected) {
            size.replaceChildren(...options.map(([v, t]) => el('option', { value: v, textContent: t })));
            size.value = selected;
        },
        busy(on) {
            regen.disabled = on;
            status.classList.toggle('busy', on);
        },
    };
}
