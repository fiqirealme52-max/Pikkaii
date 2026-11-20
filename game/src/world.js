// Neon Bay — the simulation. No drawing and no browser in it: the player, the
// cars, the traffic, the pedestrians, the police helicopter, the wanted level,
// the combat and the five story missions. Coordinates are x east, z south, y up;
// a heading angle of 0 faces east and PI/2 faces south. step() advances one
// fixed step and returns what happened as bit flags, so the caller can react
// without the world knowing about screens or sound. The audio object it is
// given is only ever called, never stored.

import {
  CAR, CITY, DAY_LENGTH, ECONOMY, HELI, MISSIONS, PLAYER, POLICE, WANTED, WORLD,
} from './config.js';
import {
  buildCity, hitsBuilding, isRoadAt, isWaterAt, nearestRoadPoint,
  resolveBuildingCollision, trafficLightState,
} from './city.js';
import { randomInt, randomPick } from './random.js';

export const EVENT_HIT = 1;
export const EVENT_SHOT = 2;
export const EVENT_PICKUP = 4;
export const EVENT_MISSION_DONE = 8;
export const EVENT_BUSTED = 16;
export const EVENT_WASTED = 32;
export const EVENT_STORY_DONE = 64;
export const EVENT_WANTED_UP = 128;

const TRAFFIC_COLORS = ['#e5534b', '#4fc3f7', '#f2c94c', '#e8e4da', '#7ee081', '#ff8c42', '#b388ff', '#c0c8d0'];
const PED_COLORS = ['#f2c94c', '#e8e4da', '#7ee081', '#ff8c42', '#b388ff', '#4fc3f7'];
const TWO_PI = Math.PI * 2;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function distance(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function angleTo(ax, az, bx, bz) {
  return Math.atan2(bz - az, bx - ax);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

/** Daylight for a clock time: sun direction, colours, and how dark it is. */
export function dayNight(clock) {
  const dayT = ((clock / DAY_LENGTH) % 1 + 1) % 1;
  const hour = (17 + dayT * 24) % 24;
  const sunAngle = ((hour - 6) / 12) * Math.PI; // 0 at 06:00, PI at 18:00
  const elevation = Math.sin(sunAngle);
  const azimuth = ((hour - 12) / 12) * Math.PI;
  const sunDir = [Math.cos(azimuth) * 0.7, Math.max(0.12, elevation), Math.sin(azimuth) * 0.5];
  const night = clamp(1 - (elevation + 0.25) / 0.5, 0, 1);
  const dusk = clamp(1 - Math.abs(elevation) / 0.35, 0, 1) * (elevation > -0.05 ? 1 : 0);
  const sunColor = [
    1.15 - night * 0.75,
    (0.95 - night * 0.5) * (1 - dusk * 0.15) + dusk * 0.3,
    (0.8 - night * 0.35) * (1 - dusk * 0.4) + dusk * 0.1,
  ];
  const ambient = [
    0.58 - night * 0.26,
    0.58 - night * 0.26,
    0.62 - night * 0.22,
  ];
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const dayTop = [0.25, 0.5, 0.95];
  const duskTop = [0.52, 0.24, 0.62];
  const nightTop = [0.05, 0.08, 0.2];
  const dayBot = [0.85, 0.75, 0.55];
  const duskBot = [1, 0.42, 0.12];
  const nightBot = [0.1, 0.12, 0.25];
  const skyTop = mix3(mix3(dayTop, duskTop, dusk), nightTop, night);
  const skyBottom = mix3(mix3(dayBot, duskBot, dusk), nightBot, night);
  const fogColor = [
    0.68 - night * 0.58 + dusk * 0.24,
    0.7 - night * 0.56 + dusk * 0.02,
    0.85 - night * 0.62 - dusk * 0.05,
  ];
  return {
    hour: Math.floor(hour),
    minute: Math.floor((hour % 1) * 60),
    night, dusk, sunDir, sunColor, ambient, skyTop, skyBottom, fogColor,
  };
}

export function createWorld(random, saved) {
  const city = buildCity(random);

  const player = {
    x: 600, z: 620, angle: -Math.PI / 2, health: PLAYER.health, armor: PLAYER.armor,
    money: saved?.money ?? ECONOMY.startMoney, ammo: PLAYER.ammoStart,
    wanted: 0, inCar: null, speed: 0, fireTimer: 0, bustTimer: 0, regenTimer: 0,
  };

  const cars = [];
  const peds = [];
  const rivals = [];
  const bullets = [];
  const particles = [];
  const pickups = [];

  function addCar(x, z, angle, color, kind) {
    const car = {
      id: cars.length, x, z, angle, speed: 0, color,
      kind, health: CAR.health, driver: kind === 'traffic',
      axis: Math.abs(Math.cos(angle)) > 0.5 ? 'x' : 'z',
      dir: Math.cos(angle) >= 0 ? 1 : -1, cruise: 10 + random() * 6,
      lost: false, stolen: false,
    };
    cars.push(car);
    return car;
  }

  // Parked cars from the city, plus a starter car near the hideout, parked
  // on Coral Ave's road (z=600) so it is clear of every building.
  for (const spot of city.parkedSpots) addCar(spot.x, spot.z, spot.angle, spot.color, 'parked');
  addCar(660, 600, 0, '#ff8c42', 'parked');

  // Traffic: cars already rolling on the roads.
  for (let i = 0; i < 14; i += 1) {
    const horizontal = random() < 0.5;
    const road = horizontal
      ? { x: 200 + random() * 3200, z: randomPick(random, CITY.roadsZ) }
      : { x: randomPick(random, CITY.roadsX), z: 200 + random() * 2000 };
    const angle = horizontal ? (random() < 0.5 ? 0 : Math.PI) : (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const car = addCar(road.x, road.z, angle, randomPick(random, TRAFFIC_COLORS), 'traffic');
    car.speed = car.cruise;
  }

  function addPed(x, z) {
    const ped = {
      x, z, angle: random() * TWO_PI, speed: 2.5 + random() * 1.5,
      color: randomPick(random, PED_COLORS), state: 'walk',
      walkTimer: 2 + random() * 4, dead: false, deadTimer: 0, bob: random() * TWO_PI,
    };
    peds.push(ped);
    return ped;
  }
  for (let i = 0; i < 26; i += 1) {
    // Pedestrians walk the sidewalks: beside a road line, mid-block, never
    // on a lane and never in an intersection.
    const horizontal = random() < 0.5;
    if (horizontal) {
      const rz = randomPick(random, CITY.roadsZ);
      const ix = Math.floor(random() * (CITY.roadsX.length - 1));
      const midX = (CITY.roadsX[ix] + CITY.roadsX[ix + 1]) / 2;
      addPed(midX + (random() - 0.5) * 160, rz + (random() < 0.5 ? -1 : 1) * (54 + random() * 14));
    } else {
      const rx = randomPick(random, CITY.roadsX);
      const iz = Math.floor(random() * (CITY.roadsZ.length - 1));
      const midZ = (CITY.roadsZ[iz] + CITY.roadsZ[iz + 1]) / 2;
      addPed(rx + (random() < 0.5 ? -1 : 1) * (54 + random() * 14), midZ + (random() - 0.5) * 160);
    }
  }

  const cashSpots = [
    { x: 1000, z: 600 }, { x: 2200, z: 1000 }, { x: 1400, z: 1800 },
    { x: 3000, z: 1800 }, { x: 600, z: 1400 }, { x: 2600, z: 600 },
    { x: 1800, z: 1000 }, { x: 3400, z: 2200 },
  ];
  for (const spot of cashSpots) pickups.push({ x: spot.x, z: spot.z, taken: false, kind: 'cash' });

  const mission = {
    index: saved?.missionIndex ?? 0,
    stage: 'start',
    timer: 0,
    deliveries: [],
    deliveryIndex: 0,
    vaultTimer: 0,
    rivalsSpawned: false,
    briefcase: null,
    text: '',
    done: false,
  };

  const heli = { active: false, angle: 0, x: 0, z: 0, y: HELI.height, rotor: 0 };
  const roadblocks = [];

  const camera = { x: player.x, z: player.z };
  const state = {
    player, cars, peds, rivals, bullets, particles, pickups,
    city, mission, camera, heli, roadblocks,
    time: 0, clock: 0, crimeTimer: 0, wantedTimer: 0, message: '', messageTimer: 0,
    storyDone: false, bestMoney: saved?.bestMoney ?? 0, crimeLog: [],
    missionTarget: null, missionText: '',
  };

  function setMessage(text, seconds) {
    state.message = text;
    state.messageTimer = seconds || 4;
  }

  function addWanted(amount, reason) {
    if (player.wanted >= WANTED.max) return 0;
    const before = player.wanted;
    player.wanted = Math.min(WANTED.max, player.wanted + amount);
    state.crimeTimer = 0;
    if (player.wanted > before) {
      state.crimeLog.push({ t: Math.round(state.time), reason, wanted: player.wanted });
      if (state.crimeLog.length > 20) state.crimeLog.shift();
      setMessage(`${reason} — Wanted level ${player.wanted} ★`, 3);
      return EVENT_WANTED_UP;
    }
    return 0;
  }

  function spawnParticles(x, y, z, color, count, speed) {
    for (let i = 0; i < count; i += 1) {
      const a = random() * TWO_PI;
      const s = (0.4 + random() * 0.6) * speed;
      particles.push({
        x, y: y + random() * 1.5, z,
        vx: Math.cos(a) * s, vy: random() * speed * 0.5, vz: Math.sin(a) * s,
        life: 0.5 + random() * 0.4, color,
      });
    }
  }

  function explode(x, z) {
    spawnParticles(x, 1, z, '#ff8c42', 22, 16);
    spawnParticles(x, 1, z, '#ffd23e', 14, 11);
    spawnParticles(x, 1, z, '#3a3f4a', 10, 8);
  }

  function nearestCar(x, z, maxDist) {
    let best = null;
    let bestDist = maxDist;
    for (const car of cars) {
      if (car.kind === 'player') continue;
      const d = distance(x, z, car.x, car.z);
      if (d <= bestDist) { bestDist = d; best = car; }
    }
    return best;
  }

  function enterCar(car, audio) {
    if (!car) return;
    player.inCar = car;
    car.kind = 'player';
    car.driver = true;
    audio?.door?.();
    if (car.kindBefore === 'traffic') {
      // Stealing a traffic car: its driver bails out on foot.
      const ped = addPed(car.x + 4, car.z + 4);
      ped.state = 'flee';
    }
    if (!car.stolen) {
      car.stolen = true;
      addWanted(WANTED.stealCar, 'Car stolen');
    }
    setMessage('Driving — W/S speed, A/D steer, E to get out', 3);
  }

  function exitCar() {
    const car = player.inCar;
    if (!car) return;
    car.kind = 'parked';
    car.speed = 0;
    player.inCar = null;
    player.x = car.x + Math.cos(car.angle + Math.PI / 2) * 5;
    player.z = car.z + Math.sin(car.angle + Math.PI / 2) * 5;
    player.angle = car.angle;
    resolveBuildingCollision(city, player, PLAYER.radius);
  }

  function damagePlayer(amount, audio) {
    // Armor soaks damage first.
    if (player.armor > 0) {
      const soaked = Math.min(player.armor, amount * 0.6);
      player.armor -= soaked;
      amount -= soaked;
    }
    player.health -= amount;
    player.regenTimer = 0;
    audio?.hurt?.();
    if (player.health <= 0) {
      player.health = 0;
      return EVENT_WASTED;
    }
    return EVENT_HIT;
  }

  function shootAt(targetX, targetZ, audio) {
    if (player.fireTimer > 0) return 0;
    const ox = player.inCar ? player.inCar.x : player.x;
    const oz = player.inCar ? player.inCar.z : player.z;
    if (player.ammo <= 0) return punch(audio);
    player.fireTimer = PLAYER.fireInterval;
    player.ammo -= 1;
    const angle = angleTo(ox, oz, targetX, targetZ);
    bullets.push({
      x: ox + Math.cos(angle) * 2.5, y: 1.4, z: oz + Math.sin(angle) * 2.5,
      vx: Math.cos(angle) * 60, vy: 0, vz: Math.sin(angle) * 60,
      life: 0.6, fromPlayer: true,
    });
    audio?.shot?.();
    spawnParticles(ox + Math.cos(angle) * 3, 1.4, oz + Math.sin(angle) * 3, '#ffd23e', 3, 8);
    return EVENT_SHOT;
  }

  function punch(audio) {
    const ox = player.x;
    const oz = player.z;
    let hit = false;
    for (const rival of rivals) {
      if (rival.alive && distance(ox, oz, rival.x, rival.z) < PLAYER.punchRange + 1) {
        rival.health -= PLAYER.punchDamage;
        spawnParticles(rival.x, 1.2, rival.z, '#e5534b', 6, 9);
        if (rival.health <= 0) rival.alive = false;
        hit = true;
      }
    }
    for (const ped of peds) {
      if (!ped.dead && distance(ox, oz, ped.x, ped.z) < PLAYER.punchRange) {
        ped.dead = true;
        ped.deadTimer = 6;
        hit = true;
        addWanted(WANTED.hitPedestrian, 'Pedestrian down');
      }
    }
    if (hit) audio?.thud?.();
    return hit ? EVENT_HIT : 0;
  }

  function missionTarget() {
    const m = MISSIONS[mission.index];
    if (!m) return null;
    if (m.kind === 'deliver' && mission.deliveries.length > 0) {
      return mission.deliveries[Math.min(mission.deliveryIndex, mission.deliveries.length - 1)];
    }
    if (m.kind === 'fight-and-fetch' && mission.stage === 'return') return { x: 600, z: 600, label: 'Hideout' };
    if (m.kind === 'fight-and-fetch' && mission.briefcase) return mission.briefcase;
    return m.target;
  }

  function startMission(index) {
    const m = MISSIONS[index];
    if (!m) return;
    mission.index = index;
    mission.stage = 'start';
    mission.timer = m.timeLimit || 0;
    mission.deliveryIndex = 0;
    mission.vaultTimer = 0;
    mission.rivalsSpawned = false;
    mission.briefcase = null;
    mission.deliveries = [];
    if (m.kind === 'deliver') {
      mission.deliveries = [
        { x: 2600, z: 1000, label: 'Delivery 1' },
        { x: 1000, z: 1800, label: 'Delivery 2' },
        { x: 3000, z: 1400, label: 'Delivery 3' },
      ];
    }
    if (m.kind === 'escape') {
      player.wanted = 3;
      state.crimeTimer = 0;
      mission.stage = 'escape';
    }
    setMessage(`${m.title}: ${m.goal}`, 6);
    state.missionText = m.briefing;
    mission.text = m.briefing;
  }

  function completeMission(audio) {
    const m = MISSIONS[mission.index];
    player.money += m.reward;
    state.bestMoney = Math.max(state.bestMoney, player.money);
    audio?.jingle?.();
    setMessage(`${m.title} complete! +$${m.reward}`, 5);
    mission.index += 1;
    if (mission.index >= MISSIONS.length) {
      state.storyDone = true;
      return EVENT_MISSION_DONE | EVENT_STORY_DONE;
    }
    startMission(mission.index);
    return EVENT_MISSION_DONE;
  }

  function failMission(reason) {
    setMessage(`Mission failed: ${reason}. Try again — the job is still open.`, 5);
    startMission(mission.index);
    return 0;
  }

  function updateMission(dt, audio) {
    const m = MISSIONS[mission.index];
    if (!m || state.storyDone) return 0;
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    let events = 0;

    if (m.kind === 'steal-and-drive') {
      if (mission.stage === 'start' && player.inCar) {
        mission.stage = 'drive';
        setMessage('Good — now drive to the paint shop', 3);
      } else if (mission.stage === 'drive' && distance(px, pz, m.target.x, m.target.z) < 12) {
        events |= completeMission(audio);
      }
    } else if (m.kind === 'deliver') {
      mission.timer -= dt;
      if (mission.timer <= 0) return failMission('out of time');
      const target = mission.deliveries[mission.deliveryIndex];
      if (target && distance(px, pz, target.x, target.z) < 10) {
        mission.deliveryIndex += 1;
        player.money += 100;
        audio?.pickup?.();
        setMessage(`Parcel delivered! ${mission.deliveryIndex} of ${mission.deliveries.length}`, 3);
        if (mission.deliveryIndex >= mission.deliveries.length) events |= completeMission(audio);
      }
    } else if (m.kind === 'fight-and-fetch') {
      if (!mission.rivalsSpawned && distance(px, pz, m.target.x, m.target.z) < 45) {
        mission.rivalsSpawned = true;
        for (let i = 0; i < m.rivals; i += 1) {
          rivals.push({
            x: m.target.x - 12 + i * 8, z: m.target.z - 20 + (i % 2) * 12,
            health: 60, alive: true, speed: 6, shootTimer: 1 + random() * 2,
          });
        }
        setMessage('Dock Rats! Deal with them.', 4);
      }
      const alive = rivals.filter((r) => r.alive).length;
      if (mission.rivalsSpawned && alive === 0 && !mission.briefcase) {
        mission.briefcase = { x: m.target.x, z: m.target.z - 15, label: 'Briefcase' };
        setMessage('Briefcase dropped — grab it!', 4);
      }
      if (mission.briefcase && distance(px, pz, mission.briefcase.x, mission.briefcase.z) < 5) {
        mission.briefcase = null;
        mission.stage = 'return';
        setMessage('Got it. Bring it to the hideout.', 4);
      }
      if (mission.stage === 'return' && distance(px, pz, 600, 600) < 12) {
        events |= completeMission(audio);
      }
    } else if (m.kind === 'escape') {
      if (player.wanted === 0 && distance(px, pz, 600, 600) < 12) {
        events |= completeMission(audio);
      }
    } else if (m.kind === 'heist') {
      if (mission.stage === 'start' && distance(px, pz, m.target.x, m.target.z) < 12) {
        mission.stage = 'vault';
        mission.vaultTimer = 8;
        setMessage('Cracking the vault — stay in the circle!', 4);
      } else if (mission.stage === 'vault') {
        if (distance(px, pz, m.target.x, m.target.z) > 15) {
          mission.stage = 'start';
          setMessage('Vault crack interrupted — get back to the bank.', 3);
        } else {
          mission.vaultTimer -= dt;
          if (mission.vaultTimer <= 0) {
            mission.stage = 'run';
            player.money += 500;
            player.wanted = Math.max(player.wanted, 4);
            setMessage('Vault open! $500 grabbed — escape to the boat at the harbor!', 5);
          }
        }
      } else if (mission.stage === 'run' && distance(px, pz, 1800, 2380) < 14) {
        events |= completeMission(audio);
      }
    }
    return events;
  }

  /**
   * Move a car by (dx, dz), sliding along walls: try the full step, then each
   * axis alone, so a car pushed into a building slides around it instead of
   * sticking to it. Returns true when the car moved at all.
   */
  function moveCarWithCollision(car, dx, dz) {
    const r = 3;
    if (!hitsBuilding(city, car.x + dx, car.z + dz, r) && !isWaterAt(car.x + dx, car.z + dz)) {
      car.x = clamp(car.x + dx, 40, WORLD.width - 40);
      car.z = clamp(car.z + dz, 40, CITY.harborZ - 4);
      return true;
    }
    if (!hitsBuilding(city, car.x + dx, car.z, r) && !isWaterAt(car.x + dx, car.z)) {
      car.x = clamp(car.x + dx, 40, WORLD.width - 40);
      return true;
    }
    if (!hitsBuilding(city, car.x, car.z + dz, r) && !isWaterAt(car.x, car.z + dz)) {
      car.z = clamp(car.z + dz, 40, CITY.harborZ - 4);
      return true;
    }
    return false;
  }

  function updateTraffic(dt) {
    for (const car of cars) {
      if (car.kind !== 'traffic') continue;
      // Drive along the current road; at intersections, sometimes turn.
      const onXRoad = CITY.roadsX.some((rx) => Math.abs(car.x - rx) < 60);
      const onZRoad = CITY.roadsZ.some((rz) => Math.abs(car.z - rz) < 60);
      if (onXRoad && onZRoad && random() < 0.004) {
        if (car.axis === 'x') {
          car.axis = 'z';
          car.dir = random() < 0.5 ? 1 : -1;
          car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          car.z = nearestRoadPoint(car.x, car.z).z;
        } else {
          car.axis = 'x';
          car.dir = random() < 0.5 ? 1 : -1;
          car.angle = car.dir > 0 ? 0 : Math.PI;
          car.x = nearestRoadPoint(car.x, car.z).x;
        }
      }
      // Traffic lights: stop at a red light ahead on this car's axis.
      let targetSpeed = car.cruise;
      if (car.axis === 'x') {
        for (let ix = 0; ix < CITY.roadsX.length; ix += 1) {
          const rx = CITY.roadsX[ix];
          const ahead = (rx - car.x) * car.dir;
          if (ahead > 0 && ahead < 120) {
            const iz = CITY.roadsZ.reduce((best, rz, i) => (
              Math.abs(rz - car.z) < Math.abs(CITY.roadsZ[best] - car.z) ? i : best
            ), 0);
            const light = trafficLightState(ix, iz, state.time, 'x');
            if (light !== 'green') targetSpeed = Math.min(targetSpeed, clamp((ahead - 55) * 0.35, 0, car.cruise));
            break;
          }
        }
      } else {
        for (let iz = 0; iz < CITY.roadsZ.length; iz += 1) {
          const rz = CITY.roadsZ[iz];
          const ahead = (rz - car.z) * car.dir;
          if (ahead > 0 && ahead < 120) {
            const ix = CITY.roadsX.reduce((best, rx, i) => (
              Math.abs(rx - car.x) < Math.abs(CITY.roadsX[best] - car.x) ? i : best
            ), 0);
            const light = trafficLightState(ix, iz, state.time, 'z');
            if (light !== 'green') targetSpeed = Math.min(targetSpeed, clamp((ahead - 55) * 0.35, 0, car.cruise));
            break;
          }
        }
      }
      car.speed += clamp(targetSpeed - car.speed, -20 * dt, 8 * dt);
      const vx = Math.cos(car.angle) * car.speed;
      const vz = Math.sin(car.angle) * car.speed;
      car.x += vx * dt;
      car.z += vz * dt;
      // Wrap around the city edge so traffic never runs out.
      if (car.x < 120) { car.x = 120; car.angle = 0; car.axis = 'x'; car.dir = 1; }
      if (car.x > WORLD.width - 120) { car.x = WORLD.width - 120; car.angle = Math.PI; car.axis = 'x'; car.dir = -1; }
      if (car.z < 120) { car.z = 120; car.angle = Math.PI / 2; car.axis = 'z'; car.dir = 1; }
      if (car.z > CITY.harborZ - 120) { car.z = CITY.harborZ - 120; car.angle = -Math.PI / 2; car.axis = 'z'; car.dir = -1; }
      // Slow down for the car ahead on the same road.
      for (const other of cars) {
        if (other === car || other.kind !== 'traffic') continue;
        const dx = other.x - car.x;
        const dz = other.z - car.z;
        const ahead = dx * Math.cos(car.angle) + dz * Math.sin(car.angle);
        if (ahead > 0 && ahead < 14 && Math.abs(dx * Math.sin(car.angle) - dz * Math.cos(car.angle)) < 5) {
          car.speed = Math.max(2, other.speed - 2);
          break;
        }
      }
    }
  }

  function updatePeds(dt) {
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    for (const ped of peds) {
      if (ped.dead) {
        ped.deadTimer -= dt;
        continue;
      }
      const scared = player.wanted > 0 && distance(ped.x, ped.z, px, pz) < 40;
      if (scared) ped.state = 'flee';
      else if (ped.state === 'flee' && distance(ped.x, ped.z, px, pz) > 70) ped.state = 'walk';
      const speed = ped.state === 'flee' ? ped.speed * 2.4 : ped.speed;
      ped.walkTimer -= dt;
      ped.bob += dt * speed * 2;
      if (ped.walkTimer <= 0) {
        ped.walkTimer = 2 + random() * 4;
        // Walk along the street grid, like a person on a sidewalk.
        ped.angle = (Math.floor(random() * 4) * Math.PI) / 2 + (random() - 0.5) * 0.3;
      }
      if (ped.state === 'flee') {
        // Run for the sidewalk, not down the road: flee away from the
        // nearest road centre line, so a fleeing pedestrian leaves the lane.
        let bestD = Infinity;
        let axis = 'z';
        let dir = 1;
        for (const rz of CITY.roadsZ) {
          const d = Math.abs(ped.z - rz);
          if (d < bestD) { bestD = d; axis = 'z'; dir = ped.z >= rz ? 1 : -1; }
        }
        for (const rx of CITY.roadsX) {
          const d = Math.abs(ped.x - rx);
          if (d < bestD) { bestD = d; axis = 'x'; dir = ped.x >= rx ? 1 : -1; }
        }
        ped.angle = axis === 'z' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
      }
      ped.x += Math.cos(ped.angle) * speed * dt;
      ped.z += Math.sin(ped.angle) * speed * dt;
      ped.x = clamp(ped.x, 60, WORLD.width - 60);
      ped.z = clamp(ped.z, 60, CITY.harborZ - 60);
      if (ped.state === 'walk') {
        // Stay on the sidewalk: never stand in a lane, even after turning
        // at an intersection.
        for (const rz of CITY.roadsZ) {
          if (Math.abs(ped.z - rz) < 50) ped.z = rz + (ped.z >= rz ? 56 : -56);
        }
        for (const rx of CITY.roadsX) {
          if (Math.abs(ped.x - rx) < 50) ped.x = rx + (ped.x >= rx ? 56 : -56);
        }
      }
      if (hitsBuilding(city, ped.x, ped.z, 1.2)) {
        ped.angle += Math.PI / 2;
        ped.x = clamp(ped.x, 60, WORLD.width - 60);
        ped.z = clamp(ped.z, 60, CITY.harborZ - 60);
      }
    }
    // The dead get back up after a while (knocked out, not gone forever).
    for (const ped of peds) {
      if (ped.dead && ped.deadTimer <= 0) {
        ped.dead = false;
        ped.state = 'flee';
      }
    }
  }

  function updatePolice(dt, audio) {
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    let events = 0;
    const wantedPolice = Math.min(player.wanted, 4);
    let active = cars.filter((c) => c.kind === 'police').length;
    // Spawn police when the heat rises.
    if (player.wanted > 0 && active < wantedPolice) {
      const road = nearestRoadPoint(px + (random() - 0.5) * 180, pz + (random() - 0.5) * 180);
      const cop = addCar(road.x, road.z, angleTo(road.x, road.z, px, pz), '#e8e4da', 'police');
      cop.speed = POLICE.maxSpeed * 0.7;
      cop.health = 60;
      active += 1;
    }
    // Standing down: when the heat is gone, police drive off.
    if (player.wanted === 0) {
      for (const car of cars) if (car.kind === 'police') car.kind = 'traffic';
    }
    for (const car of cars) {
      if (car.kind !== 'police') continue;
      const d = distance(car.x, car.z, px, pz);
      // A cop that lost the trail cruises on; it only chases again when it
      // spots the player up close. A lost cop does not keep the heat up.
      if (car.lost) {
        if (d < 50) {
          car.lost = false;
        } else {
          car.speed = Math.max(8, car.speed - 12 * dt);
          if (!moveCarWithCollision(car, Math.cos(car.angle) * car.speed * dt, Math.sin(car.angle) * car.speed * dt)) {
            car.angle += 1.2;
          }
          continue;
        }
      } else if (d > POLICE.loseTrackDistance) {
        car.lost = true;
        car.speed = Math.max(8, car.speed - 12 * dt);
        if (!moveCarWithCollision(car, Math.cos(car.angle) * car.speed * dt, Math.sin(car.angle) * car.speed * dt)) {
          car.angle += 1.2;
        }
        continue;
      }
      const targetAngle = angleTo(car.x, car.z, px, pz);
      const diff = angleDiff(targetAngle, car.angle);
      car.angle += clamp(diff, -2.4 * dt, 2.4 * dt);
      car.speed = Math.min(POLICE.maxSpeed, car.speed + POLICE.accel * dt);
      if (!moveCarWithCollision(car, Math.cos(car.angle) * car.speed * dt, Math.sin(car.angle) * car.speed * dt)) {
        car.angle += 1.2;
        car.speed *= 0.5;
      }
      // Ram the player's car, or bust the player on foot.
      if (player.inCar) {
        if (d < 9) {
          player.inCar.health -= 5 * dt;
          spawnParticles(car.x, 1, car.z, '#ff8c42', 2, 6);
          if (player.inCar.health <= 0) {
            explode(player.inCar.x, player.inCar.z);
            const wreck = player.inCar;
            wreck.kind = 'parked';
            wreck.speed = 0;
            player.inCar = null;
            player.x = wreck.x + 6;
            player.z = wreck.z;
            events |= damagePlayer(30, audio);
          }
        }
      } else if (d < 5) {
        player.bustTimer += dt;
        if (player.bustTimer >= POLICE.bustTime) {
          player.bustTimer = 0;
          player.wanted = 0;
          player.money = Math.max(0, player.money - ECONOMY.bustFine);
          player.x = 600;
          player.z = 620;
          player.health = Math.max(50, player.health);
          for (const cop of cars) if (cop.kind === 'police') cop.kind = 'traffic';
          setMessage(`BUSTED! Fine $${ECONOMY.bustFine} — back at the hideout.`, 5);
          events |= EVENT_BUSTED;
        }
      } else {
        player.bustTimer = Math.max(0, player.bustTimer - dt);
      }
      // Police take damage from bullets (handled in updateBullets via car health).
      if (car.health <= 0) {
        explode(car.x, car.z);
        car.kind = 'parked';
        car.speed = 0;
        car.health = 0;
        events |= addWanted(WANTED.killCop, 'Cop car destroyed');
      }
    }
    return events;
  }

  /** The police helicopter: circles the player once the heat hits 3 stars. */
  function updateHeli(dt) {
    heli.rotor += dt * 28;
    if (player.wanted >= 3) {
      if (!heli.active) {
        heli.active = true;
        heli.angle = random() * TWO_PI;
      }
      heli.angle += HELI.speed * dt;
      const px = player.inCar ? player.inCar.x : player.x;
      const pz = player.inCar ? player.inCar.z : player.z;
      heli.x = px + Math.cos(heli.angle) * HELI.orbitRadius;
      heli.z = pz + Math.sin(heli.angle) * HELI.orbitRadius;
      heli.y = HELI.height + Math.sin(state.time * 0.7) * 3;
    } else if (heli.active) {
      heli.active = false;
    }
  }

  /** Roadblocks: at 4+ stars, police cars park across the road ahead. */
  function updateRoadblocks(dt) {
    if (player.wanted < 4) {
      if (roadblocks.length > 0) {
        for (const car of roadblocks) {
          const i = cars.indexOf(car);
          if (i >= 0) cars.splice(i, 1);
        }
        roadblocks.length = 0;
      }
      state.roadblockTimer = 0;
      return;
    }
    state.roadblockTimer = (state.roadblockTimer || 0) + dt;
    if (state.roadblockTimer < 10 || roadblocks.length >= 4) return;
    state.roadblockTimer = 0;
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    const heading = player.inCar ? player.inCar.angle : player.angle;
    // The nearest road ahead of the player, ~120 units out.
    const aheadX = px + Math.cos(heading) * 120;
    const aheadZ = pz + Math.sin(heading) * 120;
    const road = nearestRoadPoint(aheadX, aheadZ);
    const onXRoad = Math.abs(aheadX - road.x) < Math.abs(aheadZ - road.z);
    const blockAngle = onXRoad ? Math.PI / 2 : 0;
    for (const offset of [-6, 6]) {
      const bx = onXRoad ? road.x + offset : road.x;
      const bz = onXRoad ? road.z : road.z + offset;
      if (hitsBuilding(city, bx, bz, 4)) continue;
      const block = addCar(bx, bz, blockAngle, '#e8e4da', 'roadblock');
      block.speed = 0;
      roadblocks.push(block);
    }
    if (roadblocks.length > 0) setMessage('Roadblock ahead!', 3);
  }

  function updateBullets(dt) {
    let events = 0;
    for (const bullet of bullets) {
      bullet.x += bullet.vx * dt;
      bullet.z += bullet.vz * dt;
      bullet.life -= dt;
      if (bullet.life <= 0) continue;
      // Rivals first.
      for (const rival of rivals) {
        if (rival.alive && distance(bullet.x, bullet.z, rival.x, rival.z) < 1.6) {
          rival.health -= PLAYER.shootDamage;
          bullet.life = 0;
          spawnParticles(rival.x, 1.2, rival.z, '#e5534b', 6, 9);
          if (rival.health <= 0) rival.alive = false;
          break;
        }
      }
      if (bullet.life <= 0) continue;
      for (const car of cars) {
        if (car.kind === 'player' || car.kind === 'parked') continue;
        const dx = bullet.x - car.x;
        const dz = bullet.z - car.z;
        const localX = dx * Math.cos(-car.angle) - dz * Math.sin(-car.angle);
        const localZ = dx * Math.sin(-car.angle) + dz * Math.cos(-car.angle);
        if (Math.abs(localX) < CAR.length / 2 && Math.abs(localZ) < CAR.width / 2) {
          car.health -= PLAYER.shootDamage;
          bullet.life = 0;
          spawnParticles(bullet.x, 1.2, bullet.z, '#ffd23e', 5, 8);
          if (car.health <= 0 && car.kind === 'traffic') {
            explode(car.x, car.z);
            car.kind = 'parked';
            car.speed = 0;
          }
          break;
        }
      }
      if (bullet.life <= 0) continue;
      for (const ped of peds) {
        if (!ped.dead && distance(bullet.x, bullet.z, ped.x, ped.z) < 1.2) {
          ped.dead = true;
          ped.deadTimer = 6;
          bullet.life = 0;
          events |= addWanted(WANTED.hitPedestrian, 'Pedestrian shot');
          break;
        }
      }
      if (bullet.life <= 0) continue;
      if (hitsBuilding(city, bullet.x, bullet.z, 0.5)) bullet.life = 0;
    }
    for (let i = bullets.length - 1; i >= 0; i -= 1) {
      if (bullets[i].life <= 0) bullets.splice(i, 1);
    }
    return events;
  }

  function updateRivals(dt, audio) {
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    for (const rival of rivals) {
      if (!rival.alive) continue;
      const d = distance(rival.x, rival.z, px, pz);
      rival.shootTimer -= dt;
      if (d < 30 && rival.shootTimer <= 0) {
        rival.shootTimer = 1.6 + random() * 1.0;
        const angle = angleTo(rival.x, rival.z, px, pz);
        bullets.push({
          x: rival.x, y: 1.4, z: rival.z,
          vx: Math.cos(angle) * 28, vy: 0, vz: Math.sin(angle) * 28,
          life: 0.9, fromPlayer: false,
        });
        audio?.shot?.();
      } else if (d < 30) {
        // Close in to brawl.
        rival.x += Math.cos(angleTo(rival.x, rival.z, px, pz)) * rival.speed * dt;
        rival.z += Math.sin(angleTo(rival.x, rival.z, px, pz)) * rival.speed * dt;
        if (d < 2.4 && player.fireTimer <= 0) {
          player.fireTimer = 0.5;
          damagePlayer(8, audio);
        }
      }
    }
    // Enemy bullets hurt the player.
    for (const bullet of bullets) {
      if (bullet.fromPlayer) continue;
      const ox = player.inCar ? player.inCar.x : player.x;
      const oz = player.inCar ? player.inCar.z : player.z;
      if (distance(bullet.x, bullet.z, ox, oz) < (player.inCar ? 3.5 : 1.4)) {
        bullet.life = 0;
        damagePlayer(6, audio);
      }
    }
  }

  function updatePickups(dt, audio) {
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    for (const pickup of pickups) {
      if (pickup.taken) continue;
      if (distance(px, pz, pickup.x, pickup.z) < 4) {
        pickup.taken = true;
        player.money += ECONOMY.pickupValue;
        audio?.pickup?.();
        setMessage(`Cash found! +$${ECONOMY.pickupValue}`, 2);
        return EVENT_PICKUP;
      }
    }
    return 0;
  }

  function updatePlayer(dt, input, audio) {
    const axes = input.axes || { x: 0, y: 0, run: false };
    const actions = input.actions || 0;
    let events = 0;
    player.fireTimer = Math.max(0, player.fireTimer - dt);

    if (actions & 4) { // ACTION_ENTER
      if (player.inCar) exitCar();
      else {
        const car = nearestCar(player.x, player.z, 6);
        if (car) {
          car.kindBefore = car.kind;
          enterCar(car, audio);
        }
      }
    }

    if (player.inCar) {
      const car = player.inCar;
      const throttle = -axes.y;
      const steering = axes.x;
      if (throttle > 0) {
        car.speed += CAR.accel * throttle * dt;
      } else if (throttle < 0) {
        // S (throttle -1): brake while rolling forward, reverse once stopped.
        if (car.speed > 0) car.speed += CAR.brake * throttle * dt;
        else car.speed += CAR.reverseAccel * throttle * dt;
      } else {
        car.speed *= Math.max(0, 1 - 0.6 * dt);
        if (Math.abs(car.speed) < 0.3) car.speed = 0;
      }
      car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
      const turn = steering * CAR.turnRate * clamp(Math.abs(car.speed) / 14, 0, 1) * (car.speed < 0 ? -1 : 1);
      car.angle += turn * dt;
      const nx = Math.cos(car.angle) * car.speed * dt;
      const nz = Math.sin(car.angle) * car.speed * dt;
      if (!moveCarWithCollision(car, nx, nz)) {
        car.speed *= -0.25;
        car.health -= 4;
        if (car.health <= 0) {
          explode(car.x, car.z);
          car.kind = 'parked';
          car.speed = 0;
          player.inCar = null;
          player.x = car.x + 6;
          player.z = car.z;
          events |= damagePlayer(20, audio);
        }
      }
      player.x = car.x;
      player.z = car.z;
      player.angle = car.angle;
      // Running over pedestrians while driving.
      for (const ped of peds) {
        if (!ped.dead && distance(ped.x, ped.z, car.x, car.z) < 3.2 && Math.abs(car.speed) > 8) {
          ped.dead = true;
          ped.deadTimer = 6;
          events |= addWanted(WANTED.hitPedestrian, 'Pedestrian hit');
          car.speed *= 0.85;
        }
      }
      // Bumping traffic.
      for (const other of cars) {
        if (other === car || other.kind === 'player') continue;
        if (distance(other.x, other.z, car.x, car.z) < 6.5) {
          const push = angleTo(car.x, car.z, other.x, other.z);
          other.x += Math.cos(push) * 3 * dt * 10;
          other.z += Math.sin(push) * 3 * dt * 10;
          if (other.kind === 'traffic') {
            other.speed = Math.max(0, other.speed - 4);
          }
        }
      }
      if (actions & 8) { // ACTION_SHOOT: drive-by
        events |= shootAt(input.aimX ?? car.x + Math.cos(car.angle) * 20, input.aimZ ?? car.z + Math.sin(car.angle) * 20, audio);
      }
      audio?.engine?.(Math.abs(car.speed) / CAR.maxSpeed);
    } else {
      // On foot, WASD moves relative to the camera, not the world.
      const camYaw = input.cameraYaw ?? 0;
      const fwdX = Math.cos(camYaw);
      const fwdZ = Math.sin(camYaw);
      const rightX = -fwdZ;
      const rightZ = fwdX;
      const speed = axes.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
      const mx = (fwdX * -axes.y + rightX * axes.x) * speed;
      const mz = (fwdZ * -axes.y + rightZ * axes.x) * speed;
      const moving = axes.x !== 0 || axes.y !== 0;
      const nx = player.x + mx * dt;
      const nz = player.z + mz * dt;
      if (!hitsBuilding(city, nx, player.z, PLAYER.radius) && !isWaterAt(nx, player.z)) player.x = clamp(nx, 40, WORLD.width - 40);
      if (!hitsBuilding(city, player.x, nz, PLAYER.radius) && !isWaterAt(player.x, nz)) player.z = clamp(nz, 40, CITY.harborZ - 2);
      if (moving) player.angle = Math.atan2(mz, mx);
      if (actions & 8 || input.mouseDown) {
        // Face the aim point while shooting.
        player.angle = angleTo(player.x, player.z, input.aimX ?? player.x + 10, input.aimZ ?? player.z);
        events |= shootAt(input.aimX ?? player.x + Math.cos(player.angle) * 20, input.aimZ ?? player.z + Math.sin(player.angle) * 20, audio);
      }
      audio?.engine?.(0);
    }
    return events;
  }

  function updateCamera(dt) {
    const tx = clamp(player.x, 100, WORLD.width - 100);
    const tz = clamp(player.z, 100, CITY.harborZ - 100);
    camera.x += (tx - camera.x) * Math.min(1, dt * 5);
    camera.z += (tz - camera.z) * Math.min(1, dt * 5);
  }

  /** One fixed step. `input` carries axes, actions, the mouse aim and the camera yaw. */
  function step(dt, input, audio) {
    let events = 0;
    state.time += dt;
    state.clock += dt;
    state.crimeTimer += dt;
    if (state.messageTimer > 0) state.messageTimer -= dt;
    // Slow health regen after 8 seconds without taking damage.
    player.regenTimer += dt;
    if (player.regenTimer > 8 && player.health > 0 && player.health < PLAYER.health) {
      player.health = Math.min(PLAYER.health, player.health + 6 * dt);
    }

    // Wanted cools down when the player lies low and no cop is near.
    if (player.wanted > 0) {
      state.wantedTimer += dt;
      const px = player.inCar ? player.inCar.x : player.x;
      const pz = player.inCar ? player.inCar.z : player.z;
      const copNear = cars.some((c) => c.kind === 'police' && !c.lost && distance(c.x, c.z, px, pz) < 60)
        || heli.active;
      if (state.crimeTimer > WANTED.decaySeconds && !copNear && state.wantedTimer > 10) {
        state.wantedTimer = 0;
        player.wanted -= 1;
        if (player.wanted === 0) setMessage('Heat lost — the cops gave up.', 3);
      }
    }

    events |= updatePlayer(dt, input, audio);
    events |= updateMission(dt, audio);
    state.missionTarget = missionTarget();
    updateTraffic(dt);
    updatePeds(dt);
    events |= updatePolice(dt, audio);
    updateHeli(dt);
    updateRoadblocks(dt);
    events |= updateBullets(dt);
    updateRivals(dt, audio);
    events |= updatePickups(dt, audio);

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 9 * dt;
      if (p.y < 0.1) { p.y = 0.1; p.vy = 0; }
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    updateCamera(dt);
    audio?.siren?.(cars.some((c) => c.kind === 'police') || heli.active, dt);
    return events;
  }

  function reset() {
    player.x = 600;
    player.z = 620;
    player.angle = -Math.PI / 2;
    player.health = PLAYER.health;
    player.armor = PLAYER.armor;
    player.ammo = PLAYER.ammoStart;
    player.wanted = 0;
    player.inCar = null;
    player.bustTimer = 0;
    player.fireTimer = 0;
    // Every car goes back to how the city built it; rivals, bullets and
    // pickups reset too, so a staged scene starts from a clean city.
    for (let i = cars.length - 1; i >= 0; i -= 1) {
      const car = cars[i];
      if (car.kind === 'roadblock') { cars.splice(i, 1); continue; }
      if (car.kind === 'player') car.kind = 'parked';
      if (car.kind === 'police') car.kind = 'traffic';
      car.speed = car.kind === 'traffic' ? car.cruise : 0;
      car.health = CAR.health;
      car.stolen = false;
    }
    roadblocks.length = 0;
    heli.active = false;
    rivals.length = 0;
    bullets.length = 0;
    particles.length = 0;
    for (const pickup of pickups) pickup.taken = false;
    for (const ped of peds) {
      ped.dead = false;
      ped.state = 'walk';
    }
    state.time = 0;
    state.storyDone = false;
    state.crimeTimer = 0;
    state.wantedTimer = 0;
    startMission(mission.index);
    state.missionTarget = missionTarget();
  }

  startMission(mission.index);

  return {
    state, step, reset, startMission, missionTarget,
    /** The current mission definition, or null when the story is done. */
    currentMission() {
      return MISSIONS[mission.index] || null;
    },
  };
}
