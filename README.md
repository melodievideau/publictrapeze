# Trapeze — a quiet game

A relaxing browser game about swinging from trapeze to trapeze. No goal, no fail
state — just a rhythm: hold to swing, release at the top of the forward swing, and
catch the next bar. Miss, and you softly start again. The sky slowly cycles from
dusk to deep night and back; stars, a moon, drifting clouds, and fireflies come and
go. All sound is synthesized in the browser (soft pad, wind, plucks on each catch).

## Run it

Either open `index.html` directly in a browser, or serve the folder:

```
cd trapeze
python3 -m http.server 8000
```

then visit http://localhost:8000

## Controls

- **Hold SPACE** (or press & hold anywhere / touch) — pump the swing
- **Release** on the forward swing — fly to the next trapeze
- **M** — toggle sound

## Files

- `index.html` — page shell, HUD, start overlay
- `style.css` — styling
- `game.js` — physics (exported for tests), rendering, input, Web Audio synth
- `test/physics.test.js` — headless physics checks: run with `node test/physics.test.js`
