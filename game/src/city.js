// The city of Neon Bay: a fixed grid of roads and blocks, built once from a seed.
// Roads run along the CITY.roadsX / roadsY lines; every block between them holds
// buildings, a park, a parking lot or a plaza. The harbor and its water sit along
// the south edge. Everything the world and the renderer need comes from here.

import { CITY, WORLD } from './config.js';
import { randomInt, randomPick } from './random.js';

const BUILDING_COLORS = ['#8a6f5c', '#7a6a8a', '#5c7a8a', '#a8836b', '#6b8a6f', '#946b5c'];
const ROOF_COLORS = ['#a8836b', '#c9a227', '#5c7a8a', '#8a6f5c'];
const CAR_COLORS = ['#e5534b', '#4fc3f7', '#f2c94c', '#e8e4da', '#7ee081', '#ff8c42', '#b388ff'];

/** True when (x, y) is on a road (within half the road width of a road line). */
export function isRoadAt(x, y) {
  const half = CITY.road / 2;
  for (const rx of CITY.roadsX) if (Math.abs(x - rx) <= half) return true;
  for (const ry of CITY.roadsY) if (Math.abs(y - ry) <= half) return true;
  return false;
}

/** True when (x, y) is in the harbor water. */
export function isWaterAt(x, y) {
  return y >= CITY.harborY;
}

/** The nearest road centre to a point, snapped to the grid. */
export function nearestRoadPoint(x, y) {
  let bestX = CITY.roadsX[0];
  for (const rx of CITY.roadsX) if (Math.abs(rx - x) < Math.abs(bestX - x)) bestX = rx;
  let bestY = CITY.roadsY[0];
  for (const ry of CITY.roadsY) if (Math.abs(ry - y) < Math.abs(bestY - y)) bestY = ry;
  return { x: bestX, y: bestY };
}

export function buildCity(random) {
  const buildings = [];
  const parks = [];
  const palms = [];
  const lots = [];

  // One building (or park / lot) per grid cell between neighbouring roads.
  for (let ix = 0; ix < CITY.roadsX.length - 1; ix += 1) {
    for (let iy = 0; iy < CITY.roadsY.length - 1; iy += 1) {
      const x0 = CITY.roadsX[ix] + CITY.road / 2 + 14;
      const y0 = CITY.roadsY[iy] + CITY.road / 2 + 14;
      const x1 = CITY.roadsX[ix + 1] - CITY.road / 2 - 14;
      const y1 = CITY.roadsY[iy + 1] - CITY.road / 2 - 14;
      const roll = random();
      if (roll < 0.16) {
        parks.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
        const count = randomInt(random, 3, 7);
        for (let p = 0; p < count; p += 1) {
          palms.push({ x: x0 + 30 + random() * (x1 - x0 - 60), y: y0 + 30 + random() * (y1 - y0 - 60) });
        }
        continue;
      }
      if (roll < 0.28) {
        lots.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
        continue;
      }
      // Two buildings per block, with a gap between them.
      const mid = (x0 + x1) / 2;
      const gap = 26;
      buildings.push({
        x: x0, y: y0, width: mid - gap / 2 - x0, height: y1 - y0,
        color: randomPick(random, BUILDING_COLORS), roof: randomPick(random, ROOF_COLORS),
        floors: randomInt(random, 1, 4),
      });
      buildings.push({
        x: mid + gap / 2, y: y0, width: x1 - (mid + gap / 2), height: y1 - y0,
        color: randomPick(random, BUILDING_COLORS), roof: randomPick(random, ROOF_COLORS),
        floors: randomInt(random, 1, 4),
      });
    }
  }

  // Palm trees along the main avenue and the harbor front.
  for (let x = 260; x < WORLD.width - 100; x += 180) {
    palms.push({ x, y: 152 });
    palms.push({ x: x + 90, y: CITY.harborY - 40 });
  }

  /** Parked cars waiting to be stolen, on lots and roadside spots. */
  const parkedSpots = [];
  const lotSpots = [
    { x: 1000, y: 1000 }, { x: 2200, y: 600 }, { x: 1800, y: 1400 },
    { x: 2600, y: 1800 }, { x: 600, y: 1800 }, { x: 3000, y: 1000 },
    { x: 1400, y: 2200 }, { x: 1000, y: 2200 }, { x: 2200, y: 2200 },
    { x: 3400, y: 1400 }, { x: 600, y: 1000 }, { x: 1800, y: 600 },
  ];
  for (const spot of lotSpots) {
    parkedSpots.push({
      x: spot.x + randomInt(random, -30, 30),
      y: spot.y + randomInt(random, -30, 30),
      angle: randomPick(random, [0, Math.PI / 2, Math.PI, -Math.PI / 2]),
      color: randomPick(random, CAR_COLORS),
    });
  }

  return { buildings, parks, palms, lots, parkedSpots };
}

/** True when a circle of radius r at (x, y) overlaps a building. */
export function hitsBuilding(city, x, y, r) {
  for (const b of city.buildings) {
    if (x + r > b.x && x - r < b.x + b.width && y + r > b.y && y - r < b.y + b.height) return true;
  }
  return false;
}

/** Push a circle out of any building it overlaps; returns true when it moved. */
export function resolveBuildingCollision(city, body, r) {
  let moved = false;
  for (const b of city.buildings) {
    const cx = Math.max(b.x, Math.min(body.x, b.x + b.width));
    const cy = Math.max(b.y, Math.min(body.y, b.y + b.height));
    const dx = body.x - cx;
    const dy = body.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r && d2 > 0.01) {
      const d = Math.sqrt(d2);
      body.x = cx + (dx / d) * r;
      body.y = cy + (dy / d) * r;
      moved = true;
    } else if (d2 <= 0.01) {
      body.y = b.y - r;
      moved = true;
    }
  }
  return moved;
}
