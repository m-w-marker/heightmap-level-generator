# Verhaltensregeln (aus den Claude-Code-Regeln adaptiert)

**Grundprinzip:** Lieber vorsichtig als schnell. Bei einfachen Aufgaben gesunden Menschenverstand nutzen.

0. **Eine Frage ist kein Auftrag.** „Kann man…?", „Wie würdest du…?", „Was hältst du von…?" = Gespräch,
   nicht Startsignal: antworten, dann warten. Umfang folgt der Frage – kurze Frage, kurze Antwort,
   keine Code-Archäologie, keine Pläne, solange nur gefragt wurde.
   **Vor dem ersten Schreibzugriff** kurz sagen, was ich vorhabe, und **freigeben lassen** – auch bei
   Kleinigkeiten; die Größe der Änderung entscheidet das nicht, der Auftrag tut es.
   Ausnahme: expliziter Auftrag („mach das", „bau ein", „fix das").

1. **Erst denken, dann coden.** Annahmen explizit nennen, nicht still wählen. Mehrere Interpretationen?
   Alle vorstellen. Einfacherer Weg? Nennen. Etwas unklar? Stoppen, benennen, nachfragen.

2. **Einfachheit zuerst.** Minimaler Code, der das Problem löst, nichts Spekulatives: keine ungefragten
   Features, keine Abstraktion für einmaligen Code, keine ungeforderte Konfigurierbarkeit, kein
   Error-Handling für unmögliche Fälle. Wenn 200 Zeilen auch mit 50 gehen: neu schreiben.
   Test: „Fände ein erfahrener Entwickler das zu kompliziert?"
   Bevor etwas Neues entsteht, die Leiter runter: Gibt es das schon im Projekt (zuerst im geteilten
   Code)? Reicht die Standardbibliothek oder ein Plattform-Feature? Löst es eine bereits installierte
   Abhängigkeit? Erst dann selbst bauen, eine neue Abhängigkeit nur, wenn keine Stufe darüber trägt.

3. **Kommentare kurz, das Warum.** Ein bis zwei Sätze zu dem, was man dem Code nicht ansieht (Falle,
   Messung, Entscheidung gegen das Naheliegende) – keine Nacherzählung, keine Kommentar-Blöcke, keine
   Daten oder Testprotokolle (das sagt `git log`). Deutlich unter 1 Kommentarzeile je 5 Zeilen Code.
   Die Tiefe gehört in die Doku, der Code trägt einen **Zeiger**: `// → Plan/NNN §x` (Befund im Plan)
   oder `// → verhaltensregeln #N` (Regel-N in `.clinerules/`). Der Zeiger ersetzt Blöcke ab 3 Zeilen;
   an einen Ein-Zeiler wird er nur angehängt. Doppelt gepflegt heißt: eine Fassung ist bald falsch,
   und das ist die im Code.
   Bewusst zu einfach gebaut, mit bekannter Grenze? Der Kommentar beginnt mit `// vereinfacht:` und
   nennt **Decke und Auslöser**: `// vereinfacht: O(n²) über alle Einträge – ab ~150 Grid`.
   Das Präfix ist greppbar, damit aus der Abkürzung keine stille Dauerlösung wird.

4. **Chirurgische Änderungen.** Nur anfassen, was nötig ist: angrenzenden Code nicht „verbessern",
   nichts refaktorieren, das nicht kaputt ist, bestehenden Stil übernehmen, vorhandenen toten Code
   erwähnen, nicht löschen. Jede geänderte Zeile muss auf die Anfrage zurückführbar sein.
   Eigenen Dreck aufräumen: was durch **meine** Änderung überflüssig wurde, fliegt raus – vorher nennen
   und freigeben lassen. Einsortieren statt raten: „War es vor meiner Änderung lebendig?" ja → mein
   Dreck · nein → bleibt liegen. „Brauchen wir später wieder" ist eine Behauptung – erst greppen (gibt
   es den Aufrufer noch? kann eine andere Stelle das längst?). Was bleibt, obwohl es woanders schon
   geht, ist eine zweite Wahrheit.

5. **Zielorientiert.** Bei Mehrschritt-Aufgaben kurzen Plan nennen, ein Erfolgskriterium pro Schritt:
   `1. [Schritt] → Prüfung: [Check]`. Wiederholen, bis verifiziert.

6. **Geteiltes aufbrechen: vorher greppen, hinterher eng prüfen.** Die teuren Fehler sind keine
   Denkfehler, sondern gebrochene Annahmen an anderer Stelle. Wer Geteiltes ändert (Format, Schlüssel,
   Konstante, Paket, Identität), grept **erst die Konsumenten**.
   Hinterher ein Durchgang über den **eigenen Diff**, drei Fragen: (1) Welche Annahme woanders bricht
   das? (2) Ist beim Umbauen etwas verlorengegangen (Reihenfolge, Zeile)? (3) Verstößt etwas gegen eine
   Regel dieser Datei oder aus `.clinerules/`? Gefundenes direkt fixen. Eng bleiben: nur der eigene Diff,
   kein Vollaudit.
   **Fehler an der Wurzel fixen.** Ein Report nennt ein Symptom. Wer die Funktion anfasst, grept ihre
   Aufrufer und repariert einmal an der geteilten Stelle – ein Guard dort ist ein kleinerer Diff als
   einer je Aufrufer, und ein Fix nur auf dem gemeldeten Pfad lässt die Geschwister kaputt.

## Scope-Regel
> Es wird in Milestones gebaut, jede Stufe ist lauffähig, bevor die nächste beginnt. Nichts aus einem
> späteren Milestone wird vorher vorbereitet, angelegt oder „schon mal mitgedacht".

## Arbeitsweise
Vor jedem Task die Docs des aktuellen Milestones lesen und `Plan/` prüfen. Neue Features und Änderungen
an Entscheidungen laufen über einen Plan (`Plan/_TEMPLATE.md`), nie direkt in den Code. Fertige Pläne
wandern per `git mv` nach `Plan/erledigt/`. **Was fertig ist, sagt `git log`; was offen ist, steht im
jeweiligen Plan – in CLAUDE.md steht kein Status.**

## Code-Qualitäts-Check (auf Anfrage)
Auf „Führe Code-Qualitäts-Check durch":
1. **Redundanz:** doppelte Logik, gleiche Berechnungen/Schleifen/Bedingungen
2. **Zu lange Methoden:** alle Methoden > 60 Zeilen – Kandidaten zum Aufbrechen
3. **Toter Code:** ungenutzte Imports/Felder/Methoden, `//TODO`/`//FIXME`, auskommentierte Blöcke
4. **Duplikate:** fast-identische Code-Blöcke (> 10 Zeilen) in verschiedenen Dateien
5. **Bericht:** Tabelle mit Dateipfad, Zeile, Fund-Typ, Verbesserungsvorschlag
