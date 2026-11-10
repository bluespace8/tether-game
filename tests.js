/* Unit tests for www/game.js. Run (PowerShell):
 *   $env:ELECTRON_RUN_AS_NODE=1; & 'E:\Evan\Programs\VSCode\Code.exe' tests.js
 * bash: ELECTRON_RUN_AS_NODE=1 "/e/Evan/Programs/VSCode/Code.exe" tests.js */
"use strict";
const fs = require("fs");
const path = require("path");
const G = require("./www/game.js");
const T = G.TUNING, TICK = G.TICK;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e && e.message)); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "eq") + ": expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
}
function ok(c, msg) { if (!c) throw new Error(msg || "expected truthy"); }
function near(a, b, eps, msg) { if (Math.abs(a - b) > (eps === undefined ? 1e-6 : eps)) throw new Error((msg || "near") + ": expected " + b + ", got " + a); }

// ---- helpers: a quiet state with hand-placed rocks

function quiet(seed, opts) {
  const s = G.newRun(seed || 1, opts);
  s.rocks.length = 0;
  s.timers.spawn = 1e9;
  return s;
}
function addRock(s, o) {
  const sz = T.rocks.sizes[o.size || "m"];
  const amount = o.amount === undefined ? 30 : o.amount;
  const r = { id: s.nextId++, x: o.x, y: o.y, r: sz.r, size: o.size || "m", type: o.type || "ore", amount: amount,
              amountMax: amount, depleted: amount <= 0, relay: false, tether: 0 };
  s.rocks.push(r);
  return r;
}
function rich(s) { s.mods.powerAdd = 900; s.power.budget = 1000; return s; }
function run(s, n) { for (let i = 0; i < n; i++) G.step(s); }
function types(evs) { return evs.map(function (e) { return e.type; }); }

// ---- purity

test("purity: game.js has no clock, random, DOM or trig", function () {
  const src = fs.readFileSync(path.join(__dirname, "www", "game.js"), "utf8");
  const bad = [/Math\.random/, /\bDate\b/, /\bwindow\b/, /\bdocument\b/, /localStorage/, /Math\.(sin|cos|atan2|tan|atan)\b/, /performance/, /setTimeout|setInterval/];
  bad.forEach(function (re) { ok(!re.test(src), "found " + re); });
});

// ---- RNG

test("rng: mulberry32 first 5 outputs are known", function () {
  const r = G.mulberry32(12345);
  const got = [1, 2, 3, 4, 5].map(function () { return r(); });
  const want = [0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203, 0.5094283693470061];
  got.forEach(function (v, i) { near(v, want[i], 1e-12, "output " + i); });
});
test("rng: streams are independent and states are uint32", function () {
  const a = G.newRun(7), b = G.newRun(7);
  ok(a.rng.field !== a.rng.events && a.rng.events !== a.rng.cards && a.rng.field !== a.rng.cards);
  Object.keys(a.rng).forEach(function (k) { ok(a.rng[k] >= 0 && a.rng[k] <= 4294967295 && a.rng[k] % 1 === 0); });
  eq(a.rng, b.rng);
  run(a, 600);
  eq(a.rng.events, b.rng.events, "field use must not advance events");
  eq(a.rng.cards, b.rng.cards, "field use must not advance cards");
  ok(a.rng.field !== b.rng.field);
});
test("rng: hash32 is stable and depends on seed and name", function () {
  eq(G.hash32(1, "field"), G.hash32(1, "field"));
  ok(G.hash32(1, "field") !== G.hash32(2, "field"));
  ok(G.hash32(1, "field") !== G.hash32(1, "events"));
  eq(G.hash32(1, "field"), 1471260888, "pinned value");
});

// ---- newRun

test("newRun: shape matches 5.1", function () {
  const s = G.newRun(42);
  const keys = ["v", "seed", "rng", "tick", "phase", "phaseT", "sector", "sectorTick", "params", "gauge", "score", "station",
    "power", "rocks", "tethers", "drones", "raiders", "timers", "flare", "cards", "mods", "offer", "stats", "nextId", "events", "over"];
  keys.forEach(function (k) { ok(k in s, "missing " + k); });
  eq(s.phase, "play"); eq(s.sector, 1); eq(s.over, null);
  eq(Object.keys(s.timers), ["spawn", "flare", "flareWarn", "raid"]);
  eq(Object.keys(s.params), ["scroll", "gaugeMax", "spawnGap", "crystalPct", "flareGap", "severLen", "raidGap", "raidCount", "raiderHp", "rideSpeed", "ramDmg"]);
  ok(!("starsRun" in s), "star fields are out of scope");
  JSON.parse(JSON.stringify(s));
});
test("newRun: 7 rocks on screen, spaced >= 44, budget/drones/HP from TUNING", function () {
  for (let seed = 1; seed <= 40; seed++) {
    const s = G.newRun(seed);
    eq(s.rocks.length, 7, "seed " + seed);
    s.rocks.forEach(function (r) { ok(r.y >= 60 && r.y <= 420, "y " + r.y); ok(r.x >= 26 && r.x <= 334); });
    for (let i = 0; i < s.rocks.length; i++) for (let j = i + 1; j < s.rocks.length; j++) {
      ok(Math.hypot(s.rocks[i].x - s.rocks[j].x, s.rocks[i].y - s.rocks[j].y) >= 44, "spacing seed " + seed);
    }
  }
  const s = G.newRun(1);
  eq(s.power.budget, 100); eq(s.drones.length, 6); eq(s.station.hp, 100); eq(s.station.hpMax, 100);
  s.drones.forEach(function (d) { eq(d.mode, "idle"); });
});
test("newRun: opts.sector sets params and arms timers; seed coerced >>> 0", function () {
  const s = G.newRun(5, { sector: 3 });
  eq(s.sector, 3);
  eq(s.params, G.sectorParams(3));
  eq(s.timers.flare, 20); eq(s.timers.raid, 15);
  eq(G.newRun(-1).seed, 4294967295);
  eq(G.newRun(5).timers.flare, 0);
});

// ---- field

test("field: rocks move scroll*TICK per tick", function () {
  const s = quiet(1);
  const r = addRock(s, { x: 100, y: 100 });
  const y0 = r.y;
  run(s, 60);
  near(r.y - y0, 60 * s.params.scroll * TICK, 1e-9);
});
test("field: removed past y 680, and its tether is cut as offscreen", function () {
  const s = quiet(1);
  const r = addRock(s, { x: 180, y: 679.9, r: 10 });
  s.rocks[0].tether = 0;
  // hand-link a tether so we can see the cut
  s.tethers.push({ id: s.nextId++, from: 0, to: r.id, kind: "mine", len: 119, cost: 29, doomed: false, lastLaunch: -1000 });
  r.tether = s.tethers[0].id;
  G.drainEvents(s);
  run(s, 3);
  eq(s.rocks.length, 0); eq(s.tethers.length, 0);
  const cuts = G.drainEvents(s).filter(function (e) { return e.type === "tether_cut"; });
  eq(cuts.length, 1); eq(cuts[0].reason, "offscreen");
  eq(s.power.use, 0);
});
test("field: cap of 22 respected over a long idle run", function () {
  const s = G.newRun(3);
  for (let i = 0; i < 6000; i++) { G.step(s); ok(s.rocks.length <= 22); }
});
test("field: spawned rocks appear at y -30 and keep 44 u from low rocks", function () {
  const s = quiet(9);
  s.timers.spawn = TICK;
  addRock(s, { x: 180, y: 20 });
  G.step(s);
  s.rocks.forEach(function (r) { if (r.id !== s.rocks[0].id) near(r.y, -30, 1e-9); });
  for (let i = 0; i < 1500; i++) G.step(s);
  const top = s.rocks.filter(function (r) { return r.y < 60; });
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    ok(Math.hypot(top[i].x - top[j].x, top[i].y - top[j].y) >= 43.9);
  }
});
test("field: sizes and types follow the table", function () {
  const s = G.newRun(11);
  for (let i = 0; i < 4000; i++) G.step(s);
  s.rocks.forEach(function (r) {
    const sz = T.rocks.sizes[r.size];
    eq(r.r, sz.r); ok(r.amountMax >= sz.amount[0] && r.amountMax <= sz.amount[1]);
    ok(["ore", "ice", "crystal"].indexOf(r.type) >= 0);
  });
});

// ---- sectorParams

test("sectorParams: table for n = 1..8", function () {
  const scroll = [7, 8.2, 9.4, 10.6, 11.8, 13, 14.2, 15.4];
  const gauge = [150, 220, 290, 360, 430, 500, 570, 640];
  const spawn = [3.0, 2.8, 2.6, 2.4, 2.2, 2.0, 1.8, 1.6];
  const crys = [8, 10, 12, 14, 16, 18, 18, 18];
  const flare = [0, 30, 28, 26, 24, 22, 20, 18];
  const sever = [0, 200, 190, 180, 170, 160, 150, 140];
  const raid = [0, 0, 28, 26, 24, 22, 20, 18];
  const cnt = [0, 0, 1, 1, 2, 2, 3, 3];
  const hp = [0, 0, 30, 36, 42, 48, 54, 60];
  const ride = [0, 0, 32, 34, 36, 38, 40, 42];
  const ram = [0, 0, 15, 17, 19, 21, 23, 25];
  for (let n = 1; n <= 8; n++) {
    const p = G.sectorParams(n), i = n - 1;
    near(p.scroll, scroll[i]); near(p.gaugeMax, gauge[i]); near(p.spawnGap, spawn[i]); near(p.crystalPct, crys[i]);
    near(p.flareGap, flare[i]); near(p.severLen, sever[i]); near(p.raidGap, raid[i]); near(p.raidCount, cnt[i]);
    near(p.raiderHp, hp[i]); near(p.rideSpeed, ride[i]); near(p.ramDmg, ram[i]);
  }
});
test("sectorParams: clamps at n = 20", function () {
  const p = G.sectorParams(20);
  near(p.scroll, 16); near(p.spawnGap, 1.6); near(p.crystalPct, 18); near(p.flareGap, 16); near(p.severLen, 130);
  near(p.raidGap, 12); near(p.raidCount, 5); near(p.rideSpeed, 50); near(p.ramDmg, 30);
  near(p.raiderHp, 30 + 6 * 17); near(p.gaugeMax, 150 + 70 * 19);
});

// ---- tethers

function lineup() {
  const s = quiet(1);
  const a = addRock(s, { x: 180, y: 400 });           // 160 from the station
  return { s: s, a: a };
}

test("tryTether: creates a mine tether with cost = len*0.25", function () {
  const o = lineup();
  const r = G.tryTether(o.s, 0, o.a.id);
  ok(r.ok && r.id > 0);
  const t = o.s.tethers[0];
  eq(t.kind, "mine");
  near(t.len, 160); near(t.cost, 40);
  eq(o.a.tether, t.id);
  near(o.s.power.use, 40);
  eq(o.s.stats.tethersMade, 1);
  eq(types(G.drainEvents(o.s)), ["tether_created"]);
});
test("tryTether: every non-relay failure reason is reachable", function () {
  const s = quiet(1);
  const near1 = addRock(s, { x: 180, y: 400 });
  const tooClose = addRock(s, { x: 180, y: 540 });
  const far = addRock(s, { x: 20, y: 30, r: 10 });
  const husk = addRock(s, { x: 250, y: 400, amount: 0 });
  const edge = addRock(s, { x: 300, y: 5 });
  eq(G.tryTether(s, 0, 9999).reason, "no_target");
  eq(G.tryTether(s, 77, near1.id).reason, "no_source");
  eq(G.tryTether(s, near1.id, near1.id).reason, "no_source", "plain rock is no source");
  eq(G.tryTether(s, 0, husk.id).reason, "target_depleted");
  eq(G.tryTether(s, 0, edge.id).reason, "target_offscreen");
  eq(G.tryTether(s, 0, tooClose.id).reason, "too_short");
  eq(G.tryTether(s, 0, far.id).reason, "too_long");
  ok(G.tryTether(s, 0, near1.id).ok);
  eq(G.tryTether(s, 0, near1.id).reason, "target_tethered");
  s.phase = "cards";
  eq(G.tryTether(s, 0, near1.id).reason, "bad_phase");
});
test("tryTether: no_power and tether_cap", function () {
  const s = quiet(1);
  const rocks = [];
  for (let i = 0; i < 3; i++) rocks.push(addRock(s, { x: 40 + i * 140, y: 330 }));   // ~250 u each, cost > 50
  ok(G.tryTether(s, 0, rocks[0].id).ok);
  const r = G.tryTether(s, 0, rocks[2].id);
  const c = G.previewTether(s, 0, rocks[2].x, rocks[2].y, 5);
  ok(!r.ok || c.powerAfter >= 0);
  const s2 = quiet(1);
  s2.mods.powerAdd = 1000; s2.power.budget = 1100;
  const rs = [];
  for (let i = 0; i < 13; i++) rs.push(addRock(s2, { x: 30 + i * 25, y: 350, size: "s" }));
  let made = 0;
  for (let i = 0; i < 13; i++) if (G.tryTether(s2, 0, rs[i].id).ok) made++;
  eq(made, 12);
  eq(G.tryTether(s2, 0, rs[12].id).reason, "tether_cap");
  const s3 = quiet(1);
  const big = addRock(s3, { x: 40, y: 330 }), big2 = addRock(s3, { x: 330, y: 330 });
  ok(G.tryTether(s3, 0, big.id).ok);
  eq(G.tryTether(s3, 0, big2.id).reason, "no_power");
  ok(!G.previewTether(s3, 0, 330, 330, 5).ok);
  eq(G.previewTether(s3, 0, 330, 330, 5).reason, "no_power");
});
test("tryTether: cost scales with mods", function () {
  const o = lineup();
  o.s.mods.costMul = 0.8;
  G.tryTether(o.s, 0, o.a.id);
  near(o.s.tethers[0].cost, 32);
});
test("previewTether: snaps to nearest valid target, never mutates state", function () {
  const s = quiet(1);
  const a = addRock(s, { x: 100, y: 300, size: "s" });
  const b = addRock(s, { x: 130, y: 300, size: "s" });
  addRock(s, { x: 250, y: 300, amount: 0 });
  const before = G.hashState(s), idc = s.nextId;
  const p = G.previewTether(s, 0, 112, 300, 36);
  ok(p.ok); eq(p.toId, a.id, "nearest centre wins");
  near(p.x2, 100);
  near(p.len, Math.hypot(80, 260), 1e-9);
  near(p.cost, p.len * 0.25, 1e-9);
  near(p.powerAfter, 100 - p.cost, 1e-9);
  const q = G.previewTether(s, 0, 125, 300, 36);
  eq(q.toId, b.id);
  const husk = G.previewTether(s, 0, 250, 300, 20);
  ok(!husk.ok); eq(husk.reason, "target_depleted"); eq(husk.toId, 0); eq(husk.x2, 250);
  const none = G.previewTether(s, 0, 20, 100, 10);
  eq(none.reason, "no_target"); eq(none.toId, 0);
  eq(G.hashState(s), before); eq(s.nextId, idc); eq(s.events.length, 0);
  eq(G.previewTether(s, 55, 0, 0, 10).reason, "no_source");
});
test("cutTether and reasons", function () {
  const o = lineup();
  const id = G.tryTether(o.s, 0, o.a.id).id;
  eq(G.cutTether(o.s, 12345).reason, "no_tether");
  G.drainEvents(o.s);
  const c = G.cutTether(o.s, id);
  ok(c.ok); eq(c.cut, [id]);
  eq(o.s.tethers.length, 0); eq(o.a.tether, 0); near(o.s.power.use, 0);
  const ev = G.drainEvents(o.s);
  eq(ev[0].reason, "player");
  near(ev[0].x, 180); near(ev[0].y, 480);
  o.s.phase = "over";
  eq(G.cutTether(o.s, id).reason, "bad_phase");
});

// ---- cutAcross

test("cutAcross: crossing cuts, near miss does not, several in one swipe", function () {
  const s = rich(quiet(1));
  const a = addRock(s, { x: 100, y: 350 }), b = addRock(s, { x: 260, y: 350 }), c = addRock(s, { x: 180, y: 300 });
  G.tryTether(s, 0, a.id); G.tryTether(s, 0, b.id); G.tryTether(s, 0, c.id);
  eq(G.cutAcross(s, 20, 20, 30, 30).cut, []);                 // far away
  eq(G.cutAcross(s, 0, 330, 120, 330).cut.length, 0);          // stops short of the tethers' x range
  eq(G.cutAcross(s, 80, 450, 150, 450).cut.length, 1, "only the left tether");
  eq(s.tethers.length, 2);
  const both = G.cutAcross(s, 80, 450, 280, 450);
  eq(both.cut.length, 2, "several in one swipe");
  eq(s.tethers.length, 0); near(s.power.use, 0);
  s.phase = "cards";
  eq(G.cutAcross(s, 0, 0, 360, 640).cut, []);
});
test("pick: priority station > rock > tether, and husk kind", function () {
  const s = quiet(1);
  const a = addRock(s, { x: 180, y: 400 }), h = addRock(s, { x: 80, y: 300, amount: 0 });
  G.tryTether(s, 0, a.id);
  eq(G.pick(s, 185, 555, 5), { kind: "station", id: 0 });
  eq(G.pick(s, 182, 402, 5), { kind: "rock", id: a.id });
  eq(G.pick(s, 80, 300, 2), { kind: "husk", id: h.id });
  eq(G.pick(s, 182, 480, 4).kind, "tether");
  eq(G.pick(s, 300, 100, 4), { kind: null, id: 0 });
});

// ---- power

test("power: use is recomputed as rocks drift; brownout on and off with events", function () {
  const s = quiet(1);
  s.params.scroll = 60;
  const a = addRock(s, { x: 60, y: 330, size: "l" });
  ok(G.tryTether(s, 0, a.id).ok);
  const u0 = s.power.use;
  run(s, 30);
  ok(Math.abs(s.power.use - u0) > 1, "cost follows the drifting length");
  G.drainEvents(s);
  s.mods.powerAdd = -80;
  run(s, 1);
  ok(s.power.brownout, "over budget");
  eq(G.drainEvents(s).filter(function (e) { return e.type === "brownout"; }).map(function (e) { return e.on; }), [true]);
  run(s, 10);
  eq(G.drainEvents(s).filter(function (e) { return e.type === "brownout"; }).length, 0, "no repeat events");
  s.mods.powerAdd = 0;
  run(s, 1);
  ok(!s.power.brownout);
  eq(G.drainEvents(s).filter(function (e) { return e.type === "brownout"; }).map(function (e) { return e.on; }), [false]);
});
test("power: drones move at half speed in brownout", function () {
  function outDist(brown) {
    const s = quiet(1);
    const a = addRock(s, { x: 180, y: 300 });
    s.params.scroll = 0;
    G.tryTether(s, 0, a.id);
    if (brown) s.mods.powerAdd = -90;
    run(s, 30);
    return s.drones.reduce(function (m, d) { return Math.max(m, d.d); }, 0);
  }
  const normal = outDist(false), slow = outDist(true);
  ok(normal > 0 && slow > 0);
  near(slow / normal, 0.5, 0.02);
});

// ---- overstretch and offscreen

test("overstretch: tether past maxLen snaps with reason; Superconductor flag prevents it", function () {
  function setup(flag) {
    const s = quiet(1);
    s.params.scroll = 0;
    const a = addRock(s, { x: 40, y: 330, size: "s" });
    G.tryTether(s, 0, a.id);
    s.mods.noOverstretch = flag;
    a.x = -200;                                                // pull it past 300 u
    G.drainEvents(s);
    run(s, 1);
    return s;
  }
  const s1 = setup(0);
  eq(s1.tethers.length, 0);
  eq(G.drainEvents(s1)[0].reason, "overstretch");
  const s2 = setup(1);
  eq(s2.tethers.length, 1);
});
test("maxLen: drawing past 300 is refused and Long Reach style mod extends it", function () {
  const s = quiet(1);
  const a = addRock(s, { x: 10, y: 310, size: "s" });         // about 302 away
  eq(G.tryTether(s, 0, a.id).reason, "too_long");
  s.mods.maxLenAdd = 60;
  ok(G.tryTether(s, 0, a.id).ok);
});

// ---- drones

test("drones: launch is staggered, capped at 4 per tether, balanced fewest first", function () {
  const s = rich(quiet(1));
  s.params.scroll = 0;
  const a = addRock(s, { x: 180, y: 300 }), b = addRock(s, { x: 260, y: 300 });
  G.tryTether(s, 0, a.id);
  run(s, 1);
  eq(s.drones.filter(function (d) { return d.tether; }).length, 1, "one launch per 0.25 s");
  run(s, 14);
  eq(s.drones.filter(function (d) { return d.tether; }).length, 1);
  run(s, 1);
  eq(s.drones.filter(function (d) { return d.tether; }).length, 2);
  run(s, 200);
  eq(s.drones.filter(function (d) { return d.tether; }).length, 4, "max 4 on one tether");
  G.tryTether(s, 0, b.id);
  run(s, 20);
  const onB = s.drones.filter(function (d) { return d.tether === s.tethers[1].id; }).length;
  ok(onB >= 1, "idle drones go to the emptier tether");
  ok(s.drones.filter(function (d) { return d.tether === s.tethers[0].id; }).length <= 4);
});
test("drones: tie goes to the shorter path, then lowest id", function () {
  const s = rich(quiet(1));
  s.params.scroll = 0;
  const far = addRock(s, { x: 180, y: 300 }), near2 = addRock(s, { x: 180, y: 450 });
  G.tryTether(s, 0, far.id); G.tryTether(s, 0, near2.id);
  run(s, 1);
  const busy = s.drones.find(function (d) { return d.tether; });
  eq(busy.tether, s.tethers[1].id, "shorter tether first");
  eq(busy.id, s.drones[0].id, "lowest drone id first");
});
test("drones: mine, return, deliver; gauge, score, stats and event", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  const a = addRock(s, { x: 180, y: 460, amount: 20, type: "ore" });   // 100 u away
  G.tryTether(s, 0, a.id);
  G.drainEvents(s);
  run(s, 60 * 12);
  const delivered = s.stats.delivered.ore;
  ok(delivered >= 5, "something delivered " + delivered);
  near(s.gauge, delivered);
  eq(s.score, Math.round(delivered * 10));
  ok(G.drainEvents(s).some(function (e) { return e.type === "delivery" && e.resource === "ore"; }));
  near(a.amount + delivered + s.drones.reduce(function (m, d) { return m + d.cargo; }, 0), 20, 1e-6, "ore is conserved");
});
test("drones: mining takes 5 units/s and fills a 5 unit hold", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  const a = addRock(s, { x: 180, y: 459, amount: 40 });
  G.tryTether(s, 0, a.id);
  run(s, 1);
  const d = s.drones.find(function (x) { return x.tether; });
  d.d = 100; d.mode = "mine";
  run(s, 30);
  near(d.cargo, 2.5, 1e-9);
  run(s, 40);
  eq(d.mode, "back"); near(d.cargo, 5, 1e-9);
  near(a.amount, 35, 0.2 + 1e-6);
});
test("drones: crystal is worth 4, score 40 per unit", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  const a = addRock(s, { x: 180, y: 500, amount: 5, type: "crystal" });
  G.tryTether(s, 0, a.id);
  run(s, 60 * 8);
  const n = s.stats.delivered.crystal;
  ok(n > 0);
  near(s.gauge, n * 4, 1e-9); near(s.score, n * 40, 1);
});
test("drones: cargo lost when the tether is cut, drone returns to the pool", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  const a = addRock(s, { x: 180, y: 459, amount: 40 });
  const id = G.tryTether(s, 0, a.id).id;
  run(s, 1);
  const d = s.drones.find(function (x) { return x.tether; });
  d.d = 100; d.mode = "mine";
  run(s, 20);
  ok(d.cargo > 0);
  G.cutTether(s, id);
  eq(d.mode, "idle"); eq(d.cargo, 0); eq(d.tether, 0); eq(d.x, 180); eq(d.y, 560);
  run(s, 60);
  eq(s.stats.delivered.ore, 0);
});
test("drones: depleting a rock makes the tether idle, husk stays tethered, drones go idle", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  const a = addRock(s, { x: 180, y: 459, amount: 3 });
  const id = G.tryTether(s, 0, a.id).id;
  G.drainEvents(s);
  run(s, 60 * 10);
  ok(a.depleted); eq(a.amount, 0);
  eq(G.tryTether(s, 0, a.id).reason, "target_depleted");
  eq(s.tethers[0].kind, "idle"); eq(s.tethers[0].id, id); eq(a.tether, id);
  near(s.power.use, s.tethers[0].cost, 1e-9, "husk tether still costs power");
  eq(s.drones.filter(function (d) { return d.mode !== "idle"; }).length, 0);
  eq(s.drones.filter(function (d) { return d.tether; }).length, 0);
  const deps = G.drainEvents(s).filter(function (e) { return e.type === "rock_depleted"; });
  eq(deps.length, 1); eq(deps[0].id, a.id);
  near(s.stats.delivered.ore, 3, 1e-9);
});
test("drones: tethers to husks get no drones", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  const a = addRock(s, { x: 180, y: 459, amount: 1 });
  G.tryTether(s, 0, a.id);
  run(s, 60 * 6);
  run(s, 120);
  eq(s.drones.filter(function (d) { return d.tether; }).length, 0);
});

// ---- ice

test("ice: repairs 0.5 HP per unit, capped at hpMax", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  s.station.hp = 50;
  const a = addRock(s, { x: 180, y: 459, amount: 10, type: "ice" });
  G.tryTether(s, 0, a.id);
  G.drainEvents(s);
  run(s, 60 * 8);
  near(s.station.hp, 50 + 10 * 0.5, 1e-6);
  ok(G.drainEvents(s).some(function (e) { return e.type === "station_repaired"; }));
  const s2 = quiet(1);
  s2.params.scroll = 0;
  s2.station.hp = 99.5;
  const b = addRock(s2, { x: 180, y: 459, amount: 10, type: "ice" });
  G.tryTether(s2, 0, b.id);
  run(s2, 60 * 8);
  eq(s2.station.hp, 100);
  const s3 = quiet(1);
  s3.mods.iceRepair = 1.0;
  s3.params.scroll = 0; s3.station.hp = 10;
  const c = addRock(s3, { x: 180, y: 459, amount: 10, type: "ice" });
  G.tryTether(s3, 0, c.id);
  run(s3, 60 * 8);
  near(s3.station.hp, 20, 1e-6);
});

// ---- cascade (hand-made relay; the relay tests proper are further down)

test("cascade: cutting a relay's link cuts what hangs off it", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  const r = addRock(s, { x: 180, y: 400, amount: 0 });
  r.relay = true;
  const link = G.tryTether;           // relay drawing is exercised through hand-made state in M1
  s.tethers.push({ id: s.nextId++, from: 0, to: r.id, kind: "link", len: 160, cost: 40, doomed: false, lastLaunch: -1000 });
  r.tether = s.tethers[0].id;
  const out = addRock(s, { x: 180, y: 250 });
  ok(link(s, r.id, out.id).ok, "relay is a source");
  eq(s.tethers.length, 2);
  ok(G.powered(s, r.id));
  const c = G.cutTether(s, s.tethers[0].id);
  eq(c.cut.length, 2); eq(s.tethers.length, 0);
  ok(!G.powered(s, r.id));
  const reasons = G.drainEvents(s).filter(function (e) { return e.type === "tether_cut"; }).map(function (e) { return e.reason; });
  eq(reasons, ["player", "cascade"]);
  eq(G.tryTether(s, r.id, out.id).reason, "source_unpowered");
  ok(G.tryTether(s, 0, r.id).ok, "inert relay can be re-linked");
  eq(s.tethers[0].kind, "link");
});

// ---- relays

// A husk at (x, y) with a tether from `from` (0 or a relay id); returns the husk.
function huskOn(s, from, x, y) {
  const h = addRock(s, { x: x, y: y, amount: 0 });
  const a = from === 0 ? { x: 180, y: 560 } : s.rocks.find(function (r) { return r.id === from; });
  const len = Math.hypot(h.x - a.x, h.y - a.y);
  const t = { id: s.nextId++, from: from, to: h.id, kind: "idle", len: len, cost: len * 0.25, doomed: false, lastLaunch: -1000 };
  s.tethers.push(t);
  h.tether = t.id;
  return h;
}

test("makeRelay: every failure reason, then success", function () {
  const s = rich(quiet(1));
  s.params.scroll = 0;
  const live = addRock(s, { x: 100, y: 300 });
  const bare = addRock(s, { x: 260, y: 300, amount: 0 });
  const h = huskOn(s, 0, 180, 400);
  eq(G.makeRelay(s, 9999).reason, "no_rock");
  eq(G.makeRelay(s, live.id).reason, "not_depleted");
  eq(G.makeRelay(s, bare.id).reason, "not_tethered");
  G.drainEvents(s);
  const r = G.makeRelay(s, h.id);
  ok(r.ok);
  ok(h.relay);
  eq(s.tethers[0].kind, "link");
  eq(s.stats.relaysMade, 1);
  eq(G.drainEvents(s), [{ type: "relay_created", id: h.id, x: 180, y: 400 }]);
  eq(G.makeRelay(s, h.id).reason, "already_relay");
  s.phase = "cards";
  eq(G.makeRelay(s, h.id).reason, "bad_phase");
});
test("makeRelay: relay_cap at 4 and too_deep beyond 3 relays", function () {
  const s = rich(quiet(1));
  s.params.scroll = 0;
  const hs = [];
  for (let i = 0; i < 5; i++) hs.push(huskOn(s, 0, 40 + i * 70, 430));
  for (let i = 0; i < 4; i++) ok(G.makeRelay(s, hs[i].id).ok);
  eq(G.makeRelay(s, hs[4].id).reason, "relay_cap");
  const d = rich(quiet(1));
  d.params.scroll = 0;
  const a = huskOn(d, 0, 180, 450); ok(G.makeRelay(d, a.id).ok);
  const b = huskOn(d, a.id, 180, 360); ok(G.makeRelay(d, b.id).ok);
  const c = huskOn(d, b.id, 180, 270); ok(G.makeRelay(d, c.id).ok);
  const e = huskOn(d, c.id, 180, 180);
  eq(G.makeRelay(d, e.id).reason, "too_deep");
  const inert = addRock(d, { x: 100, y: 120, amount: 0 }); inert.relay = true;
  eq(G.tryTether(d, c.id, inert.id).reason, "too_deep", "linking a 4th relay is refused too");
});
test("relays: a powered relay is a source; drones haul through the chain", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  const h = huskOn(s, 0, 180, 420);
  ok(G.makeRelay(s, h.id).ok);
  ok(G.powered(s, h.id));
  const ore = addRock(s, { x: 180, y: 330, amount: 12 });
  const pv = G.previewTether(s, h.id, 180, 330, 10);
  ok(pv.ok); eq(pv.toId, ore.id);
  near(pv.cost, 90 * 0.25, 1e-9);
  const t = G.tryTether(s, h.id, ore.id);
  ok(t.ok);
  const mine = s.tethers.find(function (x) { return x.id === t.id; });
  eq(mine.kind, "mine"); eq(mine.from, h.id);
  run(s, 60 * 20);
  near(s.stats.delivered.ore, 12, 1e-6);
  ok(s.gauge > 11);
});
test("relays: link tether keeps costing power and gets no drones", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  const h = huskOn(s, 0, 180, 420);
  G.makeRelay(s, h.id);
  run(s, 1);
  near(s.power.use, 35, 1e-6);
  run(s, 120);
  eq(s.drones.filter(function (d) { return d.tether; }).length, 0);
});
test("relays: cutting the link cascades; the relay stays inert and can be re-linked", function () {
  const s = rich(quiet(1));
  s.params.scroll = 0;
  const h = huskOn(s, 0, 180, 420);
  G.makeRelay(s, h.id);
  const a = addRock(s, { x: 120, y: 300 }), b = addRock(s, { x: 240, y: 300 });
  ok(G.tryTether(s, h.id, a.id).ok); ok(G.tryTether(s, h.id, b.id).ok);
  G.drainEvents(s);
  const c = G.cutTether(s, h.tether);
  eq(c.cut.length, 3);
  eq(s.tethers.length, 0);
  ok(h.relay && h.tether === 0 && !G.powered(s, h.id));
  eq(G.drainEvents(s).filter(function (e) { return e.type === "tether_cut"; }).map(function (e) { return e.reason; }), ["player", "cascade", "cascade"]);
  ok(G.tryTether(s, 0, h.id).ok);
  eq(s.tethers[0].kind, "link");
  ok(G.powered(s, h.id));
});
test("relays: a relay leaving the field cascades its tethers", function () {
  const s = rich(quiet(1));
  s.params.scroll = 60;
  const h = huskOn(s, 0, 180, 640);
  G.makeRelay(s, h.id);
  const a = addRock(s, { x: 180, y: 400 });
  ok(G.tryTether(s, h.id, a.id).ok);
  G.drainEvents(s);
  run(s, 60);
  eq(s.tethers.length, 0);
  const reasons = G.drainEvents(s).filter(function (e) { return e.type === "tether_cut"; }).map(function (e) { return e.reason; });
  ok(reasons.indexOf("offscreen") >= 0 && reasons.indexOf("cascade") >= 0, reasons.join());
  ok(a.tether === 0);
});
test("relays: Relay Hub style relayCostMul halves tethers drawn from relays", function () {
  const s = quiet(1);
  const h = huskOn(s, 0, 180, 420);
  G.makeRelay(s, h.id);
  addRock(s, { x: 180, y: 330 });
  s.mods.relayCostMul = 0.5;
  near(G.previewTether(s, h.id, 180, 330, 5).cost, 90 * 0.25 * 0.5, 1e-9);
});

// ---- warp

function nearlyFull(seed, opts) {
  const s = quiet(seed || 1, opts);
  s.params.scroll = 0;
  const a = addRock(s, { x: 180, y: 459, amount: 40 });
  G.tryTether(s, 0, a.id);
  s.gauge = s.params.gaugeMax - 1;
  return s;
}
test("warp: gauge full -> warp for 1.2 s -> cards with an offer; score +300 once", function () {
  const s = nearlyFull(3);
  s.score = 0;
  let ticks = 0;
  while (s.phase === "play" && ticks++ < 3000) G.step(s);
  eq(s.phase, "warp");
  near(s.gauge, s.params.gaugeMax);
  const full = G.drainEvents(s).filter(function (e) { return e.type === "gauge_full"; });
  eq(full, [{ type: "gauge_full", sector: 1 }]);
  const scoreAtFull = s.score;
  ok(scoreAtFull >= 300 && scoreAtFull < 300 + 100);
  near(s.phaseT, 1.2, 1e-9);
  let n = 0;
  while (s.phase === "warp") { G.step(s); n++; }
  ok(n >= 72 && n <= 73, "warp lasts " + n + " ticks");
  eq(s.phase, "cards");
  eq(s.offer.length, 3);
  eq(G.drainEvents(s).filter(function (e) { return e.type === "cards_offered"; })[0].ids, s.offer);
  eq(s.score, scoreAtFull, "no second sector bonus");
});
test("warp: only the field drifts; drones and timers freeze; offscreen cuts still apply", function () {
  const s = nearlyFull(3);
  s.timers.flare = 10;
  let ticks = 0;
  while (s.phase === "play" && ticks++ < 3000) G.step(s);
  eq(s.phase, "warp");
  s.params.scroll = 30;
  const rock = s.rocks[0], y0 = rock.y, flare0 = s.timers.flare, spawn0 = s.timers.spawn, tick0 = s.sectorTick;
  const dronesBefore = JSON.stringify(s.drones.map(function (d) { return [d.mode, d.d, d.cargo]; }));
  run(s, 30);
  near(rock.y - y0, 30 * 30 * TICK, 1e-9);
  eq(s.timers.flare, flare0); eq(s.timers.spawn, spawn0); eq(s.sectorTick, tick0);
  eq(JSON.stringify(s.drones.map(function (d) { return [d.mode, d.d, d.cargo]; })), dronesBefore);
  rock.y = 700;
  G.drainEvents(s);
  run(s, 1);
  eq(s.tethers.length, 0);
  eq(G.drainEvents(s).filter(function (e) { return e.type === "tether_cut"; })[0].reason, "offscreen");
});
test("warp: player actions are refused during warp and cards", function () {
  const s = nearlyFull(3);
  const a = addRock(s, { x: 100, y: 300 });
  s.gauge = s.params.gaugeMax;
  s.phase = "warp"; s.phaseT = 1.2;
  eq(G.tryTether(s, 0, a.id).reason, "bad_phase");
  eq(G.cutAcross(s, 0, 0, 360, 640).cut, []);
  eq(G.pickCard(s, "extra_drones").reason, "bad_phase");
});
test("warp: gauge clamps at gaugeMax and overflow is lost", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  s.gauge = s.params.gaugeMax - 1;
  const a = addRock(s, { x: 180, y: 500, amount: 50, type: "crystal" });
  G.tryTether(s, 0, a.id);
  run(s, 60 * 20);
  near(s.gauge, s.params.gaugeMax);
  ok(s.phase === "warp" || s.phase === "cards");
});

// ---- offers and picks

function offerAt(seed, sector, cards) {
  const s = quiet(seed, { sector: sector });
  Object.keys(cards || {}).forEach(function (k) { s.cards[k] = cards[k]; });
  s.gauge = s.params.gaugeMax;
  s.phase = "warp"; s.phaseT = TICK;
  run(s, 2);
  return s;
}
test("offer: 3 distinct real cards, same seed same offer, different seed varies", function () {
  const a = offerAt(5, 1), b = offerAt(5, 1);
  eq(a.phase, "cards");
  eq(a.offer.length, 3);
  eq(new Set(a.offer).size, 3);
  a.offer.forEach(function (id) { ok(id !== "patch_kit"); });
  eq(a.offer, b.offer);
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) seen.add(offerAt(seed, 1).offer.join());
  ok(seen.size > 5, "offers vary with the seed");
});
test("offer: epics only after sector 3 is cleared; maxed cards are excluded", function () {
  for (let seed = 1; seed <= 60; seed++) ok(offerAt(seed, 2).offer.indexOf("crystal_chain") < 0, "no epic in sector 2");
  let epics = 0;
  for (let seed = 1; seed <= 80; seed++) if (offerAt(seed, 3).offer.indexOf("crystal_chain") >= 0) epics++;
  ok(epics > 0, "crystal chain shows up once sector 3 is cleared");
  for (let seed = 1; seed <= 40; seed++) {
    ok(offerAt(seed, 3, { crystal_chain: 2, extra_drones: 5 }).offer.every(function (id) { return id !== "crystal_chain" && id !== "extra_drones"; }));
  }
});
test("offer: rarity weights come out near 60 / 30 / 10", function () {
  const c = { common: 0, rare: 0, epic: 0 };
  for (let seed = 1; seed <= 400; seed++) {
    offerAt(seed, 3).offer.forEach(function (id) { c[G.CARDS.find(function (k) { return k.id === id; }).rarity]++; });
  }
  ok(c.common > c.rare && c.rare > c.epic, JSON.stringify(c));
  ok(c.epic > 20, JSON.stringify(c));
});
test("offer: patch kit fills in when the pool runs dry (never more than one)", function () {
  const all = {};
  G.CARDS.forEach(function (c) { if (c.id !== "patch_kit") all[c.id] = c.max; });
  const left = Object.assign({}, all); left.live_wire = 0; left.splitter = 0;
  const s = offerAt(2, 3, left);
  eq(s.offer.slice().sort(), ["live_wire", "patch_kit", "splitter"].sort());
  const none = offerAt(2, 3, all);
  eq(none.offer, ["patch_kit"]);
});
test("pickCard: reasons, applies the card, starts the next sector", function () {
  const s = quiet(8);
  s.params.scroll = 0;
  const a = addRock(s, { x: 180, y: 459, amount: 40 });
  G.tryTether(s, 0, a.id);
  addRock(s, { x: 50, y: 100, amount: 0 });
  s.station.hp = 60;
  s.gauge = s.params.gaugeMax;
  s.phase = "warp"; s.phaseT = TICK;
  s.raiders.push({ id: s.nextId++, x: 10, y: 10, hp: 5, hpMax: 5, mode: "approach", tether: 0, d: 0, t: 0 });
  run(s, 2);
  eq(s.phase, "cards");
  eq(G.pickCard(s, "nope").reason, "not_offered");
  G.drainEvents(s);
  const id = s.offer[0];
  const score0 = s.score;
  ok(G.pickCard(s, id).ok);
  eq(G.pickCard(s, id).reason, "bad_phase");
  eq(s.phase, "play"); eq(s.sector, 2); eq(s.cards[id], 1); eq(s.offer, []); eq(s.gauge, 0);
  eq(s.tethers.length, 0); eq(s.raiders.length, 0); eq(s.rocks.length, 7);
  ok(s.rocks.every(function (r) { return r.tether === 0 && !r.relay && !r.depleted; }));
  s.drones.forEach(function (d) { eq(d.mode, "idle"); });
  near(s.power.use, 0);
  ok(s.station.hp >= 75 - 1e-9 && s.station.hp <= 75 + 30 + 1e-9, "warp repair of 15 (plus the card)");
  eq(s.score, score0);
  eq(s.params, G.sectorParams(2));
  eq(s.timers.flare, 20);
  eq(s.stats.cardsPicked, 1);
  const ev = types(G.drainEvents(s));
  ok(ev.indexOf("card_picked") >= 0 && ev.indexOf("sector_start") >= 0);
});
test("pickCard: warp repair is capped at hpMax", function () {
  const s = offerAt(4, 1);
  s.station.hp = 95;
  s.offer = ["overclock", "power_cell", "bigger_holds"];
  G.pickCard(s, "overclock");
  eq(s.station.hp, 100);
  ok(!("starsRun" in s));
});

// ---- cards

test("cards: every card's fx changes the mods as in 3.2", function () {
  const want = {
    extra_drones: { droneAdd: 2 }, overclock: { droneSpeedMul: 1.2 }, bigger_holds: { capAdd: 2 }, power_cell: { powerAdd: 25 },
    long_reach: { maxLenAdd: 60, severAdd: 30 }, point_defense: { turretRangeAdd: 25, turretDpsAdd: 6 },
    reinforced_hull: { hullAdd: 25 }, coolant_loop: { iceRepair: 1.0 }, splitter: { splitShare: 0.4 },
    live_wire: { zapDps: 10 }, crystal_chain: { chainRange: 90 }, patch_kit: {}
  };
  eq(G.CARDS.length, 12);
  G.CARDS.forEach(function (c) {
    const m = G.computeMods(Object.fromEntries([[c.id, 1]]));
    const base = G.computeMods({});
    Object.keys(want[c.id]).forEach(function (k) { near(m[k], want[c.id][k], 1e-9, c.id + "." + k); });
    Object.keys(m).forEach(function (k) { if (!(k in want[c.id])) near(m[k], base[k], 1e-9, c.id + " leaves " + k); });
  });
  eq(G.CARDS.filter(function (c) { return c.rarity === "common"; }).length, 8);
});
test("cards: stacking to max, Crystal Chain 90 then 130, fresh computeMods equals incremental", function () {
  near(G.computeMods({ extra_drones: 5 }).droneAdd, 10);
  near(G.computeMods({ overclock: 3 }).droneSpeedMul, 1.728, 1e-9);
  near(G.computeMods({ crystal_chain: 2 }).chainRange, 130);
  near(G.computeMods({ live_wire: 2 }).zapDps, 20);
  near(G.computeMods({ splitter: 2 }).splitShare, 0.8, 1e-9);
  const s = offerAt(6, 3);
  G.pickCard(s, s.offer[0]);
  eq(s.mods, G.computeMods(s.cards));
  ok(G.cardText("crystal_chain", 1).indexOf("90") > 0);
  ok(G.cardText("crystal_chain", 2).indexOf("130") > 0);
  eq(G.cardText("extra_drones", 2), "+4 drones.");
});
test("cards: Extra Drones adds idle drones at once; Hull and Patch Kit heal", function () {
  const s = offerAt(1, 1);
  s.offer[0] = "extra_drones";
  const n0 = s.drones.length;
  ok(G.pickCard(s, "extra_drones").ok);
  eq(s.drones.length, n0 + 2);
  const s2 = offerAt(1, 1);
  s2.offer[0] = "reinforced_hull";
  s2.station.hp = 40;
  G.pickCard(s2, "reinforced_hull");
  eq(s2.station.hpMax, 125);
  near(s2.station.hp, 40 + 25 + 15, 1e-9);
  const s3 = offerAt(1, 1);
  s3.offer[0] = "patch_kit"; s3.station.hp = 10;
  G.pickCard(s3, "patch_kit");
  near(s3.station.hp, 10 + 30 + 15, 1e-9);
});
test("cards: Power Cell and Long Reach change the budget and the reach", function () {
  const s = offerAt(1, 1);
  s.offer[0] = "power_cell";
  G.pickCard(s, "power_cell");
  eq(s.power.budget, 125);
  const l = offerAt(1, 1);
  l.offer[0] = "long_reach";
  G.pickCard(l, "long_reach");
  l.rocks.length = 0;
  const far = addRock(l, { x: 10, y: 310, size: "s" });
  ok(G.tryTether(l, 0, far.id).ok, "reach is 360 now");
});

test("splitter: a full drone delivers a 40% bonus that is not taken from the rock", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  s.mods = G.computeMods({ splitter: 1 });
  const a = addRock(s, { x: 180, y: 459, amount: 40 });
  G.tryTether(s, 0, a.id);
  G.drainEvents(s);
  run(s, 60 * 6);
  const evs = G.drainEvents(s);
  ok(evs.some(function (e) { return e.type === "drone_split"; }), "split event");
  const del = evs.filter(function (e) { return e.type === "delivery"; })[0];
  near(del.amount, 7, 1e-9);
  near(del.value, 7, 1e-9);
  const hauled = s.stats.delivered.ore + s.drones.reduce(function (m, d) { return m + d.cargo; }, 0);
  ok(40 - a.amount < hauled, "more was delivered than was taken from the rock");
  ok(s.score >= 70);
});
test("crystal chain: mined-out crystal turns the nearest live non-crystal rock within range, then chains", function () {
  const s = quiet(1);
  s.params.scroll = 0;
  s.mods = G.computeMods({ crystal_chain: 1 });
  const c1 = addRock(s, { x: 180, y: 459, amount: 2, type: "crystal" });
  const far = addRock(s, { x: 180, y: 300, type: "ore" });           // 159 away: out of range
  const mid = addRock(s, { x: 270, y: 400, type: "ore" });           // 107 away: out of range 90
  const nearIce = addRock(s, { x: 180, y: 380, type: "ice" });       // 79 away
  const nearOre = addRock(s, { x: 230, y: 420, type: "ore" });       // 63 away: nearest
  G.tryTether(s, 0, c1.id);
  G.drainEvents(s);
  run(s, 60 * 5);
  ok(c1.depleted);
  eq(nearOre.type, "crystal");
  eq(nearIce.type, "ice"); eq(far.type, "ore"); eq(mid.type, "ore");
  eq(G.drainEvents(s).filter(function (e) { return e.type === "crystal_chain"; }), [{ type: "crystal_chain", from: c1.id, to: nearOre.id }]);
  // it chains again when the converted rock empties
  nearOre.amount = 0.01; nearOre.amountMax = 0.01;
  ok(G.tryTether(s, 0, nearOre.id).ok);
  run(s, 60 * 6);
  ok(nearOre.depleted);
  eq(mid.type, "crystal", "chained on to the next nearest rock");
  eq(nearIce.type, "ice");
  // without the card nothing converts
  const t = quiet(1);
  t.params.scroll = 0;
  const d1 = addRock(t, { x: 180, y: 459, amount: 2, type: "crystal" });
  const o = addRock(t, { x: 230, y: 420, type: "ore" });
  G.tryTether(t, 0, d1.id);
  run(t, 60 * 5);
  eq(o.type, "ore");
});

// ---- run over

test("abandonRun: ends the run once, step becomes a no-op", function () {
  const s = G.newRun(2);
  const r = G.abandonRun(s);
  ok(r.ok); eq(s.phase, "over"); eq(s.over.reason, "abandoned");
  eq(G.abandonRun(s).reason, "bad_phase");
  const t = s.tick;
  run(s, 10);
  eq(s.tick, t);
  eq(G.drainEvents(s).filter(function (e) { return e.type === "run_over"; }).length, 1);
});
test("step is a no-op in phase cards", function () {
  const s = G.newRun(2);
  s.phase = "cards";
  const h = G.hashState(s);
  run(s, 10);
  eq(G.hashState(s), h);
});

// ---- determinism and save

function script(s) {
  const t = s.tick;
  if (t % 45 === 0) {
    for (let i = 0; i < s.rocks.length; i++) {
      if (G.tryTether(s, 0, s.rocks[i].id).ok) break;
    }
  }
  if (t % 200 === 100) G.cutAcross(s, 0, 300 + (t % 7) * 10, 360, 450);
}
function play(s, n) { for (let i = 0; i < n; i++) { script(s); G.step(s); } }

test("determinism: same seed and script for 3600 ticks give the same hash", function () {
  const a = G.newRun(2024), b = G.newRun(2024), c = G.newRun(2025);
  play(a, 3600); play(b, 3600); play(c, 3600);
  eq(G.hashState(a), G.hashState(b));
  ok(G.hashState(a) !== G.hashState(c));
  ok(a.score > 0, "the script actually mined something");
  ok(a.stats.tethersMade > 5);
});
test("determinism: save at tick 1000, load, continue gives the same hash", function () {
  const a = G.newRun(77), b = G.newRun(77);
  play(a, 3600);
  play(b, 1000);
  const text = G.serializeRun(b);
  ok(text.indexOf("\"events\"") < 0, "events stripped");
  const l = G.loadRun(text);
  ok(l.ok);
  eq(G.hashState(l.state), G.hashState(b));
  play(l.state, 2600);
  eq(G.hashState(l.state), G.hashState(a));
});
test("save: loadRun reasons", function () {
  eq(G.loadRun("{nope").reason, "parse");
  eq(G.loadRun(JSON.stringify({ v: 9 })).reason, "version");
  const s = G.newRun(1);
  const o = JSON.parse(G.serializeRun(s));
  delete o.rocks;
  eq(G.loadRun(JSON.stringify(o)).reason, "shape");
});
test("hashState: changes when state changes, ignores events", function () {
  const s = G.newRun(5);
  const h = G.hashState(s);
  s.events.push({ type: "x" });
  eq(G.hashState(s), h);
  s.score = 1;
  ok(G.hashState(s) !== h);
});
test("drainEvents: empties the queue and caps at 128", function () {
  const s = G.newRun(5);
  for (let i = 0; i < 300; i++) s.events.push({ type: "t", i: i });
  G.step(s);
  ok(s.events.length <= 301);
  const s2 = quiet(1);
  s2.params.scroll = 0;
  const a = addRock(s2, { x: 180, y: 400 });
  for (let i = 0; i < 200; i++) { G.tryTether(s2, 0, a.id); G.cutTether(s2, s2.tethers[0] ? s2.tethers[0].id : 0); }
  ok(s2.events.length <= 128);
  const ev = G.drainEvents(s2);
  ok(ev.length > 0 && s2.events.length === 0);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
