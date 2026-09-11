# Plan: Einstellungen speichern / laden (JSON)

**Status:** in Arbeit
**Datum:** 2026-09-11

## Ziel
Alle Regler inkl. Seed als JSON sichern und wieder laden. Jede JSON in `app/presets/` wird automatisch
zum Preset-Button, damit gute Seeds im Repo landen.

## Entscheidungen
- **Inhalt:** alle Schlüssel von `params` außer `maxH` (automatisch), 2 Leerzeichen eingerückt → per Hand
  editierbar. Dateiname-Vorschlag `heightmap-<seed>.json`.
- **Save:** `showSaveFilePicker({ id: 'presets', … })` (Chrome/Edge), sonst Download über denselben Weg wie
  Export PNG (gemeinsamer Helfer `download(blob, name)`). Abbrechen im Dialog (`AbortError`) → still.
  → Ein Browser kann keinen Projektordner vorwählen; `id` merkt sich den zuletzt gewählten Ordner →
  einmal `app/presets/` ansteuern, danach startet der Dialog dort.
- **Load:** verstecktes `<input type="file" accept=".json">` (überall gleich, ein Codepfad). Werte gehen
  durch `applyPreset` (= `gui.reset()` + Overrides → fehlende Schlüssel alter Dateien = Default),
  nur bekannte Schlüssel, `maxH` ignoriert. Kaputtes JSON → `console.error`.
- **`applyPreset` ruft `setRoadColor()`**, sonst bleibt bei geladener `roadColor` die alte Farbe im Cache.
- **Datei-Presets:** `import.meta.glob('../presets/*.json', { eager: true, import: 'default' })`, Button-Name
  = Dateiname ohne `.json`, im Ordner „Presets“ nach den eingebauten. Gleicher Weg wie Load.
- Speichern nach `app/presets/` bei laufendem Dev-Server → Vite lädt die Seite neu (Glob hat sich
  geändert). Hingenommen: Der neue Button ist danach sofort da, ein Klick stellt alles wieder her.
- Die eingebauten `PRESETS` bleiben im Code (nicht verlangt, sie umzuziehen).

## Meilensteine
1. **S1 Save/Load** (`main.js`) → Prüfung: check grün; headless: Save-Fallback liefert JSON mit allen
   Schlüsseln, Load derselben Datei nach Preset-Wechsel stellt Seed + Regler wieder her (Konsole
   „Regeneration“, Min/Max wie vorher).
2. **S2 Datei-Presets** (`main.js`, `app/presets/`) → Prüfung: check grün; headless: Button zur
   Lieblings-JSON erscheint, Klick ergibt dieselbe Konsolen-Statistik wie Load.

## Abgeschlossen
- [x] S1 Save/Load — geprüft am 2026-09-11 (headless: Download-Fallback 32 Schlüssel ohne maxH,
  Mountains → Save → Pasture → Load = gleiche Statistik)
- [ ] S2 Datei-Presets — geprüft am

<!-- fertig: git mv Plan/SaveLoad.md Plan/erledigt/ -->
