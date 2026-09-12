// Walk-Modus (→ Plan/Roadmap.md R14): Pointer-Lock + WASD, Augenhöhe über der Heightmap, Esc zurück zur Orbit-Ansicht
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export const EYE = 1.7; // m über Grund
const SPEED = 5, RUN = 15; // m/s, Shift = rennen (400 m Map)
const NEAR = 0.1; // Orbit-near 1 m schneidet in Augenhöhe den Boden am Hang ab
const KEYS = { KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0], KeyD: [0, 1], ArrowRight: [0, 1], KeyA: [0, -1], ArrowLeft: [0, -1] };

// groundAt(x, z) → Terrainhöhe in m; half() = halbe Map-Kante (Mitte im Ursprung, Map-Größe variabel)
export function createWalk(camera, dom, orbit, groundAt, half) {
    const look = new PointerLockControls(camera, dom);
    const down = new Set();
    let saved = null;

    const onKey = e => {
        if (!saved) return;
        if (e.type === 'keydown' && e.code === 'Escape') return stop(); // ohne Lock (abgelehnt/headless) sonst kein Ausweg
        if (e.type === 'keydown') down.add(e.code);
        else down.delete(e.code);
    };
    addEventListener('keydown', onKey);
    addEventListener('keyup', onKey);
    look.addEventListener('unlock', () => stop()); // Esc beendet den Lock im Browser selbst

    function start() {
        if (saved) return;
        saved = { pos: camera.position.clone(), target: orbit.target.clone(), near: camera.near };
        // an der Stelle des Orbit-Ziels, Blick horizontal in die bisherige Richtung
        const dir = orbit.target.clone().sub(camera.position).setY(0).normalize();
        camera.position.set(THREE.MathUtils.clamp(orbit.target.x, -half(), half()), 0, THREE.MathUtils.clamp(orbit.target.z, -half(), half()));
        camera.position.y = groundAt(camera.position.x, camera.position.z) + EYE;
        camera.lookAt(camera.position.clone().add(dir));
        camera.near = NEAR;
        camera.updateProjectionMatrix();
        orbit.enabled = false;
        look.lock();
    }

    function stop() {
        if (!saved) return;
        if (look.isLocked) look.unlock();
        camera.position.copy(saved.pos);
        orbit.target.copy(saved.target);
        camera.near = saved.near;
        camera.updateProjectionMatrix();
        orbit.enabled = true;
        orbit.update();
        down.clear();
        saved = null;
    }

    function update(dt) {
        let f = 0, r = 0;
        for (const c of down) if (KEYS[c]) { f += KEYS[c][0]; r += KEYS[c][1]; }
        const len = Math.hypot(f, r);
        if (len) {
            const d = (down.has('ShiftLeft') || down.has('ShiftRight') ? RUN : SPEED) * dt / len;
            look.moveForward(f * d);
            look.moveRight(r * d);
        }
        const p = camera.position;
        p.x = THREE.MathUtils.clamp(p.x, -half(), half());
        p.z = THREE.MathUtils.clamp(p.z, -half(), half());
        p.y = groundAt(p.x, p.z) + EYE; // jedes Bild, auch im Stand → Regeneration hebt/senkt mit
    }

    return { start, stop, update, get active() { return !!saved; } };
}
