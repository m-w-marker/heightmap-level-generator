// Auto-Material des 3D-Terrains (→ Plan/Texturierung.md): three NodeMaterial (TSL), weil es unter WebGPU kein
// onBeforeCompile gibt. Terrain-Mesh ohne Transformation → lokal = Welt
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { texture, uv } from 'three/tsl';

// colorTex = Farbtextur der Vorschau (RES²); set*() tauscht Texturen nach einer Map-Größen-Änderung
export function createTerrainMaterial(colorTex) {
    const color = texture(colorTex, uv());
    const mat = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
    mat.colorNode = color;
    return { mat, setColorTex(t) { color.value = t; } };
}
