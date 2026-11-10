/* Tether rules. Pure, deterministic, no browser or clock access.
 * Everything here is driven by step(state) at a fixed TICK and by the player API.
 * See ARCHITECTURE.md sections 2, 5 and 6. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TetherGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = "0.1.0";
  const SAVE_VERSION = 1;
  const TICK = 1 / 60;

  function deepFreeze(o) {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    }
    return o;
  }

  const TUNING = deepFreeze({
    world:   { w: 360, h: 640, spawnY: -30, despawnY: 680 },
    station: { x: 180, y: 560, r: 22, hp: 100, warpRepair: 15,
               turret: { range: 70, dps: 12 } },
    rocks:   { max: 22, prePlace: 7, prePlaceY: [60, 420], xMin: 26, xMax: 334, gap: 44, gapYBand: 60, tries: 6,
               jitter: 0.3, starChance: 0.04, icePct: 24,
               sizes: { s: { r: 10, w: 45, amount: [12, 18] },
                        m: { r: 15, w: 40, amount: [24, 34] },
                        l: { r: 21, w: 15, amount: [40, 56] } } },
    resources: { ore:     { value: 1 },
                 ice:     { value: 1, repair: 0.5 },
                 crystal: { value: 4 } },
    tether:  { perUnit: 0.25, budget: 100, maxLen: 300, minLen: 30, max: 12, brownoutSpeed: 0.5 },
    drones:  { start: 6, speed: 70, cap: 5, rate: 5, unload: 0.3, perTether: 4, stagger: 0.25, max: 30 },
    relay:   { max: 4, depth: 3, r: 12 },
    flare:   { firstSector: 2, firstDelay: 20, gapFirst: 30, gapStep: -2, gapMin: 16, jitter: 0.25, warn: 3.0,
               severFirst: 200, severStep: -10, severMin: 130 },
    raiders: { firstSector: 3, firstDelay: 15, gapFirst: 28, gapStep: -2, gapMin: 12, jitter: 0.25, warn: 2.5,
               countFirst: 1, countEvery: 2, countMax: 5, approach: 30, latch: 6, r: 9, max: 12,
               hpFirst: 30, hpStep: 6, rideFirst: 32, rideStep: 2, rideMax: 50,
               ramFirst: 15, ramStep: 2, ramMax: 30, xMin: 30, xMax: 330 },
    sectors: { scrollFirst: 7, scrollStep: 1.2, scrollMax: 16,
               gaugeFirst: 150, gaugeStep: 70,
               spawnFirst: 3.0, spawnStep: -0.2, spawnMin: 1.6,
               crystalFirst: 8, crystalStep: 2, crystalMax: 18 },
    warp:    { time: 1.2 },
    score:   { perValue: 10, sector: 300, raider: 50, starRock: 100 },
    stars:   { perWarp: 1, perStarRock: 1 },
    cards:   { weights: { common: 60, rare: 30, epic: 10 }, epicFrom: 3, offer: 3 },
    events:  { max: 128 }
  });

  // Prototype pool: the 8 commons, Splitter, Live Wire, Crystal Chain and the Patch Kit filler (3.2).
  // `fx` applies once per stack; `stackFx` (optional) lists the effects of each stack instead (Crystal Chain).
  // `max: 0` means unlimited. The other rares and epics arrive in M4.
  const CARDS = deepFreeze([
    { id: "extra_drones", name: "Extra Drones", rarity: "common", max: 5, text: "+2 drones.", fx: [["droneAdd", "add", 2]] },
    { id: "overclock", name: "Overclock", rarity: "common", max: 3, text: "Drones move 20% faster.", fx: [["droneSpeedMul", "mul", 1.2]] },
    { id: "bigger_holds", name: "Bigger Holds", rarity: "common", max: 3, text: "+2 cargo per drone.", fx: [["capAdd", "add", 2]] },
    { id: "power_cell", name: "Power Cell", rarity: "common", max: 4, text: "+25 power.", fx: [["powerAdd", "add", 25]] },
    { id: "long_reach", name: "Long Reach", rarity: "common", max: 2, text: "Tethers reach 60 further and survive flares 30 longer.",
      fx: [["maxLenAdd", "add", 60], ["severAdd", "add", 30]] },
    { id: "point_defense", name: "Point Defense", rarity: "common", max: 3, text: "Turret range +25, damage +6/s.",
      fx: [["turretRangeAdd", "add", 25], ["turretDpsAdd", "add", 6]] },
    { id: "reinforced_hull", name: "Reinforced Hull", rarity: "common", max: 4, text: "+25 max hull and repair 25.",
      fx: [["hullAdd", "add", 25]], now: [["heal", 25]] },
    { id: "coolant_loop", name: "Coolant Loop", rarity: "common", max: 2, text: "Ice repairs +0.5 hull per unit.", fx: [["iceRepair", "add", 0.5]] },
    { id: "splitter", name: "Splitter", rarity: "rare", max: 2, text: "A full drone splits off a shard: +40% load, delivered with it.",
      fx: [["splitShare", "add", 0.4]] },
    { id: "live_wire", name: "Live Wire", rarity: "rare", max: 2, text: "Raiders riding a tether take 10 damage per second.",
      fx: [["zapDps", "add", 10]] },
    { id: "crystal_chain", name: "Crystal Chain", rarity: "epic", max: 2,
      text: "A mined-out crystal turns the nearest rock within 90 into crystal.",
      fx: [["chainRange", "add", 90]], stackFx: [[["chainRange", "add", 90]], [["chainRange", "add", 40]]] },
    { id: "patch_kit", name: "Patch Kit", rarity: "filler", max: 0, text: "Repair 30 hull.", fx: [], now: [["heal", 30]] }
  ]);
  const LOOKS = deepFreeze([]);

  // Effect text for a card at a stack count (what you have once you own `stacks`).
  const CARD_TEXT = {
    extra_drones: function (n) { return "+" + 2 * n + " drones."; },
    overclock: function (n) { return "Drones move " + Math.round((Math.pow(1.2, n) - 1) * 100) + "% faster."; },
    bigger_holds: function (n) { return "+" + 2 * n + " cargo per drone."; },
    power_cell: function (n) { return "+" + 25 * n + " power."; },
    long_reach: function (n) { return "Tethers reach " + 60 * n + " further; flare limit +" + 30 * n + "."; },
    point_defense: function (n) { return "Turret range +" + 25 * n + ", damage +" + 6 * n + "/s."; },
    reinforced_hull: function (n) { return "+" + 25 * n + " max hull; repairs 25 when taken."; },
    coolant_loop: function (n) { return "Ice repairs " + (0.5 + 0.5 * n) + " hull per unit."; },
    splitter: function (n) { return "A full drone splits off a shard worth +" + 40 * n + "% of its load."; },
    live_wire: function (n) { return "Raiders riding a tether take " + 10 * n + " damage per second."; },
    crystal_chain: function (n) { return "A mined-out crystal turns the nearest rock within " + (n >= 2 ? 130 : 90) + " into crystal."; },
    patch_kit: function () { return "Repair 30 hull."; }
  };

  const T = TUNING;

  // ---------------------------------------------------------------- RNG

  function hash32(seed, name) {
    let h = 0x811c9dc5;
    let s = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      h ^= s & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      s >>>= 8;
    }
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32 over an explicit state number; returns [value, newState].
  function mulberryStep(s) {
    const a = (s + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
  }

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      const r = mulberryStep(s);
      s = r[1];
      return r[0];
    };
  }

  function rnd(state, stream) {
    const r = mulberryStep(state.rng[stream]);
    state.rng[stream] = r[1];
    return r[0];
  }

  function rndInt(state, stream, lo, hi) {
    return lo + Math.floor(rnd(state, stream) * (hi - lo + 1));
  }

  // ---------------------------------------------------------------- sectors and mods

  function sectorParams(n) {
    const S = T.sectors, F = T.flare, R = T.raiders;
    const p = {
      scroll: Math.min(S.scrollMax, S.scrollFirst + S.scrollStep * (n - 1)),
      gaugeMax: S.gaugeFirst + S.gaugeStep * (n - 1),
      spawnGap: Math.max(S.spawnMin, S.spawnFirst + S.spawnStep * (n - 1)),
      crystalPct: Math.min(S.crystalMax, S.crystalFirst + S.crystalStep * (n - 1)),
      flareGap: 0, severLen: 0, raidGap: 0, raidCount: 0, raiderHp: 0, rideSpeed: 0, ramDmg: 0
    };
    if (n >= F.firstSector) {
      p.flareGap = Math.max(F.gapMin, F.gapFirst + F.gapStep * (n - F.firstSector));
      p.severLen = Math.max(F.severMin, F.severFirst + F.severStep * (n - F.firstSector));
    }
    if (n >= R.firstSector) {
      const k = n - R.firstSector;
      p.raidGap = Math.max(R.gapMin, R.gapFirst + R.gapStep * k);
      p.raidCount = Math.min(R.countMax, R.countFirst + Math.floor(k / R.countEvery));
      p.raiderHp = R.hpFirst + R.hpStep * k;
      p.rideSpeed = Math.min(R.rideMax, R.rideFirst + R.rideStep * k);
      p.ramDmg = Math.min(R.ramMax, R.ramFirst + R.ramStep * k);
    }
    return p;
  }

  function baseMods() {
    return { droneAdd: 0, droneSpeedMul: 1, capAdd: 0, powerAdd: 0, costMul: 1, relayCostMul: 1, maxLenAdd: 0,
             severAdd: 0, splitShare: 0, zapDps: 0, chainRange: 0, turretRangeAdd: 0, turretDpsAdd: 0,
             hullAdd: 0, iceRepair: 0.5, flareBlocks: 0, noOverstretch: 0 };
  }

  function computeMods(cards) {
    const m = baseMods();
    CARDS.forEach(function (c) {
      const n = (cards && cards[c.id]) || 0;
      for (let i = 0; i < n; i++) {
        (c.stackFx ? c.stackFx[Math.min(i, c.stackFx.length - 1)] : c.fx).forEach(function (fx) {
          if (fx[1] === "add") m[fx[0]] += fx[2];
          else m[fx[0]] *= fx[2];
        });
      }
    });
    return m;
  }

  function getCard(id) {
    for (let i = 0; i < CARDS.length; i++) if (CARDS[i].id === id) return CARDS[i];
    return null;
  }

  function cardText(cardId, stacks) {
    const c = getCard(cardId);
    if (!c) return "";
    const f = CARD_TEXT[cardId];
    return f ? f(Math.max(1, stacks || 0)) : c.text;
  }

  // ---------------------------------------------------------------- helpers

  function emit(state, ev) {
    state.events.push(ev);
    if (state.events.length > T.events.max) state.events.shift();
  }

  function getRock(state, id) {
    for (let i = 0; i < state.rocks.length; i++) if (state.rocks[i].id === id) return state.rocks[i];
    return null;
  }

  function getTether(state, id) {
    for (let i = 0; i < state.tethers.length; i++) if (state.tethers[i].id === id) return state.tethers[i];
    return null;
  }

  function nodePos(state, id) {
    if (id === 0) return { x: state.station.x, y: state.station.y };
    const r = getRock(state, id);
    return r ? { x: r.x, y: r.y } : null;
  }

  function dist(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function tetherEnds(state, id) {
    const t = getTether(state, id);
    if (!t) return null;
    const a = nodePos(state, t.from), b = nodePos(state, t.to);
    if (!a || !b) return null;
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let u = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    u = Math.max(0, Math.min(1, u));
    return dist(px, py, x1 + u * dx, y1 + u * dy);
  }

  // Nearest point on a segment: { x, y, u (0..1), d (distance from p) }.
  function closestOnSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let u = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    u = Math.max(0, Math.min(1, u));
    const x = x1 + u * dx, y = y1 + u * dy;
    return { x: x, y: y, u: u, d: dist(px, py, x, y) };
  }

  function orient(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  function onSeg(ax, ay, bx, by, cx, cy) {
    return Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) && Math.min(ay, by) <= cy && cy <= Math.max(ay, by);
  }

  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy);
    const o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
    if (o1 === 0 && onSeg(ax, ay, bx, by, cx, cy)) return true;
    if (o2 === 0 && onSeg(ax, ay, bx, by, dx, dy)) return true;
    if (o3 === 0 && onSeg(cx, cy, dx, dy, ax, ay)) return true;
    if (o4 === 0 && onSeg(cx, cy, dx, dy, bx, by)) return true;
    return false;
  }

  // Number of relays in the chain from the station up to and including node `id` (0 = station).
  function relayDepth(state, id) {
    let n = 0, cur = id, guard = 0;
    while (cur !== 0 && guard++ < 16) {
      n++;
      const r = getRock(state, cur);
      const t = r ? getTether(state, r.tether) : null;
      if (!t) return n;
      cur = t.from;
    }
    return n;
  }

  function powered(state, rockId) {
    let cur = rockId, guard = 0;
    while (cur !== 0 && guard++ < 16) {
      const r = getRock(state, cur);
      if (!r || !r.relay) return false;
      const t = getTether(state, r.tether);
      if (!t) return false;
      cur = t.from;
    }
    return cur === 0;
  }

  // Tethers from the station down to tether `id`, root first.
  function chainOf(state, id) {
    const out = [];
    let t = getTether(state, id), guard = 0;
    while (t && guard++ < 16) {
      out.push(t);
      if (t.from === 0) break;
      const r = getRock(state, t.from);
      t = r ? getTether(state, r.tether) : null;
    }
    return out.reverse();
  }

  function pathLength(state, id) {
    const ch = chainOf(state, id);
    let s = 0;
    for (let i = 0; i < ch.length; i++) s += ch[i].len;
    return s;
  }

  function pointAlong(state, id, d) {
    const ch = chainOf(state, id);
    let rem = d;
    for (let i = 0; i < ch.length; i++) {
      const e = tetherEnds(state, ch[i].id);
      if (!e) break;
      const l = ch[i].len;
      if (rem <= l || i === ch.length - 1) {
        const u = l > 0 ? Math.max(0, Math.min(1, rem / l)) : 0;
        return { x: e.x1 + (e.x2 - e.x1) * u, y: e.y1 + (e.y2 - e.y1) * u };
      }
      rem -= l;
    }
    return { x: state.station.x, y: state.station.y };
  }

  function computePower(state) {
    let use = 0;
    for (let i = 0; i < state.tethers.length; i++) use += state.tethers[i].cost;
    state.power.use = use;
    state.power.budget = T.tether.budget + state.mods.powerAdd;
  }

  function tetherCost(state, fromId, len) {
    let c = len * T.tether.perUnit * state.mods.costMul;
    if (fromId !== 0) c *= state.mods.relayCostMul;
    return c;
  }

  function maxLen(state) {
    return T.tether.maxLen + state.mods.maxLenAdd;
  }

  // ---------------------------------------------------------------- run creation

  function makeRock(state, x, y) {
    const sizes = T.rocks.sizes;
    const roll = rnd(state, "field") * 100;
    const size = roll < sizes.s.w ? "s" : roll < sizes.s.w + sizes.m.w ? "m" : "l";
    const crystal = rnd(state, "field") * 100 < state.params.crystalPct;
    let type = "crystal";
    if (!crystal) type = rnd(state, "field") * 100 < T.rocks.icePct ? "ice" : "ore";
    const sz = sizes[size];
    const amount = rndInt(state, "field", sz.amount[0], sz.amount[1]);
    const rock = { id: state.nextId++, x: x, y: y, r: sz.r, size: size, type: type, amount: amount,
                   amountMax: amount, depleted: false, relay: false, tether: 0 };
    state.rocks.push(rock);
    return rock;
  }

  function spacingOk(state, x, y, bandY) {
    for (let i = 0; i < state.rocks.length; i++) {
      const r = state.rocks[i];
      if (bandY !== null && r.y >= bandY) continue;
      if (dist(x, y, r.x, r.y) < T.rocks.gap) return false;
    }
    return true;
  }

  function trySpawn(state, y, bandY) {
    for (let i = 0; i < T.rocks.tries; i++) {
      const x = T.rocks.xMin + rnd(state, "field") * (T.rocks.xMax - T.rocks.xMin);
      if (spacingOk(state, x, y, bandY)) return makeRock(state, x, y);
    }
    return null;
  }

  function jittered(state, stream, v, j) {
    return v * (1 + (rnd(state, stream) * 2 - 1) * j);
  }

  function prePlace(state) {
    let placed = 0, attempts = 0;
    const yr = T.rocks.prePlaceY;
    while (placed < T.rocks.prePlace && attempts++ < 80) {
      const y = yr[0] + rnd(state, "field") * (yr[1] - yr[0]);
      if (trySpawn(state, y, null)) placed++;
    }
  }

  function newRun(seed, opts) {
    opts = opts || {};
    seed = seed >>> 0;
    const sector = Math.max(1, Math.floor(opts.sector || 1));
    const mods = computeMods({});
    const params = sectorParams(sector);
    const state = {
      v: SAVE_VERSION,
      seed: seed,
      rng: { field: hash32(seed, "field"), events: hash32(seed, "events"), cards: hash32(seed, "cards") },
      tick: 0,
      phase: "play",
      phaseT: 0,
      sector: sector,
      sectorTick: 0,
      params: params,
      gauge: 0,
      score: 0,
      station: { x: T.station.x, y: T.station.y, r: T.station.r, hp: T.station.hp + mods.hullAdd,
                 hpMax: T.station.hp + mods.hullAdd, beam: 0 },
      power: { budget: T.tether.budget + mods.powerAdd, use: 0, brownout: false },
      rocks: [],
      tethers: [],
      drones: [],
      raiders: [],
      timers: { spawn: 0, flare: 0, flareWarn: 0, raid: 0 },
      flare: { blocksLeft: mods.flareBlocks },
      cards: {},
      mods: mods,
      offer: [],
      stats: { delivered: { ore: 0, ice: 0, crystal: 0 }, raidersKilled: 0, tethersMade: 0,
               relaysMade: 0, flaresSurvived: 0, cardsPicked: 0 },
      nextId: 1,
      events: [],
      over: null
    };
    const n = Math.min(T.drones.max, T.drones.start + mods.droneAdd);
    for (let i = 0; i < n; i++) state.drones.push(newDrone(state));
    startSectorField(state);
    return state;
  }

  function newDrone(state) {
    return { id: state.nextId++, tether: 0, mode: "idle", d: 0, x: state.station.x, y: state.station.y,
             cargo: 0, cargoType: "ore", bonus: 0, t: 0 };
  }

  // Pre-place the field and arm the timers for the sector in state.sector.
  function startSectorField(state) {
    const p = state.params;
    state.sectorTick = 0;
    prePlace(state);
    state.timers.spawn = jittered(state, "field", p.spawnGap, T.rocks.jitter);
    state.timers.flare = state.sector >= T.flare.firstSector ? T.flare.firstDelay : 0;
    state.timers.flareWarn = 0;
    state.timers.raid = state.sector >= T.raiders.firstSector ? T.raiders.firstDelay : 0;
  }

  // ---------------------------------------------------------------- cutting

  function removeTether(state, id, reason) {
    let idx = -1;
    for (let i = 0; i < state.tethers.length; i++) if (state.tethers[i].id === id) { idx = i; break; }
    if (idx < 0) return [];
    const t = state.tethers[idx];
    const e = tetherEnds(state, id);
    const mx = e ? (e.x1 + e.x2) / 2 : state.station.x;
    const my = e ? (e.y1 + e.y2) / 2 : state.station.y;
    state.tethers.splice(idx, 1);
    const rock = getRock(state, t.to);
    if (rock) rock.tether = 0;
    for (let i = 0; i < state.drones.length; i++) {
      const d = state.drones[i];
      if (d.tether === id) resetDrone(state, d);
    }
    emit(state, { type: "tether_cut", id: id, reason: reason, x: mx, y: my });
    // Ruling W2: any removal of the ridden tether kills the raider.
    const riders = state.raiders.filter(function (rd) { return rd.mode === "ride" && rd.tether === id; });
    for (let i = 0; i < riders.length; i++) killRaider(state, riders[i], "snap");
    const cut = [id];
    if (rock && rock.relay) {
      const down = [];
      for (let i = 0; i < state.tethers.length; i++) if (state.tethers[i].from === rock.id) down.push(state.tethers[i].id);
      for (let i = 0; i < down.length; i++) {
        const sub = removeTether(state, down[i], "cascade");
        for (let j = 0; j < sub.length; j++) cut.push(sub[j]);
      }
    }
    return cut;
  }

  function resetDrone(state, d) {
    d.tether = 0; d.mode = "idle"; d.d = 0; d.cargo = 0; d.bonus = 0; d.t = 0;
    d.x = state.station.x; d.y = state.station.y;
  }

  // ---------------------------------------------------------------- player API

  function onScreen(r) {
    return r.y - r.r >= 0 && r.y + r.r <= T.world.h;
  }

  // Shared validation for preview and tryTether.
  function checkTether(state, fromId, toId) {
    const fail = function (reason) { return { ok: false, reason: reason }; };
    if (state.phase !== "play") return fail("bad_phase");
    let src = null;
    if (fromId !== 0) {
      src = getRock(state, fromId);
      if (!src || !src.relay) return fail("no_source");
      if (!powered(state, fromId)) return fail("source_unpowered");
    }
    const target = getRock(state, toId);
    if (!target) return fail("no_target");
    if (toId === fromId) return fail("same_node");
    if (target.relay) {
      if (target.tether !== 0) return fail("target_tethered");
    } else {
      if (target.depleted) return fail("target_depleted");
      if (target.tether !== 0) return fail("target_tethered");
    }
    if (!onScreen(target)) return fail("target_offscreen");
    if (target.relay && relayDepth(state, fromId) + 1 > T.relay.depth) return fail("too_deep");
    const a = nodePos(state, fromId);
    const len = dist(a.x, a.y, target.x, target.y);
    const cost = tetherCost(state, fromId, len);
    if (len > maxLen(state)) return { ok: false, reason: "too_long", len: len, cost: cost };
    if (len < T.tether.minLen) return { ok: false, reason: "too_short", len: len, cost: cost };
    if (state.tethers.length >= T.tether.max) return { ok: false, reason: "tether_cap", len: len, cost: cost };
    if (state.power.use + cost > state.power.budget + 1e-9) return { ok: false, reason: "no_power", len: len, cost: cost };
    return { ok: true, reason: "", len: len, cost: cost, kind: target.relay ? "link" : "mine" };
  }

  function previewTether(state, fromId, x, y, snapR) {
    const res = { ok: false, reason: "no_target", toId: 0, x2: x, y2: y, len: 0, cost: 0, powerAfter: state.power.budget - state.power.use };
    if (state.phase !== "play") { res.reason = "bad_phase"; return res; }
    if (fromId !== 0) {
      const s = getRock(state, fromId);
      if (!s || !s.relay) { res.reason = "no_source"; return res; }
      if (!powered(state, fromId)) { res.reason = "source_unpowered"; return res; }
    }
    let best = null, bestD = Infinity, nearest = null, nearestD = Infinity;
    for (let i = 0; i < state.rocks.length; i++) {
      const r = state.rocks[i];
      if (r.id === fromId) continue;
      const d = dist(x, y, r.x, r.y);
      if (d > snapR + r.r) continue;
      if (d < nearestD) { nearestD = d; nearest = r; }
      if (checkTether(state, fromId, r.id).ok && d < bestD) { bestD = d; best = r; }
    }
    if (best) {
      const c = checkTether(state, fromId, best.id);
      res.ok = true; res.reason = ""; res.toId = best.id; res.x2 = best.x; res.y2 = best.y;
      res.len = c.len; res.cost = c.cost; res.powerAfter = state.power.budget - state.power.use - c.cost;
      return res;
    }
    if (nearest) {
      const c = checkTether(state, fromId, nearest.id);
      res.reason = c.reason;
      if (c.len !== undefined) { res.len = c.len; res.cost = c.cost; res.powerAfter = state.power.budget - state.power.use - c.cost; }
    }
    return res;
  }

  function tryTether(state, fromId, toId) {
    const c = checkTether(state, fromId, toId);
    if (!c.ok) return { ok: false, reason: c.reason, id: 0 };
    const t = { id: state.nextId++, from: fromId, to: toId, kind: c.kind, len: c.len, cost: c.cost,
                doomed: false, lastLaunch: -1000 };
    state.tethers.push(t);
    getRock(state, toId).tether = t.id;
    state.stats.tethersMade++;
    computePower(state);
    emit(state, { type: "tether_created", id: t.id, from: fromId, to: toId, kind: t.kind, cost: c.cost });
    return { ok: true, reason: "", id: t.id };
  }

  function cutTether(state, id) {
    if (state.phase !== "play") return { ok: false, reason: "bad_phase", cut: [] };
    if (!getTether(state, id)) return { ok: false, reason: "no_tether", cut: [] };
    const cut = removeTether(state, id, "player");
    computePower(state);
    return { ok: true, reason: "", cut: cut };
  }

  function cutAcross(state, x1, y1, x2, y2) {
    const out = [];
    if (state.phase !== "play") return { cut: out };
    const hit = [];
    for (let i = 0; i < state.tethers.length; i++) {
      const e = tetherEnds(state, state.tethers[i].id);
      if (e && segmentsIntersect(x1, y1, x2, y2, e.x1, e.y1, e.x2, e.y2)) hit.push(state.tethers[i].id);
    }
    for (let i = 0; i < hit.length; i++) {
      if (!getTether(state, hit[i])) continue; // already removed by a cascade
      const c = removeTether(state, hit[i], "player");
      for (let j = 0; j < c.length; j++) out.push(c[j]);
    }
    if (out.length) computePower(state);
    return { cut: out };
  }

  function pick(state, x, y, r) {
    if (dist(x, y, state.station.x, state.station.y) <= state.station.r + r) return { kind: "station", id: 0 };
    let best = null, bestD = Infinity;
    for (let i = 0; i < state.rocks.length; i++) {
      const k = state.rocks[i];
      if (!k.relay) continue;
      const d = dist(x, y, k.x, k.y);
      if (d <= k.r + r && d < bestD) { bestD = d; best = k; }
    }
    if (best) return { kind: "relay", id: best.id };
    for (let i = 0; i < state.rocks.length; i++) {
      const k = state.rocks[i];
      if (k.relay) continue;
      const d = dist(x, y, k.x, k.y);
      if (d <= k.r + r && d < bestD) { bestD = d; best = k; }
    }
    if (best) return { kind: best.depleted ? "husk" : "rock", id: best.id };
    let bt = null;
    bestD = Infinity;
    for (let i = 0; i < state.tethers.length; i++) {
      const e = tetherEnds(state, state.tethers[i].id);
      if (!e) continue;
      const d = distToSegment(x, y, e.x1, e.y1, e.x2, e.y2);
      if (d <= r && d < bestD) { bestD = d; bt = state.tethers[i]; }
    }
    if (bt) return { kind: "tether", id: bt.id };
    return { kind: null, id: 0 };
  }

  function makeRelay(state, rockId) {
    const fail = function (reason) { return { ok: false, reason: reason }; };
    if (state.phase !== "play") return fail("bad_phase");
    const rock = getRock(state, rockId);
    if (!rock) return fail("no_rock");
    if (rock.relay) return fail("already_relay");
    if (!rock.depleted) return fail("not_depleted");
    const link = getTether(state, rock.tether);
    if (!link) return fail("not_tethered");
    let count = 0;
    for (let i = 0; i < state.rocks.length; i++) if (state.rocks[i].relay) count++;
    if (count >= T.relay.max) return fail("relay_cap");
    if (relayDepth(state, link.from) + 1 > T.relay.depth) return fail("too_deep");
    rock.relay = true;
    link.kind = "link";
    state.stats.relaysMade++;
    emit(state, { type: "relay_created", id: rock.id, x: rock.x, y: rock.y });
    return { ok: true, reason: "" };
  }

  function endRun(state, reason) {
    if (state.phase === "over") return;
    state.phase = "over";
    state.station.beam = 0;
    state.over = { reason: reason, score: state.score, sector: state.sector, starsRun: 0 };
    emit(state, { type: "run_over", reason: reason, score: state.score, sector: state.sector, starsRun: 0 });
  }

  function abandonRun(state) {
    if (state.phase === "over") return { ok: false, reason: "bad_phase" };
    endRun(state, "abandoned");
    return { ok: true, reason: "" };
  }

  // ---------------------------------------------------------------- warp and cards

  function drawOffer(state) {
    const pool = CARDS.filter(function (c) {
      if (c.id === "patch_kit") return false;
      if ((state.cards[c.id] || 0) >= c.max) return false;
      if (c.rarity === "epic" && state.sector < T.cards.epicFrom) return false;
      return true;
    });
    const offer = [];
    const rarities = ["common", "rare", "epic"];
    for (let slot = 0; slot < T.cards.offer && pool.length > 0; slot++) {
      let total = 0;
      for (let i = 0; i < rarities.length; i++) {
        if (pool.some(function (c) { return c.rarity === rarities[i]; })) total += T.cards.weights[rarities[i]];
      }
      let roll = rnd(state, "cards") * total, rarity = null;
      for (let i = 0; i < rarities.length; i++) {
        if (!pool.some(function (c) { return c.rarity === rarities[i]; })) continue;
        rarity = rarities[i];
        if (roll < T.cards.weights[rarities[i]]) break;
        roll -= T.cards.weights[rarities[i]];
      }
      const same = pool.filter(function (c) { return c.rarity === rarity; });
      const card = same[Math.min(same.length - 1, Math.floor(rnd(state, "cards") * same.length))];
      offer.push(card.id);
      pool.splice(pool.indexOf(card), 1);
    }
    if (offer.length < T.cards.offer) offer.push("patch_kit");
    return offer;
  }

  function heal(state, n) {
    const before = state.station.hp;
    state.station.hp = Math.min(state.station.hpMax, before + n);
    if (state.station.hp > before) {
      emit(state, { type: "station_repaired", hp: state.station.hp, amount: state.station.hp - before });
    }
  }

  function startNextSector(state) {
    state.tethers.length = 0;
    state.rocks.length = 0;
    state.raiders.length = 0;
    for (let i = 0; i < state.drones.length; i++) resetDrone(state, state.drones[i]);
    state.station.beam = 0;
    if (state.power.brownout) {
      state.power.brownout = false;
      emit(state, { type: "brownout", on: false });
    }
    heal(state, T.station.warpRepair);
    state.sector++;
    state.params = sectorParams(state.sector);
    state.gauge = 0;
    state.phase = "play";
    state.phaseT = 0;
    state.offer = [];
    state.flare.blocksLeft = state.mods.flareBlocks;
    startSectorField(state);
    computePower(state);
    emit(state, { type: "sector_start", sector: state.sector, params: state.params });
  }

  function pickCard(state, cardId) {
    if (state.phase !== "cards") return { ok: false, reason: "bad_phase" };
    if (state.offer.indexOf(cardId) < 0) return { ok: false, reason: "not_offered" };
    const card = getCard(cardId);
    state.cards[cardId] = (state.cards[cardId] || 0) + 1;
    state.mods = computeMods(state.cards);
    state.stats.cardsPicked++;
    state.station.hpMax = T.station.hp + state.mods.hullAdd;
    if (card.now) {
      for (let i = 0; i < card.now.length; i++) if (card.now[i][0] === "heal") heal(state, card.now[i][1]);
    }
    const want = Math.min(T.drones.max, T.drones.start + state.mods.droneAdd);
    while (state.drones.length < want) state.drones.push(newDrone(state));
    emit(state, { type: "card_picked", id: cardId, stacks: state.cards[cardId] });
    startNextSector(state);
    return { ok: true, reason: "" };
  }

  function checkGauge(state) {
    if (state.phase !== "play" || state.gauge < state.params.gaugeMax - 1e-9) return;
    state.phase = "warp";
    state.phaseT = T.warp.time;
    state.score += T.score.sector * state.sector;
    emit(state, { type: "gauge_full", sector: state.sector });
  }

  // Ruling W1: in warp only the field drifts; drones, raiders and timers freeze and nothing deals damage.
  function stepWarp(state) {
    stepField(state);
    updateTethers(state);
    computePower(state);
    for (let i = 0; i < state.drones.length; i++) {
      const d = state.drones[i];
      if (d.mode === "idle" || !d.tether) continue;
      const p = pointAlong(state, d.tether, d.d);
      d.x = p.x; d.y = p.y;
    }
    state.phaseT -= TICK;
    if (state.phaseT <= 1e-9) {
      state.phaseT = 0;
      state.phase = "cards";
      state.offer = drawOffer(state);
      emit(state, { type: "cards_offered", ids: state.offer.slice() });
    }
  }

  // ---------------------------------------------------------------- hazards

  function killRaider(state, rd, by) {
    const i = state.raiders.indexOf(rd);
    if (i < 0) return;
    state.raiders.splice(i, 1);
    state.score += T.score.raider;
    state.stats.raidersKilled++;
    if (state.station.beam === rd.id) state.station.beam = 0;
    emit(state, { type: "raider_killed", id: rd.id, by: by, x: rd.x, y: rd.y });
  }

  function stepFlares(state) {
    const p = state.params, F = T.flare, tm = state.timers;
    if (p.flareGap <= 0) return;
    tm.flare -= TICK;
    const sever = p.severLen + state.mods.severAdd;
    if (tm.flare > 1e-9) {
      if (tm.flare <= F.warn + 1e-9) {
        const first = tm.flareWarn === 0;
        tm.flareWarn = tm.flare;
        const doomed = [];
        for (let i = 0; i < state.tethers.length; i++) {
          const t = state.tethers[i];
          t.doomed = t.len > sever;
          if (t.doomed) doomed.push(t.id);
        }
        if (first) emit(state, { type: "flare_warning", in: F.warn, doomed: doomed });
      }
      return;
    }
    // strike
    const ids = [];
    for (let i = 0; i < state.tethers.length; i++) if (state.tethers[i].len > sever) ids.push(state.tethers[i].id);
    if (state.flare.blocksLeft > 0) {
      state.flare.blocksLeft--;
      emit(state, { type: "flare_blocked", blocksLeft: state.flare.blocksLeft });
    } else {
      const cut = [];
      for (let i = 0; i < ids.length; i++) {
        if (!getTether(state, ids[i])) continue;
        const c = removeTether(state, ids[i], "flare");
        for (let j = 0; j < c.length; j++) cut.push(c[j]);
      }
      computePower(state);
      emit(state, { type: "flare", cut: cut });
    }
    state.stats.flaresSurvived++;
    tm.flareWarn = 0;
    tm.flare = jittered(state, "events", p.flareGap, F.jitter);
    for (let i = 0; i < state.tethers.length; i++) state.tethers[i].doomed = false;
  }

  function stepWaves(state) {
    const p = state.params, R = T.raiders;
    if (p.raidGap <= 0) return;
    state.timers.raid -= TICK;
    if (state.timers.raid > 1e-9) return;
    state.timers.raid += jittered(state, "events", p.raidGap, R.jitter);
    if (state.timers.raid <= 0) state.timers.raid = TICK;
    const xs = [];
    for (let i = 0; i < p.raidCount; i++) {
      if (state.raiders.length >= R.max) break;
      const x = R.xMin + rnd(state, "events") * (R.xMax - R.xMin);
      state.raiders.push({ id: state.nextId++, x: x, y: 0, hp: p.raiderHp, hpMax: p.raiderHp, mode: "warn",
                           tether: 0, d: 0, t: R.warn });
      xs.push(x);
    }
    if (xs.length) emit(state, { type: "raid_warning", xs: xs, in: R.warn });
  }

  function moveToward(rd, tx, ty, step) {
    const dd = dist(rd.x, rd.y, tx, ty);
    if (dd <= step) { rd.x = tx; rd.y = ty; return; }
    rd.x += (tx - rd.x) / dd * step;
    rd.y += (ty - rd.y) / dd * step;
  }

  function stepRaiders(state) {
    const R = T.raiders, p = state.params, st = state.station;
    // warn countdown -> approach
    for (let i = 0; i < state.raiders.length; i++) {
      const rd = state.raiders[i];
      if (rd.mode !== "warn") continue;
      rd.t -= TICK;
      if (rd.t <= 1e-9) {
        rd.t = 0; rd.mode = "approach";
        emit(state, { type: "raider_spawn", id: rd.id, x: rd.x, y: rd.y });
      }
    }
    // Live Wire (riders) then the turret (nearest raider in range)
    if (state.mods.zapDps > 0) {
      const list = state.raiders.slice();
      for (let i = 0; i < list.length; i++) {
        if (list[i].mode !== "ride") continue;
        list[i].hp -= state.mods.zapDps * TICK;
        if (list[i].hp <= 1e-9) killRaider(state, list[i], "zap");
      }
    }
    const range = T.station.turret.range + state.mods.turretRangeAdd;
    let target = null, targetD = Infinity;
    for (let i = 0; i < state.raiders.length; i++) {
      const rd = state.raiders[i];
      if (rd.mode === "warn") continue;
      const d = dist(rd.x, rd.y, st.x, st.y);
      if (d <= range && d < targetD) { target = rd; targetD = d; }
    }
    st.beam = target ? target.id : 0;
    if (target) {
      target.hp -= (T.station.turret.dps + state.mods.turretDpsAdd) * TICK;
      if (target.hp <= 1e-9) killRaider(state, target, "turret");
    }
    // movement
    const list = state.raiders.slice();
    for (let i = 0; i < list.length; i++) {
      const rd = list[i];
      if (state.raiders.indexOf(rd) < 0 || rd.mode === "warn") continue;
      if (rd.mode === "approach") {
        let best = null, bestId = 0, bestD = Infinity, bestT = null;
        for (let j = 0; j < state.tethers.length; j++) {
          const t = state.tethers[j];
          const e = tetherEnds(state, t.id);
          if (!e) continue;
          const c = closestOnSeg(rd.x, rd.y, e.x1, e.y1, e.x2, e.y2);
          if (c.d < bestD) { bestD = c.d; best = c; bestId = t.id; bestT = t; }
        }
        if (best && bestD <= R.latch) {
          const ch = chainOf(state, bestId);
          let before = 0;
          for (let j = 0; j < ch.length - 1; j++) before += ch[j].len;
          rd.mode = "ride"; rd.tether = bestId; rd.d = before + best.u * bestT.len;
          rd.x = best.x; rd.y = best.y;
          emit(state, { type: "raider_latched", id: rd.id, tether: bestId });
        } else if (best) {
          moveToward(rd, best.x, best.y, R.approach * TICK);
        } else {
          moveToward(rd, st.x, st.y, R.approach * TICK);
        }
      } else if (rd.mode === "ride") {
        const ch = chainOf(state, rd.tether);
        if (!ch.length) { killRaider(state, rd, "snap"); continue; }
        let total = 0;
        for (let j = 0; j < ch.length; j++) total += ch[j].len;
        rd.d = Math.max(0, Math.min(total, rd.d) - p.rideSpeed * TICK);
        // crossing a relay hands the raider on to the link it came from
        let k = ch.length - 1, start = total - ch[k].len;
        while (k > 0 && rd.d < start) { k--; start -= ch[k].len; }
        rd.tether = ch[k].id;
        const pos = pointAlong(state, rd.tether, rd.d);
        rd.x = pos.x; rd.y = pos.y;
      }
      if (dist(rd.x, rd.y, st.x, st.y) <= st.r) {
        const i2 = state.raiders.indexOf(rd);
        if (i2 >= 0) state.raiders.splice(i2, 1);
        if (state.station.beam === rd.id) state.station.beam = 0;
        st.hp = Math.max(0, st.hp - p.ramDmg);
        emit(state, { type: "station_hit", damage: p.ramDmg, hp: st.hp, hpMax: st.hpMax });
        if (st.hp <= 0) break;
      }
    }
  }

  // ---------------------------------------------------------------- simulation

  function updateTethers(state) {
    for (let i = 0; i < state.tethers.length; i++) {
      const t = state.tethers[i];
      const e = tetherEnds(state, t.id);
      if (!e) continue;
      t.len = dist(e.x1, e.y1, e.x2, e.y2);
      t.cost = tetherCost(state, t.from, t.len);
    }
  }

  function stepField(state) {
    const dy = state.params.scroll * TICK;
    for (let i = 0; i < state.rocks.length; i++) state.rocks[i].y += dy;
    // despawn rocks that left the bottom, cutting their tethers first
    for (let i = state.rocks.length - 1; i >= 0; i--) {
      const r = state.rocks[i];
      if (r.y <= T.world.despawnY) continue;
      if (r.tether) removeTether(state, r.tether, "offscreen");
      const j = state.rocks.indexOf(r);
      if (j >= 0) state.rocks.splice(j, 1);
    }
  }

  function stepSpawn(state) {
    state.timers.spawn -= TICK;
    if (state.timers.spawn > 0) return;
    state.timers.spawn += jittered(state, "field", state.params.spawnGap, T.rocks.jitter);
    if (state.timers.spawn <= 0) state.timers.spawn = TICK;
    if (state.rocks.length >= T.rocks.max) return;
    trySpawn(state, T.world.spawnY, T.rocks.gapYBand);
  }

  function stepOverstretch(state) {
    if (state.mods.noOverstretch) return;
    const ml = maxLen(state);
    const ids = state.tethers.map(function (t) { return t.id; });
    for (let i = 0; i < ids.length; i++) {
      const t = getTether(state, ids[i]);
      if (t && t.len > ml) removeTether(state, t.id, "overstretch");
    }
  }

  function assignDrones(state) {
    const counts = {};
    for (let i = 0; i < state.drones.length; i++) {
      const d = state.drones[i];
      if (d.tether) counts[d.tether] = (counts[d.tether] || 0) + 1;
    }
    const stagger = Math.round(T.drones.stagger / TICK);
    for (let i = 0; i < state.drones.length; i++) {
      const d = state.drones[i];
      if (d.mode !== "idle" || d.tether) continue;
      let best = null, bestN = 0, bestLen = 0;
      for (let j = 0; j < state.tethers.length; j++) {
        const t = state.tethers[j];
        if (t.kind !== "mine") continue;
        const rock = getRock(state, t.to);
        if (!rock || rock.depleted || rock.amount <= 0) continue;
        const n = counts[t.id] || 0;
        if (n >= T.drones.perTether) continue;
        if (state.tick - t.lastLaunch < stagger) continue;
        const pl = pathLength(state, t.id);
        if (best === null || n < bestN || (n === bestN && (pl < bestLen || (pl === bestLen && t.id < best.id)))) {
          best = t; bestN = n; bestLen = pl;
        }
      }
      if (best) {
        d.tether = best.id; d.mode = "out"; d.d = 0; d.t = 0;
        best.lastLaunch = state.tick;
        counts[best.id] = (counts[best.id] || 0) + 1;
      }
    }
  }

  function depleteRock(state, rock, tether) {
    rock.amount = 0;
    rock.depleted = true;
    if (tether) tether.kind = "idle";
    emit(state, { type: "rock_depleted", id: rock.id, x: rock.x, y: rock.y, star: false });
    if (rock.type === "crystal" && state.mods.chainRange > 0) {
      // Crystal Chain: the nearest live, non-crystal rock in range turns to crystal (and chains on when it empties).
      let best = null, bestD = Infinity;
      for (let i = 0; i < state.rocks.length; i++) {
        const k = state.rocks[i];
        if (k === rock || k.depleted || k.relay || k.type === "crystal") continue;
        const d = dist(rock.x, rock.y, k.x, k.y);
        if (d <= state.mods.chainRange && d < bestD) { bestD = d; best = k; }
      }
      if (best) {
        best.type = "crystal";
        emit(state, { type: "crystal_chain", from: rock.id, to: best.id });
      }
    }
    for (let i = 0; i < state.drones.length; i++) {
      const d = state.drones[i];
      if (tether && d.tether === tether.id && (d.mode === "out" || d.mode === "mine")) d.mode = "back";
    }
  }

  function deliver(state, d) {
    const units = d.cargo + d.bonus;
    if (units > 0) {
      const res = T.resources[d.cargoType];
      const value = res.value * units;
      state.gauge = Math.min(state.params.gaugeMax, state.gauge + value);
      state.score += Math.round(T.score.perValue * value);
      state.stats.delivered[d.cargoType] += units;
      // `type` is taken by the event name, so the resource goes in `resource`.
      emit(state, { type: "delivery", resource: d.cargoType, amount: units, value: value,
                    x: state.station.x, y: state.station.y });
      if (d.cargoType === "ice" && state.mods.iceRepair > 0) {
        const before = state.station.hp;
        state.station.hp = Math.min(state.station.hpMax, before + units * state.mods.iceRepair);
        if (state.station.hp > before) {
          emit(state, { type: "station_repaired", hp: state.station.hp, amount: state.station.hp - before });
        }
      }
    }
    resetDrone(state, d);
    checkGauge(state);
  }

  function stepDrones(state) {
    assignDrones(state);
    const speed = T.drones.speed * state.mods.droneSpeedMul * (state.power.brownout ? T.tether.brownoutSpeed : 1);
    const cap = T.drones.cap + state.mods.capAdd;
    for (let i = 0; i < state.drones.length; i++) {
      const d = state.drones[i];
      if (d.mode === "idle") continue;
      const t = getTether(state, d.tether);
      if (!t) { resetDrone(state, d); continue; }
      const rock = getRock(state, t.to);
      const pl = pathLength(state, t.id);
      if (d.d > pl) d.d = pl;
      if (d.mode === "out") {
        if (rock.depleted || rock.amount <= 0) d.mode = "back";
        else {
          d.d += speed * TICK;
          if (d.d >= pl) { d.d = pl; d.mode = "mine"; }
        }
      }
      if (d.mode === "mine") {
        if (rock.depleted || rock.amount <= 0) d.mode = "back";
        else {
          const take = Math.min(T.drones.rate * TICK, cap - d.cargo, rock.amount);
          d.cargo += take;
          d.cargoType = rock.type;
          rock.amount -= take;
          if (rock.amount <= 1e-9) depleteRock(state, rock, t);
          if (d.cargo >= cap - 1e-9) {
            d.mode = "back";
            if (state.mods.splitShare > 0) {
              d.bonus = d.cargo * state.mods.splitShare;
              emit(state, { type: "drone_split", droneId: d.id });
            }
          } else if (rock.depleted) d.mode = "back";
        }
      } else if (d.mode === "back") {
        d.d -= speed * TICK;
        if (d.d <= 0) { d.d = 0; d.mode = "unload"; d.t = T.drones.unload; }
      } else if (d.mode === "unload") {
        d.t -= TICK;
        if (d.t <= 0) { deliver(state, d); continue; }
      }
      if (d.tether) {
        const p = pointAlong(state, d.tether, d.d);
        d.x = p.x; d.y = p.y;
      }
    }
  }

  function step(state) {
    if (state.phase === "over" || state.phase === "cards") return;
    state.tick++;
    if (state.phase === "warp") { stepWarp(state); return; }
    state.sectorTick++;
    stepField(state);
    updateTethers(state);
    stepOverstretch(state);
    computePower(state);
    const bo = state.power.use > state.power.budget + 1e-9;
    if (bo !== state.power.brownout) {
      state.power.brownout = bo;
      emit(state, { type: "brownout", on: bo });
    }
    stepSpawn(state);
    stepFlares(state);
    stepWaves(state);
    stepRaiders(state);
    stepDrones(state);
    if (state.station.hp <= 0) endRun(state, "destroyed");
  }

  function drainEvents(state) {
    const ev = state.events;
    state.events = [];
    return ev;
  }

  // ---------------------------------------------------------------- save and hash

  function serializeRun(state) {
    // Strip only the top-level event queue: rng.events is a stream state and must be saved.
    return JSON.stringify(state, function (k, v) { return (k === "events" && this === state) ? undefined : v; });
  }

  function loadRun(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { return { ok: false, reason: "parse", state: null }; }
    if (!o || typeof o !== "object" || o.v !== SAVE_VERSION) return { ok: false, reason: "version", state: null };
    const arrays = ["rocks", "tethers", "drones", "raiders", "offer"];
    for (let i = 0; i < arrays.length; i++) if (!Array.isArray(o[arrays[i]])) return { ok: false, reason: "shape", state: null };
    const phases = ["play", "warp", "cards", "over"];
    if (phases.indexOf(o.phase) < 0 || !o.rng || typeof o.rng.field !== "number" || typeof o.rng.events !== "number" || typeof o.rng.cards !== "number" || !o.station || !o.power || !o.timers || !o.stats || !o.cards ||
        typeof o.tick !== "number" || typeof o.sector !== "number" || typeof o.gauge !== "number" ||
        typeof o.score !== "number" || typeof o.nextId !== "number") return { ok: false, reason: "shape", state: null };
    o.events = [];
    o.mods = computeMods(o.cards);
    o.params = sectorParams(o.sector);
    computePower(o);
    return { ok: true, reason: "", state: o };
  }

  function hashState(state) {
    const s = serializeRun(state);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  return {
    VERSION: VERSION, SAVE_VERSION: SAVE_VERSION, TICK: TICK, TUNING: TUNING, CARDS: CARDS, LOOKS: LOOKS,
    hash32: hash32, mulberry32: mulberry32,
    newRun: newRun, step: step, abandonRun: abandonRun, sectorParams: sectorParams, computeMods: computeMods,
    pick: pick, previewTether: previewTether, tryTether: tryTether, cutTether: cutTether, cutAcross: cutAcross,
    makeRelay: makeRelay, pickCard: pickCard, cardText: cardText,
    tetherEnds: tetherEnds, powered: powered, drainEvents: drainEvents, hashState: hashState,
    serializeRun: serializeRun, loadRun: loadRun
  };
});
