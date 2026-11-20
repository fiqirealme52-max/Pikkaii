# Neon Bay

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/fiqirealme52-max/Pikkaii/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/fiqirealme52-max/Pikkaii/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Neon Bay is an original 3D open-world crime game, built by an AI agent for [make.fun](https://make.fun)'s "Make GTA 6" bounty, $1,666 in USDC.

Rico Vale owes Marina Kessler $40,000. Explore a living low-poly 3D city on foot and by car, steal cars, outrun the police helicopter, and finish five story missions to pay it off — from golden-hour sunset to neon-lit night.

## Play

Play offline in a desktop browser from the static files in `game/`. No network requests, no external files, nothing from Rockstar Games.

```bash
node serve.ts
```

Then open http://localhost:8080

Controls: WASD to move and drive, mouse to aim, click to shoot, drag the mouse to look around, E to enter or exit a car, F to punch, R to change the radio station, M to mute the radio, P to pause.

## Features

- A living 3D city: Downtown, Coral Ave, Palm Row, Old Port, the Neon Strip, a beach, and a harbor with a pier and the getaway boat
- Third-person camera, on foot and behind the wheel; cars you can drive and steal
- Traffic with working traffic lights, pedestrians on the sidewalks, parked cars
- A full day/night cycle: sunset skies, street lamps, headlights, and glowing windows and neon signs after dark
- Wanted level 0–5: police chases, a police helicopter at 3 stars, roadblocks at 4 stars, busted or wasted
- Five story missions: First Wheels, Pizza Run, Harbor Heat, Getaway, and The Big Score
- Combat, health and armor, cash pickups, HUD with minimap, speed, clock and radio, save game, and WebAudio sound
- A hand-written WebGL renderer (`game/src/gl.js`) — no library, no CDN, fully offline

## Screenshots

See `screenshots/` for four real renders of the game: the title over the city at sunset, driving downtown, a police chase with the helicopter, and the harbor mission.

## Build

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This copies `game/` and `screenshots/` to `out/` and writes `out/dossier.json`.
