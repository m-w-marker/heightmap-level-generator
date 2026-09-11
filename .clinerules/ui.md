---
paths:
  - "app/src/ui.js"
  - "app/index.html"
---
# Thema: Panel (lil-gui + Toolbar)

## No-Gos
- NICHT lil-gui-Elemente per `hidden`-Attribut ausblenden, sondern mit `gui.show(bool)`. Das lil-gui-CSS übersteuert `[hidden]`, dann bleiben alle Tabs sichtbar.
- NICHT Presets über `gui.reset()` setzen, sondern über `Object.assign(params, DEFAULTS, overrides)` + `panel.refresh()`. Der Seed liegt außerhalb von lil-gui, und `reset()` löst jeden onChange einzeln aus.
- NICHT Regler-Labels als JSON-Schlüssel verwenden. Labels sind lesbar und dürfen sich ändern, Save-Dateien und Tests nutzen den Schlüssel (`data-key`).
