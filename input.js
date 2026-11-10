/* Tether input: Pointer Events -> gesture recogniser -> rules API. One pointer at a time.
 * Drawing drags go from the station or a powered relay; any other drag is a cut swipe.
 * Tapping never cuts; tapping a mined-out rock that still has a tether makes it a relay.
 * (Reverse drawing, rock to station, is deferred.) */
var TetherInput = (function () {
  "use strict";
  var G = TetherGame;
  var NODE_HIT = 28, ROCK_HIT = 24, DRAG_START = 8, SNAP = 36, SNAP_TOP = 48, CUT_MIN = 24, EDGE_DEAD = 16;
  var TAP_MOVE = 10, TAP_TIME = 250;

  var canvas, getState, R;
  var pointerId = null;
  var g = null;    // active gesture
  var ui = { mode: "idle", from: 0, preview: null, finger: { x: 0, y: 0 }, trail: null };

  function init(c, stateGetter, render) {
    canvas = c; getState = stateGetter; R = render;
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("lostpointercapture", cancel);
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  function reset() {
    g = null; pointerId = null;
    ui.mode = "idle"; ui.preview = null; ui.trail = null; ui.from = 0;
  }

  function world(e) { return R.toWorld(e.clientX, e.clientY); }

  function down(e) {
    if (pointerId !== null) return;
    var W = window.innerWidth, H = window.innerHeight;
    if (e.clientX < EDGE_DEAD || e.clientY < EDGE_DEAD || e.clientX > W - EDGE_DEAD || e.clientY > H - EDGE_DEAD) return;
    var state = getState();
    if (!state || state.phase !== "play") return;
    pointerId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var w = world(e);
    var scale = R.view.scale;
    var hit = G.pick(state, w.x, w.y, NODE_HIT / scale);
    g = { sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y, t0: performance.now(), hit: hit, mode: "pressed", path: 0, px: e.clientX, py: e.clientY, trail: [] };
    ui.finger = w;
    e.preventDefault();
  }

  function snapRadius(w) {
    return (w.y < G.TUNING.world.h / 3 ? SNAP_TOP : SNAP) / R.view.scale;
  }

  function move(e) {
    if (e.pointerId !== pointerId || !g) return;
    var state = getState();
    if (state.phase !== "play") { reset(); return; }
    var w = world(e);
    ui.finger = w;
    if (g.mode === "pressed") {
      var dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (Math.sqrt(dx * dx + dy * dy) <= DRAG_START) return;
      var h = g.hit;
      if (h.kind === "station" || (h.kind === "relay" && G.powered(state, h.id))) {
        g.mode = "drawing"; g.from = h.id;
        ui.mode = "drawing"; ui.from = h.id;
      } else {
        g.mode = "cutting";
        ui.mode = "cutting";
        var s0 = R.toWorld(g.sx, g.sy);
        g.trail = [s0];
        ui.trail = g.trail;
        g.px = g.sx; g.py = g.sy;
      }
    }
    if (g.mode === "drawing") {
      ui.preview = G.previewTether(state, g.from, w.x, w.y, snapRadius(w));
    } else if (g.mode === "cutting") {
      var mx = e.clientX - g.px, my = e.clientY - g.py;
      var prev = g.trail[g.trail.length - 1];
      g.path += Math.sqrt(mx * mx + my * my);
      g.px = e.clientX; g.py = e.clientY;
      g.trail.push(w);
      if (g.trail.length > 24) g.trail.shift();
      if (g.path >= CUT_MIN) {
        if (!g.cutting) {
          g.cutting = true;
          // the first time the threshold is crossed, cut along everything swiped so far
          for (var i = 1; i < g.trail.length; i++) G.cutAcross(state, g.trail[i - 1].x, g.trail[i - 1].y, g.trail[i].x, g.trail[i].y);
        } else {
          G.cutAcross(state, prev.x, prev.y, w.x, w.y);
        }
      }
    }
  }

  function up(e) {
    if (e.pointerId !== pointerId) return;
    var state = getState();
    if (g && g.mode === "drawing" && ui.preview && ui.preview.toId && state.phase === "play") {
      G.tryTether(state, g.from, ui.preview.toId);
    }
    // a quick tap on a mined-out rock with a tether makes a relay; any other tap does nothing (tapping never cuts)
    if (g && g.mode === "pressed" && state.phase === "play" && performance.now() - g.t0 <= TAP_TIME) {
      var dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (Math.sqrt(dx * dx + dy * dy) <= TAP_MOVE) {
        var h = G.pick(state, g.wx, g.wy, ROCK_HIT / R.view.scale);
        if (h.kind === "husk") {
          var res = G.makeRelay(state, h.id);
          if (!res.ok && R.REASON[res.reason]) R.addFloat(g.wx, g.wy - 24, R.REASON[res.reason], "#ffb020", 1.2);
        }
      }
    }
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    reset();
  }

  function cancel(e) {
    if (e.pointerId !== pointerId) return;
    reset();
  }

  return { init: init, ui: ui, reset: reset };
})();
