/* Tether renderer: canvas sizing, view transform, layers, HUD. Reads state, never writes it. */
var TetherRender = (function () {
  "use strict";
  var G = TetherGame;
  var T = G.TUNING;
  var HUD_H = 88;
  var COL = {
    bg: "#05070d", ore: "#9aa3ad", ice: "#bfe8ff", crystal: "#ff3fd2", tether: "#38d6ff", tetherDim: "#0e4f63",
    ok: "#43e08a", bad: "#ff5a5a", text: "#e8f0ff", dim: "#6b7a90", station: "#ffd166", warn: "#ffb020"
  };
  var REASON = {
    no_power: "Not enough power", too_long: "Too far", too_short: "Too close", target_tethered: "Already tethered",
    target_depleted: "That rock is empty", target_offscreen: "Wait until it is on screen", tether_cap: "Too many tethers",
    source_unpowered: "That relay has no power", relay_cap: "Relay limit reached", too_deep: "Relay chain too long",
    not_tethered: "Tether it first"
  };

  var canvas, ctx, probe;
  var view = { scale: 1, offX: 0, offY: 0, dpr: 1, cssW: 360, cssH: 640, safe: { l: 0, t: 0, r: 0, b: 0 },
               hudX: 0, hudW: 360, hudY: 0 };
  var stars = [];
  var particles = [];
  var floats = [];
  var shapeCache = {};
  var arcs = [];
  var banner = null;     // { text, t0 } big sector title
  var curState = null;
  var warpAt = 0;        // performance time when the warp started, 0 = not warping

  function init(c) {
    canvas = c;
    ctx = canvas.getContext("2d", { alpha: false });
    probe = document.getElementById("safe-probe");
    var seed = 1234567;
    for (var i = 0; i < 70; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      var x = (seed >>> 8) / 16777216;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      var y = (seed >>> 8) / 16777216;
      stars.push({ x: x, y: y, s: 0.4 + (i % 3) * 0.4, a: 0.25 + (i % 4) * 0.12 });
    }
    resize();
  }

  function readSafe() {
    var cs = getComputedStyle(probe);
    view.safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0,
                  b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }

  function resize() {
    readSafe();
    var cssW = window.innerWidth, cssH = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    var sf = view.safe;
    var safeW = cssW - sf.l - sf.r, safeH = cssH - sf.t - sf.b;
    var scale = Math.min(safeW / T.world.w, (safeH - HUD_H) / T.world.h);
    var fieldW = T.world.w * scale, fieldH = T.world.h * scale;
    var leftover = safeH - HUD_H - fieldH;
    view.scale = scale; view.dpr = dpr; view.cssW = cssW; view.cssH = cssH;
    view.offX = sf.l + (safeW - fieldW) / 2;
    view.offY = sf.t + HUD_H + Math.min(40, leftover / 2);
    view.hudX = view.offX; view.hudW = fieldW; view.hudY = sf.t;
  }

  function toWorld(cx, cy) {
    return { x: (cx - view.offX) / view.scale, y: (cy - view.offY) / view.scale };
  }

  // ---- effects (driven from events)

  function addFloat(x, y, text, color, life) {
    floats.push({ x: x, y: y, text: text, color: color, life: life || 1 });
    if (floats.length > 12) floats.shift();
  }
  function addBurst(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = (i / n) * 6.2832 + x;
      var sp = 20 + (i % 3) * 18;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, color: color });
    }
    while (particles.length > 150) particles.shift();
  }

  function setBanner(text, now) { banner = { text: text, t0: now }; }

  function handleEvents(events, state) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.type === "delivery") addFloat(e.x, e.y - 30, "+" + Math.round(e.value * 10), COL[e.resource] || COL.text);
      else if (e.type === "tether_cut") addBurst(e.x, e.y, e.reason === "player" ? "#ffffff" : COL.warn, 6);
      else if (e.type === "rock_depleted") addBurst(e.x, e.y, COL.dim, 8);
      else if (e.type === "station_repaired") addFloat(180, 520, "+" + Math.round(e.amount * 10) / 10 + " hull", COL.ok);
      else if (e.type === "relay_created") { addBurst(e.x, e.y, COL.tether, 12); addFloat(e.x, e.y - 22, "relay", COL.tether); }
      else if (e.type === "crystal_chain" && state) {
        var a = null, b = null;
        for (var k = 0; k < state.rocks.length; k++) { if (state.rocks[k].id === e.from) a = state.rocks[k]; if (state.rocks[k].id === e.to) b = state.rocks[k]; }
        if (a && b) { arcs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, life: 0.6 }); addBurst(b.x, b.y, COL.crystal, 10); }
      } else if (e.type === "drone_split" && state) {
        for (var q = 0; q < state.drones.length; q++) if (state.drones[q].id === e.droneId) addBurst(state.drones[q].x, state.drones[q].y, "#ffffff", 5);
      } else if (e.type === "gauge_full") warpAt = performance.now();
    }
  }

  function stepFx(dt) {
    for (var a = arcs.length - 1; a >= 0; a--) { arcs[a].life -= dt; if (arcs[a].life <= 0) arcs.splice(a, 1); }
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (var j = floats.length - 1; j >= 0; j--) {
      var f = floats[j];
      f.life -= dt; f.y -= 24 * dt;
      if (f.life <= 0) floats.splice(j, 1);
    }
  }

  // ---- shapes

  function polygon(id, n, r, jitter) {
    var key = id + ":" + n + ":" + r;
    var pts = shapeCache[key];
    if (pts) return pts;
    pts = [];
    var h = id * 2654435761 >>> 0;
    for (var i = 0; i < n; i++) {
      h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
      var k = 1 - jitter + (h >>> 16) / 65536 * jitter;
      var a = (i / n) * 6.2832;
      pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]);
    }
    shapeCache[key] = pts;
    return pts;
  }

  function drawRock(r, t) {
    var col = COL[r.type];
    var frac = r.amountMax > 0 ? r.amount / r.amountMax : 0;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.globalAlpha = r.depleted ? 0.4 : 1;
    ctx.fillStyle = r.depleted ? "#1a212c" : col;
    ctx.strokeStyle = r.depleted ? "#46546a" : "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (r.type === "ore") {
      var p = polygon(r.id, 7, r.r, 0.25);
      ctx.moveTo(p[0][0], p[0][1]);
      for (var i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
      ctx.closePath();
    } else if (r.type === "ice") {
      ctx.arc(0, 0, r.r, 0, 6.2832);
    } else {
      ctx.moveTo(0, -r.r * 1.15); ctx.lineTo(r.r * 0.8, 0); ctx.lineTo(0, r.r * 1.15); ctx.lineTo(-r.r * 0.8, 0);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    if (!r.depleted) {
      if (r.type === "ice") {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath(); ctx.arc(-r.r * 0.3, -r.r * 0.3, r.r * 0.28, 0, 6.2832); ctx.fill();
      } else if (r.type === "crystal") {
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.beginPath(); ctx.moveTo(0, -r.r * 1.15); ctx.lineTo(0, r.r * 1.15); ctx.moveTo(-r.r * 0.8, 0); ctx.lineTo(r.r * 0.8, 0); ctx.stroke();
      }
      // amount left: a dark arc over the rock
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r.r * 0.55, -1.5708, -1.5708 + 6.2832 * frac); ctx.stroke();
    }
    ctx.restore();
    if (r.relay) drawRelayIcon(r);
  }

  function drawRelayIcon(r) {
    var on = curState && G.powered(curState, r.id);
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.strokeStyle = on ? COL.tether : "#7a8794";
    ctx.fillStyle = on ? "rgba(56,214,255,0.18)" : "rgba(120,130,145,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, T.relay.r, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(6, 0); ctx.lineTo(0, 6); ctx.lineTo(-6, 0); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  // ---- layers

  function drawBackground(state) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, view.cssW, view.cssH);
    var off = state ? state.tick * state.params.scroll * 0.3 / 60 * view.scale : 0;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var y = (s.y * view.cssH + off) % view.cssH;
      ctx.fillStyle = "rgba(200,220,255," + s.a + ")";
      ctx.fillRect(s.x * view.cssW, y, s.s, s.s);
    }
  }

  function drawField(state, ui, now) {
    curState = state;
    var d = view.dpr, k = view.scale;
    ctx.setTransform(d * k, 0, 0, d * k, d * view.offX, d * view.offY);
    // field frame
    ctx.strokeStyle = "rgba(120,160,220,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, T.world.w - 1, T.world.h - 1);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, T.world.w, T.world.h); ctx.clip();   // rocks spawn above the field: keep them out of the HUD

    var i, t;
    // husks and relays first (under live rocks)
    for (i = 0; i < state.rocks.length; i++) if (state.rocks[i].depleted) drawRock(state.rocks[i]);
    for (i = 0; i < state.rocks.length; i++) if (!state.rocks[i].depleted) drawRock(state.rocks[i]);

    // tethers
    var brown = state.power.brownout;
    for (i = 0; i < state.tethers.length; i++) {
      t = state.tethers[i];
      var e = G.tetherEnds(state, t.id);
      if (!e) continue;
      ctx.strokeStyle = brown ? "#2a3744" : COL.tetherDim;
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
      ctx.strokeStyle = t.kind === "idle" ? "#7a8794" : t.kind === "link" ? "#bff4ff" : (brown ? "#5c93a6" : COL.tether);
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
    }

    for (i = 0; i < arcs.length; i++) {
      var ar = arcs[i];
      ctx.globalAlpha = Math.min(1, ar.life * 2);
      ctx.strokeStyle = COL.crystal;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ar.x1, ar.y1); ctx.lineTo((ar.x1 + ar.x2) / 2 + (ar.y2 - ar.y1) * 0.15, (ar.y1 + ar.y2) / 2 - (ar.x2 - ar.x1) * 0.15); ctx.lineTo(ar.x2, ar.y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // drones
    for (i = 0; i < state.drones.length; i++) {
      var dr = state.drones[i];
      if (dr.mode === "idle") continue;
      ctx.fillStyle = dr.cargo > 0 ? COL[dr.cargoType] : "#ffffff";
      ctx.strokeStyle = "#05070d";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(dr.x, dr.y, 3, 0, 6.2832); ctx.fill(); ctx.stroke();
    }

    // station
    var st = state.station;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(st.x, st.y, st.r + 5, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = st.hp / st.hpMax > 0.3 ? COL.ok : COL.bad;
    ctx.beginPath(); ctx.arc(st.x, st.y, st.r + 5, -1.5708, -1.5708 + 6.2832 * Math.max(0, st.hp / st.hpMax)); ctx.stroke();
    ctx.fillStyle = "#1c2433";
    ctx.strokeStyle = COL.station;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.fillStyle = COL.station;
    ctx.beginPath(); ctx.arc(st.x, st.y, 6, 0, 6.2832); ctx.fill();
    var idle = 0;
    for (i = 0; i < state.drones.length; i++) if (state.drones[i].mode === "idle") idle++;
    ctx.fillStyle = COL.dim;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(state.drones.length + " drones (" + idle + " idle)", st.x, st.y + st.r + 20);

    // effects
    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.font = "bold 12px system-ui, sans-serif";
    for (i = 0; i < floats.length; i++) {
      var f = floats[i];
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
    drawGesture(state, ui);
  }

  function drawGesture(state, ui) {
    if (!ui) return;
    var k = view.scale;
    if (ui.trail && ui.trail.length > 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2 / k;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ui.trail[0].x, ui.trail[0].y);
      for (var i = 1; i < ui.trail.length; i++) ctx.lineTo(ui.trail[i].x, ui.trail[i].y);
      ctx.stroke();
      ctx.lineCap = "butt";
    }
    if (ui.mode === "drawing" && ui.preview) {
      var pv = ui.preview;
      var src = ui.from === 0 ? { x: state.station.x, y: state.station.y } : null;
      if (!src) {
        for (var j = 0; j < state.rocks.length; j++) if (state.rocks[j].id === ui.from) src = state.rocks[j];
      }
      if (src) {
        var col = pv.ok ? COL.ok : COL.bad;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2 / k;
        ctx.setLineDash([6 / k, 4 / k]);
        ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(pv.x2, pv.y2); ctx.stroke();
        ctx.setLineDash([]);
        if (pv.toId) {
          ctx.beginPath(); ctx.arc(pv.x2, pv.y2, 20, 0, 6.2832); ctx.stroke();
        }
        var label = pv.ok ? "-" + Math.round(pv.cost) + " (" + Math.max(0, Math.round(pv.powerAfter)) + " left)" : (REASON[pv.reason] || "");
        if (label) {
          var lx = ui.finger.x, ly = ui.finger.y - 56 / k;
          ctx.font = "bold " + (15 / k) + "px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.lineWidth = 4 / k;
          ctx.strokeStyle = "rgba(5,7,13,0.9)";
          ctx.strokeText(label, lx, ly);
          ctx.fillStyle = col;
          ctx.fillText(label, lx, ly);
        }
      }
    }
  }

  function bar(x, y, w, h, frac, color) {
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
  }

  function drawHud(state, now) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    var x = view.hudX + 10, w = view.hudW - 20, y = view.hudY;
    ctx.textBaseline = "alphabetic";
    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.fillStyle = COL.text;
    ctx.textAlign = "left";
    ctx.fillText("SECTOR " + state.sector, x, y + 24);
    ctx.textAlign = "right";
    ctx.fillText(String(state.score).replace(/\B(?=(\d{3})+(?!\d))/g, ","), x + w, y + 24);

    var pct = state.gauge / state.params.gaugeMax;
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = COL.dim;
    ctx.fillText("WARP", x, y + 47);
    bar(x + 38, y + 38, w - 38 - 40, 10, pct, "#7c6cff");
    ctx.textAlign = "right";
    ctx.fillStyle = COL.text;
    ctx.fillText(Math.floor(pct * 100) + "%", x + w, y + 47);

    ctx.textAlign = "left";
    ctx.fillStyle = COL.dim;
    ctx.fillText("HULL", x, y + 71);
    var hf = state.station.hp / state.station.hpMax;
    bar(x + 38, y + 62, w * 0.36, 10, hf, hf > 0.3 ? COL.ok : COL.bad);
    var flash = state.power.brownout && Math.floor(now / 250) % 2 === 0;
    ctx.textAlign = "right";
    ctx.fillStyle = state.power.brownout ? (flash ? COL.bad : COL.warn) : COL.text;
    ctx.fillText("POWER " + Math.round(state.power.use) + "/" + Math.round(state.power.budget), x + w, y + 71);
    var pf = state.power.use / state.power.budget;
    bar(x + w * 0.5, y + 62, w * 0.5 - 100, 10, pf, state.power.brownout ? COL.bad : COL.tether);
  }

  function drawOverlays(state, now) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    var cx = view.offX + T.world.w * view.scale / 2, cy = view.offY + 210 * view.scale;
    if (state.phase === "warp" || state.phase === "cards") {
      var el = warpAt ? (now - warpAt) / 1000 : 0;
      var fieldH = T.world.h * view.scale, fieldW = T.world.w * view.scale;
      ctx.fillStyle = "rgba(124,108,255," + (state.phase === "cards" ? 0.22 : Math.min(0.25, el * 0.3)) + ")";
      ctx.fillRect(view.offX, view.offY, fieldW, fieldH);
      ctx.strokeStyle = "rgba(200,220,255,0.7)";
      ctx.lineWidth = 1.5;
      for (var i = 0; i < 36; i++) {
        var x = view.offX + ((i * 97) % 360) / 360 * fieldW;
        var len = 40 + (i % 5) * 30 + Math.min(1, el) * 90;
        var y = (view.offY + (((i * 53) % 640) / 640 * fieldH + el * 900 * (0.6 + (i % 4) * 0.2)) % (fieldH + 120)) - 60;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + len); ctx.stroke();
      }
      ctx.font = "bold 26px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = COL.text;
      ctx.fillText("WARP", cx, cy);
    }
    if (banner) {
      var age = (now - banner.t0) / 1000;
      if (age > 2.2) banner = null;
      else {
        ctx.globalAlpha = age < 1.4 ? 1 : Math.max(0, 1 - (age - 1.4) / 0.8);
        ctx.font = "bold 34px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 6;
        ctx.strokeStyle = "rgba(5,7,13,0.85)";
        ctx.strokeText(banner.text, cx, cy + 50);
        ctx.fillStyle = COL.text;
        ctx.fillText(banner.text, cx, cy + 50);
        ctx.globalAlpha = 1;
      }
    }
  }

  function draw(state, ui, now) {
    drawBackground(state);
    drawField(state, ui, now);
    drawHud(state, now);
    drawOverlays(state, now);
  }

  return { init: init, resize: resize, toWorld: toWorld, draw: draw, handleEvents: handleEvents, stepFx: stepFx, setBanner: setBanner, addFloat: addFloat,
           view: view, REASON: REASON };
})();
