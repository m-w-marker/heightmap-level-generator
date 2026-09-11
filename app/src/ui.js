// Panel: Toolbar + Tabs, je Tab ein lil-gui (→ Plan/UI.md). Hier nur Aufbau + Metadaten, Logik kommt als Callbacks.
import { GUI } from 'lil-gui';

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
        // Maxima so, dass MST + Zusatz + Ausfahrten ≤ MAX_ROADS: (8 − 1) + 4 + 4 = 15
        'Road network': [
            ['townCount', 'Towns', 1, 8, 1, 'Flat, dry spots that get connected by roads.'],
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
        'Water & ground': [
            ['waterLevel', 'Water level (m)', 0, 50, 0.5, 'Everything below is water.'],
            ['baseLevel', 'Ground level (m)', 0, 60, 0.5, 'Ground height before hills; its distance to the water level decides lakes.'],
        ],
        'Border ring': [
            ['rimAmp', 'Height (m)', 0, 100, 1, 'Height of the closed ring that hides the horizon.'],
            ['rimZone', 'Width (m)', 10, 150, 5, 'How far the ring reaches in from the map edge.'],
        ],
        Advanced: [
            ['rimWave', 'Ring variation size (m)', 20, 300, 5, 'Wavelength of the height variation along the ring.'],
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

// cb: change(), color(), presets: [Namen], preset(name), save(), load(), exports: {Label: fn}, regenerate()
// → { guis: {Tab: GUI}, refresh() }
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
        params.seed = 1 + Math.floor(Math.random() * 99999);
        seed.value = params.seed;
        cb.change();
    });
    const toolbar = el('div', { className: 'toolbar' },
        el('div', { className: 'row' }, el('label', { textContent: 'Seed', htmlFor: 'seed' }), seed, dice,
            button('↻', 'Regenerate', cb.regenerate)),
        el('div', { className: 'row' }, menu('preset', 'Preset…', cb.presets, cb.preset),
            button('Save', 'Save all settings as JSON', cb.save), button('Load', 'Load settings from JSON', cb.load),
            menu('export', 'Export…', Object.keys(cb.exports), name => cb.exports[name]())));

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
                    : f.add(params, key, min, max, step).onChange(cb.change);
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
    };
}
