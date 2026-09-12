// Biome (→ Plan/Biome.md): ein Biom belegt nur Farben, Texturen, Wasser und Stimmung anders; Gelände und Straßen bleiben.
// DOM-frei. Rampen-Höhen kommen aus den Material-Reglern (main.applyMaterial) → Fels/Schnee/Sand wirken in jedem Biom.

// Textur-Plätze des Auto-Materials; Ordner public/textures/<biom>/<rolle>/albedo.jpg + normal.jpg
export const ROLES = ['ground', 'rock', 'scree', 'shore', 'top', 'road'];

// ramp: sRGB 0–255 in der Reihenfolge der STOPS (Ufer, Boden, Boden dunkel, Fels-Zone, Schutt, oben); rock: steile Hänge;
// water: Farbkarte tief/flach + Wasser-Mesh; road: Straßenfarbe, die ein Biom-Wechsel setzt; sky: Hintergrund + Nebel;
// hemi: [Himmel, Boden, Stärke], sun: [Farbe, Stärke]; ice: Seen/Flüsse gefroren → water = Eis-Farben, Wasser-Mesh mit
// Eis-Material (Ufer-Textur) statt water.mesh; markings: Asphalt mit Mittel- und Randlinien (material.js)
export const BIOMES = {
    temperate: {
        label: 'Temperate',
        ramp: [[194, 178, 128], [108, 146, 72], [72, 112, 54], [112, 104, 92], [150, 146, 138], [240, 244, 248]],
        rock: [110, 102, 92],
        water: { deep: [42, 90, 158], shallow: [62, 118, 180], mesh: 0x3d78b0 },
        road: '#9a8462',
        sky: 0x0e1116,
        hemi: [0xbdd7ff, 0x3a4a33, 0.7],
        sun: [0xfff2dd, 2.8],
    },
    steppe: {
        label: 'Steppe',
        ramp: [[150, 134, 104], [150, 146, 96], [118, 120, 80], [128, 116, 98], [150, 142, 126], [206, 202, 192]],
        rock: [124, 110, 94],
        water: { deep: [38, 78, 112], shallow: [72, 110, 128], mesh: 0x3f6f8a },
        road: '#5a5854',
        markings: true,
        sky: 0x15130f,
        hemi: [0xdcdcc8, 0x5a4a30, 0.7],
        sun: [0xffe8c8, 2.8],
    },
    desert: {
        label: 'Desert',
        ramp: [[216, 206, 186], [206, 162, 112], [192, 144, 98], [172, 112, 78], [186, 142, 106], [226, 192, 152]],
        rock: [164, 102, 72],
        water: { deep: [28, 92, 118], shallow: [64, 150, 158], mesh: 0x2f8f9a },
        road: '#3e3c3a',
        markings: true,
        sky: 0x19130c,
        hemi: [0xffe8c8, 0x8a5a36, 0.7],
        sun: [0xffe2b8, 2.8],
    },
    snow: {
        label: 'Snow world',
        ramp: [[196, 216, 228], [232, 237, 243], [218, 225, 234], [122, 120, 124], [176, 179, 186], [168, 198, 218]],
        rock: [96, 96, 102],
        water: { deep: [120, 164, 190], shallow: [184, 212, 228], mesh: 0x46708f },
        ice: true,
        road: '#6c6e72',
        sky: 0x10141a,
        hemi: [0xd4e6ff, 0x8090a0, 0.7],
        sun: [0xfff6ee, 2.2], // helle Albedo → sonst weiß ausgebrannt
    },
};
