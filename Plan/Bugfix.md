# Plan: Bugfix nach Audit (Road-Uniform, Fehlerausgabe, Prüf-Tooling, Doku-Drift)

**Status:** offen
**Datum:** 2026-09-10

## Ziel
Nach M3 gefundene Fehler beheben. Der wichtigste: Nur 4 von 8 Straßen passen in den Uniform-Buffer.
Dazu kommen Prüfungen, die solche Layout-Fehler künftig automatisch finden, statt sie nur zu dokumentieren.
Kein neues Feature, kein M4-Vorgriff.

## Befunde
1. **Road-Array zu klein (Bug).** `heightmap.wgsl`: `roads: array<vec4<f32>, 128>` = 128 Punkte, gebraucht
   werden `MAX_ROADS × ROAD_POINTS` = 8 × 32 = 256. Entstanden beim M3-Fix vec2×256 → vec4×128: Die Bytes
   blieben gleich (2048), die Punkte haben sich halbiert. `main.js`: `new Float32Array(540)` ist ebenfalls zu klein.
   Die Schleife schreibt bis Index 1045, **TypedArrays verwerfen Schreibzugriffe hinter dem Ende stillschweigend**.
   Bei `roadCount > 4` liest der Shader deshalb außerhalb des Arrays. Mit dem Default 4 fällt das nicht auf.
2. **roadCount im Shader unbegrenzt.** `generateRoads` begrenzt auf 8, `encodeUniforms` schreibt `params.roadCount`
   aber ungeprüft. Der Shader-Loop läuft dann bis `u32(roadCount)`.
3. **Shader-/WebGPU-Fehler sind unsichtbar.** Kein `getCompilationInfo`, kein `uncapturederror`, `generate()` ohne
   `.catch`. Genau so ist in M3 der Fehler im Firefox untergegangen.
4. **Device-Check zu spät.** `main.js`: `const queue = device.queue` steht vor `if (!device) throw …`. Ohne Device
   gibt es einen TypeError statt der eigentlichen Meldung.
5. **Doku-Drift.**
   - `roadgen.js` Kopfkommentar: steht noch auf „array<vec2, 256>“.
   - `main.js`: „u[21], u[22]: Padding“, frei sind aber u[21..23].
   - `Plan/Build.md`: Datenfluss nennt „8×32×vec2“, der M3-Befund nennt „2 Padding-floats“. Beides ist veraltet.
   - Daten in `Plan/Build.md`: „2026-07-10“ ist falsch. Laut `git log` war es der 2026-09-10.
   - Code-Zeiger `→ Plan/Build.md M3` zum Uniform-Layout: Die Begründung steht inzwischen in `.clinerules/wgsl.md`.

## Entscheidungen
- Punkte bleiben `vec4(x, z, 0, 0)`, das Array wird auf 256 vergrößert (4 KB Uniform, Limit 64 KB)
  → verworfen: 2 Punkte pro vec4 packen (spart 2 KB, braucht aber Index-Logik mit `.xy`/`.zw` im Shader)
- Buffer-Größe wird aus `MAX_ROADS`/`ROAD_POINTS` berechnet, nicht als Zahl hingeschrieben
  → eine Wahrheit, der Test prüft sie gegen die WGSL
- `encodeUniforms` wandert nach `app/src/uniforms.js`
  → nur so ist das Layout in Node testbar (`main.js` braucht zwingend einen Browser). Das ist keine
  Abstraktion auf Vorrat: Der Test verhindert genau den Bug, den es in M3 schon zweimal gab.

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)

1. **`npm run check`**: alle Prüfungen mit einem Befehl. In `app/package.json`:
   ```json
   "naga": "C:\\naga-proj\\target\\debug\\naga-runner.exe src\\heightmap.wgsl",
   "check": "npm run naga && npm run sanity && npm run build"
   ```
   → Prüfung: `npm run check` ist grün. Dann in `heightmap.wgsl` testweise einen Syntaxfehler einbauen:
   `npm run check` muss abbrechen (Exit-Code ≠ 0). Danach den Fehler wieder entfernen.
   Bricht naga trotz Fehler nicht ab: melden, nicht umbauen.

2. **`app/src/uniforms.js` + Layout-Test** (reiner Umzug, das Verhalten bleibt gleich):
   - `uniforms.js` exportiert `PARAM_FIELDS`, ein Objekt in **WGSL-Feldreihenfolge**, Wert = Funktion `(p) => float`:
     ```js
     export const PARAM_FIELDS = {
         seed: p => p.seed,
         mapSize: p => p.mapSize,
         res: p => p.res,
         maxH: p => p.maxH,
         // … alle 21 Felder, z. B. hillScale: p => 1 / p.hillWave, roadHalfWidth: p => p.roadWidth / 2
     };
     export const ROADS_OFFSET = Math.ceil(Object.keys(PARAM_FIELDS).length / 4) * 4; // Float-Index, vec4-Align
     export function encodeUniforms(p, roads, out) { … }   // Felder per Object.values, dann Punkte ab ROADS_OFFSET
     ```
     `mapSize`/`res` kommen über `p` rein (`main.js` übergibt `{ ...params, mapSize: MAP, res: RES }`).
   - Die Buffer-Länge bleibt in diesem Schritt **absichtlich** 540 (Bug erst in Schritt 3 fixen).
   - Neuer Test `app/tests/uniforms.layout.mjs` (liest `src/heightmap.wgsl` per `fs`):
     - Feldnamen aus `struct Params { … }` per Regex ziehen, **Reihenfolge** == `Object.keys(PARAM_FIELDS)`
     - `ROADS_OFFSET * 4` == 96 (Byte-Offset von `roads`)
     - Größe N aus `roads: array<vec4<f32>, N>` == `MAX_ROADS * ROAD_POINTS`
     - Länge des Encode-Puffers == `ROADS_OFFSET + 4 * MAX_ROADS * ROAD_POINTS`
   - `"sanity"` in `package.json` führt beide Tests aus.

   → Prüfung: Die Feld- und Offset-Checks sind grün. **Die Checks für Array-Größe und Pufferlänge schlagen fehl**
   (128 ≠ 256, 540 ≠ 1048). Das ist gewollt und belegt, dass der Test Befund 1 findet.
   Im Browser weiterhin dieselben Konsolen-Stats wie vorher.

3. **Road-Array fixen** (Befunde 1 + 2):
   - `heightmap.wgsl`: `roads: array<vec4<f32>, 256>`; `let nRoads = min(u32(u.params.roadCount), 8u);`
   - `main.js`: `new Float32Array(ROADS_OFFSET + 4 * MAX_ROADS * ROAD_POINTS)`, Buffer-Größe `uniformsData.byteLength`
   - Die Schleife in `encodeUniforms` läuft bis `MAX_ROADS * ROAD_POINTS` statt bis zur Zahl 256

   → Prüfung: `npm run check` grün, inklusive der beiden vorher roten Checks. Im Browser `params.roadCount = 8`:
   8 Straßen in der Preview, Road-Level 26 ± 0,5 m. Danach wieder 4.

4. **Fehler sichtbar machen** (Befunde 3 + 4), in `main.js`:
   - `if (!device) throw …` **vor** `device.queue`
   - `device.addEventListener('uncapturederror', e => console.error('WebGPU:', e.error.message));`
   - Shader-Modul in eine eigene Variable, dann:
     ```js
     const info = await shaderModule.getCompilationInfo();
     for (const m of info.messages) console[m.type === 'error' ? 'error' : 'warn'](`WGSL ${m.lineNum}:${m.linePos} ${m.message}`);
     ```
   - `generate().catch(e => console.error('generate:', e));`

   → Prüfung: `npm run check` grün. Testweise im Browser `array<vec4<f32>, 256>` → `array<vec2<f32>, 256>`:
   Die Konsole zeigt eine `WGSL …`-Zeile mit Zeilennummer. Danach zurückstellen.

5. **Doku-Drift aufräumen** (Befund 5), ohne neue Inhalte:
   - Veraltete Kommentare in `roadgen.js` und `main.js` korrigieren
   - `Plan/Build.md`: im Datenfluss „8×32×vec4“. Den M3-Befund-Absatz ersetzen durch:
     „Befund + Lösung → .clinerules/wgsl.md“ (eine Wahrheit)
   - `.clinerules/wgsl.md`: unter „Aktuell“ ergänzen: `roads` = `MAX_ROADS × ROAD_POINTS` vec4, geprüft von
     `tests/uniforms.layout.mjs`. Wenn `encodeUniforms` aus `main.js` raus ist, `app/src/main.js` aus `paths:` streichen.
   - Code-Zeiger zum Uniform-Layout: `→ Plan/Build.md M3` wird zu `→ .clinerules/wgsl.md`

   → Prüfung: `git grep -n -e "vec2, 256" -e "540" -e "2026-07-10" -- ":!app/package-lock.json" ":!Plan/Bugfix.md"`
   liefert keine Treffer.
   `npm run check` grün.

## Bewusst NICHT in diesem Plan (Entscheidung beim User, erst nach Freigabe)
- **Kein Wasser mit den Defaults:** Das Minimum liegt bei 30 − 3,9 − 10 ≈ 16,1 m, der Wasserspiegel bei 15 m.
  Das Maximum kann ~142 m erreichen und liegt damit über `maxH = 120`. Defaults ändern? → Parameter-Frage, kein Bug.
- **Sinus-Hash** (`hash()` in WGSL): Die Argumente liegen bei ~100 000, `sin` ist in WGSL nur in [−π, π]
  genau definiert. Eine andere GPU oder ein anderer Browser kann dann eine andere Map liefern.
  → eventuell eigener Plan: Integer-Hash (PCG, `u32`)
- **Straßen auf festen 26 m** schneiden steile Schluchten in Berge und Rand-Ring → Design-Frage für M4
- **Rennen bei Regenerierung** (M5): Ein älterer `generate()`-Lauf kann nach einem neueren fertig werden
  → Generation-Counter, erst in M5
- **`.clinerules/` straffen** (kürzere Regeln, Doku-Pflicht ohne Dreifach-Pflege) → nur der User entscheidet

## Abgeschlossen
- [x] 1 `npm run check` — geprüft am 2026-09-10
- [x] 2 `uniforms.js` + Layout-Test (rot bei Array-Größe) — geprüft am 2026-09-10
- [x] 3 Road-Array 256 + roadCount-Grenze — geprüft am 2026-09-10
- [x] 4 Fehlerausgabe WGSL/WebGPU — geprüft am 2026-09-10
- [x] 5 Doku-Drift — geprüft am 2026-09-10

<!-- fertig: git mv Plan/Bugfix.md Plan/erledigt/ -->
