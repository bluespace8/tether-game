# Tether: Architecture

Status: v1 plan, ready to build. Owner decisions still open are in section 14, each with a default so no
work waits on them. Words used throughout: **must** is part of the contract; **guess** marks a number to
tune in playtest.

---

## 1. Summary, pillars, non-goals

Tether is a portrait, one-thumb asteroid-mining roguelite with 3 to 5 minute runs, a sibling of Fleet
(`E:\Evan\Projects\fleet-game`) with every side panel removed. You never steer ships. You draw lines
(tethers) from your station to asteroids; drones run along them, mine and haul. Tethers cost power by
length, the field drifts down the screen, solar flares sever long tethers and raiders ride tethers back
to the station. Delivered material fills a warp gauge; a full gauge jumps to a harder sector and offers
three upgrade cards. The run ends when the station is destroyed. Stars buy cosmetics only.

**Pillars**

1. **Draw, don't steer.** Every action is a drag or a tap on the play field. No buttons during play
   except Pause.
2. **The network is the puzzle.** Short, cheap, well-placed tethers beat many long ones.
3. **The field never waits.** Rocks arrive and leave; the network must be rebuilt every few seconds.
4. **Readable in one hand.** Big shapes, colour plus shape for every resource, critical HUD at the top
   where the thumb does not cover it.
5. **Same rules everywhere.** One DOM-free rules file, deterministic from a seed, tested under Node.

**Non-goals for v1**

| Not in v1 | Why |
|---|---|
| Accounts, cloud saves, leaderboards, any network call | Offline PWA; no server |
| Ads, in-app purchases, real-money anything | Stars are earned only |
| Power from meta progression | Cosmetics only, by design |
| Landscape, tablets as a target | Portrait phone; desktop and tablet letterbox |
| Multi-touch gestures (pinch, two-finger) | One thumb |
| Steering, building menus, side panels, tech tree | Fleet's job, not Tether's |
| Daily seeds, replays UI, share codes | Rules support seeds; UI later |
| Rock-station collisions | Rocks pass behind the station |
| Themes (Fleet's Dwarven/Hamster), localisation | English, space look only |
| Build step, npm packages, frameworks | Plain HTML + Canvas + JS |

---

## 2. Resolved game rules

### 2.1 World and coordinates

- World units (**u**). The play field is **360 u wide x 640 u tall**, origin top-left, x right, y down.
- Station centre (180, 560), radius 22. Rocks spawn above the top edge (y = -30) and are removed once
  y > 680 (fully off the bottom).
- The front end fits the field into the screen (section 8.1); 1 u is about 1 CSS px on a 360-400 px wide
  phone. Rules never know about pixels.
- Rules run at a **fixed tick of 1/60 s** (`TICK`). All speeds are per second, all durations in seconds;
  rules convert with `TICK`.

### 2.2 The field (conveyor)

Every rock, relay and husk moves down at `scroll` u/s (same for all; no sideways drift).

- Spawn: a timer of `spawnGap` seconds, jittered by +-30%. On fire, try up to 6 x positions uniformly in
  [26, 334]; reject any closer than 44 u (centre to centre) to a rock with y < 60. If all 6 fail, skip.
- Cap: at most 22 rocks (relays and husks count). A spawn over the cap is skipped.
- Sector start: pre-place 7 rocks with y uniformly in [60, 420], same spacing rule, so the screen is not
  empty after a warp.
- Size (weights 45 / 40 / 15): `s` r 10 amount 12-18; `m` r 15 amount 24-34; `l` r 21 amount 40-56
  (integer, uniform). Amount scales by `mods.rockAmountMul` (1.0 base).
- Type: crystal chance `crystalPct` (sector table); of the rest, ice 24%, ore 76%.
- Star rock: 4% of spawns have `star: true` (any type). Mining it out gives 1 star.

### 2.3 Resources

| Type | Shape and colour (front end) | Gauge value per unit | Extra effect |
|---|---|---|---|
| ore | rough grey heptagon | 1 | none |
| ice | rounded pale-blue blob with white highlight | 1 | repairs station 0.5 HP per unit (`mods.iceRepair`) |
| crystal | faceted magenta diamond | 4 | none |

Score per unit delivered = 10 x gauge value.

### 2.4 Tethers and power

- A tether is a straight segment from a **source** (station or a powered relay) to a **target** rock.
- One incoming tether per rock. Max 12 tethers at once. Tethers may cross each other.
- Length = current distance between the two centres (recomputed every tick: rocks drift).
- Cost = length x `perUnit` (0.25 power per u) x `mods.costMul`, x `mods.relayCostMul` if the source is
  a relay. Not rounded in rules; the HUD rounds.
- **Budget** 100 power (+ `mods.powerAdd`). Drawing is refused if use after drawing would exceed budget.
- **Brownout:** drift can push use over budget. While use > budget, all drones move at 50% speed and the
  power meter flashes. Ends as soon as use <= budget.
- **Overstretch:** a tether longer than `maxLen` (300 u + `mods.maxLenAdd`) snaps. Drawing longer than
  `maxLen` is refused; shorter than 30 u is refused.
- **Off screen:** when a target or relay leaves the field (y > 680), its tether is cut.
- **Cutting** (player swipe, flare, overstretch, off screen, cascade) removes the tether. Drones on it
  return to the pool at once and their cargo is lost. Cutting a relay's link also cuts every tether
  downstream of that relay ("cascade").

### 2.5 Drones

| Field | Value | Guess? |
|---|---|---|
| Start count | 6 (+ `mods.droneAdd`) | guess |
| Speed | 70 u/s (x `mods.droneSpeedMul`) | guess |
| Capacity | 5 units (+ `mods.capAdd`) | guess |
| Mine rate | 5 units/s per drone | guess |
| Unload time | 0.3 s at the station | |
| Max per mining tether | 4 | |
| Launch stagger | one launch per tether per 0.25 s | |
| Hard cap | 30 drones | |

- Drones live in a pool at the station. Only **mining** tethers (target is a rock with amount > 0 that is
  not a relay) get drones; **link** tethers (target is a relay) and tethers to husks get none.
- Each tick, every idle drone is assigned to the mining tether with the fewest assigned drones (below
  the max), ties by shortest path length, then lowest id. Respect the launch stagger.
- A drone's path is the chain station -> relay(s) -> rock. Mode cycle:
  `idle -> out -> mine -> back -> unload -> idle`. Position `d` is distance from the station along the path;
  if the path shrinks, clamp `d`. Rules also keep `x, y` updated for drawing.
- Mining takes from the rock (`min(rate*dt, room, rock.amount)`). Leaving full (or the rock empties) turns
  the drone back. On unload: add to gauge, score, stats; ice repairs; emit `delivery`.
- If a rock empties, drones heading out turn back empty; the rock becomes a **husk** (`depleted: true`) and
  its tether stays (still costing power) until the player relays it or cuts it.
- **Tether kind transitions (ruling W3).** A `mine` tether becomes `idle` when its rock empties (the rock is
  now a husk). An `idle` tether becomes `link` on `makeRelay`. A new tether to an inert relay starts as
  `link`. No other transitions exist.

### 2.6 Relays

- **Tap a husk that has a tether** to convert it into a relay (one gesture). Its existing tether becomes
  the relay's **link** to the network.
- Rules: target must be depleted, tethered, not already a relay; max 4 relays (`relayMax`); max chain
  depth 3 relays between a rock and the station.
- A relay is a tether source. It is **powered** while its link chain reaches the station. (Cascading cuts
  mean an unpowered relay never keeps outgoing tethers.)
- A relay drifts like any rock. Leaving the field cuts its link (cascade). A relay with no link (link cut)
  stays as an inert relay and can be re-linked by drawing a tether from the station or another powered relay
  to it. Drawing to an inert relay creates a link tether (no drones).
- Relay radius drawn 12 (icon over the husk); its hit radius is the husk's.
- Kind transitions are listed in 2.5 (`idle` becomes `link` on `makeRelay`; a new tether to an inert relay
  starts as `link`).

### 2.7 Station, turret, damage

- Station HP 100 (+ `mods.hullAdd`); `hpMax` likewise. No natural regen. Ice repairs (2.3). Warp repairs 15.
- Turret: range 70 u (+ `mods.turretRangeAdd`), 12 damage/s (+ `mods.turretDpsAdd`) as a continuous beam on
  the nearest raider in range. Always on.
- Run over when HP <= 0 (`over.reason = "destroyed"`).

### 2.8 Solar flares (from sector 2)

- Timer `flareGap` s (jitter +-25%), first flare strikes 20 s into the sector, so its warning starts at 17 s
  (ruling W6).
- Warning 3.0 s (`flare_warning`): screen edge glows, every tether currently longer than `severLen` is drawn
  pulsing red so the player can shorten or cut them.
- On fire: every tether with length > `severLen` (+ `mods.severAdd`) is cut with reason `"flare"`.
  If `flare.blocksLeft > 0` (card Flare Shield), the flare is blocked instead (`flare_blocked`), blocksLeft--.

### 2.9 Raiders (from sector 3)

- Every `raidGap` s (jitter +-25%, first wave 15 s into the sector) a wave of `raidCount` raiders is warned:
  a red marker at the top edge for 2.5 s at each spawn x (uniform [30, 330]).
- First raid (ruling W6): warned at 15 s into the sector, raiders spawn 2.5 s later at 17.5 s.
- Raiders spawn at y = 0 (ruling W2).
- Mode `approach`: fly straight at 30 u/s toward the nearest point on any tether; latch when within 6 u.
  With no tethers, fly straight at the station. The nearest tether point is recomputed every tick (ruling
  W2).
- Mode `ride`: travel along the tether's path toward the station at `rideSpeed`; switching tethers at relays
  follows the link.
- **Cutting the tether a raider rides kills it** ("snapped", +50 score). Turret and Live Wire also kill.
  Any removal of the ridden tether (player, flare, overstretch, offscreen, cascade) kills the raider with
  `by: "snap"` (ruling W2). A raider's `d` is its distance from the station along the path and decreases
  while riding.
- Reaching the station (within station r): deals `ramDmg`, raider removed (`station_hit`).
- Raider radius 9, HP `raiderHp`. Max 12 raiders alive.

### 2.10 Warp, sectors, difficulty

- Gauge max per sector `gaugeMax`. When gauge >= max: phase `warp` for 1.2 s (rules ignore input, field
  keeps drifting, no damage), then phase `cards` with three offers. After a pick: all tethers removed, all
  drones idle, rocks/raiders cleared, station +15 HP, sector++, new field pre-placed, phase `play`.
- Score +300 x (sector just cleared). Stars +1 per warp.
- **Warp and cards phases (ruling W1).** During `warp` only the field drifts (offscreen cuts still apply);
  drones, raiders and timers freeze and nothing deals damage. The gauge clamps at `gaugeMax`; overflow is
  lost. The sector score (+300 x n) is added when the gauge fills (event `gauge_full`). Warp repair is
  capped at `hpMax`. `step` is a no-op in phases `cards` and `over`.

**Difficulty table** (n = sector). All values are guesses to tune. Formulas in `TUNING.sectors`.

| Param | Formula | n=1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| scroll u/s | 7 + 1.2(n-1), max 16 | 7 | 8.2 | 9.4 | 10.6 | 11.8 | 13 | 14.2 | 15.4 |
| gaugeMax | 150 + 70(n-1) | 150 | 220 | 290 | 360 | 430 | 500 | 570 | 640 |
| spawnGap s | 3.0 - 0.2(n-1), min 1.6 | 3.0 | 2.8 | 2.6 | 2.4 | 2.2 | 2.0 | 1.8 | 1.6 |
| crystalPct | 8 + 2(n-1), max 18 | 8 | 10 | 12 | 14 | 16 | 18 | 18 | 18 |
| flareGap s | 30 - 2(n-2), min 16 | - | 30 | 28 | 26 | 24 | 22 | 20 | 18 |
| severLen u | 200 - 10(n-2), min 130 | - | 200 | 190 | 180 | 170 | 160 | 150 | 140 |
| raidGap s | 28 - 2(n-3), min 12 | - | - | 28 | 26 | 24 | 22 | 20 | 18 |
| raidCount | 1 + floor((n-3)/2), max 5 | - | - | 1 | 1 | 2 | 2 | 3 | 3 |
| raiderHp | 30 + 6(n-3) | - | - | 30 | 36 | 42 | 48 | 54 | 60 |
| rideSpeed u/s | 32 + 2(n-3), max 50 | - | - | 32 | 34 | 36 | 38 | 40 | 42 |
| ramDmg | 15 + 2(n-3), max 30 | - | - | 15 | 17 | 19 | 21 | 23 | 25 |

No sector cap: raider HP keeps rising, others clamp. Target: a median player dies in sector 4-6, a strong
player reaches 8 at about 5-6 minutes. Playtest goal: sector 1 lasts 40-60 s.

### 2.11 Scoring and stars

| Source | Score | Stars |
|---|---|---|
| Unit delivered | 10 x gauge value (ore 10, ice 10, crystal 40) | - |
| Sector cleared (warp) | 300 x sector number | +1 |
| Raider killed (any way) | +50 | - |
| Star rock mined out | +100 | +1 |

Stars earned in the run (`starsRun`) are banked when the run ends (destroyed or abandoned). Best score and
best sector kept in the profile.

### 2.12 TUNING table (top of `game.js`)

```js
const TICK = 1 / 60;
const TUNING = {
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
  events:  { max: 128 },   // per drain; oldest dropped beyond this
};
```

Every value above is a guess except `TICK`, world size, station position and the caps.

---

## 3. Upgrade cards

### 3.1 Data shape

```js
// in game.js
const CARDS = [
  { id: "extra_drones", name: "Extra Drones", rarity: "common", max: 5,
    text: "+2 drones.", fx: [["droneAdd", "add", 2]] },
  ...
];
```

- `fx` entries are `[modKey, "add" | "mul", value]` applied once per stack, in order.
- `state.cards` is `{ [cardId]: stacks }`. `state.mods` is recomputed from scratch by `computeMods(cards)`
  after every pick and after load (never saved as truth; saved for convenience and checked).
- Base mods: `{ droneAdd:0, droneSpeedMul:1, capAdd:0, powerAdd:0, costMul:1, relayCostMul:1, maxLenAdd:0,
  severAdd:0, splitShare:0, zapDps:0, chainRange:0, turretRangeAdd:0, turretDpsAdd:0, hullAdd:0,
  iceRepair:0.5, flareBlocks:0, noOverstretch:0 }`.
- Cards with an immediate effect (heal) carry `now: [["heal", n]]`, applied on pick.
- Drone count change takes effect at once: new drones are added idle at the station.

### 3.2 Starter set (15 + 1 filler)

| id | Name | Rarity | Max | Exact effect per stack |
|---|---|---|---|---|
| extra_drones | Extra Drones | common | 5 | droneAdd +2 |
| overclock | Overclock | common | 3 | droneSpeedMul x1.2 |
| bigger_holds | Bigger Holds | common | 3 | capAdd +2 |
| power_cell | Power Cell | common | 4 | powerAdd +25 |
| long_reach | Long Reach | common | 2 | maxLenAdd +60, severAdd +30 |
| point_defense | Point Defense | common | 3 | turretRangeAdd +25, turretDpsAdd +6 |
| reinforced_hull | Reinforced Hull | common | 4 | hullAdd +25; now heal 25 |
| coolant_loop | Coolant Loop | common | 2 | iceRepair +0.5 (HP per ice unit) |
| thin_wire | Thin Wire | rare | 2 | costMul x0.8 |
| splitter | Splitter | rare | 2 | splitShare +0.4: a drone leaving a rock full splits off a shard carrying 40% of its load extra (not taken from the rock), delivered with it |
| live_wire | Live Wire | rare | 2 | zapDps +10: raiders riding a tether take 10 damage/s |
| flare_shield | Flare Shield | rare | 2 | flareBlocks +1: blocks that many flares each sector |
| relay_hub | Relay Hub | rare | 1 | relayCostMul x0.5: tethers drawn from relays cost half |
| crystal_chain | Crystal Chain | epic | 2 | chainRange +90 (first stack), +40 (second): when a crystal rock is mined out, the nearest non-depleted, non-relay, non-crystal rock within chainRange becomes crystal (and chains again when it empties) |
| superconductor | Superconductor | epic | 1 | noOverstretch = 1 (tethers never snap from length; draw limit stays) and powerAdd +30 |
| patch_kit | Patch Kit | filler | unlimited | now heal 30. Only offered when fewer than 3 real cards remain |

Implementation notes for the special cards:
- `splitShare`: on leaving the rock full, `drone.bonus = cargo * splitShare` (fractional allowed; the
  delivered amount is `cargo + bonus`, value and score computed on the float, score rounded at add).
  Emit `drone_split`.
- `chainRange` for stack 2 is 130 total (`chainRange` uses `add`: +90 then +40).
- `flareBlocks`: `state.flare.blocksLeft = mods.flareBlocks` at each sector start.

### 3.3 Drawing the offer

On entering phase `cards`, rules draw the offer with the `cards` RNG stream and store it in `state.offer`
(so a reload shows the same three cards):

1. Pool = real cards (not `patch_kit`) whose stacks < max, and epics only if the sector just cleared >= 3.
2. For each of 3 slots: roll a rarity with weights common 60 / rare 30 / epic 10 among rarities that still
   have pool cards (renormalise); pick uniformly among pool cards of that rarity in `CARDS` array order;
   remove it from the pool.
3. If the pool empties before 3 slots, fill the remaining slots with `patch_kit` (at most one patch kit).
   An offer is therefore 1 to 3 entries (a lone patch kit when no real card is left), never empty.
4. `pickCard` applies the card, clears `offer`, and starts the next sector.

No rerolls, no skips in v1.

---

## 4. File and module layout

```
E:\Evan\Projects\tether-game\
  ARCHITECTURE.md          this file (owner: architect; changes go through the reviewer)
  README.md                how to play, run, test (written in milestone 1, kept current)
  tests.js                 plain test runner for www/game.js (owner: rules)
  tools\serve.js           ~40-line static server (Node http, no packages) for phone testing (owner: front end)
  www\                     everything shipped; this is Capacitor's webDir later
    index.html             page shell, screens as hidden <section>s, script tags in order (front end)
    style.css              screens, buttons, safe areas (front end)
    game.js                ALL rules: TUNING, CARDS, LOOKS, RNG, state, step, API, save/profile (rules)
    storage.js             localStorage read/write, damaged-save copies, quota errors (front end)
    render.js              canvas sizing, view transform, sprite cache, draw(state, view, ui) (front end)
    input.js               pointer handling, gesture recogniser, calls the rules API (front end)
    ui.js                  DOM screens: home, card pick, pause, run over, hangar, settings, onboarding (front end)
    audio.js               Web Audio synth and vibration (front end)
    main.js                boot, loop (fixed 60 Hz accumulator), event dispatch, save timing (front end)
    sw.js                  service worker (front end)
    manifest.webmanifest   PWA manifest (front end)
    icons\                 icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon-180.png,
                           favicon-32.png, icon.svg (front end)
```

Rules:
- Classic scripts, no ES modules (ES modules fail over `file://`). Load order in index.html:
  `game.js, storage.js, audio.js, render.js, input.js, ui.js, main.js`. Each front-end file defines one
  global (`TetherStorage`, `TetherAudio`, `TetherRender`, `TetherInput`, `TetherUI`); `main.js` defines none.
- `game.js` uses Fleet's UMD wrapper: `module.exports` under Node, `self.TetherGame` in the browser.
  It must not reference `window`, `document`, `localStorage`, `Date`, `Math.random`, `performance`, timers.
- Only `game.js` and `tests.js` are touched by the rules branch. The front-end branch never edits them;
  if it needs a rules change it asks (contract change = doc change, section 6).
- Double-clicking `www\index.html` must play (service worker silently skipped on `file:`).

---

## 5. State model and saving

### 5.1 Run state (`newRun` returns this; all plain JSON)

```js
{
  v: 1,                        // SAVE_VERSION
  seed: 0,                     // uint32 run seed
  rng: { field: 0, events: 0, cards: 0 },   // uint32 stream states (mulberry32)
  tick: 0,                     // ticks since run start
  phase: "play",               // "play" | "warp" | "cards" | "over"
  phaseT: 0,                   // seconds left in "warp"
  sector: 1,
  sectorTick: 0,
  params: { scroll, gaugeMax, spawnGap, crystalPct, flareGap, severLen,
            raidGap, raidCount, raiderHp, rideSpeed, ramDmg },   // sectorParams(sector), cached
  gauge: 0,                    // float, value delivered this sector
  score: 0,                    // integer
  starsRun: 0,
  station: { x: 180, y: 560, r: 22, hp: 100, hpMax: 100, beam: 0 },  // beam: target raider id or 0
  power: { budget: 100, use: 0, brownout: false },
  rocks: [ { id, x, y, r, size: "s"|"m"|"l", type: "ore"|"ice"|"crystal",
             amount, amountMax, star: false, depleted: false, relay: false,
             tether: 0 } ],      // id of incoming tether, 0 = none
  tethers: [ { id, from: 0 /*station*/ | rockId /*relay*/, to: rockId,
               kind: "mine" | "link" | "idle",   // idle = target is an unrelayed husk
               len, cost, doomed: false,         // doomed: will be cut by the warned flare
               lastLaunch: 0 } ],                // tick of last drone launch
  drones: [ { id, tether: 0, mode: "idle"|"out"|"mine"|"back"|"unload",
              d: 0, x, y, cargo: 0, cargoType: "ore", bonus: 0, t: 0 } ],
  raiders: [ { id, x, y, hp, hpMax, mode: "warn"|"approach"|"ride",
               tether: 0, d: 0, t: 0 } ],        // t: warn countdown in "warn" mode
  timers: { spawn: 0, flare: 0, flareWarn: 0, raid: 0 },   // seconds
  flare: { blocksLeft: 0 },
  cards: {},                   // { cardId: stacks }
  mods: {},                    // computeMods(cards)
  offer: [],                   // card ids while phase === "cards"
  stats: { delivered: { ore: 0, ice: 0, crystal: 0 }, raidersKilled: 0, tethersMade: 0,
           relaysMade: 0, flaresSurvived: 0, cardsPicked: 0 },
  nextId: 1,                   // station is id 0; ids are never reused
  events: [],                  // transient, never saved
  over: null                   // { reason: "destroyed"|"abandoned", score, sector, starsRun }
}
```

Arrays hold live entities only (removed entities are spliced out); lookups are linear (counts are small).

### 5.2 Profile (kept between runs)

```js
{
  v: 1,
  stars: 0,
  best: { score: 0, sector: 0 },
  runs: 0,
  owned: ["station_default", "tether_cyan", "drone_dot", "bg_deep"],
  equipped: { station: "station_default", tether: "tether_cyan", drone: "drone_dot", bg: "bg_deep" },
  settings: { sound: true, haptics: true, reducedMotion: "auto" },   // "auto" | "on" | "off"
  onboarding: { tether: false, cut: false, relay: false },
  seedCounter: 0               // bumped per run; mixed into the seed by main.js
}
```

`LOOKS` (in game.js): `{ id, slot: "station"|"tether"|"drone"|"bg", name, price }`. v1 catalogue:
station 4 (default 0, Ring 10, Forge 15, Lantern 25); tether 5 (Cyan 0, Amber 5, Lime 5, Violet 10,
Prism 20); drone 3 (Dot 0, Arrow 8, Comet trail 15); bg 3 (Deep 0, Nebula 10, Belt 15). Total 138 stars.

### 5.3 What is saved, where, when

| localStorage key | Content | Written when |
|---|---|---|
| `tether-profile-v1` | `serializeProfile(profile)` | after bank, buy, equip, setting change, onboarding step |
| `tether-run-v1` | `serializeRun(state)` | every 10 s of play, on card pick, on `visibilitychange` to hidden, on `pagehide`; deleted at run over |
| `tether-damaged-v1` | array of last 3 `{ key, text }` that failed to load | on a failed load |

- Saves are written only by `storage.js`. A quota error shows a toast and play continues.
- `serializeRun` strips `events`. `loadRun` validates `v`, phase, array shapes and number fields; on failure
  returns `{ ok: false, reason }`, the front end copies the text to `tether-damaged-v1` and drops the run.
- **Versioning:** `SAVE_VERSION = 1`. A later version adds `migrateRun(obj)` / `migrateProfile(obj)` steps
  v1 -> v2 -> ... inside game.js; the key suffix (`-v1`) only changes if the format becomes incompatible,
  and then the old key is read once, migrated, and never written again (Fleet's rule).
- Boot: if `tether-run-v1` exists and loads, the home screen offers **Resume** (sector, score) or
  **Abandon** (banks its stars via `abandonRun` + `bankRun`).

---

## 6. Rules API contract

Global `TetherGame` (browser) / `require("./www/game.js")` (Node). All functions are synchronous and
mutate the given `state` in place unless noted. Results are plain objects. Reasons are fixed strings; the
front end maps them to text (section 9.6). The front end **must not** write to state directly.

### 6.1 Constants

| Name | Type |
|---|---|
| `VERSION` | string, e.g. "0.1.0" (shown on the home screen) |
| `SAVE_VERSION` | 1 |
| `TICK` | 1/60 |
| `TUNING`, `CARDS`, `LOOKS` | frozen data tables |

### 6.2 Run lifecycle

| Function | Returns | Failure reasons |
|---|---|---|
| `newRun(seed, opts?)` opts `{ sector?: n, stress?: bool }` | state | - (seed coerced `>>> 0`) |
| `step(state)` | undefined; advances exactly one tick; no-op in phases `cards` and `over` | - |
| `abandonRun(state)` | `{ ok, reason }` sets `over.reason = "abandoned"` | `"bad_phase"` (already over) |
| `sectorParams(n)` | params object (5.1) | - |
| `computeMods(cards)` | mods object | - |

### 6.3 Player actions

| Function | Returns | Failure reasons |
|---|---|---|
| `pick(state, x, y, r)` | `{ kind: "station"|"relay"|"rock"|"husk"|"tether"|null, id }`; priority station > relay > rock/husk (nearest centre) > tether (within r of the segment) | - |
| `previewTether(state, fromId, x, y, snapR)` | `{ ok, reason, toId, x2, y2, len, cost, powerAfter }`. Snaps to the nearest valid target within `snapR` of (x, y); if none, `toId = 0`, (x2, y2) = (x, y), reason says why the nearest candidate is invalid, or `"no_target"` | `"bad_phase"`, `"no_source"`, `"source_unpowered"`, `"no_target"`, `"target_depleted"`, `"target_tethered"`, `"target_offscreen"`, `"too_long"`, `"too_short"`, `"no_power"`, `"tether_cap"`, `"same_node"`, `"too_deep"` |
| `tryTether(state, fromId, toId)` | `{ ok, reason, id }` | same as preview |
| `cutTether(state, id)` | `{ ok, reason, cut: [ids] }` (cascade included) | `"bad_phase"`, `"no_tether"` |
| `cutAcross(state, x1, y1, x2, y2)` | `{ cut: [ids] }` every tether whose segment intersects the swipe segment, plus cascades | never fails; empty in wrong phase |
| `makeRelay(state, rockId)` | `{ ok, reason }` | `"bad_phase"`, `"no_rock"`, `"not_depleted"`, `"not_tethered"`, `"already_relay"`, `"relay_cap"`, `"too_deep"` |
| `pickCard(state, cardId)` | `{ ok, reason }` | `"bad_phase"`, `"not_offered"` |

Valid tether targets are (a) a non-depleted, non-relay rock without a tether (`kind "mine"`) and (b) an
inert relay (`kind "link"`). A husk is never a valid target (`"target_depleted"`). "On screen" means
`y - r >= 0` and `y + r <= 640`. Actions are allowed only in phase `play` (else `"bad_phase"`), except
`pickCard`, which is allowed only in phase `cards`.
Drag direction does not matter to rules: the front end always passes the source as `fromId`.

### 6.4 Derived getters (read only, cheap)

| Function | Returns |
|---|---|
| `tetherEnds(state, id)` | `{ x1, y1, x2, y2 }` (source to target) |
| `powered(state, rockId)` | boolean (relay chain reaches station) |
| `cardText(cardId, stacks)` | string, the effect at that stack count |
| `hashState(state)` | uint32 FNV-1a over `serializeRun(state)` (tests and bug reports) |

### 6.5 Save and profile

| Function | Returns | Failure reasons |
|---|---|---|
| `serializeRun(state)` | string | - |
| `loadRun(text)` | `{ ok, reason, state }` (recomputes mods, power, params) | `"parse"`, `"version"`, `"shape"` |
| `newProfile()` | profile | - |
| `serializeProfile(p)` | string | - |
| `loadProfile(text)` | `{ ok, reason, profile }` (fills missing fields with defaults) | `"parse"`, `"version"`, `"shape"` |
| `bankRun(profile, state)` | `{ ok, reason, starsGained, newBest }`; adds `starsRun`, updates best, runs++ | `"not_over"`, `"already_banked"` (state gets `over.banked = true`) |
| `buyLook(profile, lookId)` | `{ ok, reason }` | `"unknown"`, `"owned"`, `"no_stars"` |
| `equipLook(profile, lookId)` | `{ ok, reason }` | `"unknown"`, `"not_owned"` |
| `markOnboarding(profile, step)` | `{ ok }` step in `"tether"|"cut"|"relay"` | - |

### 6.6 Event queue

Rules push `{ type, ...payload }` onto `state.events`. The front end calls `drainEvents(state)` once per
frame (returns the array and empties it). Events are for sound, haptics, particles, toasts and onboarding;
the front end must never need them to draw the state correctly.

| type | Payload | Front end does |
|---|---|---|
| `tether_created` | `id, from, to, kind, cost` | zip sound, 10 ms haptic |
| `tether_cut` | `id, reason: "player"|"flare"|"overstretch"|"offscreen"|"cascade"`, `x, y` (midpoint) | snip, sparks |
| `rock_depleted` | `id, x, y, star` | puff; hint "tap to relay" if tethered |
| `relay_created` | `id, x, y` | chime, ring |
| `delivery` | `type, amount, value, x, y` | throttled tick sound, +N float text |
| `station_repaired` | `hp, amount` | green float text |
| `brownout` | `on: bool` | power meter flash, low hum |
| `drone_split` | `droneId` | small shard sprite |
| `crystal_chain` | `from, to` | arc effect |
| `flare_warning` | `in: 3.0, doomed: [tetherIds]` | edge glow, warning sound |
| `flare` | `cut: [ids]` | white flash (or tint if reduced motion), crackle, 50 ms haptic |
| `flare_blocked` | `blocksLeft` | shield shimmer |
| `raid_warning` | `xs: [x], in: 2.5` | top-edge markers |
| `raider_spawn` | `id, x, y` | - |
| `raider_latched` | `id, tether` | buzz |
| `raider_killed` | `id, by: "snap"|"turret"|"zap", x, y` | pop, +50 |
| `station_hit` | `damage, hp, hpMax` | thud, shake (not in reduced motion), haptic `[30,40,30]` |
| `star_collected` | `x, y, starsRun` | star flies to the HUD counter |
| `gauge_full` | `sector` | warp sound starts |
| `cards_offered` | `ids` | open card pick screen |
| `card_picked` | `id, stacks` | ding |
| `sector_start` | `sector, params` | "SECTOR n" banner |
| `run_over` | `reason, score, sector, starsRun` | open run over screen |

### 6.7 Determinism rules

- RNG: `mulberry32`, three independent streams whose states live in `state.rng` (so a reload continues
  identically). Stream seeds: `hash32(seed, "field")`, `hash32(seed, "events")`, `hash32(seed, "cards")`
  with `hash32` = FNV-1a over the seed's 4 bytes then the name's char codes.
  - `field`: spawn timing, positions, sizes, types, amounts, star flags.
  - `events`: flare and raid timing, raid x positions.
  - `cards`: offers.
- One `step` = one tick of `TICK`. No variable dt in rules.
- Simulation uses only `+ - * /`, `Math.sqrt`, `floor`, `ceil`, `round`, `min`, `max`, `abs`. No trig, no
  `Math.random`, no `Date`, no `performance.now`. Iterate arrays in index order; ties broken by id.
- Player actions change state only through the API, at tick boundaries (the front end calls them between
  `step` calls). Same seed + same `(tick, call, args)` script => same `hashState`.
- The **seed** is made by `main.js`: `(Date.now() ^ (profile.seedCounter * 2654435761)) >>> 0`, or from
  `?seed=N` in the URL.

### 6.8 Changing the contract

Ruling W5: the whole of section 5.1 except the star fields (`starsRun`, `star` on rocks) is the contract
from M1, and `newRun` accepts `opts.sector` from M1 (it starts the run in that sector, with that sector's
params and pre-placed field).

Any change to 5.1, 6.x or the event list is a doc change in this file on its own commit, reviewed before
either branch builds on it. Additive fields and events are allowed without a review; renames and removals
are not.

---

## 7. Input design

### 7.1 Event model

- Pointer Events only (`pointerdown/move/up/cancel` on the canvas). No touch or mouse listeners. Canvas CSS
  `touch-action: none; user-select: none; -webkit-touch-callout: none`. `contextmenu` prevented.
- Track **one pointer**: the first `pointerdown` while none is active; call `setPointerCapture`. Any other
  pointer is ignored until it lifts. `pointercancel` (or `lostpointercapture`) cancels the gesture with no
  action.
- Coalesced events: use `getCoalescedEvents()` when present for the cut trail.
- Convert to world units with the view transform (8.1). All thresholds below are CSS px, converted with
  `px / view.scale`.

### 7.2 Thresholds

| Name | Value | Meaning |
|---|---|---|
| `NODE_HIT` | 28 px | radius around a station/relay centre (plus node r) that starts a tether drag |
| `ROCK_HIT` | 24 px + rock r | radius to start a reverse drag from a rock, or tap a husk |
| `DRAG_START` | 8 px | movement before a press becomes a drag |
| `TAP_MOVE` | 10 px | max movement for a tap |
| `TAP_TIME` | 250 ms | max press time for a tap |
| `SNAP` | 36 px (48 px if finger y is in the top third of the field) | snap radius for tether targets |
| `CUT_MIN` | 24 px | swipe path length before cuts start |
| `EDGE_DEAD` | 16 px | presses starting this close to a screen edge are ignored (system gestures) |
| `LIFT_LABEL` | 56 px | the cost label sits this far above the finger |
| `MIN_TARGET` | 44 x 44 px | minimum touch target for every DOM button; 56 px tall for primary buttons |

### 7.3 Recogniser (state machine in input.js)

```
idle --down--> pressed{start, t0, hit = pick(...)}
pressed --move > DRAG_START-->
    hit is station or powered relay  -> drawing(from = hit.id)
    hit is rock (not husk) or inert relay -> reverseDrawing(target = hit.id)
    otherwise (empty or tether)      -> cutting
pressed --up within TAP_TIME and TAP_MOVE-->
    hit is husk with tether          -> makeRelay(hit.id)
    otherwise                         -> nothing (tapping a tether never cuts it)
drawing --move--> previewTether(from, x, y, SNAP) each move; draw preview
drawing --up--> if preview.toId: tryTether(from, toId) else cancel (no cost)
reverseDrawing --move--> snap to nearest station/powered relay within SNAP; preview with that as source
reverseDrawing --up--> tryTether(source, target)
cutting --move--> once path >= CUT_MIN: cutAcross(prev, cur) per move segment (live)
any --cancel--> idle, no action
```

- The preview line is green when ok, red with the reason text when not; the label shows cost and power
  after, e.g. `-38 (62 left)`, lifted `LIFT_LABEL` above the finger so the thumb does not hide it.
- A gesture started during phase `play` that is still active when the phase changes is cancelled.
- Haptic tick (5 ms) when the preview snaps onto a new target.
- Accidental touches: edge dead zone; single pointer; taps never destroy anything; a cut needs a 24 px
  swipe; releasing a draw on empty space costs nothing; no long-press actions in v1.
- Mouse on desktop works through the same Pointer Events (for testing).

### 7.4 Safe areas and orientation

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`.
- Read insets from CSS `env(safe-area-inset-*)` into CSS variables; `render.js` reads them once per resize
  via `getComputedStyle` on a probe element. The field is placed inside the safe rectangle; the background
  is drawn edge to edge.
- Manifest `orientation: "portrait"`. In a browser tab, when `innerWidth > innerHeight` and the device has
  a coarse pointer, show the "Turn your phone upright" overlay and pause. Desktop landscape windows just
  letterbox (no overlay).
- Pause automatically on `visibilitychange` hidden and on `blur`.

---

## 8. Rendering and performance

### 8.1 Canvas and view transform

- One full-window canvas, `getContext("2d", { alpha: false })`.
- `dpr = min(devicePixelRatio, 2)`; backing size `round(cssW * dpr) x round(cssH * dpr)`; resize on
  `resize` and `orientationchange` (debounced 100 ms).
- Safe rectangle = window minus insets. Top HUD band 88 px is reserved inside it.
  `scale = min(safeW / 360, (safeH - 88) / 640)`; field width 360*scale centred horizontally; field top =
  safe top + 88 + (leftover height / 2, but at most 40 px; the rest goes below).
- `view = { scale, offX, offY, dpr }`; `ctx.setTransform(dpr*scale, 0, 0, dpr*scale, dpr*offX, dpr*offY)`
  for world drawing; HUD draws in CSS px with `setTransform(dpr,0,0,dpr,0,0)`.

### 8.2 Loop

- `requestAnimationFrame`; accumulate real time (capped at 0.25 s per frame); run `step` while
  acc >= TICK, at most 5 steps per frame; draw only if at least one step ran (caps drawing at 60 fps on
  90/120 Hz screens and saves battery). No interpolation (60 Hz rules).
- While paused or on any menu screen, the loop stops; screens are DOM. The field is drawn once behind them.
- `main.js` drains events after the steps of a frame and dispatches them to audio, ui and fx.

### 8.3 Layer order (back to front)

1. Background (cached offscreen canvas per `bg` look; star layer scrolls at 0.3 x scroll, still in reduced motion)
2. Husks and relays
3. Rocks (pre-rendered sprites per type x size x dpr; star rocks get a glint)
4. Tethers (dim base line 2 u, bright core 1 u; doomed tethers pulse red; brownout dims)
5. Drones (3 u dot or look sprite; cargo colour fill; split shard)
6. Raiders, warn markers, turret beam, Live Wire sparks (drawn from `mods.zapDps > 0` and a raider with
   `mode === "ride"`; no event, ruling W7)
7. Station (look sprite, HP ring)
8. Effects (particles, float texts)
9. Gesture layer (preview line, snap ring, cost label, cut trail)
10. Flare overlay (edge glow during warning, flash or tint on fire)
11. Canvas HUD (top band)

No `shadowBlur`, no per-frame gradients; glows are pre-rendered sprites. Text uses one font
(`system-ui`), measured once per string where possible.

### 8.4 Object budgets

| Object | Cap | Enforced by |
|---|---|---|
| Rocks incl. husks and relays | 22 | rules |
| Tethers | 12 | rules |
| Drones | 30 | rules |
| Raiders | 12 | rules |
| Particles | 150 | render (drop oldest) |
| Float texts | 12 | render |
| Delivery sounds | 8 per second | audio |

### 8.5 Targets and measurement

- Target: **60 fps, p95 frame time <= 16.7 ms** on a mid-range phone (reference: Pixel 6a or Galaxy A54
  class, Chrome). Rules step < 1 ms at caps.
- `?perf` shows an overlay: fps, p50/p95 frame ms, step ms, draw ms (from `performance.now`), object counts.
- `?stress` = `newRun(seed, { stress: true })`: rules fill every cap (22 rocks, 12 tethers, 30 drones,
  12 raiders riding, no damage) and never save or bank.
- Desktop proxy: Chrome DevTools, 4x CPU throttle, device mode 412 x 915, Performance panel 30 s capture.
  Real phone: Android Chrome remote debugging (`chrome://inspect`).

### 8.6 Battery

DPR cap 2; draw only after a tick; stop the loop on menus, pause and hidden; no timers in the background;
audio context suspended while paused; no wake lock.

### 8.7 Reduced motion

`profile.settings.reducedMotion`: `"auto"` follows `prefers-reduced-motion`. When on: no screen shake, no
flare flash (static tint + banner), particles x0.25, no rock spin, background stars still, star-to-HUD flight
replaced by a counter pulse. The field drift is gameplay and stays.

---

## 9. HUD and screens

All screens except play are DOM `<section>`s in index.html toggled by `ui.js`. Buttons >= 44 x 44 px,
primary buttons 56 px tall at the bottom (thumb zone).

### 9.1 Play screen (390 x 844 example)

```
+----------------------------------------+  <- safe-area top
| [II]   SECTOR 3      12,450     * 7    |  pause 44x44 | sector | score | stars this run
| WARP  [###########...........]  58%    |  gauge bar, full width
| HULL  [###############.....]  POWER 72/100 |  HP bar left; power used/budget right (flashes in brownout)
|- - - - - - - - - - - - - - - - - - - - |  field top
|     (o)          <>                    |  rocks drift down
|           (o)            !  raid marker|
|   (o)  .                               |
|         .   tether                     |
|      [R]  .                 (o)        |  [R] relay
|        \    .                          |
|         \    .                         |
|          \    .                        |
|           +---[ STATION ]              |  station at (180,560), HP ring, turret beam
|                 6 drones (2 idle)      |  small text under station
+----------------------------------------+  <- field bottom / safe-area bottom
```

### 9.2 Card pick (phase `cards`)

```
+----------------------------------------+
|            SECTOR 3 CLEARED            |
|        +900   * +1   Hull 64/100       |
|                                        |
|  +----------------------------------+  |
|  | COMMON            Extra Drones   |  |  each card full width, 112 px tall
|  | +2 drones.            (owned 1)  |  |
|  +----------------------------------+  |
|  +----------------------------------+  |
|  | RARE                 Live Wire   |  |
|  | Raiders on tethers take 10/s.    |  |
|  +----------------------------------+  |
|  +----------------------------------+  |
|  | EPIC             Crystal Chain   |  |
|  | Mined-out crystal turns a rock...|  |
|  +----------------------------------+  |
|          Tap a card to take it         |
+----------------------------------------+
```

Tap selects (highlight), second tap or the "Take" button (56 px, bottom) confirms. This prevents a stray
tap from the last drag picking a card. Cards are not tappable for the first 400 ms.

### 9.3 Run over

```
+----------------------------------------+
|           STATION DESTROYED            |
|                                        |
|              SCORE 18,240              |
|            NEW BEST!  (was 15,100)     |
|           Reached sector 5             |
|     Delivered  ore 640 ice 120 cr 48   |
|     Raiders 9   Relays 4   Cards 4     |
|                                        |
|           * +6 stars  (total 31)       |
|                                        |
|  [        PLAY AGAIN  (56 px)       ]  |
|  [ HANGAR ]                  [ HOME ]  |
+----------------------------------------+
```

`bankRun` is called once when the run over event arrives; the screen shows its result.

### 9.4 Home and hangar

```
HOME                                       HANGAR
+-----------------------------+            +-----------------------------+
|                         [gear]|          | < Back            * 31      |
|          T E T H E R        |            | [Station][Tether][Drone][Space] |
|       best 18,240 (s5)      |            | +-------+-------+-------+   |
|                             |            | |preview|preview|preview|   |
|  Resume run? s3  9,100      |            | |Default|Ring   |Forge  |   |
|  [RESUME]      [ABANDON]    |            | |EQUIPPED| * 10 |  * 15 |   |
|                             |            | +-------+-------+-------+   |
|  [        PLAY        ]     |            | |Lantern|       |       |   |
|  [ HANGAR ]   * 31          |            | | * 25  |       |       |   |
|  v0.1.0  Update ready [Restart]|         | +-------+-------+-------+   |
+-----------------------------+            +-----------------------------+
```

Hangar tile tap: owned -> equip; not owned and affordable -> confirm sheet "Buy Ring for 10 stars?"
[Buy] [Cancel]; not affordable -> shows "Need 4 more stars". Settings (gear): Sound, Haptics,
Reduced motion (Auto/On/Off), Replay tutorial, version.

Pause sheet: Resume (primary), Restart, Quit to home (asks "End this run? Stars earned are kept."), Sound,
Haptics.

### 9.5 First-run onboarding (three steps)

Shown while the matching `profile.onboarding` flag is false. Onboarding is front end only: rules run
normally (sector 1 has no hazards, so the tips have time).

1. **Draw.** After 1 s: a ghost finger animates from the station to the nearest rock with "Drag from the
   station to a rock". Done on the first `tether_created` -> `markOnboarding("tether")`.
2. **Cut.** On the first `rock_depleted` or after 20 s: a ghost swipe across that tether with "Swipe across
   a tether to cut it. Empty rocks still use power." Done on the first player `tether_cut`.
3. **Relay.** On the next `rock_depleted` of a tethered rock: pulse it with "Tap an empty rock to make a
   relay. Draw new tethers from it." Done on `relay_created`.

Each hint has a small "Skip tips" link that sets all three flags.

### 9.6 Reason strings to text

| reason | Text (toast near the finger, 1.2 s) |
|---|---|
| no_power | Not enough power |
| too_long | Too far |
| too_short | Too close |
| target_tethered | Already tethered |
| target_depleted | That rock is empty |
| target_offscreen | Wait until it is on screen |
| tether_cap | Too many tethers |
| source_unpowered | That relay has no power |
| relay_cap | Relay limit reached |
| too_deep | Relay chain too long |
| not_tethered | Tether it first |
| other | (no toast) |

---

## 10. Audio and haptics (optional, off-able)

- `audio.js` creates one `AudioContext` on the first `pointerdown` (autoplay rules), master gain 0.6,
  suspended while paused. All sounds are synthesised (oscillators + one shared white-noise buffer): no
  audio files, nothing to cache.
- Sounds: tether zip (saw sweep 300->900 Hz, 80 ms), snip (noise burst 40 ms high-pass), delivery tick
  (sine 880/1100/1320 Hz by type, 30 ms, max 8/s), relay chime (two sines), flare warning (rising 3 s),
  flare crackle (noise 300 ms), raider buzz, raider pop, station thud (sine 60 Hz 150 ms), warp whoosh,
  card ding, run over low tone.
- Haptics: `navigator.vibrate` if present (Android Chrome; iOS Safari has none, silently skipped).
  Patterns: snap 5, tether 10, cut 15, flare 50, station hit [30,40,30], warp [20,30,60], run over 200 ms.
  Never on deliveries. Both obey profile settings; failures are swallowed.
- Later in Capacitor: swap `navigator.vibrate` for `@capacitor/haptics` behind the same `TetherAudio.buzz(name)`.

---

## 11. PWA

### 11.1 Manifest (`www/manifest.webmanifest`)

```json
{
  "name": "Tether",
  "short_name": "Tether",
  "description": "Draw tethers, mine the drift, warp deeper.",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#05070d",
  "theme_color": "#05070d",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

index.html also has: `<link rel="manifest">`, `<meta name="theme-color" content="#05070d">`,
`<link rel="apple-touch-icon" href="icons/apple-touch-icon-180.png">`,
`<meta name="apple-mobile-web-app-capable" content="yes">`,
`<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`, favicon-32.png and icon.svg.
Icons: a station circle with three tethers on #05070d; maskable version keeps the art inside the
central 80% circle. Produced by hand (or drawn once by a small canvas page in tools\ and saved): no packages.

### 11.2 Service worker (`www/sw.js`)

- `const BUILD = "0.1.0";` `CACHE = "tether-" + BUILD`. Bump BUILD with every release (same as `VERSION`).
- `install`: precache the shell list (all www files above). Do **not** call `skipWaiting` here.
- `activate`: delete caches whose name starts with `tether-` and is not `CACHE`; `clients.claim()`.
- `fetch`: same-origin GET only. Navigations -> cached `index.html`; others cache-first, falling back to
  network. No runtime caching of anything else; the game makes no other requests.
- Update flow: `main.js` registers `sw.js` only when `location.protocol` is `https:` or host is `localhost`.
  On load it calls `registration.update()`. When a worker is `waiting`, the home screen shows
  "Update ready [Restart]"; Restart posts `{ type: "SKIP_WAITING" }`, then reloads on `controllerchange`.
  Never offered mid-run; an unrestarted update applies on the next cold start.
- Offline: fully playable after first visit. localStorage holds all data. Note for the owner: an installed
  iOS home-screen app has its own storage separate from Safari.

### 11.3 Serving for phone tests

- Desktop: double-click `www\index.html` (no service worker) or run
  `ELECTRON_RUN_AS_NODE=1 "E:\Evan\Programs\VSCode\Code.exe" tools\serve.js` (serves `www\` on port 8080,
  all interfaces).
- Phone on the same Wi-Fi: `http://<pc-ip>:8080` plays, but is not a secure context (no service worker,
  no install). For full PWA testing use Android USB debugging with port forwarding (`chrome://inspect`,
  forward 8080 -> localhost:8080; `localhost` counts as secure) or an HTTPS static host (section 14, Q3).

### 11.4 App stores later (Capacitor), no restructuring

- `www/` is already Capacitor's default `webDir`. Wrapping = install Node + `@capacitor/cli` (the only
  place a package manager appears, outside the game), `npx cap init Tether com.<owner>.tether --web-dir www`,
  `npx cap add android` / `ios`, `npx cap copy`. The game code does not change.
- Swap-ins behind existing seams: vibration -> `@capacitor/haptics` in audio.js; localStorage ->
  `@capacitor/preferences` in storage.js (same sync-looking wrapper with an async flush); orientation lock in
  native config; service worker not registered when `window.Capacitor` exists.
- iOS needs a Mac for the build; Android can build on this PC with Android Studio installed on E:.

---

## 12. Test plan

### 12.1 Unit tests (`tests.js`, rules branch)

Runner copied in style from Fleet: `test(name, fn)`, `eq`, `ok`, `near`, prints each test and
`N passed, M failed`, exits non-zero on failure. Run with
`ELECTRON_RUN_AS_NODE=1 "E:\Evan\Programs\VSCode\Code.exe" tests.js` (PowerShell:
`$env:ELECTRON_RUN_AS_NODE=1; & 'E:\Evan\Programs\VSCode\Code.exe' tests.js`).

Must cover:

| Area | Cases |
|---|---|
| Purity | game.js source has no `Math.random`, `Date`, `window`, `document`, `localStorage`, `Math.sin/cos/atan2` (string scan) |
| RNG | mulberry32 known first 5 outputs; streams independent; `hash32` stable |
| Determinism | same seed + same action script for 3,600 ticks -> same `hashState`; different seed differs; save at tick 1,000, load, continue -> same hash as uninterrupted |
| newRun | shape matches 5.1; 7 pre-placed rocks on screen with spacing >= 44; budget, drones, HP from TUNING |
| Field | rocks move scroll*TICK per tick; removed past 680; cap 22 respected; spawn spacing rule |
| sectorParams | table in 2.10 reproduced for n = 1..8 and clamps at n = 20 |
| tryTether / preview | every failure reason reachable; cost = len*0.25*mods; snap picks nearest valid; refused when over budget; preview never mutates state (hash equal before and after) |
| Power | use recomputed as rocks drift; brownout on/off events; drones at half speed in brownout |
| Overstretch / offscreen | tether past maxLen cut with reason; Superconductor prevents it; target leaving field cuts |
| Drones | assignment fewest-first then shortest then id; stagger; cap per tether; mining amount; delivery adds gauge, score, stats; cargo lost on cut; idle on depletion |
| Ice | repairs 0.5/unit, capped at hpMax; Coolant Loop |
| Relays | each makeRelay reason; link kept; source from relay works; depth 3 limit; cascade cut; relay leaving field cascades; inert relay re-linkable; Relay Hub halves cost |
| cutAcross | crossing cuts, near miss does not; multiple tethers in one swipe |
| Flares | none in sector 1; warning 3 s before; cuts only tethers > severLen; doomed list correct; Flare Shield blocks per sector; Long Reach |
| Raiders | none before sector 3; warn -> approach -> latch -> ride; snap kill on cut (+50); turret kill; Live Wire kill; ram damage and removal; no-tether path to station |
| Warp | gauge full -> warp 1.2 s -> cards; offer is 3 distinct cards, epics only from sector 3, maxed cards excluded, patch kit fill; same seed same offer; pickCard reasons; next sector clears field, +15 HP, +300n score, +1 star |
| Cards | every card's fx changes mods as in 3.2; stacking to max; computeMods from scratch equals incremental; Splitter bonus delivered; Crystal Chain conversion and range |
| Run over | HP <= 0 -> phase over, run_over event once; step no-op after; abandonRun |
| Save | serializeRun strips events; loadRun round-trip equal hash; corrupt JSON -> "parse"; wrong v -> "version"; missing arrays -> "shape" |
| Profile | newProfile defaults; bankRun adds stars once (`already_banked`), best update, newBest flag; buyLook/equipLook reasons; loadProfile fills missing fields |
| Stress | `newRun(seed, {stress:true})` hits every cap; 600 ticks under 300 ms total on the test machine |

### 12.2 Manual checklist (tester, phone-sized viewport)

Run in Chrome DevTools device mode at **360 x 740** and **412 x 915**, then on a real Android phone; iPhone
Safari if available.

1. Page loads from `file://` and from `tools\serve.js`; no console errors.
2. Portrait fills the screen; notch and home indicator never cover HUD or the station.
3. Landscape on a phone shows the rotate overlay and pauses.
4. Drag station -> rock creates a tether; the cost label stays visible above the thumb; green/red preview.
5. Release on empty space: nothing created, no power spent.
6. Drag from a rock to the station also creates a tether.
7. A 24 px+ swipe across a tether cuts it; a tap on a tether does not.
8. Tap a tethered husk makes a relay; tap on a live rock does nothing.
9. Drawing from a relay works; cutting the relay's link removes its tethers.
10. Power meter matches; brownout flashes and drones slow when drift overdraws.
11. Field drifts; tethers to leaving rocks snap at the bottom edge.
12. Sector 2: flare warning shows doomed tethers 3 s ahead; long ones cut.
13. Sector 3 (`?sector=3`): raid markers, raiders latch and ride; cutting kills; ramming hurts.
14. Gauge fills -> warp -> card screen; a stray tap does not pick; picking starts the next sector.
15. Station destroyed -> run over shows score, best, stars; Play again works.
16. Stars bank once; hangar buy/equip works and persists after reload.
17. Switch apps mid-run, return: game paused; kill the tab, reopen: Resume offered and matches.
18. Onboarding shows the three steps on a fresh profile; Skip tips works; Replay tutorial works.
19. Sound and haptics toggles work; no sound before first touch.
20. Reduced motion (OS setting and in-game): no shake, no flash.
21. `?perf` on the real phone: p95 <= 16.7 ms in normal play; `?stress` stays playable (>= 50 fps).
22. Install to home screen (secure context), launch offline in airplane mode, play a full run.
23. Two fingers on screen at once never create two actions.
24. All DOM buttons are at least 44 px; primary buttons reachable by the thumb.

---

## 13. Build plan

Two branches per milestone (`m<N>-rules`, `m<N>-ui`), merged rules first. The front end may start a
milestone as soon as the contract for it (listed below, already in this document) is agreed; until the rules
branch merges, it tests against `newRun` + `step` from the previous milestone and hand-made states built
with the shapes in 5.1. Tester and reviewer run after each pair.

### M1. Core loop: draw, mine, drift

| | |
|---|---|
| Rules | UMD shell, `TICK`, `TUNING` (world, station, rocks, resources, tether, drones, sectors), RNG + streams, `newRun`, `step` (drift, spawn, despawn, power, brownout, overstretch, drones, delivery, score, gauge accumulates but no warp), `pick`, `previewTether`, `tryTether`, `cutTether`, `cutAcross`, `tetherEnds`, `drainEvents`, `hashState`, `sectorParams` |
| Front end | index.html, style.css, render.js (view transform, DPR, layers 1-5, 7-9, canvas HUD with score and power), input.js (full recogniser except tap-to-relay), main.js loop, `?seed`, `?perf`, `tools\serve.js`, README |
| Contract | 5.1 fields: rocks, tethers, drones, station, power, score, gauge; events `tether_created`, `tether_cut`, `rock_depleted`, `delivery`, `brownout` |
| Accept | tests pass (determinism, field, tether, power, drones); on a 360 x 740 viewport a player can draw, cut and watch drones mine and score rise for 2 minutes with no errors; 60 fps in DevTools 4x throttle |

### M2. Relays, warp and first cards

| | |
|---|---|
| Rules | `makeRelay`, powered/cascade, link and inert relays, ice repair, gauge full -> warp -> cards -> `pickCard`, sector progression, CARDS (8 commons + patch kit), `computeMods`, offer draw, `cardText` |
| Front end | tap-to-relay, relay drawing, gauge bar, sector banner, card pick screen (9.2) with confirm tap |
| Contract | events `relay_created`, `station_repaired`, `gauge_full`, `cards_offered`, `card_picked`, `sector_start`; `state.offer`, `state.cards` |
| Accept | relay and card tests pass; a run reaches sector 3 by play; offers identical for the same seed |

### M3. Hazards and the end of a run

| | |
|---|---|
| Rules | flares (warning, doomed, sever), raiders (warn, approach, latch, ride, snap kill, ram), turret, station HP, run over, `abandonRun`, raider/flare score |
| Front end | flare glow/flash/tint, raid markers, raiders, turret beam, HP bar, station hit feedback, pause sheet, run over screen (9.3) |
| Contract | events `flare_warning`, `flare`, `raid_warning`, `raider_spawn`, `raider_latched`, `raider_killed`, `station_hit`, `run_over`; `state.over` |
| Accept | hazard tests pass; a full run ends in destruction in about 3-5 minutes for a casual tester (a guide, section 14 question 6); `?sector=3` shows raiders at once |

### M4. Full card set, stars, saves

| | |
|---|---|
| Rules | remaining 7 cards (rares, epics, special mechanics), star rocks and stars, profile functions, `serializeRun`/`loadRun`, `bankRun` |
| Front end | storage.js (keys, damaged copies, quota), autosave timing, resume/abandon on home, home screen, best score, card rarity styling, split shard and chain effects |
| Contract | 5.2, 5.3, 6.5; events `drone_split`, `crystal_chain`, `flare_blocked`, `star_collected` |
| Accept | save round-trip tests; killing the tab mid-run and reopening resumes the same tick-state; stars bank exactly once |

### M5. Hangar, onboarding, feel

| | |
|---|---|
| Rules | LOOKS, `buyLook`, `equipLook`, `markOnboarding` |
| Front end | hangar (9.4), look sprites, settings, onboarding (9.5), audio.js sounds and haptics, reduced motion, rotate overlay, reason toasts (9.6) |
| Contract | `profile.owned`, `equipped`, `settings`, `onboarding` |
| Accept | a fresh profile sees all three tips once; buying and equipping persists; checklist items 18-20 pass |

### M6. PWA, performance, polish

| | |
|---|---|
| Rules | `stress` option fills caps; perf test in tests.js; balance pass on TUNING from playtest notes |
| Front end | manifest, sw.js, icons, update flow, `?stress`, perf overlay polish, sprite caching audit |
| Contract | none new |
| Accept | installable on Android, works offline; checklist 21-22 pass; Lighthouse PWA installable checks pass; full manual checklist green |

---

### Prototype scope (ruling W4)

The first prototype (M1 to M3 plus three cards) has no profile, stars, hangar, home screen or saves. Run
over shows score, sector reached and stats, with Play again. Pause offers Resume, Restart and Quit (Quit
calls `abandonRun` and shows run over). Stars and star rocks are hidden or left out. The seed is
`Date.now() >>> 0`, or `?seed=N`.

---

## 14. Open questions for the owner

| # | Question | Default if no answer |
|---|---|---|
| 1 | Should players also be able to **tap a raider** to zap it (a second verb, costs power)? | No. Counter play is cutting the ridden tether, the turret and Live Wire. Revisit after M3 playtest. |
| 2 | Warp when the gauge fills: **automatic**, or a "Warp" tap so players can delay for score? | Automatic after 1.2 s. Keeps play one-gesture. |
| 3 | Where to host for phone and install testing (needs HTTPS)? | GitHub Pages from a `tether-game` repo the owner creates; until then USB port forwarding to `tools\serve.js`. |
| 4 | Should a run be resumable after the app is closed? | Yes, one slot (`tether-run-v1`), autosave every 10 s and on hide. |
| 5 | Hangar scope for v1 (Fleet-style themes later?) | 15 looks in 4 slots, 138 stars total (about 15-25 runs); no themes in v1. |
| 6 | Is 3-5 minutes per run a hard target (add sudden death after sector 8) or a guide? | A guide. No sudden death; difficulty keeps rising and raider HP is uncapped. |
