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
- NICHT den Wasser-Boden (See/Fluss) am Punkt mit großem Umkreis suchen, sondern entlang der ganzen Nachbarsegmente mit halber Fahrbahn. Großer Umkreis hob eine Straße im Einschnitt neben einem Bergsee um 29 m; halbe Segmente ließen die Interpolation zum Nachbarn über dem Wasser wieder absinken.
- NICHT unbegrenzt über See/Fluss anheben, sondern nur bis `RAISE_MAX` unter dem Spiegel. Tiefer liegt die Straße im Einschnitt; der Shader hält abgesenktes Gelände trocken.
- NICHT den örtlichen Wasser-Boden nur vor `limitGrade` setzen, sondern danach nachklemmen. Die Hüllen halten nur einen überall gleichen Boden (waterLevel), einen örtlichen tragen sie ab.
