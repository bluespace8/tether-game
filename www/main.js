/* Tether boot and loop: fixed 60 Hz accumulator, draw only after a tick. */
(function () {
  "use strict";
  var G = TetherGame;
  var params = new URLSearchParams(location.search);

  function intParam(name) {
    if (!params.has(name)) return null;
    var n = parseInt(params.get(name), 10);
    return isNaN(n) ? null : n;
  }

  var state = null;
  var paused = false;
  var firstRun = true;

  function newGame() {
    var seed = firstRun ? intParam("seed") : null;     // ?seed fixes the first run only
    if (seed === null) seed = Date.now() >>> 0;
    firstRun = false;
    var sector = intParam("sector");
    state = G.newRun(seed, sector !== null && sector >= 1 ? { sector: sector } : {});
    paused = false;
    TetherInput.reset();
    TetherUI.hideCards();
    TetherUI.hidePause();
    TetherUI.hideOver();
    TetherRender.setBanner("SECTOR " + state.sector, performance.now());
  }

  function pause() {
    if (paused || (state.phase !== "play" && state.phase !== "warp")) return;
    paused = true;
    TetherInput.reset();
    TetherUI.showPause();
  }
  function resume() {
    paused = false;
    TetherUI.hidePause();
  }

  var canvas = document.getElementById("game");
  TetherRender.init(canvas);
  TetherInput.init(canvas, function () { return state; }, TetherRender);
  TetherUI.init({
    onPick: function (id) {
      if (G.pickCard(state, id).ok) { TetherUI.hideCards(); pump(); draw(); }
    },
    onPause: pause,
    onResume: resume,
    onRestart: function () { newGame(); draw(); },
    onQuit: function () { G.abandonRun(state); resume(); pump(); draw(); },
    onPlayAgain: function () { newGame(); draw(); }
  });
  newGame();
  TetherUI.layout(TetherRender.view);

  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { TetherRender.resize(); TetherUI.layout(TetherRender.view); draw(); }, 100);
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  var lastDraw = 0;
  function draw() { TetherRender.draw(state, TetherInput.ui, performance.now()); }

  // Drain the rules' event queue once and hand the events to the effects and the screens.
  function pump() {
    var events = G.drainEvents(state);
    TetherRender.handleEvents(events, state);
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.type === "cards_offered") { TetherInput.reset(); TetherUI.showCards(state); }
      else if (e.type === "sector_start") TetherRender.setBanner("SECTOR " + e.sector, performance.now());
      else if (e.type === "run_over") { TetherInput.reset(); TetherUI.showOver(state); }
    }
  }

  var acc = 0, last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
    last = now;
    var live = !paused && (state.phase === "play" || state.phase === "warp");
    if (live) acc += dt; else acc = 0;
    var steps = 0;
    while (live && acc >= G.TICK && steps < 5) {
      G.step(state);
      acc -= G.TICK;
      steps++;
      if (state.phase !== "play" && state.phase !== "warp") break;
    }
    if (steps === 5) acc = 0;
    if (steps > 0) {
      pump();
      TetherRender.stepFx(steps * G.TICK);
      draw();
      lastDraw = now;
    } else if (now - lastDraw > 100) {
      TetherRender.stepFx(Math.min(0.1, (now - lastDraw) / 1000));
      draw();
      lastDraw = now;
    }
  }
  requestAnimationFrame(frame);

  // Leaving the page pauses the run, and a returning player does not lose time to a long frame.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) pause();
    last = 0; acc = 0;
  });
  window.addEventListener("blur", pause);

  // Debug hook for headless checks.
  window.__tetherState = function () { return state; };
})();
