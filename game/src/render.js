// Drawing only: the world's state and the current screen in, pixels out.
// The 3D scene goes through the WebGL renderer (city, water, cars, people,
// helicopter, beacons); the HUD, the minimap and the menus are DOM on top.
// The camera chases the player in third person and smooths behind them.

import { CAR, CITY, DISTRICTS, MISSIONS, PALETTE, PLAYER, VIEW, WORLD } from './config.js';
import { dayNight } from './world.js';
import {
  MeshBuilder, createGLRenderer, hexRgb,
  mat4Perspective, mat4LookAt, mat4FromTRS,
} from './gl.js';
import { trafficLightColor } from './city.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_WIN = 'win';

const FOV = (62 * Math.PI) / 180;
const TWO_PI = Math.PI * 2;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

/** A car body: stepped hood and trunk, glass cabin with a roof, slanted
 * windshield and rear glass, grille, bumpers and hubcaps — front toward
 * local +x. The police light bar in the glow mesh still sits on the roof. */
function buildCarMesh(color) {
  const b = new MeshBuilder();
  // Lower body (y 0.3..1.1), then hood and trunk steps.
  b.box(0, 0.7, 0, CAR.length, 0.8, CAR.width, color, { top: color });
  b.box(2.6, 0.95, 0, 1.6, 0.5, CAR.width - 0.4, color); // hood
  b.box(-2.7, 0.95, 0, 1.4, 0.5, CAR.width - 0.4, color); // trunk
  // Glass cabin (x -2.0..1.0, y 1.1..2.0) with a body-colour roof.
  b.box(-0.5, 1.55, 0, 3.0, 0.9, 2.9, '#1c2733');
  b.box(-0.5, 2.08, 0, 2.6, 0.25, 2.6, color);
  // Slanted windshield and rear glass.
  b.quad([1.35, 1.05, 1.45], [1.35, 1.05, -1.45], [1.0, 1.95, -1.45], [1.0, 1.95, 1.45], '#8fd4e8');
  b.quad([-2.4, 1.05, -1.45], [-2.4, 1.05, 1.45], [-2.0, 1.95, 1.45], [-2.0, 1.95, -1.45], '#8fd4e8');
  // Grille and bumpers.
  b.box(3.62, 0.65, 0, 0.18, 0.5, 2.2, '#1c1f26');
  b.box(3.65, 0.45, 0, 0.24, 0.35, CAR.width - 0.2, '#c0c8d0');
  b.box(-3.65, 0.45, 0, 0.24, 0.35, CAR.width - 0.2, '#c0c8d0');
  // Wheels with hubcaps.
  for (const wx of [-2.3, 2.3]) {
    for (const wz of [-1.7, 1.7]) {
      b.box(wx, 0.55, wz, 1.4, 1.1, 0.5, '#14161a');
      b.box(wx, 0.55, wz + (wz > 0 ? 0.28 : -0.28), 0.7, 0.55, 0.1, '#c0c8d0');
    }
  }
  return b;
}

/** Headlights, taillights and the police light bar — drawn emissive. */
function buildCarGlowMesh() {
  const b = new MeshBuilder();
  b.box(3.55, 0.9, -1.1, 0.3, 0.35, 0.7, '#fff2b0');
  b.box(3.55, 0.9, 1.1, 0.3, 0.35, 0.7, '#fff2b0');
  b.box(-3.55, 0.9, -1.1, 0.3, 0.35, 0.7, '#ff3b30');
  b.box(-3.55, 0.9, 1.1, 0.3, 0.35, 0.7, '#ff3b30');
  b.box(-0.4, 2.3, 0, 1.2, 0.35, 2.2, '#ffffff');
  return b;
}

/** A person: legs, torso, arms, head — about 2 units tall. */
function buildPersonMesh(shirt) {
  const b = new MeshBuilder();
  b.box(0, 0.45, 0, 0.7, 0.9, 0.45, '#2c303a'); // legs
  b.box(0, 1.25, 0, 0.9, 0.9, 0.5, shirt); // torso
  b.box(-0.55, 1.25, 0, 0.25, 0.8, 0.35, shirt); // arms
  b.box(0.55, 1.25, 0, 0.25, 0.8, 0.35, shirt);
  b.box(0, 1.95, 0, 0.55, 0.55, 0.55, '#e8b98a'); // head
  b.box(0, 2.28, 0, 0.6, 0.12, 0.6, '#1c1f26'); // hair / cap
  return b;
}

function buildHeliMesh() {
  const b = new MeshBuilder();
  b.box(0, 0, 0, 5, 2.2, 2.6, '#e8e4da');
  b.box(0.6, 0.4, 0, 2.6, 1.2, 2.2, '#2f6df6'); // cockpit glass
  b.box(-4.2, 0.3, 0, 4.5, 0.7, 0.7, '#e8e4da'); // tail boom
  b.box(-6.2, 0.9, 0, 0.4, 2.2, 0.3, '#2f6df6'); // tail fin
  b.box(-1.2, -1.4, -1, 3.4, 0.25, 0.25, '#1c1f26'); // skids
  b.box(-1.2, -1.4, 1, 3.4, 0.25, 0.25, '#1c1f26');
  b.box(0, -1.15, 0, 1.6, 0.5, 0.5, '#ff3b30'); // belly light
  return b;
}

function buildRotorMesh() {
  const b = new MeshBuilder();
  b.box(0, 0, 0, 15, 0.18, 0.9, '#1c1f26');
  b.box(0, 0, 0, 0.9, 0.18, 15, '#1c1f26');
  return b;
}

function buildSkyDome() {
  const b = new MeshBuilder();
  const R = 3000;
  const latSteps = 6;
  const lonSteps = 16;
  const point = (lat, lon) => [
    Math.cos(lat) * Math.cos(lon) * R,
    Math.sin(lat) * R,
    Math.cos(lat) * Math.sin(lon) * R,
  ];
  for (let i = 0; i < latSteps; i += 1) {
    const lat0 = (-0.12 + (i / latSteps) * 1.12) * (Math.PI / 2);
    const lat1 = (-0.12 + ((i + 1) / latSteps) * 1.12) * (Math.PI / 2);
    for (let j = 0; j < lonSteps; j += 1) {
      const lon0 = (j / lonSteps) * TWO_PI;
      const lon1 = ((j + 1) / lonSteps) * TWO_PI;
      const a = point(lat0, lon0);
      const c = point(lat1, lon1);
      const d = point(lat1, lon0);
      const bb = point(lat0, lon1);
      // Wound so the normal points outward (the shader gradients by it).
      b.quad(a, d, c, bb, '#ffffff');
    }
  }
  return b;
}

/** Ten clouds, each a cluster of three overlapping slabs at slightly
 * different heights and offsets, so they read as puffy clouds from below
 * instead of one hard-edged rectangle. */
function buildCloudMesh() {
  const b = new MeshBuilder();
  const spots = [
    [600, 320, 500, 300, 110], [1600, 360, 900, 360, 130], [2600, 300, 400, 270, 100],
    [900, 400, 1600, 320, 120], [2200, 340, 1900, 350, 110], [3200, 380, 1100, 300, 110],
    [300, 350, 2000, 270, 95], [2900, 330, 2100, 310, 110], [1400, 390, 300, 280, 100],
    [3300, 310, 1800, 320, 120],
  ];
  for (const [x, y, z, w, d] of spots) {
    // Main slab, then two smaller puffs offset up and to the sides.
    b.quad([x - w / 2, y, z - d / 2], [x + w / 2, y, z - d / 2],
      [x + w / 2, y, z + d / 2], [x - w / 2, y, z + d / 2], '#ffffff');
    b.quad([x - w * 0.28, y + 7, z - d * 0.3], [x + w * 0.32, y + 7, z - d * 0.3],
      [x + w * 0.32, y + 7, z + d * 0.3], [x - w * 0.28, y + 7, z + d * 0.3], '#ffffff');
    b.quad([x - w * 0.2, y + 13, z - d * 0.22], [x + w * 0.24, y + 13, z - d * 0.22],
      [x + w * 0.24, y + 13, z + d * 0.22], [x - w * 0.2, y + 13, z + d * 0.22], '#ffffff');
  }
  return b;
}

export function createRenderer(canvas, hud) {
  const glr = createGLRenderer(canvas);
  const minimap = hud.minimap.getContext('2d');

  function meshFrom(build) {
    const b = new MeshBuilder();
    build(b);
    return glr.createMesh(b);
  }

  const unitBox = meshFrom((b) => b.box(0, 0, 0, 1, 1, 1, '#ffffff'));
  const carMeshes = new Map();
  const carGlow = glr.createMesh(buildCarGlowMesh());
  const playerMesh = glr.createMesh(buildPersonMesh(PALETTE.player));
  const pedMesh = glr.createMesh(buildPersonMesh('#ffffff'));
  const heliMesh = glr.createMesh(buildHeliMesh());
  const rotorMesh = glr.createMesh(buildRotorMesh());
  const skyMesh = glr.createMesh(buildSkyDome());
  const cloudMesh = glr.createMesh(buildCloudMesh());
  const beaconMesh = meshFrom((b) => b.cylinder(0, 0, 0, 3.5, 50, '#ff4d9d', 12));
  const ringMesh = meshFrom((b) => b.cylinder(0, 0, 0, 9, 0.5, '#ff4d9d', 20));
  const beamMesh = meshFrom((b) => b.cylinderTapered(0, 0, 0, 1, 4, 1, '#fff2b0', 10));

  function carMeshFor(color) {
    if (!carMeshes.has(color)) carMeshes.set(color, glr.createMesh(buildCarMesh(color)));
    return carMeshes.get(color);
  }

  // Smoothed camera state.
  const cam = { yaw: 0, pitch: 0.32, dist: 16, x: 600, y: 8, z: 620, ready: false };
  let lastCamera = null;
  // The city's builders become GL meshes on the first frame.
  let cityGL = null;
  function cityMeshes(state) {
    if (!cityGL) {
      cityGL = {
        water: glr.createMesh(state.city.waterMesh),
        static: glr.createMesh(state.city.staticMesh),
        glow: glr.createMesh(state.city.glowMesh),
        pier: glr.createMesh(state.city.pierMesh),
      };
    }
    return cityGL;
  }

  function resize() {
    glr.resize(window.innerWidth, window.innerHeight);
  }

  function headingModel(x, y, z, angle, sx, sy, sz) {
    return mat4FromTRS(x, y, z, -angle, sx || 1, sy || 1, sz || 1);
  }

  function drawCar(car, time) {
    const mesh = carMeshFor(car.color);
    glr.drawMesh(mesh, headingModel(car.x, 0, car.z, car.angle));
    const night = glr.env.night || 0;
    const flash = Math.floor(time / 0.25) % 2 === 0;
    const tint = car.kind === 'police'
      ? (flash ? [1, 0.15, 0.12] : [0.2, 0.45, 1])
      : [1, 1, 1];
    glr.drawMesh(carGlow, headingModel(car.x, 0, car.z, car.angle), {
      emissive: 1, tint,
    });
    // Headlight pools on the road at night, just ahead of the car.
    if (night > 0.4 && (car.kind === 'player' || car.kind === 'police')) {
      const fx = car.x + Math.cos(car.angle) * 8.5;
      const fz = car.z + Math.sin(car.angle) * 8.5;
      glr.drawMesh(unitBox, mat4FromTRS(fx, 0.12, fz, -car.angle, 7, 0.1, 3.5), {
        emissive: 1, tint: [0.5, 0.45, 0.28],
      });
    }
  }

  function drawPersonAt(x, z, angle, mesh, tint, bobY) {
    glr.drawMesh(mesh, headingModel(x, bobY || 0, z, angle), { tint });
  }

  function drawScene(state, screen, time) {
    const player = state.player;
    const env = dayNight(state.clock);
    glr.setEnvironment({
      sunDir: env.sunDir,
      sunColor: env.sunColor,
      ambient: env.ambient,
      skyTop: env.skyTop,
      skyBottom: env.skyBottom,
      fogColor: env.fogColor,
      fogNear: 420,
      fogFar: 2600,
      emissiveStrength: 0.15 + env.night * 0.85,
      time,
      night: env.night,
    });

    // Camera: third person behind the player (or a slow orbit on the title).
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    const heading = player.inCar ? player.inCar.angle : player.angle;
    let eye;
    let target;
    if (screen === SCREEN_TITLE) {
      const t = time * 0.03;
      const cx = 1800 + Math.cos(t) * 320;
      const cz = 1000 + Math.sin(t) * 260;
      eye = [cx, 85, cz];
      target = [1800, 28, 1000];
    } else {
      const orbit = state.orbit || { yawOffset: 0, pitch: 0.32 };
      const wantYaw = heading + orbit.yawOffset;
      if (!cam.ready) { cam.yaw = wantYaw; cam.ready = true; }
      cam.yaw += angleDiff(wantYaw, cam.yaw) * 0.08;
      cam.pitch += (orbit.pitch - cam.pitch) * 0.1;
      const wantDist = player.inCar ? 24 : 15;
      cam.dist += (wantDist - cam.dist) * 0.06;
      const fx = Math.cos(cam.yaw);
      const fz = Math.sin(cam.yaw);
      const hDist = cam.dist * Math.cos(cam.pitch);
      const h = cam.dist * Math.sin(cam.pitch) + 2;
      eye = [px - fx * hDist, h, pz - fz * hDist];
      target = [px + fx * 8, 2.5, pz + fz * 8];
    }
    const aspect = canvas.width / canvas.height;
    const proj = mat4Perspective(FOV, aspect, 0.5, 8000);
    const view = mat4LookAt(eye, target, [0, 1, 0]);
    lastCamera = { eye, target, aspect, width: canvas.width, height: canvas.height };
    glr.setCamera(proj, view, eye);
    glr.applyEnvironment();
    glr.clear(env.skyBottom);

    // Sky dome first, centred on the camera, no depth write.
    glr.drawMesh(skyMesh, mat4FromTRS(eye[0], 0, eye[2], 0, 1, 1, 1), {
      sky: 1, noFog: 1, depthWrite: false, cull: false,
    });

    // Clouds, tinted by the time of day: white at noon, pink at dusk, dark
    // at night. Drawn right after the dome, before the city.
    const cloudTint = [
      1 - env.night * 0.78,
      1 - env.dusk * 0.45 - env.night * 0.74,
      1 - env.dusk * 0.35 - env.night * 0.58,
    ];
    glr.drawMesh(cloudMesh, mat4FromTRS(0, 0, 0, 0, 1, 1, 1), {
      unlit: 1, noFog: 1, cull: false, depthWrite: false, alpha: 0.35, tint: cloudTint,
    });

    // The city, its glow, the water and the pier.
    const cg = cityMeshes(state);
    glr.drawMesh(cg.water, mat4FromTRS(0, 0, 0, 0, 1, 1, 1), { wave: 1 });
    glr.drawMesh(cg.static, mat4FromTRS(0, 0, 0, 0, 1, 1, 1));
    glr.drawMesh(cg.glow, mat4FromTRS(0, 0, 0, 0, 1, 1, 1), { emissive: 1 });
    glr.drawMesh(cg.pier, mat4FromTRS(0, 0, 0, 0, 1, 1, 1));

    // Traffic-light heads near the player.
    for (let ix = 0; ix < CITY.roadsX.length; ix += 1) {
      for (let iz = 0; iz < CITY.roadsZ.length; iz += 1) {
        const rx = CITY.roadsX[ix];
        const rz = CITY.roadsZ[iz];
        if (Math.hypot(rx - px, rz - pz) > 420) continue;
        const lx = rx + CITY.road / 2 + 4;
        const lz = rz + CITY.road / 2 + 4;
        glr.drawMesh(unitBox, mat4FromTRS(lx, 8.4, lz, 0, 1.4, 1.4, 1.4), {
          emissive: 1, tint: hexRgb(trafficLightColor(ix, iz, time, 'x')),
        });
        glr.drawMesh(unitBox, mat4FromTRS(lx, 8.4, lz + 2.2, 0, 1.4, 1.4, 1.4), {
          emissive: 1, tint: hexRgb(trafficLightColor(ix, iz, time, 'z')),
        });
      }
    }
    return { env, px, pz };
  }

  function drawDynamic(state, time, env) {
    const player = state.player;
    const night = env.night;

    // Mission beacon: a pink column of light over the target, pulsing.
    const target = state.missionTarget;
    if (target) {
      const pulse = 0.75 + Math.sin(time * 4) * 0.25;
      glr.drawMesh(beaconMesh, mat4FromTRS(target.x, 25, target.z, 0, 1, 1, 1), {
        emissive: 1, tint: [pulse, pulse * 0.3, pulse * 0.6],
      });
      glr.drawMesh(ringMesh, mat4FromTRS(target.x, 0.4, target.z, 0, 1, 1, 1), {
        emissive: 1, tint: [pulse, pulse * 0.3, pulse * 0.6],
      });
    }
    if (state.mission && state.mission.briefcase) {
      const b = state.mission.briefcase;
      glr.drawMesh(unitBox, mat4FromTRS(b.x, 1, b.z, 0, 2.4, 1.4, 1.6), {
        tint: hexRgb('#8a6f5c'),
      });
      glr.drawMesh(unitBox, mat4FromTRS(b.x, 1.9, b.z, 0, 1, 0.4, 0.5), {
        emissive: 1, tint: hexRgb('#ffd23e'),
      });
    }
    // Vault circle during the heist.
    if (state.mission && state.mission.stage === 'vault') {
      glr.drawMesh(ringMesh, mat4FromTRS(3000, 0.4, 600, 0, 2.6, 1, 2.6), {
        emissive: 1, tint: hexRgb('#ffd23e'),
      });
    }

    // Cash pickups: bobbing green boxes.
    for (const pickup of state.pickups) {
      if (pickup.taken) continue;
      const bob = 1 + Math.sin(time * 3 + pickup.x) * 0.25;
      glr.drawMesh(unitBox, mat4FromTRS(pickup.x, bob, pickup.z, time, 1.6, 0.5, 1), {
        emissive: 1, tint: hexRgb('#7ee081'),
      });
    }

    // Pedestrians, rivals, the player.
    for (const ped of state.peds) {
      const bob = ped.dead ? 0 : Math.abs(Math.sin(ped.bob)) * 0.18;
      if (ped.dead) {
        glr.drawMesh(pedMesh, mat4FromTRS(ped.x, 0.3, ped.z, ped.angle, 1, 0.3, 1), {
          tint: hexRgb(ped.color),
        });
      } else {
        drawPersonAt(ped.x, ped.z, ped.angle, pedMesh, hexRgb(ped.color), bob);
      }
    }
    for (const rival of state.rivals) {
      if (!rival.alive) continue;
      drawPersonAt(rival.x, rival.z, 0, pedMesh, hexRgb('#e5534b'), 0);
      // Health bar over the rival's head.
      glr.drawMesh(unitBox, mat4FromTRS(rival.x, 3.1, rival.z, 0, 2.4, 0.25, 0.25), {
        unlit: 1, tint: [0.1, 0.1, 0.12],
      });
      glr.drawMesh(unitBox, mat4FromTRS(rival.x - (1 - rival.health / 60) * 1.1, 3.1, rival.z, 0, 2.2 * (rival.health / 60), 0.3, 0.3), {
        unlit: 1, tint: hexRgb('#e5534b'),
      });
    }

    // Cars (the player's car first, so it is never hidden behind traffic).
    for (const car of state.cars) {
      if (car.kind === 'player') continue;
      drawCar(car, time);
    }
    if (player.inCar) drawCar(player.inCar, time);
    else drawPersonAt(player.x, player.z, player.angle, playerMesh, null, 0);

    // Bullets: short yellow tracers along their velocity.
    for (const bullet of state.bullets) {
      const angle = Math.atan2(bullet.vz, bullet.vx);
      glr.drawMesh(unitBox, headingModel(bullet.x, bullet.y, bullet.z, angle, 1.6, 0.22, 0.22), {
        emissive: 1, tint: hexRgb('#ffd23e'),
      });
    }
    // Particles: small bright boxes.
    for (const p of state.particles) {
      const s = 0.4 + p.life * 0.3;
      glr.drawMesh(unitBox, mat4FromTRS(p.x, p.y, p.z, 0, s, s, s), {
        emissive: 1, tint: hexRgb(p.color),
      });
    }

    // The police helicopter, circling above with a searchlight at night.
    const heli = state.heli;
    if (heli.active) {
      glr.drawMesh(heliMesh, mat4FromTRS(heli.x, heli.y, heli.z, -heli.angle + Math.PI / 2, 1, 1, 1));
      glr.drawMesh(rotorMesh, mat4FromTRS(heli.x, heli.y + 1.4, heli.z, heli.rotor, 1, 1, 1));
      if (night > 0.4) {
        glr.drawMesh(unitBox, mat4FromTRS(player.x, 0.2, player.z, 0, 6, 0.1, 6), {
          emissive: 1, tint: [0.7, 0.65, 0.45], alpha: 0.5,
        });
        glr.drawMesh(beamMesh, mat4FromTRS(heli.x, heli.y / 2, heli.z, 0, 1, heli.y, 1), {
          emissive: 1, tint: [0.85, 0.8, 0.5], alpha: 0.32, depthWrite: false,
        });
      }
    }
  }

  function drawMinimap(state) {
    const m = { x: 0, y: 0, width: 202, height: 146 };
    const sx = m.width / WORLD.width;
    const sz = m.height / CITY.harborZ;
    minimap.fillStyle = 'rgba(16,21,31,0.9)';
    minimap.fillRect(0, 0, m.width, m.height);
    minimap.fillStyle = '#5d8f43';
    minimap.fillRect(0, 0, m.width, m.height);
    minimap.fillStyle = PALETTE.water;
    minimap.fillRect(0, CITY.harborZ * sz - 6, m.width, 6);
    minimap.strokeStyle = '#3a3f4a';
    minimap.lineWidth = 3;
    for (const rx of CITY.roadsX) {
      minimap.beginPath();
      minimap.moveTo(rx * sx, 0);
      minimap.lineTo(rx * sx, m.height);
      minimap.stroke();
    }
    for (const rz of CITY.roadsZ) {
      minimap.beginPath();
      minimap.moveTo(0, rz * sz);
      minimap.lineTo(m.width, rz * sz);
      minimap.stroke();
    }
    const dot = (x, z, color, size) => {
      minimap.fillStyle = color;
      minimap.fillRect(x * sx - size / 2, z * sz - size / 2, size, size);
    };
    for (const car of state.cars) {
      if (car.kind === 'police') dot(car.x, car.z, '#2f6df6', 6);
      else if (car.kind === 'roadblock') dot(car.x, car.z, '#ff3b30', 6);
      else if (car.kind === 'traffic') dot(car.x, car.z, '#e8e4da', 3);
    }
    if (state.heli.active) {
      minimap.fillStyle = '#ff3b30';
      minimap.beginPath();
      minimap.arc(state.heli.x * sx, state.heli.z * sz, 5, 0, Math.PI * 2);
      minimap.fill();
    }
    const target = state.missionTarget;
    if (target) dot(target.x, target.z, PALETTE.marker, 9);
    dot(state.player.x, state.player.z, PALETTE.player, 8);
    minimap.fillStyle = 'rgba(242,245,247,0.8)';
    minimap.font = 'bold 11px system-ui, sans-serif';
    minimap.textAlign = 'center';
    minimap.fillText('NEON BAY', m.width / 2, m.height - 5);
  }

  function drawHud(state, screen, best) {
    const player = state.player;
    const mission = MISSIONS[state.mission.index] || null;
    const env = dayNight(state.clock);
    const pad = (n) => String(n).padStart(2, '0');
    const icon = env.night > 0.6 ? '🌙' : env.dusk > 0.3 ? '🌇' : '☀️';
    hud.clock.textContent = `${icon} ${pad(env.hour)}:${pad(env.minute)}`;
    hud.money.textContent = `$${player.money}`;
    hud.healthFill.style.width = `${clamp(player.health, 0, 100)}%`;
    hud.healthFill.style.background = player.health > 30 ? '#7ee081' : '#ff5a5a';
    hud.armorFill.style.width = `${clamp(player.armor, 0, 100)}%`;
    hud.ammo.textContent = `AMMO ${player.ammo}`;
    hud.stars.textContent = '★'.repeat(player.wanted) + '☆'.repeat(5 - player.wanted);
    hud.stars.style.color = player.wanted > 0 ? PALETTE.star : '#3a3f4a';
    hud.speed.textContent = player.inCar
      ? `${Math.round(Math.abs(player.inCar.speed) * 3.6)} km/h`
      : 'ON FOOT';
    hud.radio.textContent = hud.radioStation || '';
    if (player.bustTimer > 0) {
      hud.bust.style.display = 'block';
      hud.bustFill.style.width = `${clamp(player.bustTimer / 1.6, 0, 1) * 100}%`;
    } else {
      hud.bust.style.display = 'none';
    }
    if (mission && !state.storyDone) {
      hud.mission.style.display = 'block';
      hud.missionTitle.textContent = mission.title;
      hud.missionGoal.textContent = mission.goal;
      let timer = '';
      if (mission.kind === 'deliver' && state.mission) timer = `TIME ${Math.max(0, Math.ceil(state.mission.timer))}s`;
      if (mission.kind === 'heist' && state.mission && state.mission.stage === 'vault') timer = `VAULT ${Math.max(0, Math.ceil(state.mission.vaultTimer))}s`;
      hud.missionTimer.textContent = timer;
    } else {
      hud.mission.style.display = 'none';
    }
    if (state.messageTimer > 0 && state.message) {
      hud.toast.style.display = 'block';
      hud.toast.textContent = state.message;
    } else {
      hud.toast.style.display = 'none';
    }
    hud.hint.style.display = state.time < 14 && screen === SCREEN_PLAY ? 'block' : 'none';
    drawMinimap(state);
  }

  function setOverlay(name, visible, lines) {
    const el = hud[name];
    if (!el) return;
    el.style.display = visible ? 'flex' : 'none';
    if (visible && lines) {
      el.querySelector('.panel-lines').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
    }
  }

  /** Paint one frame: the 3D world, then the HUD or a menu overlay. */
  function draw(state, screen, best) {
    const time = state.time;
    // The whole 3D scene goes through the 32-bit pass: render it into the
    // low-res framebuffer, then upscale it to the screen. The DOM HUD is
    // drawn by the browser afterwards and stays crisp on top.
    glr.beginRetro();
    const { env } = drawScene(state, screen, time);
    drawDynamic(state, time, env);
    glr.endRetro();
    drawHud(state, screen, best);
    if (screen === SCREEN_TITLE) {
      setOverlay('title', true, [
        'Rico Vale owes Marina Kessler $40,000 — and Neon Bay always collects.',
        'Steal cars, run jobs, dodge the cops. Five missions. One way out.',
        'WASD move & drive  •  E enter a car  •  Click to shoot  •  Drag mouse to look around',
        `Best haul so far: $${best}`,
      ]);
    } else {
      setOverlay('title', false);
    }
    setOverlay('paused', screen === SCREEN_PAUSED, [
      'The city waits. Your save is safe.',
      'Missions and money are kept in this browser.',
    ]);
    setOverlay('over', screen === SCREEN_OVER, [
      'Rico went down in Neon Bay.',
      `You kept $${state.player.money} — the debt is still there.`,
    ]);
    setOverlay('win', screen === SCREEN_WIN, [
      'All five jobs done. The boat is waiting at the harbor.',
      `Final haul: $${state.player.money}. Neon Bay is yours now.`,
    ]);
  }

  /**
   * The world point on the ground plane the mouse is aiming at, from the
   * camera of the last drawn frame. Used for shooting and facing.
   */
  function aimPoint(mouseX, mouseY) {
    const c = lastCamera;
    if (!c) return null;
    const ndcX = (mouseX / c.width) * 2 - 1;
    const ndcY = 1 - (mouseY / c.height) * 2;
    const eye = c.eye;
    const target = c.target;
    let fx = target[0] - eye[0];
    let fy = target[1] - eye[1];
    let fz = target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz;
    let ry = 0;
    let rz = fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;
    const tanF = Math.tan(FOV / 2);
    let dx = fx + rx * ndcX * tanF * c.aspect + ux * ndcY * tanF;
    let dy = fy + ry * ndcX * tanF * c.aspect + uy * ndcY * tanF;
    let dz = fz + rz * ndcX * tanF * c.aspect + uz * ndcY * tanF;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    if (dy > -0.02) {
      return { x: eye[0] + dx * 30, z: eye[2] + dz * 30 };
    }
    const t = (1.2 - eye[1]) / dy;
    return { x: eye[0] + dx * t, z: eye[2] + dz * t };
  }

  resize();
  window.addEventListener('resize', resize);
  return {
    draw, aimPoint,
    /** The smoothed chase-camera yaw, so on-foot movement follows the camera. */
    cameraYaw() { return cam.yaw; },
    view: { width: VIEW.width, height: VIEW.height },
  };
}
