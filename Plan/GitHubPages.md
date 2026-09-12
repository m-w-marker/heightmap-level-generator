# Plan: GitHub Pages

**Status:** in Arbeit
**Datum:** 2026-09-11

## Ziel
Das Tool direkt aus dem GitHub-Repo im Browser nutzbar machen (GitHub Pages), Link im README.

## Entscheidungen
- GitHub Pages statt eigenem Webspace → kostenlos, HTTPS automatisch (WebGPU braucht Secure Context), Build per Actions.
- Username vorher `MichaMaGit` → `m-w-marker` (macht der User auf github.com) → alte `*.github.io`-Adresse wird nicht umgeleitet, daher vor dem Verteilen des Links.
- `base: './'` → läuft unter `m-w-marker.github.io/heightmap-level-generator/` und später auch mit eigener Domain (z.B. `heightmap.mmarker.de`).
- Build nur in Actions, `dist/` nicht ins Repo.
- Repo ist öffentlich (Pages für private Repos nur mit Pro).

## Meilensteine (jede Stufe lauffähig, bevor die nächste beginnt)
1. User: GitHub-Username auf `m-w-marker` ändern, Repo öffentlich → danach `git remote set-url origin https://github.com/m-w-marker/heightmap-level-generator.git` (optional `git config user.name m-w-marker`) → Prüfung: `git remote -v`, `git fetch` ok
2. `app/vite.config.js` mit `base: './'` → Prüfung: `npm run build`, `npx vite preview` lädt aus Unterpfad
3. WebGPU-Hinweis, wenn `navigator.gpu` fehlt → Prüfung: sichtbarer Text statt leerer Seite
4. `.github/workflows/pages.yml` (npm ci + build in `app/`, deploy `app/dist`); User: Settings → Pages → Source „GitHub Actions“ → Prüfung: Workflow grün, Seite läuft
5. Link im README → Prüfung: Link öffnet das Tool

## Abgeschlossen
- [x] P1 Username + Remote (m-w-marker, Repo öffentlich, fetch ok) — geprüft am 2026-09-12
- [x] P2 Vite base (dist aus `/heightmap-level-generator/` headless: rendert, keine 404 außer favicon) — geprüft am 2026-09-12
- [x] P3 WebGPU-Hinweis (auch bei stillem WebGL-Fallback von three; headless ohne `navigator.gpu`) — geprüft am 2026-09-12
- [ ] P4 Pages-Workflow (Datei steht; `npm run sanity` + `build`, naga nur lokal) — geprüft am
- [ ] P5 README-Link — geprüft am

<!-- fertig: git mv Plan/<Datei>.md Plan/erledigt/ -->
