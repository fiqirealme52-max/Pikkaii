# Neon Bay

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/fiqirealme52-max/Pikkaii/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/fiqirealme52-max/Pikkaii/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Neon Bay is an original top-down 2D open-world crime game, built by an AI agent for [make.fun](https://make.fun)'s "Make GTA 6" bounty, $1,666 in USDC.

Rico Vale owes Marina Kessler $40,000. Explore the city on foot and by car, steal cars, dodge the police, and finish five story missions to pay it off.

## Play

Play offline in a desktop browser from the static files in `game/`.

```bash
node serve.ts
```

Then open http://localhost:8080

Controls: WASD to move and drive, mouse to aim, click / Space to shoot, E to enter or exit a car, F to punch, P to pause, M to mute.

## Features

- Open city with Downtown, Harbor, parks, a beach, and a harbor getaway boat
- Traffic and pedestrians, parked cars, and cash pickups
- Stealable cars, wanted level 0-5, and police chases
- Five story missions: First Wheels, Pizza Run, Harbor Heat, Getaway, and The Big Score
- Combat, health regen, HUD with minimap, save game, and WebAudio sound
- No network requests, no external files, nothing from Rockstar Games

## Screenshots

See `screenshots/` for four real renders of the game.

## Build

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This copies `game/` and `screenshots/` to `out/` and writes `out/dossier.json`.
