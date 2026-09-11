# Plan: GitHub Pages

**Status:** offen
**Datum:** 2026-09-11

## Ziel
Das Tool direkt aus dem GitHub-Repo im Browser nutzbar machen (GitHub Pages), Link im README.

## Entscheidungen
- GitHub Pages statt eigenem Webspace → kostenlos, HTTPS automatisch (WebGPU braucht Secure Context), Build per Actions.
- Username vorher `MichaMaGit` → `mwmarker` (macht der User auf github.com) → alte `*.github.io`-Adresse wird nicht umgeleitet, daher vor dem Verteilen des Links.
- `base: './'` → läuft unter `mwmarker.github.io/heightmap-level-generator/` und später auch mit eigener Domain (z.B. `heightmap.mmarker.de`).
- Build nur in Actions, `dist/` nicht ins Repo.
- Offen: Repo muss öffentlich sein (Pages für private Repos nur mit Pro).

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)
1. User: GitHub-Username auf `mwmarker` ändern, Repo öffentlich → danach `git remote set-url origin https://github.com/mwmarker/heightmap-level-generator.git` (optional `git config user.name mwmarker`) → Prüfung: `git remote -v`, `git fetch` ok
2. `app/vite.config.js` mit `base: './'` → Prüfung: `npm run build`, `npx vite preview` lädt aus Unterpfad
3. WebGPU-Hinweis, wenn `navigator.gpu` fehlt → Prüfung: sichtbarer Text statt leerer Seite
4. `.github/workflows/pages.yml` (npm ci + build in `app/`, deploy `app/dist`); User: Settings → Pages → Source „GitHub Actions“ → Prüfung: Workflow grün, Seite läuft
5. Link im README → Prüfung: Link öffnet das Tool

## Abgeschlossen
- [ ] P1 Username + Remote — geprüft am
- [ ] P2 Vite base — geprüft am
- [ ] P3 WebGPU-Hinweis — geprüft am
- [ ] P4 Pages-Workflow — geprüft am
- [ ] P5 README-Link — geprüft am

<!-- fertig: git mv Plan/<Datei>.md Plan/erledigt/ -->
