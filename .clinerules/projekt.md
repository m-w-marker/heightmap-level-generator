# Projekt-Regeln

Zu Beginn jeder Session:
1. Lies `CLAUDE.md` im Projekt-Root (Struktur, Stack, Konventionen, Pitfalls, No-Gos, Themen-Tabelle).
2. Lies den Plan des aktuellen Milestones aus `Plan/` (offene Punkte stehen dort).
3. Für das anstehende Thema: die in der CLAUDE.md-Themen-Tabelle genannte `rules/<thema>.md` vollständig lesen.
4. Was fertig ist, sagt `git log`; was offen ist, steht im jeweiligen Plan — **nicht** in CLAUDE.md.

## Doku-Pflicht (vor dem Commit, in dieser Reihenfolge)
1. `rules/<thema>.md` der betroffenen Themen ergänzen: was gebaut, welche Funktion, welcher Test,
   was bewusst NICHT — und warum.
2. Neue Regel = „NICHT…"-Satz mit Datum + Zeiger in den No-Gos von CLAUDE.md **und** Begründung
   in `rules/<thema>.md` — beide Stellen, nie nur eine.
3. Neue Datei angelegt = Zeile in der CLAUDE.md-Themen-Tabelle.
4. Am Ende der Antwort die geänderten Doku-Dateien auflisten. Fehlt die Liste, ist die Aufgabe nicht fertig.
