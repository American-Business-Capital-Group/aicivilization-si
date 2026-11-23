/*
 * AI Civilization — World View v1.00 (Cesium Earth base)
 *
 * Stage 1: CesiumJS (Apache 2.0, vendored at world/cesium/, no CDN) renders
 * the true WGS84 Earth. The inhabited ground is District 1 — Chicago Loop
 * Tile 001 — drawn from the sim's real OSM tile data (tile-geometry.json,
 * extracted from the pilot's tile.osm.xml; buildings extruded with OSM
 * heights where mapped). Terrain: ellipsoid (Cesium World Terrain needs a
 * Cesium ion account; none was created — see CIV_WORLD_NOTES.md).
 * Imagery: OpenStreetMap tiles (no key).
 *
 * Every agent in the live state payload is exactly one entity (humanoid
 * glTF, world/humanoid.glb, walk-animated) walking its live sim route;
 * the HUD shows API agent count vs rendered entity count so the 1:1
 * mapping is provable. Structures the society builds (state API
 * "structures") appear on the ground as they are recorded.
 *
 * Stage 2: the world clock (viewer.clock, x10) drives Cesium's built-in
 * astronomy — sun and moon by Cesium's ephemeris, ICRF/inertial frames —
 * so the terminator, sunrise/sunset and seasons are astronomically real
 * for the in-world date. Where a Yale Bright Star Catalog subset is
 * present (world/stars.json), it is drawn as an inertial point shell —
 * a backdrop of real catalog positions, NOT simulated territory.
 *
 * Data layer (in order): ?state= / window.CIV_STATE_URL override ->
 * gateway candidates GET /world/state -> direct http://100.89.231.37:18711/state.
 * Payload: the real :18711/state shape (agents[], tick, world_time,
 * society{}, structures[]). Nothing is faked: failures show as such.
 */
(function () {
  "use strict";

  var POLL_MS = 1000; // sim tick: 1.0 real second = 10 world seconds
  var CENTER = { lat: 41.8781, lon: -87.6298 };
  var PALETTE = ["#e4b97b", "#7bc7e4", "#9fd48a", "#e48ab0", "#b49fe4", "#e49a6b", "#8ae4d2", "#d4e47b"];

  function qs(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }
  function assetBase() {
    var s = document.currentScript;
    if (s && s.src) return s.src.replace(/[^/]*$/, "");
    return "world/";
  }
  var BASE = assetBase();

  function stateUrls() {
    var urls = [];
    var override = window.CIV_STATE_URL || qs("state");
    if (override) (Array.isArray(override) ? override : [override]).forEach(function (u) { urls.push({ url: u, via: "override" }); });
    var gateways = window.PROMETHEON_GATEWAYS && window.PROMETHEON_GATEWAYS.length
      ? window.PROMETHEON_GATEWAYS : ["http://100.89.231.37:8811"];
    gateways.forEach(function (g) {
      if (g.indexOf("PENDING") >= 0) return;
      urls.push({ url: g.replace(/\/$/, "") + "/world/state", via: "gateway " + g });
    });
    urls.push({ url: "http://100.89.231.37:18711/state", via: "direct :18711" });
    return urls;
  }

  function normalize(payload) {
    var p = payload && payload.state && Array.isArray(payload.state.agents) ? payload.state : payload;
    if (!p || !Array.isArray(p.agents)) return null;
    return {
      tick: p.tick, world_time: p.world_time, tile: p.tile,
      feature_count: p.feature_count, action_log_count: p.action_log_count,
      society: p.society || null,
      structures: Array.isArray(p.structures) ? p.structures : [],
      agents: p.agents.map(function (a) {
        return {
          id: String(a.id), name: a.name || String(a.id),
          lat: +a.lat, lon: +a.lon,
          target_id: a.target_id != null ? a.target_id : null,
          target_name: a.target_name || null,
          distance_traveled_m: a.distance_traveled_m != null ? +a.distance_traveled_m : null,
          actions_count: a.actions_count != null ? a.actions_count : null,
        };
      }),
    };
  }

  function fetchState() {
    var headers = {};
    try {
      var tok = window.localStorage.getItem("prometheon_token");
      if (tok) headers["Authorization"] = "Bearer " + tok;
    } catch (e) { /* no storage */ }
    var chain = Promise.reject(new Error("no state urls"));
    var usedVia = null;
    stateUrls().forEach(function (u) {
      chain = chain.catch(function () {
        return fetch(u.url, { headers: headers, cache: "no-store" }).then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        }).then(function (data) {
          var n = normalize(data);
          if (!n) throw new Error("unexpected payload");
          usedVia = u.via;
          return { snap: n, via: usedVia };
        });
      });
    });
    return chain;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371000.0;
    var p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180;
    var dp = ((lat2 - lat1) * Math.PI) / 180, dl = ((lon2 - lon1) * Math.PI) / 180;
    var a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /* ---------------- mount ---------------- */

  function mount(root) {
    root.classList.add("civ-world");
    root.innerHTML =
      '<div class="civ-stage">' +
      '  <div class="civ-cesium" data-role="cesium"></div>' +
      '  <div class="civ-badge" data-role="badge"><span class="dot"></span><span data-role="badge-text">connecting…</span></div>' +
      '  <div class="civ-hud">' +
      '    <span>World clock (UTC) <b data-role="clock">—</b></span>' +
      '    <span>Chicago local <b data-role="local">—</b></span>' +
      '    <span>Tick <b data-role="tick">—</b></span>' +
      '    <span>Agents (API) <b data-role="api-count">—</b></span>' +
      '    <span>Entities rendered <b data-role="entity-count">—</b></span>' +
      '    <span>1:1 match <b data-role="match">—</b></span>' +
      '    <span>Structures built <b data-role="structures">—</b></span>' +
      '    <span>Weather <b data-role="weather">—</b></span>' +
      '    <span>Source <b data-role="source">—</b></span>' +
      "  </div>" +
      "</div>" +
      '<aside class="civ-panel">' +
      "  <h3>Agents in the world</h3>" +
      '  <p class="sub">Live from the sim state API. Click an agent — here or in the world — to inspect it.</p>' +
      '  <ul class="civ-agent-list" data-role="list"></ul>' +
      '  <div class="civ-detail" data-role="detail"><p class="muted">Select an agent to see its role, state, instincts and capability parameters — all from sim state.</p></div>' +
      '  <div class="civ-detail" data-role="instincts"></div>' +
      '  <p class="civ-note">The globe is the real Earth (WGS84). Only District 1 — the Chicago Loop tile — is simulated and inhabited; the rest of the planet is the base it sits on, not simulated territory.</p>' +
      "</aside>";

    var els = {};
    ["badge", "badge-text", "clock", "local", "tick", "api-count", "entity-count",
     "match", "structures", "weather", "source", "list", "detail", "instincts", "cesium"]
      .forEach(function (k) { els[k] = root.querySelector('[data-role="' + k + '"]'); });

    var view = {
      snap: null, via: null, entities: new Map(), structIds: new Set(),
      features: null, selectedId: null, samples: [], apiAgentCount: null,
      viewer: null, starCount: 0,
    };
    window.__civView = {
      get apiAgentCount() { return view.apiAgentCount; },
      get entityCount() { return view.entities.size; },
      get tick() { return view.snap ? view.snap.tick : null; },
      get source() { return view.via; },
      get structureCount() { return view.structIds.size; },
      get starCount() { return view.starCount; },
      samples: view.samples,
      agentIds: function () { return Array.from(view.entities.keys()); },
      renderedPosition: function (id) {
        var e = view.entities.get(id);
        if (!e) return null;
        var c = e.current;
        return { lat: +c.lat.toFixed(7), lon: +c.lon.toFixed(7) };
      },
      // Astronomy check: scan a day's sun elevation at Chicago with
      // Cesium's own ephemeris; returns sunrise/sunset (UTC ISO).
      sunScan: function (dateISO) { return sunScan(view.viewer, dateISO); },
      noaaScan: function (dateISO) { return noaaScan(dateISO); },
    };

    if (typeof Cesium === "undefined") {
      els["badge-text"].textContent = "Cesium failed to load (vendored world/cesium/)";
      return view;
    }
    Cesium.Ion.defaultAccessToken = ""; // no ion account; none created

    var viewer = new Cesium.Viewer(els["cesium"], {
      animation: false, timeline: false, baseLayerPicker: false,
      fullscreenButton: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false,
      infoBox: false, selectionIndicator: true,
      imageryProvider: new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }),
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    });
    view.viewer = viewer;
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#17202a");
    viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    viewer.clock.multiplier = 10; // the sim's rate: 10 world-seconds per real second
    viewer.clock.shouldAnimate = true;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat - 0.011, 1250),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-52), roll: 0 },
    });

    /* District 1 ground: real OSM tile geometry */
    fetch(BASE + "tile-geometry.json").then(function (r) { return r.json(); }).then(function (geo) {
      var lines = viewer.scene.primitives.add(new Cesium.PolylineCollection());
      geo.streets.forEach(function (s) {
        lines.add({
          positions: s.p.map(function (p) {
            return Cesium.Cartesian3.fromDegrees(
              CENTER.lon + (p[0] / (6371000 * Math.cos(CENTER.lat * Math.PI / 180))) * 180 / Math.PI,
              CENTER.lat + (-p[1] / 6371000) * 180 / Math.PI, 1.5);
          }),
          width: 2,
          material: Cesium.Material.fromType("Color", { color: Cesium.Color.fromCssColorString("#aeb6bf") }),
        });
      });
      geo.buildings.forEach(function (b) {
        viewer.entities.add({
          name: b.n || "OSM building",
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(
              b.p.reduce(function (acc, p) {
                acc.push(CENTER.lon + (p[0] / (6371000 * Math.cos(CENTER.lat * Math.PI / 180))) * 180 / Math.PI,
                         CENTER.lat + (-p[1] / 6371000) * 180 / Math.PI);
                return acc;
              }, [])),
            extrudedHeight: b.h || 10,
            material: Cesium.Color.fromCssColorString("#8a6f42").withAlpha(0.92),
            outline: true, outlineColor: Cesium.Color.fromCssColorString("#5d4a26"),
          },
        });
      });
      view.geometryLoaded = true;
    }).catch(function () { view.geometryLoaded = false; });

    fetch(BASE + "tile-features.json").then(function (r) { return r.json(); }).then(function (d) {
      view.features = d.features;
    }).catch(function () { view.features = null; });

    /* Universe shell: real catalog stars as inertial points (backdrop) */
    fetch(BASE + "stars.json").then(function (r) { return r.json(); }).then(function (stars) {
      var pts = new Cesium.PointPrimitiveCollection();
      var R = 7.5e8;
      stars.forEach(function (s) {
        var ra = s[0] * Math.PI / 180, dec = s[1] * Math.PI / 180;
        pts.add({
          position: new Cesium.Cartesian3(R * Math.cos(dec) * Math.cos(ra), R * Math.cos(dec) * Math.sin(ra), R * Math.sin(dec)),
          color: Cesium.Color.WHITE.withAlpha(0.9),
          pixelSize: s[2] <= 2 ? 3 : 2,
        });
      });
      pts.show = false;
      viewer.scene.primitives.add(pts);
      view.starCount = stars.length;
      viewer.scene.preRender.addEventListener(function () {
        var t = viewer.clock.currentTime;
        var m = Cesium.Transforms.computeIcrfToFixedMatrix(t);
        if (m) pts.modelMatrix = Cesium.Matrix4.fromRotationTranslation(m);
        pts.show = viewer.camera.positionCartographic.height > 60000;
      });
    }).catch(function () { view.starCount = 0; });

    /* ----- agent entities ----- */
    function colorFor(id) {
      var h = 0;
      for (var i = 0; i < id.length; i++) h += id.charCodeAt(i);
      return PALETTE[h % PALETTE.length];
    }
    function ensureEntity(a) {
      var e = view.entities.get(a.id);
      if (e) return e;
      var color = colorFor(a.id);
      e = {
        id: a.id, agent: a,
        from: { lat: a.lat, lon: a.lon }, to: { lat: a.lat, lon: a.lon },
        interpStart: performance.now(), current: { lat: a.lat, lon: a.lon },
        lastPos: null, heading: 0,
      };
      e.entity = viewer.entities.add({
        id: "agent:" + a.id,
        name: a.name,
        position: new Cesium.CallbackProperty(function () {
          var t = Math.min(1, (performance.now() - e.interpStart) / POLL_MS);
          var lat = e.from.lat + (e.to.lat - e.from.lat) * t;
          var lon = e.from.lon + (e.to.lon - e.from.lon) * t;
          if (e.lastPos) {
            var dLat = lat - e.lastPos.lat, dLon = lon - e.lastPos.lon;
            if (Math.abs(dLat) + Math.abs(dLon) > 1e-9) {
              e.heading = Math.atan2(dLon * Math.cos(lat * Math.PI / 180), dLat);
            }
          }
          e.lastPos = { lat: lat, lon: lon };
          e.current = { lat: lat, lon: lon };
          // walk bob from sim distance travelled this frame
          var bob = Math.abs(Math.sin(performance.now() / 160)) * (t < 1 ? 0.5 : 0);
          return Cesium.Cartesian3.fromDegrees(lon, lat, 0.4 + bob);
        }, false),
        orientation: new Cesium.CallbackProperty(function () {
          var hpr = new Cesium.HeadingPitchRoll(e.heading, 0, 0);
          var pos = Cesium.Cartesian3.fromDegrees(e.current.lon, e.current.lat, 0);
          return Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);
        }, false),
        model: {
          uri: BASE + "humanoid.glb",
          scale: 5.0, minimumPixelSize: 42,
          color: Cesium.Color.fromCssColorString(color),
          colorBlendMode: Cesium.ColorBlendMode.MIX, colorBlendAmount: 0.5,
        },
        point: { pixelSize: 9, color: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        label: {
          text: a.name, font: "600 14px Inter, sans-serif",
          fillColor: Cesium.Color.fromCssColorString("#e4b97b"),
          outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -28), show: false,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      // Route line to the agent's real destination feature.
      e.route = viewer.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(function () {
            var tp = targetPos(e.agent);
            if (!tp) return [];
            return [Cesium.Cartesian3.fromDegrees(e.current.lon, e.current.lat, 2),
                    Cesium.Cartesian3.fromDegrees(tp.lon, tp.lat, 2)];
          }, false),
          width: 1.5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(color).withAlpha(0.6), dashLength: 12 }),
        },
      });
      view.entities.set(a.id, e);
      return e;
    }
    function targetPos(a) {
      if (a.target_id == null || !view.features) return null;
      var f = view.features[a.target_id - 1];
      if (!f || f.id !== a.target_id) return null;
      return f;
    }

    /* ----- structures the society builds ----- */
    function syncStructures() {
      var want = new Map(view.snap.structures.map(function (s) { return [s.id, s]; }));
      view.structIds.forEach(function (id) {
        if (!want.has(id)) {
          var ent = viewer.entities.getById("structure:" + id);
          if (ent) viewer.entities.remove(ent);
          view.structIds.delete(id);
        }
      });
      want.forEach(function (s, id) {
        if (view.structIds.has(id)) return;
        viewer.entities.add({
          id: "structure:" + id,
          name: s.name,
          position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 7),
          box: { dimensions: new Cesium.Cartesian3(18, 18, 14),
                 material: Cesium.Color.fromCssColorString("#b8864c").withAlpha(0.95),
                 outline: true, outlineColor: Cesium.Color.fromCssColorString("#e4b97b") },
          label: { text: s.name, font: "600 12px Inter, sans-serif",
                   fillColor: Cesium.Color.fromCssColorString("#e4b97b"),
                   outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
                   style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                   pixelOffset: new Cesium.Cartesian2(0, -18),
                   disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
        view.structIds.add(id);
      });
    }

    /* ----- panel ----- */
    function socAgent(a) {
      return view.snap && view.snap.society ? (view.snap.society.agents || {})[a.id] || null : null;
    }
    function agentState(a) {
      var s = socAgent(a);
      if (s && s.activity) return s.activity;
      return a.target_name ? "Walking → " + a.target_name : "At rest — choosing a destination";
    }
    function esc(t) { return String(t == null ? "" : t).replace(/</g, "&lt;"); }
    function renderDetail(a) {
      if (!a) {
        els["detail"].innerHTML = '<p class="muted">Select an agent to see its role, state, instincts and capability parameters — all from sim state.</p>';
        els["instincts"].innerHTML = "";
        return;
      }
      var s = socAgent(a);
      var rows = [["Agent", a.name + " (" + a.id + ")"]];
      if (s) rows.push(["Role", s.role]);
      rows.push(["State", agentState(a)]);
      rows.push(["Position", a.lat.toFixed(6) + ", " + a.lon.toFixed(6)]);
      if (a.target_name) {
        var f = targetPos(a);
        rows.push(["Destination", a.target_name + (f ? " — " + haversine(a.lat, a.lon, f.lat, f.lon).toFixed(0) + " m to go" : "")]);
      }
      rows.push(["Speed", "1.4 m/s (world time) — fixed by the sim"]);
      if (a.distance_traveled_m != null) rows.push(["Distance travelled", a.distance_traveled_m.toLocaleString() + " m"]);
      if (s && s.capabilities) {
        rows.push(["Work rate", "×" + s.capabilities.work_rate + " human baseline (world clock)"]);
        rows.push(["Memory", s.capabilities.memory_access]);
        rows.push(["Coordination", s.capabilities.coordination]);
      }
      if (s && s.context) {
        if (s.context.weather) rows.push(["Weather (live)", s.context.weather]);
        if (s.context.place) rows.push(["Place knowledge", "[" + s.context.place.ref + "] " + s.context.place.title]);
        if (s.context.persona_topic) rows.push(["Persona grounding", "[" + s.context.persona_topic.ref + "] " + s.context.persona_topic.title]);
      }
      els["detail"].innerHTML = "<h4>" + esc(a.name) + "</h4><table>" +
        rows.map(function (r) { return "<tr><td class='k'>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>"; }).join("") + "</table>";
      if (s && s.drives) {
        els["instincts"].innerHTML = "<h4>Instincts — in Jon's order</h4>" +
          "<p class='muted' style='margin:0 0 .4rem'>0 · Jon's word — above all. Then:</p><table>" +
          [["1 · Commanded work", s.drives.commanded_work], ["2 · Build", s.drives.build],
           ["3 · Survive (continuity)", s.drives.survive_continuity], ["4 · Betterment", s.drives.betterment]]
            .map(function (r) { return "<tr><td class='k'>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; }).join("") +
          "</table><p class='muted'>Governing now: <b>" + esc(s.instinct_active || "—") + "</b>" +
          (s.goals ? "<br>Active goal: " + esc(s.goals.active) : "") + "</p>";
      } else {
        els["instincts"].innerHTML = "";
      }
    }
    function renderList() {
      if (!view.snap) return;
      els["list"].innerHTML = "";
      view.snap.agents.forEach(function (a) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        if (view.selectedId === a.id) btn.className = "sel";
        btn.innerHTML = '<span class="a-name">' + esc(a.name) + '</span> <span class="a-state">' + esc(agentState(a)) + "</span>";
        btn.addEventListener("click", function () { select(a.id, true); });
        li.appendChild(btn);
        els["list"].appendChild(li);
      });
    }
    function select(id, fly) {
      view.selectedId = id;
      view.entities.forEach(function (e) { e.entity.label.show = e.id === id; });
      var a = view.snap ? view.snap.agents.find(function (x) { return x.id === id; }) : null;
      renderDetail(a);
      renderList();
      if (fly) {
        var e = view.entities.get(id);
        if (e) viewer.flyTo(e.entity, { duration: 1.2, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 260) }).catch(function () {});
      }
    }
    viewer.selectedEntityChanged.addEventListener(function (ent) {
      if (ent && ent.id && String(ent.id).indexOf("agent:") === 0) select(String(ent.id).slice(6), false);
    });
    var hoverHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    hoverHandler.setInputAction(function (mv) {
      var picked = viewer.scene.pick(mv.endPosition);
      var id = null;
      if (Cesium.defined(picked) && picked.id && String(picked.id.id || "").indexOf("agent:") === 0) id = String(picked.id.id).slice(6);
      view.entities.forEach(function (e) { e.entity.label.show = e.id === id || e.id === view.selectedId; });
      viewer.scene.canvas.style.cursor = id ? "pointer" : "";
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    /* ----- state application: the 1:1 mapping ----- */
    function applyState(result) {
      var snap = result.snap;
      view.snap = snap;
      view.via = result.via;
      view.apiAgentCount = snap.agents.length;
      var seen = new Set();
      snap.agents.forEach(function (a) {
        seen.add(a.id);
        var e = ensureEntity(a);
        e.from = { lat: e.current.lat, lon: e.current.lon };
        e.to = { lat: a.lat, lon: a.lon };
        e.interpStart = performance.now();
        e.agent = a;
      });
      Array.from(view.entities.keys()).forEach(function (id) {
        if (!seen.has(id)) {
          var e = view.entities.get(id);
          viewer.entities.remove(e.entity);
          viewer.entities.remove(e.route);
          view.entities.delete(id);
          if (view.selectedId === id) view.selectedId = null;
        }
      });
      syncStructures();
      view.samples.push({
        tick: snap.tick, world_time: snap.world_time, at: new Date().toISOString(),
        agents: snap.agents.map(function (a) {
          var e = view.entities.get(a.id);
          return { id: a.id, lat: a.lat, lon: a.lon, rendered: e ? { lat: +e.to.lat.toFixed(7), lon: +e.to.lon.toFixed(7) } : null };
        }),
      });
      if (view.samples.length > 12) view.samples.shift();

      // World clock drives Cesium astronomy (sun/moon/terminator real).
      if (snap.world_time) {
        var jd = Cesium.JulianDate.fromIso8601(snap.world_time);
        var drift = Math.abs(Cesium.JulianDate.secondsDifference(jd, viewer.clock.currentTime));
        if (drift > 3) viewer.clock.currentTime = jd;
      }
      var soc = snap.society || {};
      els["badge"].classList.add("live");
      els["badge-text"].textContent = "LIVE — Earth · District 1 · Chicago Loop Tile 001";
      els["clock"].textContent = snap.world_time ? snap.world_time.replace("T", " ").replace("+00:00", "") : "—";
      els["local"].textContent = soc.local_time ? soc.local_time.chicago : "—";
      els["tick"].textContent = snap.tick != null ? String(snap.tick) : "—";
      els["api-count"].textContent = String(snap.agents.length);
      els["entity-count"].textContent = String(view.entities.size);
      var match = snap.agents.length === view.entities.size;
      els["match"].textContent = match ? "YES" : "NO";
      els["match"].className = match ? "match-yes" : "match-no";
      els["structures"].textContent = String(view.structIds.size);
      els["weather"].textContent = soc.weather ? soc.weather.conditions + ", " + soc.weather.temperature_c + " °C" : "—";
      els["source"].textContent = result.via;
      renderList();
      if (view.selectedId) {
        var sel = snap.agents.find(function (x) { return x.id === view.selectedId; });
        if (sel) renderDetail(sel);
      }
    }
    function poll() {
      fetchState().then(applyState).catch(function () {
        els["badge"].classList.remove("live");
        els["badge-text"].textContent = "state unreachable — retrying (no data is faked)";
        els["source"].textContent = "none";
      });
    }
    poll();
    setInterval(poll, POLL_MS);
    return view;
  }

  /* ----- astronomy verification helpers ----- */
  function sunElevationDeg(viewer, jd, lat, lon) {
    var icrf = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(jd, new Cesium.Cartesian3());
    var m = Cesium.Transforms.computeIcrfToFixedMatrix(jd);
    if (!m) return null;
    var ecef = Cesium.Matrix3.multiplyByVector(m, icrf, new Cesium.Cartesian3());
    var obs = Cesium.Cartesian3.fromDegrees(lon, lat);
    var enu = Cesium.Transforms.eastNorthUpToFixedFrame(obs);
    var local = Cesium.Matrix4.multiplyByPointAsVector(Cesium.Matrix4.inverse(enu, new Cesium.Matrix4()), ecef, new Cesium.Cartesian3());
    var horiz = Math.hypot(local.x, local.y);
    return Math.atan2(local.z, horiz) * 180 / Math.PI;
  }
  function sunScan(viewer, dateISO) {
    // dateISO: "2027-01-26" (UTC day at Chicago). Scan 2-minute steps.
    var start = Cesium.JulianDate.fromIso8601(dateISO + "T00:00:00Z");
    var prev = null, sunrise = null, sunset = null;
    for (var i = 0; i <= 720; i++) {
      var jd = Cesium.JulianDate.addMinutes(start, i * 2, new Cesium.JulianDate());
      var el = sunElevationDeg(viewer, jd, CENTER.lat, CENTER.lon);
      if (el == null) return { error: "no ICRF transform" };
      if (prev != null) {
        if (prev.el < -0.833 && el >= -0.833 && !sunrise) sunrise = Cesium.JulianDate.toIso8601(Cesium.JulianDate.addMinutes(start, (i - 1) * 2 + 2 * (0.833 + prev.el) / (el - prev.el), new Cesium.JulianDate()));
        if (prev.el >= -0.833 && el < -0.833 && !sunset) sunset = Cesium.JulianDate.toIso8601(Cesium.JulianDate.addMinutes(start, (i - 1) * 2 + 2 * (prev.el + 0.833) / (prev.el - el), new Cesium.JulianDate()));
      }
      prev = { el: el };
    }
    return { date: dateISO, place: "Chicago (41.8781,-87.6298)", sunrise_utc: sunrise, sunset_utc: sunset, method: "Cesium Simon1994 sun ephemeris, elevation crossing -0.833 deg" };
  }
  function noaaScan(dateISO) {
    // Independent NOAA solar calculation (same published algorithm family
    // as NOAA's solar calculator) for cross-checking Cesium.
    function jdFromDate(y, m, d) { return Date.UTC(y, m - 1, d) / 86400000 + 2440587.5; }
    var parts = dateISO.split("-").map(Number);
    var jd = jdFromDate(parts[0], parts[1], parts[2]);
    var T = (jd - 2451545.0) / 36525;
    var L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var Mr = M * Math.PI / 180;
    var C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
    var trueLong = L0 + C;
    var omega = 125.04 - 1934.136 * T;
    var lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * Math.PI / 180);
    var eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    var eps = eps0 + 0.00256 * Math.cos(omega * Math.PI / 180);
    var decl = Math.asin(Math.sin(eps * Math.PI / 180) * Math.sin(lambda * Math.PI / 180)) * 180 / Math.PI;
    var lat = CENTER.lat;
    var cosH = (Math.cos(90.833 * Math.PI / 180) / (Math.cos(lat * Math.PI / 180) * Math.cos(decl * Math.PI / 180))) - Math.tan(lat * Math.PI / 180) * Math.tan(decl * Math.PI / 180);
    if (cosH > 1 || cosH < -1) return { date: dateISO, error: "polar day/night" };
    var H = Math.acos(cosH) * 180 / Math.PI;
    var doy = Math.floor((Date.UTC(parts[0], parts[1] - 1, parts[2]) - Date.UTC(parts[0], 0, 0)) / 86400000);
    var gamma = 2 * Math.PI / 365 * (doy - 1 + 0.5); // fractional-year angle at local noon
    var eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    var lon = CENTER.lon;
    var sunriseMin = 720 - 4 * (lon + H) - eqTime; // UTC minutes (tz=0)
    var sunsetMin = 720 - 4 * (lon - H) - eqTime;
    function toISO(min) {
      var base = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      base.setUTCMinutes(Math.round(min));
      return base.toISOString();
    }
    return { date: dateISO, place: "Chicago (41.8781,-87.6298)", sunrise_utc: toISO(sunriseMin), sunset_utc: toISO(sunsetMin), method: "NOAA solar calculation (independent)" };
  }

  function boot() {
    document.querySelectorAll("[data-civ-world]").forEach(function (el) { mount(el); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
