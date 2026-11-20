// The screenshot scenes behind ?shot=start|drive|chase|mission. Each one plays
// the real rules forward from a fresh world for a fixed number of steps, steered
// by a simple autopilot (drive toward a waypoint, shoot the nearest rival), so
// every frame is what a short game really looks like and the same seed always
// gives the same frame. No scene is posed: the traffic, the police, the
// helicopter and the mission all run while the shot is staged.

import { CITY, STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 6;
const DRIVE_SECONDS = 40;
const CHASE_SECONDS = 30;
const MISSION_SECONDS = 45;

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
 * Drive the player's car toward (tx, tz) along the roads: the city is a grid,
 * so the autopilot first reaches the nearest road, then follows it to the
 * target's road line, then turns onto that line. Buildings block the diagonal.
 */
export function driveInput(world, tx, tz) {
  const car = world.state.player.inCar;
  if (!car) return { axes: { x: 0, y: 0, run: false }, actions: 0, aimX: tx, aimZ: tz };
  // Which road is the car on, if any?
  let roadZ = null;
  for (const rz of CITY.roadsZ) if (Math.abs(car.z - rz) < 50) roadZ = rz;
  let roadX = null;
  for (const rx of CITY.roadsX) if (Math.abs(car.x - rx) < 50) roadX = rx;
  let wx = tx;
  let wz = tz;
  if (roadZ !== null && Math.abs(car.x - tx) > 60) {
    // On a horizontal road: run along it to the target's street first.
    wx = tx;
    wz = roadZ;
  } else if (roadX !== null && Math.abs(car.z - tz) > 60) {
    // On a vertical road: run along it to the target's avenue.
    wx = roadX;
    wz = tz;
  } else if (roadZ === null && roadX === null) {
    // Off-road (a parking lot): head for the nearest road centre.
    let bestX = CITY.roadsX[0];
    for (const rx of CITY.roadsX) if (Math.abs(rx - car.x) < Math.abs(bestX - car.x)) bestX = rx;
    let bestZ = CITY.roadsZ[0];
    for (const rz of CITY.roadsZ) if (Math.abs(rz - car.z) < Math.abs(bestZ - car.z)) bestZ = rz;
    wx = bestX;
    wz = bestZ;
  }
  // Reversing out of a dead end: if the car is barely moving and far off
  // course, back up a little while steering.
  const target = Math.atan2(wz - car.z, wx - car.x);
  const diff = angleDiff(target, car.angle);
  const reversing = Math.abs(diff) > 2.4 && Math.abs(car.speed) < 4;
  return {
    axes: {
      x: clamp(diff * 1.6, -1, 1),
      y: reversing ? 1 : -1,
      run: false,
    },
    actions: 0,
    aimX: tx,
    aimZ: tz,
    cameraYaw: car.angle,
  };
}

/** Walk toward (tx, tz) on foot: the camera faces the target, W walks forward. */
function walkInput(world, tx, tz) {
  const player = world.state.player;
  const dx = tx - player.x;
  const dz = tz - player.z;
  return {
    axes: { x: 0, y: -1, run: false },
    actions: 0,
    aimX: tx,
    aimZ: tz,
    cameraYaw: Math.atan2(dz, dx),
  };
}

/** Stand still and let the scene settle: particles fade, the camera stops
 * moving, so a staged frame is clean instead of mid-explosion. */
function idleInput() {
  return { axes: { x: 0, y: 0, run: false }, actions: 0, aimX: 1800, aimZ: 2400, cameraYaw: 0 };
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
  state.orbit = { yawOffset: 0, pitch: 0.32 };
  if (name === 'drive') {
    world.reset();
    // Walk to the nearest parked car and take it.
    const near = world.state.cars
      .filter((c) => c.kind === 'parked')
      .sort((a, b) => (a.x - 1000) ** 2 + (a.z - 960) ** 2 - ((b.x - 1000) ** 2 + (b.z - 960) ** 2))[0];
    state.player.x = near.x + 3;
    state.player.z = near.z + 3;
    world.step(STEP, { axes: { x: 0, y: 0, run: false }, actions: ACTION_ENTER, aimX: near.x, aimZ: near.z, cameraYaw: 0 }, null);
    playFor(world, DRIVE_SECONDS, (w) => driveInput(w, 2600, 1000));
    state.clock = 4; // golden hour, so the drive reads in warm sunset light
    return { screen: SCREEN_PLAY, best: state.player.money };
  }
  if (name === 'chase') {
    world.reset();
    // The getaway job: three stars, the cops already on Rico's tail.
    world.startMission(3);
    const near = world.state.cars
      .filter((c) => c.kind === 'parked')
      .sort((a, b) => (a.x - 1000) ** 2 + (a.z - 960) ** 2 - ((b.x - 1000) ** 2 + (b.z - 960) ** 2))[0];
    state.player.x = near.x + 3;
    state.player.z = near.z + 3;
    world.step(STEP, { axes: { x: 0, y: 0, run: false }, actions: ACTION_ENTER, aimX: near.x, aimZ: near.z, cameraYaw: 0 }, null);
    // A circuit through downtown so the chase stays in the streets: the
    // car's wide turns at speed would carry a single out-and-back run to
    // the harbor's edge.
    const circuit = [[2200, 1000], [2200, 1400], [1400, 1400], [1400, 1000]];
    for (const leg of circuit) {
      playFor(world, 7.5, (w) => driveInput(w, leg[0], leg[1]));
    }
    state.clock = 14; // dusk: lamps and neon on, the helicopter in the sky
    return { screen: SCREEN_PLAY, best: state.player.money };
  }
  if (name === 'mission') {
    world.reset();
    world.startMission(2);
    state.player.x = 1800;
    state.player.z = 2240;
    state.player.ammo = 120;
    const steps = Math.floor(MISSION_SECONDS / STEP);
    for (let i = 0; i < steps; i += 1) {
      const alive = state.rivals.find((r) => r.alive);
      let input;
      if (alive) {
        const near = state.rivals.filter((r) => r.alive);
        const cx0 = near.reduce((s, r) => s + r.x, 0) / near.length;
        const cz0 = near.reduce((s, r) => s + r.z, 0) / near.length;
        const dRival = Math.hypot(alive.x - state.player.x, alive.z - state.player.z);
        if (dRival > 22) {
          // Close in first: bullets only fly 36 units, so strafe range is useless
          // from across the harbor.
          input = walkInput(world, alive.x, alive.z);
        } else {
          // Strafe around the rival cluster while shooting, so the rivals'
          // slow bullets miss: circle the docks instead of standing still.
          const cx = cx0 + Math.cos(i * 0.03) * 10;
          const cz = cz0 + Math.sin(i * 0.03) * 7;
          input = {
            axes: { x: 0, y: -1, run: false },
            actions: ACTION_SHOOT,
            aimX: alive.x,
            aimZ: alive.z,
            cameraYaw: Math.atan2(cz - state.player.z, cx - state.player.x),
          };
        }
      } else if (state.mission.briefcase) {
        input = walkInput(world, state.mission.briefcase.x, state.mission.briefcase.z);
      } else {
        input = walkInput(world, 1800, 2400);
      }
      world.step(STEP, input, null);
      if (state.mission.stage === 'return') break;
    }
    // Face back toward the city (the hideout is north) before the camera
    // settles, so the frame shows Rico with downtown behind him instead of
    // an empty stretch of beach and sea.
    state.player.angle = -Math.PI / 2;
    // Let the fight's blood and spark particles fade and the camera settle
    // before the frame is taken — otherwise the harbor reads as debris.
    playFor(world, 2, idleInput);
    state.clock = 6; // late golden hour over the harbor
    return { screen: SCREEN_PLAY, best: state.player.money };
  }
  // start (and anything else): the title over a living city at golden hour.
  world.reset();
  playFor(world, START_SECONDS, () => ({ axes: { x: 0, y: 0, run: false }, actions: 0, aimX: 640, aimZ: 360, cameraYaw: 0 }));
  state.clock = 6; // sunset
  return { screen: SCREEN_TITLE, best: state.player.money };
}
