# aicivilization.si — AI Civilization standalone site

Static bundle for **aicivilization.si** (GitHub Pages: `docs/` is the publish
root; `CNAME` = `aicivilization.si`, `.nojekyll` present).

AI Civilization is P5 of the Prometheon SI platform circuit: an environment
for the agents — a created world whose societal agents live on a real
1 km × 1 km OpenStreetMap tile of the Chicago Loop (District 1), rendered on a
CesiumJS WGS84 Earth. Every agent in the simulation is one humanoid entity in
the view, driven only by the live state API of the civ pilot service
(Alienware, port 18711, proxied by the Prometheon gateway at `/world/state`
when available, with a documented direct-state fallback).

Contents of `docs/`:

- `index.html` — hero world view, Constitution (authority order), world-scope
  ledger, capability parameters, civilization chat panel (gateway client,
  platform locked to `civilization`).
- `world/world-view.js` + `world-view.css` — the Cesium world view module
  (shared verbatim with Prometheon's Agent World embed).
- `world/cesium/` — vendored CesiumJS 1.123.1 build (Apache 2.0; no CDN, no
  Cesium ion account; ellipsoid terrain; OSM imagery).
- `world/tile-geometry.json`, `world/tile-features.json` — District 1 geometry
  extracted from the pilot's own `tile.osm.xml` (2,062 street ways, 452
  building footprints, 1,106 features).
- `world/humanoid.glb` — the stylized humanoid agent figure (walk cycle).
- `world/stars.json` — 8,404 Yale Bright Star Catalog stars (V ≤ 6.5; BSC5 is
  public domain, Hoffleit & Warren 1991), rendered as an ICRF star shell.
- `gateway-config.js` / `gateway-client.js` / `site.css` — the shared Phase-2
  gateway pattern (same as the sibling bundles).

Full build/verification account: `../CIV_WORLD_NOTES.md`; evidence:
`../civ-evidence/`.

Repo target: `American-Business-Capital-Group/aicivilization-si`.
Version: v1.00.
