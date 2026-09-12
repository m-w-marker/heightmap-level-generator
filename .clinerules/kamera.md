---
paths:
  - "app/src/walk.js"
---
# Thema: Kamera (Orbit + Walk-Modus)

## No-Gos
- NICHT `OrbitControls.update()` aufrufen, solange der Walk-Modus läuft. `update()` prüft `enabled` nicht und dreht die Kamera per `lookAt(target)` zurück.
- NICHT die Augenhöhe aus dem 1024²-Readback nehmen, sondern aus dem angezeigten 512²-Mesh (`meshHeight`). An Böschungen weichen beide ±12 cm ab, man sinkt sichtbar ein.
- NICHT das Walk-Ende nur an `unlock` hängen. Wird der Pointer-Lock abgelehnt (headless, ohne Klick), gibt es kein `unlock` → Esc per `keydown` zusätzlich.
