---
paths:
  - "app/src/roadgen.js"
  - "app/tests/roadgen.sanity.mjs"
---
# Thema: Straßennetz (Routing + Level)

## No-Gos
- NICHT das Straßen-Level je Straße auf die Steigung begrenzen, sondern im ganzen Netz (Punkte fremder Straßen < `NET_LINK` gekoppelt). Der Shader nimmt das nächstgelegene Segment → zwei verschiedene Rampen auf einer Trasse = Sägezahn.
- NICHT das Mittel der Abtrag-/Auftrag-Hüllen mit der Ziel-Steigung g bilden, sondern erst mit 2g, dann g. Mit g allein wird ein Sprung zur Rampe mit g/2 über die doppelte Länge → lange Dämme und Gräben.
- NICHT Steigung im Routing hart sperren. Ein Plateau ohne Lücke wäre unerreichbar.
- NICHT die Randzone nur über Kosten meiden, sondern im Routing sperren. Gegenüber Klippen-Kosten wird der Ring sonst zur billigen Rampe.
