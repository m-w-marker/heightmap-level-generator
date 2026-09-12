// Biome (→ Plan/Biome.md): ein Biom belegt nur Farben, Texturen, Wasser und Stimmung anders; Gelände und Straßen bleiben.
// DOM-frei. Rampen-Höhen kommen aus den Material-Reglern (main.applyMaterial) → Fels/Schnee/Sand wirken in jedem Biom.

// Textur-Plätze des Auto-Materials; Ordner public/textures/<biom>/<rolle>/albedo.jpg + normal.jpg
export const ROLES = ['ground', 'rock', 'scree', 'shore', 'top', 'road'];

// ramp: sRGB 0–255 in der Reihenfolge der STOPS (Ufer, Boden, Boden dunkel, Fels-Zone, Schutt, oben); rock: steile Hänge;
// water: Farbkarte tief/flach + Wasser-Mesh; road: Straßenfarbe, die ein Biom-Wechsel setzt; sky: Hintergrund + Nebel;
// hemi: [Himmel, Boden, Stärke], sun: [Farbe, Stärke]
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
};
