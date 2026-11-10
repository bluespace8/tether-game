# Tether

A portrait, one-thumb asteroid-mining game. You draw lines (tethers) from your station to asteroids; drones run along them, mine, and haul ore, ice and crystal home. Spec: `ARCHITECTURE.md`.

This is the prototype build. In so far: draw, mine, drift, cut (M1); relays, warp and upgrade cards (M2).

## Play

- Double-click `www\index.html` (works from `file://`), or run the server below and open the page.
- Drag from the station to a rock to make a tether. The label shows the power cost and what is left.
- Swipe across a tether to cut it. Tapping never cuts.
- Rocks drift down; a rock leaving the bottom breaks its tether. Tethers longer than 300 units snap.
- URL options: `?seed=N` fixes the field, `?sector=N` starts in that sector.
- Tap a mined-out rock that still has a tether to turn it into a relay, then draw new tethers from the relay. Cutting a relay's link cuts everything hanging off it.
- Delivered material fills the WARP gauge. When it is full the game warps to the next sector and offers up to three cards: tap one to select it, tap it again (or press Take) to confirm.
- Reload the page to start a new run (run over and pause screens come in the next milestone).

## Phone testing

```
ELECTRON_RUN_AS_NODE=1 "E:\Evan\Programs\VSCode\Code.exe" tools\serve.js
```

PowerShell: `$env:ELECTRON_RUN_AS_NODE=1; & 'E:\Evan\Programs\VSCode\Code.exe' tools\serve.js`. Then open `http://<pc-ip>:8080` on the phone.

## Test

```
$env:ELECTRON_RUN_AS_NODE=1; & 'E:\Evan\Programs\VSCode\Code.exe' tests.js
```

bash: `ELECTRON_RUN_AS_NODE=1 "/e/Evan/Programs/VSCode/Code.exe" tests.js`

All rules live in `www\game.js` (pure, deterministic, no DOM). `tests.js` covers them.
