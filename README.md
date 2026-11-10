# Tether

A portrait, one-thumb asteroid-mining game. You draw lines (tethers) from your station to asteroids; drones run along them, mine, and haul ore, ice and crystal home. Spec: `ARCHITECTURE.md`.

This is the prototype build. In so far: draw, mine, drift, cut (M1); relays, warp and upgrade cards (M2); solar flares, raiders and the end of a run (M3).

## Play

- Double-click `www\index.html` (works from `file://`), or run the server below and open the page.
- Drag from the station to a rock to make a tether. The label shows the power cost and what is left.
- Swipe across a tether to cut it. Tapping never cuts.
- Rocks drift down; a rock leaving the bottom breaks its tether. Tethers longer than 300 units snap.
- URL options: `?seed=N` fixes the field, `?sector=N` starts in that sector.
- Tap a mined-out rock that still has a tether to turn it into a relay, then draw new tethers from the relay. Cutting a relay's link cuts everything hanging off it.
- Delivered material fills the WARP gauge. When it is full the game warps to the next sector and offers up to three cards: tap one to select it, tap it again (or press Take) to confirm.
- From sector 2 a solar flare warns 3 seconds ahead (red pulsing tethers are the ones it will cut: shorten or cut them yourself). From sector 3 raiders are warned at the top edge, then latch onto a tether and ride it to the station. Cutting the tether a raider rides kills it; the turret and Live Wire help too.
- The run ends when the station is destroyed: the run-over screen shows score, sector and stats, with Play again. The II button pauses (Resume, Restart, Quit).
- Hazards start late in a sector (first flare at 20 s, first raid warned at 15 s), so `?sector=3` shows raiders after about 15 seconds.

## Phone testing

```
ELECTRON_RUN_AS_NODE=1 "E:\Evan\Programs\VSCode\Code.exe" tools\serve.js
```

PowerShell: `$env:ELECTRON_RUN_AS_NODE=1; & 'E:\Evan\Programs\VSCode\Code.exe' tools\serve.js`.

By default the server listens on `127.0.0.1` only (this PC). For a phone on the same Wi-Fi add `--lan`, which listens on all interfaces (`0.0.0.0`): `... tools\serve.js --lan`, then open `http://<pc-ip>:8080` on the phone. An optional port can come first: `tools\serve.js 9000 --lan`.

## Test

```
$env:ELECTRON_RUN_AS_NODE=1; & 'E:\Evan\Programs\VSCode\Code.exe' tests.js
```

bash: `ELECTRON_RUN_AS_NODE=1 "/e/Evan/Programs/VSCode/Code.exe" tests.js`

All rules live in `www\game.js` (pure, deterministic, no DOM). `tests.js` covers them.
