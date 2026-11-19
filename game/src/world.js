// Neon Bay — the simulation. No drawing and no browser in it: the player, the
// cars, the traffic, the pedestrians, the police, the wanted level, the combat
// and the five story missions. step() advances one fixed step and returns what
// happened as bit flags, so the caller can react without the world knowing
// about screens or sound. The audio object it is given is only ever called,
// never stored.

import {
  CAR, CITY, ECONOMY, MISSIONS, PLAYER, POLICE, VIEW, WANTED, WORLD,
} from './config.js';
import { buildCity, hitsBuilding, isRoadAt, isWaterAt, nearestRoadPoint, resolveBuildingCollision } from './city.js';
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

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

export function createWorld(random, saved) {
  const city = buildCity(random);

  const player = {
    x: 600, y: 620, angle: -Math.PI / 2, health: PLAYER.health,
    money: saved?.money ?? ECONOMY.startMoney, ammo: PLAYER.ammoStart,
    wanted: 0, inCar: null, speed: 0, fireTimer: 0, bustTimer: 0,
  };

  const cars = [];
  const peds = [];
  const rivals = [];
  const bullets = [];
  const particles = [];
  const pickups = [];

  function addCar(x, y, angle, color, kind) {
    const car = {
      id: cars.length, x, y, angle, speed: 0, color,
      kind, health: CAR.health, driver: kind === 'traffic',
      axis: Math.abs(Math.cos(angle)) > 0.5 ? 'x' : 'y',
      dir: Math.cos(angle) >= 0 ? 1 : -1, cruise: 130 + random() * 70,
    };
    cars.push(car);
    return car;
  }

  // Parked cars from the city, plus a starter car near the hideout.
  for (const spot of city.parkedSpots) addCar(spot.x, spot.y, spot.angle, spot.color, 'parked');
  addCar(660, 700, 0, '#ff8c42', 'parked');

  // Traffic: cars already rolling on the roads.
  for (let i = 0; i < 14; i += 1) {
    const horizontal = random() < 0.5;
    const road = horizontal
      ? { x: 200 + random() * 3200, y: randomPick(random, CITY.roadsY) }
      : { x: randomPick(random, CITY.roadsX), y: 200 + random() * 2000 };
    const angle = horizontal ? (random() < 0.5 ? 0 : Math.PI) : (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const car = addCar(road.x, road.y, angle, randomPick(random, TRAFFIC_COLORS), 'traffic');
    car.speed = car.cruise;
  }

  function addPed(x, y) {
    const ped = {
      x, y, angle: random() * TWO_PI, speed: 55 + random() * 30,
      color: randomPick(random, PED_COLORS), state: 'walk',
      walkTimer: 2 + random() * 4, dead: false, deadTimer: 0,
    };
    peds.push(ped);
    return ped;
  }
  for (let i = 0; i < 26; i += 1) {
    // Pedestrians walk the sidewalks: beside a road line, mid-block, never
    // on a lane and never in an intersection.
    const horizontal = random() < 0.5;
    if (horizontal) {
      const ry = randomPick(random, CITY.roadsY);
      const ix = Math.floor(random() * (CITY.roadsX.length - 1));
      const midX = (CITY.roadsX[ix] + CITY.roadsX[ix + 1]) / 2;
      addPed(midX + (random() - 0.5) * 160, ry + (random() < 0.5 ? -1 : 1) * (54 + random() * 14));
    } else {
      const rx = randomPick(random, CITY.roadsX);
      const iy = Math.floor(random() * (CITY.roadsY.length - 1));
      const midY = (CITY.roadsY[iy] + CITY.roadsY[iy + 1]) / 2;
      addPed(rx + (random() < 0.5 ? -1 : 1) * (54 + random() * 14), midY + (random() - 0.5) * 160);
    }
  }

  const cashSpots = [
    { x: 1000, y: 600 }, { x: 2200, y: 1000 }, { x: 1400, y: 1800 },
    { x: 3000, y: 1800 }, { x: 600, y: 1400 }, { x: 2600, y: 600 },
    { x: 1800, y: 1000 }, { x: 3400, y: 2200 },
  ];
  for (const spot of cashSpots) pickups.push({ x: spot.x, y: spot.y, taken: false, kind: 'cash' });

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

  const camera = { x: player.x, y: player.y };
  const state = {
    player, cars, peds, rivals, bullets, particles, pickups,
    city, mission, camera,
    time: 0, crimeTimer: 0, wantedTimer: 0, message: '', messageTimer: 0,
    storyDone: false, bestMoney: saved?.bestMoney ?? 0, crimeLog: [],
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

  function spawnParticles(x, y, color, count, speed) {
    for (let i = 0; i < count; i += 1) {
      const a = random() * TWO_PI;
      const s = (0.4 + random() * 0.6) * speed;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + random() * 0.4, color });
    }
  }

  function explode(x, y) {
    spawnParticles(x, y, '#ff8c42', 22, 260);
    spawnParticles(x, y, '#ffd23e', 14, 180);
    spawnParticles(x, y, '#3a3f4a', 10, 120);
  }

  function nearestCar(x, y, maxDist) {
    let best = null;
    let bestDist = maxDist;
    for (const car of cars) {
      if (car.kind === 'player') continue;
      const d = distance(x, y, car.x, car.y);
      if (d < bestDist) { bestDist = d; best = car; }
    }
    return best;
  }

  function enterCar(car, audio) {
    if (!car) return;
    player.inCar = car;
    car.kind = 'player';
    car.driver = true;
    if (car.wasTraffic) { /* driver already fled */ }
    audio?.door?.();
    if (car.stolen !== true && car.kindBefore !== 'parked') {
      // Stealing a traffic car: its driver bails out on foot.
      const ped = addPed(car.x + 40, car.y + 40);
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
    player.x = car.x + Math.cos(car.angle + Math.PI / 2) * 40;
    player.y = car.y + Math.sin(car.angle + Math.PI / 2) * 40;
    player.angle = car.angle;
    resolveBuildingCollision(city, player, PLAYER.radius);
  }

  function damagePlayer(amount, audio) {
    player.health -= amount;
    player.regenTimer = 0;
    audio?.hurt?.();
    if (player.health <= 0) {
      player.health = 0;
      return EVENT_WASTED;
    }
    return EVENT_HIT;
  }

  function shootAt(targetX, targetY, audio) {
    if (player.fireTimer > 0) return 0;
    const ox = player.inCar ? player.inCar.x : player.x;
    const oy = player.inCar ? player.inCar.y : player.y;
    if (player.ammo <= 0) {
      // Out of ammo: punch whatever is closest.
      return punch(audio);
    }
    player.fireTimer = PLAYER.fireInterval;
    player.ammo -= 1;
    const angle = angleTo(ox, oy, targetX, targetY);
    bullets.push({ x: ox + Math.cos(angle) * 30, y: oy + Math.sin(angle) * 30, vx: Math.cos(angle) * 950, vy: Math.sin(angle) * 950, life: 0.6, fromPlayer: true });
    audio?.shot?.();
    spawnParticles(ox + Math.cos(angle) * 34, oy + Math.sin(angle) * 34, '#ffd23e', 3, 120);
    return EVENT_SHOT | addWanted(0, '') & 0; // shooting itself is not a crime unless it hits someone
  }

  function punch(audio) {
    const ox = player.x;
    const oy = player.y;
    let hit = false;
    for (const rival of rivals) {
      if (rival.alive && distance(ox, oy, rival.x, rival.y) < PLAYER.punchRange + 14) {
        rival.health -= PLAYER.punchDamage;
        spawnParticles(rival.x, rival.y, '#e5534b', 6, 140);
        if (rival.health <= 0) rival.alive = false;
        hit = true;
      }
    }
    for (const ped of peds) {
      if (!ped.dead && distance(ox, oy, ped.x, ped.y) < PLAYER.punchRange) {
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
        { x: 2600, y: 1000, label: 'Delivery 1' },
        { x: 1000, y: 1800, label: 'Delivery 2' },
        { x: 3000, y: 1400, label: 'Delivery 3' },
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
    const py = player.inCar ? player.inCar.y : player.y;
    let events = 0;

    if (m.kind === 'steal-and-drive') {
      if (mission.stage === 'start' && player.inCar) {
        mission.stage = 'drive';
        setMessage('Good — now drive to the paint shop', 3);
      } else if (mission.stage === 'drive' && distance(px, py, m.target.x, m.target.y) < 130) {
        events |= completeMission(audio);
      }
    } else if (m.kind === 'deliver') {
      mission.timer -= dt;
      if (mission.timer <= 0) return failMission('out of time');
      const target = mission.deliveries[mission.deliveryIndex];
      if (target && distance(px, py, target.x, target.y) < 110) {
        mission.deliveryIndex += 1;
        player.money += 100;
        audio?.pickup?.();
        setMessage(`Parcel delivered! ${mission.deliveryIndex} of ${mission.deliveries.length}`, 3);
        if (mission.deliveryIndex >= mission.deliveries.length) events |= completeMission(audio);
      }
    } else if (m.kind === 'fight-and-fetch') {
      if (!mission.rivalsSpawned && distance(px, py, m.target.x, m.target.y) < 450) {
        mission.rivalsSpawned = true;
        for (let i = 0; i < m.rivals; i += 1) {
          rivals.push({ x: m.target.x - 120 + i * 80, y: m.target.y - 60 + (i % 2) * 120, health: 60, alive: true, speed: 95, shootTimer: 1 + random() * 2 });
        }
        setMessage('Dock Rats! Deal with them.', 4);
      }
      const alive = rivals.filter((r) => r.alive).length;
      if (mission.rivalsSpawned && alive === 0 && !mission.briefcase) {
        mission.briefcase = { x: m.target.x, y: m.target.y, label: 'Briefcase' };
        setMessage('Briefcase dropped — grab it!', 4);
      }
      if (mission.briefcase && distance(px, py, mission.briefcase.x, mission.briefcase.y) < 70) {
        mission.briefcase = null;
        mission.stage = 'return';
        setMessage('Got it. Bring it to the hideout.', 4);
      }
      if (mission.stage === 'return' && distance(px, py, 600, 600) < 130) {
        events |= completeMission(audio);
      }
    } else if (m.kind === 'escape') {
      if (player.wanted === 0 && distance(px, py, 600, 600) < 130) {
        events |= completeMission(audio);
      }
    } else if (m.kind === 'heist') {
      if (mission.stage === 'start' && distance(px, py, m.target.x, m.target.y) < 130) {
        mission.stage = 'vault';
        mission.vaultTimer = 8;
        setMessage('Cracking the vault — stay in the circle!', 4);
      } else if (mission.stage === 'vault') {
        if (distance(px, py, m.target.x, m.target.y) > 150) {
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
      } else if (mission.stage === 'run' && distance(px, py, 1800, 2400) < 140) {
        events |= completeMission(audio);
      }
    }
    return events;
  }

  function updateTraffic(dt) {
    for (const car of cars) {
      if (car.kind !== 'traffic') continue;
      // Drive along the current road; at intersections, sometimes turn.
      const onXRoad = CITY.roadsX.some((rx) => Math.abs(car.x - rx) < 60);
      const onYRoad = CITY.roadsY.some((ry) => Math.abs(car.y - ry) < 60);
      if (onXRoad && onYRoad && random() < 0.004) {
        if (car.axis === 'x') {
          car.axis = 'y';
          car.dir = random() < 0.5 ? 1 : -1;
          car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          car.y = nearestRoadPoint(car.x, car.y).y;
        } else {
          car.axis = 'x';
          car.dir = random() < 0.5 ? 1 : -1;
          car.angle = car.dir > 0 ? 0 : Math.PI;
          car.x = nearestRoadPoint(car.x, car.y).x;
        }
      }
      const vx = Math.cos(car.angle) * car.speed;
      const vy = Math.sin(car.angle) * car.speed;
      car.x += vx * dt;
      car.y += vy * dt;
      // Wrap around the city edge so traffic never runs out.
      if (car.x < 120) { car.x = 120; car.angle = 0; car.axis = 'x'; car.dir = 1; }
      if (car.x > WORLD.width - 120) { car.x = WORLD.width - 120; car.angle = Math.PI; car.axis = 'x'; car.dir = -1; }
      if (car.y < 120) { car.y = 120; car.angle = Math.PI / 2; car.axis = 'y'; car.dir = 1; }
      if (car.y > CITY.harborY - 120) { car.y = CITY.harborY - 120; car.angle = -Math.PI / 2; car.axis = 'y'; car.dir = -1; }
      // Slow down for the car ahead on the same road.
      for (const other of cars) {
        if (other === car || other.kind !== 'traffic') continue;
        const dx = other.x - car.x;
        const dy = other.y - car.y;
        const ahead = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
        if (ahead > 0 && ahead < 90 && Math.abs(dx * Math.sin(car.angle) - dy * Math.cos(car.angle)) < 40) {
          car.speed = Math.max(40, other.speed - 20);
          break;
        }
        car.speed = car.cruise;
      }
    }
  }

  function updatePeds(dt) {
    const px = player.inCar ? player.inCar.x : player.x;
    const py = player.inCar ? player.inCar.y : player.y;
    for (const ped of peds) {
      if (ped.dead) {
        ped.deadTimer -= dt;
        continue;
      }
      const scared = player.wanted > 0 && distance(ped.x, ped.y, px, py) < 320;
      if (scared) ped.state = 'flee';
      else if (ped.state === 'flee' && distance(ped.x, ped.y, px, py) > 500) ped.state = 'walk';
      const speed = ped.state === 'flee' ? ped.speed * 2.4 : ped.speed;
      ped.walkTimer -= dt;
      if (ped.walkTimer <= 0) {
        ped.walkTimer = 2 + random() * 4;
        // Walk along the street grid, like a person on a sidewalk.
        ped.angle = (Math.floor(random() * 4) * Math.PI) / 2 + (random() - 0.5) * 0.3;
      }
      if (ped.state === 'flee') {
        // Run for the sidewalk, not down the road: flee away from the
        // nearest road centre line, so a fleeing pedestrian leaves the lane.
        let bestD = Infinity;
        let axis = 'y';
        let dir = 1;
        for (const ry of CITY.roadsY) {
          const d = Math.abs(ped.y - ry);
          if (d < bestD) { bestD = d; axis = 'y'; dir = ped.y >= ry ? 1 : -1; }
        }
        for (const rx of CITY.roadsX) {
          const d = Math.abs(ped.x - rx);
          if (d < bestD) { bestD = d; axis = 'x'; dir = ped.x >= rx ? 1 : -1; }
        }
        ped.angle = axis === 'y' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
      }
      ped.x += Math.cos(ped.angle) * speed * dt;
      ped.y += Math.sin(ped.angle) * speed * dt;
      ped.x = clamp(ped.x, 60, WORLD.width - 60);
      ped.y = clamp(ped.y, 60, CITY.harborY - 60);
      if (ped.state === 'walk') {
        // Stay on the sidewalk: never stand in a lane, even after turning
        // at an intersection.
        for (const ry of CITY.roadsY) {
          if (Math.abs(ped.y - ry) < 50) ped.y = ry + (ped.y >= ry ? 56 : -56);
        }
        for (const rx of CITY.roadsX) {
          if (Math.abs(ped.x - rx) < 50) ped.x = rx + (ped.x >= rx ? 56 : -56);
        }
      }
      if (hitsBuilding(city, ped.x, ped.y, 10)) {
        ped.angle += Math.PI / 2;
        ped.x = clamp(ped.x, 60, WORLD.width - 60);
        ped.y = clamp(ped.y, 60, CITY.harborY - 60);
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
    const py = player.inCar ? player.inCar.y : player.y;
    let events = 0;
    const wantedPolice = Math.min(player.wanted, 4);
    let active = cars.filter((c) => c.kind === 'police').length;
    // Spawn police when the heat rises.
    if (player.wanted > 0 && active < wantedPolice) {
      const road = nearestRoadPoint(px + (random() - 0.5) * 1400, py + (random() - 0.5) * 1400);
      const cop = addCar(road.x, road.y, angleTo(road.x, road.y, px, py), '#2f6df6', 'police');
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
      const d = distance(car.x, car.y, px, py);
      // A cop that lost the trail cruises on; it only chases again when it
      // spots the player up close. A lost cop does not keep the heat up.
      if (car.lost) {
        if (d < 400) {
          car.lost = false;
        } else {
          car.speed = Math.max(120, car.speed - 200 * dt);
          if (!moveCarWithCollision(car, Math.cos(car.angle) * car.speed * dt, Math.sin(car.angle) * car.speed * dt)) {
            car.angle += 1.2;
          }
          continue;
        }
      } else if (d > POLICE.loseTrackDistance) {
        car.lost = true;
        car.speed = Math.max(120, car.speed - 200 * dt);
        if (!moveCarWithCollision(car, Math.cos(car.angle) * car.speed * dt, Math.sin(car.angle) * car.speed * dt)) {
          car.angle += 1.2;
        }
        continue;
      }
      const targetAngle = angleTo(car.x, car.y, px, py);
      const diff = angleDiff(targetAngle, car.angle);
      car.angle += clamp(diff, -2.4 * dt, 2.4 * dt);
      car.speed = Math.min(POLICE.maxSpeed, car.speed + POLICE.accel * dt);
      if (!moveCarWithCollision(car, Math.cos(car.angle) * car.speed * dt, Math.sin(car.angle) * car.speed * dt)) {
        car.angle += 1.2;
        car.speed *= 0.5;
      }
      // Ram the player's car, or bust the player on foot.
      if (player.inCar) {
        if (d < 70) {
          player.inCar.health -= 14 * dt;
          spawnParticles(car.x, car.y, '#ff8c42', 2, 100);
          if (player.inCar.health <= 0) {
            explode(player.inCar.x, player.inCar.y);
            const wreck = player.inCar;
            wreck.kind = 'parked';
            wreck.speed = 0;
            player.inCar = null;
            player.x = wreck.x + 60;
            player.y = wreck.y;
            events |= damagePlayer(30, audio);
          }
        }
      } else if (d < 48) {
        player.bustTimer += dt;
        if (player.bustTimer >= POLICE.bustTime) {
          player.bustTimer = 0;
          player.wanted = 0;
          player.money = Math.max(0, player.money - ECONOMY.bustFine);
          player.x = 600;
          player.y = 620;
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
        explode(car.x, car.y);
        car.kind = 'parked';
        car.speed = 0;
        car.health = 0;
        events |= addWanted(WANTED.killCop, 'Cop car destroyed');
      }
    }
    return events;
  }

  function updateBullets(dt) {
    let events = 0;
    for (const bullet of bullets) {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.life -= dt;
      if (bullet.life <= 0) continue;
      // Rivals first.
      for (const rival of rivals) {
        if (rival.alive && distance(bullet.x, bullet.y, rival.x, rival.y) < 22) {
          rival.health -= PLAYER.shootDamage;
          bullet.life = 0;
          spawnParticles(rival.x, rival.y, '#e5534b', 6, 140);
          if (rival.health <= 0) rival.alive = false;
          break;
        }
      }
      if (bullet.life <= 0) continue;
      for (const car of cars) {
        if (car.kind === 'player' || car.kind === 'parked') continue;
        const dx = bullet.x - car.x;
        const dy = bullet.y - car.y;
        const localX = dx * Math.cos(-car.angle) - dy * Math.sin(-car.angle);
        const localY = dx * Math.sin(-car.angle) + dy * Math.cos(-car.angle);
        if (Math.abs(localX) < CAR.length / 2 && Math.abs(localY) < CAR.width / 2) {
          car.health -= PLAYER.shootDamage;
          bullet.life = 0;
          spawnParticles(bullet.x, bullet.y, '#ffd23e', 5, 120);
          if (car.health <= 0 && car.kind === 'traffic') {
            explode(car.x, car.y);
            car.kind = 'parked';
            car.speed = 0;
          }
          break;
        }
      }
      if (bullet.life <= 0) continue;
      for (const ped of peds) {
        if (!ped.dead && distance(bullet.x, bullet.y, ped.x, ped.y) < 16) {
          ped.dead = true;
          ped.deadTimer = 6;
          bullet.life = 0;
          events |= addWanted(WANTED.hitPedestrian, 'Pedestrian shot');
          break;
        }
      }
      if (bullet.life <= 0) continue;
      if (hitsBuilding(city, bullet.x, bullet.y, 2)) bullet.life = 0;
    }
    for (let i = bullets.length - 1; i >= 0; i -= 1) {
      if (bullets[i].life <= 0) bullets.splice(i, 1);
    }
    return events;
  }

  function updateRivals(dt, audio) {
    const px = player.inCar ? player.inCar.x : player.x;
    const py = player.inCar ? player.inCar.y : player.y;
    for (const rival of rivals) {
      if (!rival.alive) continue;
      const d = distance(rival.x, rival.y, px, py);
      rival.shootTimer -= dt;
      if (d < 300 && rival.shootTimer <= 0) {
        rival.shootTimer = 1.6 + random() * 1.0;
        const angle = angleTo(rival.x, rival.y, px, py);
        bullets.push({ x: rival.x, y: rival.y, vx: Math.cos(angle) * 430, vy: Math.sin(angle) * 430, life: 0.7, fromPlayer: false });
        audio?.shot?.();
      } else if (d < 300) {
        // Close in to brawl.
        rival.x += Math.cos(angleTo(rival.x, rival.y, px, py)) * rival.speed * dt;
        rival.y += Math.sin(angleTo(rival.x, rival.y, px, py)) * rival.speed * dt;
        if (d < 34 && player.fireTimer <= 0) {
          player.fireTimer = 0.5;
          damagePlayer(8, audio);
        }
      }
    }
    // Enemy bullets hurt the player.
    for (const bullet of bullets) {
      if (bullet.fromPlayer) continue;
      const ox = player.inCar ? player.inCar.x : player.x;
      const oy = player.inCar ? player.inCar.y : player.y;
      if (distance(bullet.x, bullet.y, ox, oy) < (player.inCar ? 30 : 16)) {
        bullet.life = 0;
        damagePlayer(6, audio);
      }
    }
  }

  function updatePickups(dt, audio) {
    const px = player.inCar ? player.inCar.x : player.x;
    const py = player.inCar ? player.inCar.y : player.y;
    for (const pickup of pickups) {
      if (pickup.taken) continue;
      if (distance(px, py, pickup.x, pickup.y) < 44) {
        pickup.taken = true;
        player.money += ECONOMY.pickupValue;
        audio?.pickup?.();
        setMessage(`Cash found! +$${ECONOMY.pickupValue}`, 2);
        return EVENT_PICKUP;
      }
    }
    return 0;
  }

  /**
   * Move a car by (dx, dy), sliding along walls: try the full step, then each
   * axis alone, so a car pushed into a building slides around it instead of
   * sticking to it. Returns true when the car moved at all.
   */
  function moveCarWithCollision(car, dx, dy) {
    const r = 24;
    if (!hitsBuilding(city, car.x + dx, car.y + dy, r) && !isWaterAt(car.x + dx, car.y + dy)) {
      car.x = clamp(car.x + dx, 40, WORLD.width - 40);
      car.y = clamp(car.y + dy, 40, CITY.harborY - 40);
      return true;
    }
    if (!hitsBuilding(city, car.x + dx, car.y, r) && !isWaterAt(car.x + dx, car.y)) {
      car.x = clamp(car.x + dx, 40, WORLD.width - 40);
      return true;
    }
    if (!hitsBuilding(city, car.x, car.y + dy, r) && !isWaterAt(car.x, car.y + dy)) {
      car.y = clamp(car.y + dy, 40, CITY.harborY - 40);
      return true;
    }
    return false;
  }

  function updatePlayer(dt, input, audio) {
    const axes = input.axes || { x: 0, y: 0, run: false };
    const actions = input.actions || 0;
    let events = 0;
    player.fireTimer = Math.max(0, player.fireTimer - dt);

    if (actions & 4) { // ACTION_ENTER
      if (player.inCar) exitCar();
      else {
        const car = nearestCar(player.x, player.y, 78);
        if (car) {
          car.kindBefore = car.kind;
          car.wasTraffic = car.kind === 'traffic';
          car.owned = car.owned || false;
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
        if (Math.abs(car.speed) < 4) car.speed = 0;
      }
      car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
      const turn = steering * CAR.turnRate * clamp(Math.abs(car.speed) / 200, 0, 1) * (car.speed < 0 ? -1 : 1);
      car.angle += turn * dt;
      const nx = Math.cos(car.angle) * car.speed * dt;
      const ny = Math.sin(car.angle) * car.speed * dt;
      if (!moveCarWithCollision(car, nx, ny)) {
        car.speed *= -0.25;
        car.health -= 4;
        if (car.health <= 0) {
          explode(car.x, car.y);
          car.kind = 'parked';
          car.speed = 0;
          player.inCar = null;
          player.x = car.x + 60;
          player.y = car.y;
          events |= damagePlayer(20, audio);
        }
      }
      player.x = car.x;
      player.y = car.y;
      player.angle = car.angle;
      // Running over pedestrians while driving.
      for (const ped of peds) {
        if (!ped.dead && distance(ped.x, ped.y, car.x, car.y) < 26 && Math.abs(car.speed) > 100) {
          ped.dead = true;
          ped.deadTimer = 6;
          events |= addWanted(WANTED.hitPedestrian, 'Pedestrian hit');
          car.speed *= 0.85;
        }
      }
      // Bumping traffic.
      for (const other of cars) {
        if (other === car || other.kind === 'player') continue;
        if (distance(other.x, other.y, car.x, car.y) < 52) {
          const push = angleTo(car.x, car.y, other.x, other.y);
          other.x += Math.cos(push) * 30 * dt * 10;
          other.y += Math.sin(push) * 30 * dt * 10;
          if (other.kind === 'traffic') {
            other.speed = Math.max(0, other.speed - 60);
            if (Math.abs(car.speed) > 240) events |= addWanted(0, '') & 0;
          }
        }
      }
      if (actions & 8) { // ACTION_SHOOT: drive-by
        events |= shootAt(input.aimX ?? car.x + Math.cos(car.angle) * 200, input.aimY ?? car.y + Math.sin(car.angle) * 200, audio);
      }
      audio?.engine?.(Math.abs(car.speed) / CAR.maxSpeed);
    } else {
      const speed = axes.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
      const len = Math.hypot(axes.x, axes.y) || 1;
      const mx = (axes.x / len) * (axes.x || axes.y ? speed : 0);
      const my = (axes.y / len) * (axes.x || axes.y ? speed : 0);
      const nx = player.x + mx * dt;
      const ny = player.y + my * dt;
      if (!hitsBuilding(city, nx, player.y, PLAYER.radius) && !isWaterAt(nx, player.y)) player.x = clamp(nx, 40, WORLD.width - 40);
      if (!hitsBuilding(city, player.x, ny, PLAYER.radius) && !isWaterAt(player.x, ny)) player.y = clamp(ny, 40, CITY.harborY - 40);
      if (axes.x || axes.y) player.angle = Math.atan2(my, mx);
      if (actions & 8) {
        events |= shootAt(input.aimX ?? player.x + Math.cos(player.angle) * 200, input.aimY ?? player.y + Math.sin(player.angle) * 200, audio);
      }
      audio?.engine?.(0);
    }
    return events;
  }

  function updateCamera(dt) {
    const tx = clamp(player.x, VIEW.width / 2, WORLD.width - VIEW.width / 2);
    const ty = clamp(player.y, VIEW.height / 2, CITY.harborY - VIEW.height / 2 + 160);
    camera.x += (tx - camera.x) * Math.min(1, dt * 5);
    camera.y += (ty - camera.y) * Math.min(1, dt * 5);
  }

  /** One fixed step. `input` carries axes, actions and the mouse aim in world coords. */
  function step(dt, input, audio) {
    let events = 0;
    state.time += dt;
    state.crimeTimer += dt;
    if (state.messageTimer > 0) state.messageTimer -= dt;
    // Slow health regen after 8 seconds without taking damage.
    player.regenTimer = (player.regenTimer || 0) + dt;
    if (player.regenTimer > 8 && player.health > 0 && player.health < PLAYER.health) {
      player.health = Math.min(PLAYER.health, player.health + 6 * dt);
    }

    // Wanted cools down when the player lies low and no cop is near.
    if (player.wanted > 0) {
      state.wantedTimer += dt;
      const px = player.inCar ? player.inCar.x : player.x;
      const py = player.inCar ? player.inCar.y : player.y;
      const copNear = cars.some((c) => c.kind === 'police' && !c.lost && distance(c.x, c.y, px, py) < 450);
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
    events |= updateBullets(dt);
    updateRivals(dt, audio);
    events |= updatePickups(dt, audio);

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    updateCamera(dt);
    audio?.siren?.(cars.some((c) => c.kind === 'police'), dt);
    return events;
  }

  function reset() {
    player.x = 600;
    player.y = 620;
    player.angle = -Math.PI / 2;
    player.health = PLAYER.health;
    player.ammo = PLAYER.ammoStart;
    player.wanted = 0;
    player.inCar = null;
    player.bustTimer = 0;
    player.fireTimer = 0;
    // Every car goes back to how the city built it; rivals, bullets and
    // pickups reset too, so a staged scene starts from a clean city.
    for (const car of cars) {
      if (car.kind === 'player') car.kind = 'parked';
      if (car.kind === 'police') car.kind = 'traffic';
      car.speed = car.kind === 'traffic' ? car.cruise : 0;
      car.health = CAR.health;
    }
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
