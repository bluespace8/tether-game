# Tether

A portrait, one-thumb asteroid-mining game. You draw lines (tethers) from your station to asteroids; drones run along them, mine, and haul ore, ice and crystal home. Spec: `ARCHITECTURE.md`.

This is the prototype build. Milestone 1 is in: draw, mine, drift, cut.

## Play

- Double-click `www\index.html` (works from `file://`), or run the server below and open the page.
- Drag from the station to a rock to make a tether. The label shows the power cost and what is left.
- Swipe across a tether to cut it. Tapping never cuts.
- Rocks drift down; a rock leaving the bottom breaks its tether. Tethers longer than 300 units snap.
- URL options: `?seed=N` fixes the field, `?sector=N` starts in that sector.
- Reload the page to start a new run (run over and pause screens come in a later milestone).

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
