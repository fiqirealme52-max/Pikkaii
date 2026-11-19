// The screenshot scenes behind ?shot=start|drive|chase|mission. Each one plays
// the real rules forward from a fresh world for a fixed number of steps, steered
// by a simple autopilot (drive toward a waypoint, shoot the nearest rival), so
// every frame is what a short game really looks like and the same seed always
// gives the same frame. No scene is posed: the traffic, the police and the
// mission all run while the shot is staged.

import { CITY, STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 6;
const DRIVE_SECONDS = 22;
const CHASE_SECONDS = 16;
const MISSION_SECONDS = 30;

const ACTION_ENTER = 4;
const ACTION_SHOOT = 8;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Drive the player's car toward (tx, ty) along the roads: the city is a grid,
 * so the autopilot first reaches the nearest road, then follows it to the
 * target's road line, then turns onto that line. Buildings block the diagonal.
 */
export function driveInput(world, tx, ty) {
  const car = world.state.player.inCar;
  if (!car) return { axes: { x: 0, y: 0, run: false }, actions: 0, aimX: tx, aimY: ty };
  // Which road is the car on, if any?
  let roadY = null;
  for (const ry of CITY.roadsY) if (Math.abs(car.y - ry) < 50) roadY = ry;
  let roadX = null;
  for (const rx of CITY.roadsX) if (Math.abs(car.x - rx) < 50) roadX = rx;
  let wx = tx;
  let wy = ty;
  if (roadY !== null && Math.abs(car.x - tx) > 60) {
    // On a horizontal road: run along it to the target's street first.
    wx = tx;
    wy = roadY;
  } else if (roadX !== null && Math.abs(car.y - ty) > 60) {
    // On a vertical road: run along it to the target's avenue.
    wx = roadX;
    wy = ty;
  } else if (roadY === null && roadX === null) {
    // Off-road (a parking lot): head for the nearest road centre.
    let bestX = CITY.roadsX[0];
    for (const rx of CITY.roadsX) if (Math.abs(rx - car.x) < Math.abs(bestX - car.x)) bestX = rx;
    let bestY = CITY.roadsY[0];
    for (const ry of CITY.roadsY) if (Math.abs(ry - car.y) < Math.abs(bestY - car.y)) bestY = ry;
    wx = bestX;
    wy = bestY;
  }
  // Reversing out of a dead end: if the car is barely moving and far off
  // course, back up a little while steering.
  const target = Math.atan2(wy - car.y, wx - car.x);
  const diff = angleDiff(target, car.angle);
  const reversing = Math.abs(diff) > 2.4 && Math.abs(car.speed) < 40;
  return {
    axes: {
      x: clamp(diff * 1.6, -1, 1),
      y: reversing ? 1 : -1,
      run: false,
    },
    actions: 0,
    aimX: tx,
    aimY: ty,
  };
}

/** Walk toward (tx, ty) on foot. */
function walkInput(world, tx, ty) {
  const player = world.state.player;
  const dx = tx - player.x;
  const dy = ty - player.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    axes: { x: dx / len, y: dy / len, run: false },
    actions: 0,
    aimX: tx,
    aimY: ty,
  };
}

/** Step the world for `seconds`, feeding it the input each frame. */
function playFor(world, seconds, inputFn, audio) {
  const steps = Math.floor(seconds / STEP);
  let events = 0;
  for (let i = 0; i < steps; i += 1) {
    events |= world.step(STEP, inputFn(world), audio || null);
    if (events & 32) break; // EVENT_WASTED: stop before the game-over screen.
  }
  return events;
}

/**
 * Set `world` to the named scene and return the screen to draw over it and the
 * best haul to show.
 */
export function stageShot(name, world) {
  const state = world.state;
  if (name === 'drive') {
    world.reset();
    // Walk to the parked car on Coral Ave and take it.
    state.player.x = 1000;
    state.player.y = 960;
    world.step(STEP, { axes: { x: 0, y: 0, run: false }, actions: ACTION_ENTER, aimX: 1000, aimY: 1000 }, null);
    playFor(world, DRIVE_SECONDS, (w) => driveInput(w, 2600, 1000));
    return { screen: SCREEN_PLAY, best: state.player.money };
  }
  if (name === 'chase') {
    world.reset();
    // The getaway job: three stars, the cops already on Rico's tail.
    world.startMission(3);
    state.player.x = 1000;
    state.player.y = 960;
    world.step(STEP, { axes: { x: 0, y: 0, run: false }, actions: ACTION_ENTER, aimX: 1000, aimY: 1000 }, null);
    // A circuit through downtown so the chase stays in the streets: the
    // car's wide turns at speed would carry a single out-and-back run to
    // the harbor's edge.
    const circuit = [[2200, 1000], [2200, 1400], [1400, 1400], [1400, 1000]];
    for (const leg of circuit) {
      playFor(world, 4, (w) => driveInput(w, leg[0], leg[1]));
    }
    return { screen: SCREEN_PLAY, best: state.player.money };
  }
  if (name === 'mission') {
    world.reset();
    world.startMission(2);
    state.player.x = 1800;
    state.player.y = 2240;
    state.player.ammo = 120;
    const steps = Math.floor(MISSION_SECONDS / STEP);
    for (let i = 0; i < steps; i += 1) {
      const alive = state.rivals.find((r) => r.alive);
      let input;
      if (alive) {
        // Strafe around the harbor while shooting, so the rivals' slow
        // bullets miss: circle the docks instead of standing still.
        const cx = 1800 + Math.cos(i * 0.02) * 150;
        const cy = 2280 + Math.sin(i * 0.02) * 90;
        const dx = cx - state.player.x;
        const dy = cy - state.player.y;
        const len = Math.hypot(dx, dy) || 1;
        input = {
          axes: { x: dx / len, y: dy / len, run: false },
          actions: ACTION_SHOOT,
          aimX: alive.x,
          aimY: alive.y,
        };
      } else if (state.mission.briefcase) {
        input = walkInput(world, state.mission.briefcase.x, state.mission.briefcase.y);
      } else {
        input = walkInput(world, 1800, 2400);
      }
      world.step(STEP, input, null);
      if (state.mission.stage === 'return') break;
    }
    return { screen: SCREEN_PLAY, best: state.player.money };
  }
  // start (and anything else): the title over a living city.
  world.reset();
  playFor(world, START_SECONDS, () => ({ axes: { x: 0, y: 0, run: false }, actions: 0, aimX: 640, aimY: 360 }));
  return { screen: SCREEN_TITLE, best: state.player.money };
}
