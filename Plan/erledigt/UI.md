# Plan: Panel mit Toolbar + Tabs, lesbare Regler

**Status:** fertig
**Datum:** 2026-09-11

## Ziel
Statt eines langen Regler-Balkens: oben eine Toolbar, darunter drei Tabs mit wenigen, verständlich
beschrifteten Reglern. Seltenes steckt zugeklappt in „Advanced“.

## Entscheidungen (User-Wahl 2026-09-11)
- **Toolbar:** Seed + Würfel (Zufalls-Seed), Preset-Auswahl (natives `<select>`: eingebaute + Datei-Presets),
  Save, Load, Export ▾, ↻ Regenerate.
- **Tabs:** Terrain (Hills, Mountains, Cliffs) · Roads (Road network, Road edges) · World (Water & base, Border ring,
  maxH). Je Tab ein lil-gui in einem eigenen Panel-Container, Tab-Wechsel = ein-/ausblenden.
- **Advanced je Tab (zugeklappt):** hillRoughness, mountainWave, clusterWave, cliffWave, cliffWidth, cliffAreaWave ·
  townSpacing, reuse, slopePenalty, waterAvoid · rimWave. Road edges bleiben komplett sichtbar (User: wichtig
  für Abbruchkanten).
- **Labels:** lesbar mit Einheit („Height (m)“), Tooltip = ein Satz + interner Name. JSON-Schlüssel unverändert
  → alte Presets/Saves laden weiter.
- **Presets ohne `gui.reset()`:** `params` = Kopie der Startwerte + Overrides, dann Anzeigen aktualisieren.
  Seed liegt jetzt außerhalb von lil-gui, `reset()` würde ihn nicht erfassen; außerdem kein onChange-Sturm.
- Regler-Metadaten (Tab, Gruppe, Label, Bereich, Tooltip) in neuer Datei `src/ui.js`; `main.js` liefert Callbacks.
- Das Dropdown-Problem des alten Plans (Dropdown von `gui.reset()` mitgesetzt) entfällt: `<select>` liegt außerhalb.

## Meilensteine
1. **U1 Panel** (`ui.js` neu, `main.js`, `index.html`, README) → Prüfung: check grün; headless: jeder Tab als
   Screenshot, jedes Preset über die Auswahl = gleiche Statistik wie vorher, Save/Load/Würfel funktionieren,
   kein Scrollen bei 900 px Fensterhöhe.

## Abgeschlossen
- [x] U1 Panel — geprüft am 2026-09-11 (headless: Tabs 300–450 px, mit Advanced 560 px, kein Scrollen; alle
  7 Presets über die Auswahl = gleiche Werte wie vorher; Save/Load, String-JSON, Würfel ok)

<!-- fertig: git mv Plan/UI.md Plan/erledigt/ -->
