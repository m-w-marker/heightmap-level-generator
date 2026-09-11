# Verhaltensregeln

Reihenfolge = Priorität. Kurze Frage → kurze Antwort.

1. **Frage ≠ Auftrag.** „Kann man…?", „Was hältst du von…?" → antworten, nichts ändern, warten.
   „Mach / bau / fix …" → umsetzen.
2. **Ein Plan-Schritt pro Durchgang:** umsetzen → Prüfung ausführen → Ausgabe zeigen → auf Freigabe warten.
3. **Fertig heißt: `npm run check` ist grün** (in `app/`). Ausgabe zeigen, nicht behaupten.
   Solange es `check` noch nicht gibt: `npm run sanity` + `npm run build`.
4. **Unklar → fragen, nicht raten.** Annahmen in einem Satz nennen.
5. **Minimal.** Nur was der Auftrag verlangt: keine Extra-Features, keine Abstraktion auf Vorrat, kein
   Error-Handling für Unmögliches. Erst prüfen, ob Projekt oder Plattform es schon können.
6. **Chirurgisch.** Nur anfassen, was der Auftrag braucht. Stil übernehmen. Fremden toten Code melden, nicht löschen.
7. **Geteiltes ändern** (Struct-Feld, Konstante, Format) → erst alle Nutzer greppen, alle im selben Zug anpassen.
8. **Größen, Offsets, Anzahlen aus Konstanten berechnen**, nie als Zahl hinschreiben.
9. **Scope:** nur der aktuelle Plan-Schritt, nichts für spätere vorbereiten.
10. **Datum** aus `git log -1 --format=%ad --date=short`, nie schätzen.

## Kommentare
- Kurz, nur das Warum (Falle, Entscheidung). Keine Nacherzählung, keine Kommentar-Blöcke.
- Längeres gehört in die Doku, im Code steht nur ein Zeiger: `// → .clinerules/<thema>.md` oder `// → Plan/<Datei>.md`
- Bewusste Abkürzung: `// vereinfacht: <Grenze> – ab <Auslöser>` (greppbar)

## Code-Qualitäts-Check (nur auf Anfrage)
Suchen: bugs · doppelte Logik · Methoden > 60 Zeilen · toter Code / TODO / auskommentierte Blöcke · Duplikate > 10 Zeilen.
Bericht als Tabelle: Datei | Zeile | Fund | Vorschlag.
