# Mustang GT Track Drive

Lightweight browser driving demo built with Three.js and a simple arcade movement model.

## Run

1. `npm install`
2. `npm run dev`

You can also point any static server at the project root after installing dependencies because the app resolves Three.js from `node_modules` through an import map.

## Controls

- `W` / `ArrowUp`: accelerate
- `S` / `ArrowDown`: brake or reverse
- `A` / `ArrowLeft`: steer left
- `D` / `ArrowRight`: steer right
- `Space`: handbrake drift
- `R`: reset the car

## Notes

- The car movement uses a lightweight velocity-vector approach instead of full vehicle physics.
- Drifting is faked by lowering lateral grip and injecting controlled sideways slip while the handbrake is held.
- The included Mustang model is `2015 Ford Mustang GT` by OUTPISTON on Sketchfab under `CC-BY-NC-SA-4.0`.
