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
  function newGame() {
    var seed = intParam("seed");
    if (seed === null) seed = Date.now() >>> 0;
    var sector = intParam("sector");
    state = G.newRun(seed, sector !== null && sector >= 1 ? { sector: sector } : {});
    TetherInput.reset();
  }

  var canvas = document.getElementById("game");
  TetherRender.init(canvas);
  TetherInput.init(canvas, function () { return state; }, TetherRender);
  newGame();

  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { TetherRender.resize(); draw(); }, 100);
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  var lastDraw = 0;
  function draw() { TetherRender.draw(state, TetherInput.ui, performance.now()); }

  var acc = 0, last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
    last = now;
    acc += dt;
    var steps = 0;
    while (acc >= G.TICK && steps < 5) {
      G.step(state);
      acc -= G.TICK;
      steps++;
    }
    if (steps === 5) acc = 0;
    if (steps > 0) {
      TetherRender.handleEvents(G.drainEvents(state));
      TetherRender.stepFx(steps * G.TICK);
      draw();
      lastDraw = now;
    } else if (now - lastDraw > 250) {
      draw();
      lastDraw = now;
    }
  }
  requestAnimationFrame(frame);

  // Pause the clock while the tab is hidden so a returning player does not lose the run.
  document.addEventListener("visibilitychange", function () { last = 0; acc = 0; });
})();
