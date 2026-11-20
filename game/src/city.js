// The city of Neon Bay: a fixed grid of roads and blocks, built once from a seed.
// Roads run along the CITY.roadsX / roadsZ lines; every block between them holds
// buildings, a park, a parking lot or a plaza. The harbor and its water sit along
// the south edge. The whole static city is baked into two meshes here — the
// lambert city and the emissive glow (windows, neon signs, lamp heads) that
// lights up at night — plus a water plane and the boat at the pier.

import { CITY, WORLD } from './config.js';
import { randomInt, randomPick } from './random.js';
import { MeshBuilder } from './gl.js';

const BUILDING_COLORS = ['#c97b4a', '#7a6a8a', '#4f8a9e', '#a8836b', '#6b8a6f', '#946b5c', '#b08050', '#d95f6e', '#5c8a7a'];
const ROOF_COLORS = ['#a8836b', '#c9a227', '#5c7a8a', '#8a6f5c', '#3a3f4a'];
const CAR_COLORS = ['#e5534b', '#4fc3f7', '#f2c94c', '#e8e4da', '#7ee081', '#ff8c42', '#b388ff'];
const NEON_COLORS = ['#ff4d9d', '#37e0d8', '#ffd23e', '#ff6b35'];

/** True when (x, z) is on a road (within half the road width of a road line). */
export function isRoadAt(x, z) {
  const half = CITY.road / 2;
  for (const rx of CITY.roadsX) if (Math.abs(x - rx) <= half) return true;
  for (const rz of CITY.roadsZ) if (Math.abs(z - rz) <= half) return true;
  return false;
}

/** True when (x, z) is in the harbor water. */
export function isWaterAt(x, z) {
  return z >= CITY.harborZ;
}

/** The nearest road centre to a point, snapped to the grid. */
export function nearestRoadPoint(x, z) {
  let bestX = CITY.roadsX[0];
  for (const rx of CITY.roadsX) if (Math.abs(rx - x) < Math.abs(bestX - x)) bestX = rx;
  let bestZ = CITY.roadsZ[0];
  for (const rz of CITY.roadsZ) if (Math.abs(rz - z) < Math.abs(bestZ - z)) bestZ = rz;
  return { x: bestX, z: bestZ };
}

/**
 * The traffic light at one intersection. Lights run on a 16-second cycle,
 * offset per intersection so the city never changes all at once. Returns
 * 'green' | 'yellow' | 'red' for traffic travelling along `axis` ('x' or 'z').
 */
export function trafficLightState(ix, iz, time, axis) {
  const phase = (time + ix * 3 + iz * 5) % 16;
  // x-traffic (east-west) runs while z-traffic waits, then they swap.
  const xGreen = phase < 7;
  const xYellow = phase >= 7 && phase < 8;
  const zGreen = phase >= 8 && phase < 15;
  const zYellow = phase >= 15;
  if (axis === 'x') return xGreen ? 'green' : xYellow ? 'yellow' : 'red';
  return zGreen ? 'green' : zYellow ? 'yellow' : 'red';
}

/** The colour a traffic-light head shows for one axis at one intersection. */
export function trafficLightColor(ix, iz, time, axis) {
  const s = trafficLightState(ix, iz, time, axis);
  return s === 'green' ? '#2ee66b' : s === 'yellow' ? '#ffd23e' : '#ff3b30';
}

function addPalm(builder, x, z, height) {
  const h = height || 13;
  builder.cylinder(x, h / 2, z, 0.9, h, '#6b4a2f', 6);
  const top = h;
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const outward = [Math.cos(a), -0.45, Math.sin(a)];
    const side = [-Math.sin(a), 0, Math.cos(a)];
    const up = [0, 1, 0];
    builder.boxBasis(
      x + Math.cos(a) * 4.5, top - 1.2, z + Math.sin(a) * 4.5,
      outward, side, up, 5, 1.4, 0.25, '#4e8f3e',
    );
  }
  builder.box(x, top + 0.4, z, 3.4, 1.2, 3.4, '#3d7a33');
}

export function buildCity(random) {
  const buildings = [];
  const parks = [];
  const palms = [];
  const lots = [];
  const lamps = [];

  // One building (or park / lot) per grid cell between neighbouring roads.
  for (let ix = 0; ix < CITY.roadsX.length - 1; ix += 1) {
    for (let iz = 0; iz < CITY.roadsZ.length - 1; iz += 1) {
      const x0 = CITY.roadsX[ix] + CITY.road / 2 + 14;
      const z0 = CITY.roadsZ[iz] + CITY.road / 2 + 14;
      const x1 = CITY.roadsX[ix + 1] - CITY.road / 2 - 14;
      const z1 = CITY.roadsZ[iz + 1] - CITY.road / 2 - 14;
      const roll = random();
      if (roll < 0.16) {
        parks.push({ x: x0, z: z0, width: x1 - x0, depth: z1 - z0 });
        const count = randomInt(random, 3, 7);
        for (let p = 0; p < count; p += 1) {
          palms.push({ x: x0 + 30 + random() * (x1 - x0 - 60), z: z0 + 30 + random() * (z1 - z0 - 60) });
        }
        continue;
      }
      if (roll < 0.28) {
        lots.push({ x: x0, z: z0, width: x1 - x0, depth: z1 - z0 });
        continue;
      }
      // Two buildings per block, with a gap between them.
      const mid = (x0 + x1) / 2;
      const gap = 26;
      buildings.push({
        x: x0, z: z0, width: mid - gap / 2 - x0, depth: z1 - z0,
        color: randomPick(random, BUILDING_COLORS), roof: randomPick(random, ROOF_COLORS),
        floors: randomInt(random, 1, 5),
      });
      buildings.push({
        x: mid + gap / 2, z: z0, width: x1 - (mid + gap / 2), depth: z1 - z0,
        color: randomPick(random, BUILDING_COLORS), roof: randomPick(random, ROOF_COLORS),
        floors: randomInt(random, 1, 5),
      });
    }
  }

  // Palm trees along the main avenue and the harbor front.
  for (let x = 260; x < WORLD.width - 100; x += 180) {
    palms.push({ x, z: 152 });
    palms.push({ x: x + 90, z: CITY.harborZ - 40 });
  }

  // Street lamps along every road, alternating sides.
  for (const rx of CITY.roadsX) {
    for (let z = 300; z < CITY.harborZ - 100; z += 320) {
      lamps.push({ x: rx + CITY.road / 2 + 6, z });
    }
  }
  for (const rz of CITY.roadsZ) {
    for (let x = 300; x < WORLD.width - 100; x += 320) {
      lamps.push({ x, z: rz + CITY.road / 2 + 6 });
    }
  }

  /** Parked cars waiting to be stolen, on lots and roadside spots. */
  const parkedSpots = [];
  const lotSpots = [
    { x: 1000, z: 1000 }, { x: 2200, z: 600 }, { x: 1800, z: 1400 },
    { x: 2600, z: 1800 }, { x: 600, z: 1800 }, { x: 3000, z: 1000 },
    { x: 1400, z: 2200 }, { x: 1000, z: 2200 }, { x: 2200, z: 2200 },
    { x: 3400, z: 1400 }, { x: 600, z: 1000 }, { x: 1800, z: 600 },
  ];
  for (const spot of lotSpots) {
    parkedSpots.push({
      x: spot.x + randomInt(random, -30, 30),
      z: spot.z + randomInt(random, -30, 30),
      angle: randomPick(random, [0, Math.PI / 2, Math.PI, -Math.PI / 2]),
      color: randomPick(random, CAR_COLORS),
    });
  }

  const city = { buildings, parks, palms, lots, parkedSpots, lamps };
  const meshes = buildCityMeshes(city, random);
  city.staticMesh = meshes.staticMesh;
  city.glowMesh = meshes.glowMesh;
  city.waterMesh = meshes.waterMesh;
  city.pierMesh = meshes.pierMesh;
  return city;
}

/**
 * Bake the city into meshes: `static` (lambert), `glow` (emissive windows,
 * neon signs and lamp heads — it brightens at night), `water` (an animated
 * plane) and `pier` (the harbor pier and the getaway boat).
 */
function buildCityMeshes(city, random) {
  const b = new MeshBuilder();
  const g = new MeshBuilder();
  const w = new MeshBuilder();
  const p = new MeshBuilder();

  // Grass base, then sidewalks, then asphalt, then lane dashes — each a
  // little higher than the last so nothing z-fights.
  b.groundQuad(0, 0, WORLD.width, CITY.harborZ, -0.1, '#7fae5a');
  for (let z = 0; z < CITY.harborZ; z += 160) {
    b.groundQuad(0, z, WORLD.width, z + 40, -0.05, '#6f9c4c');
  }
  for (const rx of CITY.roadsX) {
    b.groundQuad(rx - CITY.road / 2 - 10, 0, rx + CITY.road / 2 + 10, CITY.harborZ, 0.02, '#b9b3a4');
    b.groundQuad(rx - CITY.road / 2, 0, rx + CITY.road / 2, CITY.harborZ, 0.05, '#484d5a');
  }
  for (const rz of CITY.roadsZ) {
    b.groundQuad(0, rz - CITY.road / 2 - 10, WORLD.width, rz + CITY.road / 2 + 10, 0.02, '#b9b3a4');
    b.groundQuad(0, rz - CITY.road / 2, WORLD.width, rz + CITY.road / 2, 0.05, '#484d5a');
  }
  for (const rx of CITY.roadsX) {
    for (let z = 20; z < CITY.harborZ; z += 64) {
      b.groundQuad(rx - 2, z, rx + 2, z + 30, 0.08, '#e8d44d');
    }
  }
  for (const rz of CITY.roadsZ) {
    for (let x = 20; x < WORLD.width; x += 64) {
      b.groundQuad(x, rz - 2, x + 30, rz + 2, 0.08, '#e8d44d');
    }
  }

  // Beach, then the water plane (its own mesh: the shader waves it).
  b.groundQuad(0, CITY.harborZ - 26, WORLD.width, CITY.harborZ, 0.1, '#e8d29a');
  w.groundQuad(0, CITY.harborZ, WORLD.width, WORLD.depth, -0.6, '#2e7f9e');

  // Parks and parking lots.
  for (const park of city.parks) {
    b.groundQuad(park.x, park.z, park.x + park.width, park.z + park.depth, 0.03, '#5d8f43');
  }
  for (const lot of city.lots) {
    b.groundQuad(lot.x, lot.z, lot.x + lot.width, lot.z + lot.depth, 0.03, '#9a938a');
    for (let x = lot.x + 30; x < lot.x + lot.width - 20; x += 60) {
      b.groundQuad(x, lot.z + 12, x + 3, lot.z + 52, 0.06, '#e8e4da');
    }
  }

  // Buildings: a box per building, windows as emissive quads on its faces,
  // and a neon sign on some of them, facing the nearest road.
  for (const bd of city.buildings) {
    const cx = bd.x + bd.width / 2;
    const cz = bd.z + bd.depth / 2;
    const h = 10 + bd.floors * 7;
    b.box(cx, h / 2, cz, bd.width, h, bd.depth, bd.color, { top: bd.roof });
    const floors = bd.floors;
    const winColor = '#ffd98a';
    const stepX = 22;
    const stepY = 7;
    for (let fy = 0; fy < floors; fy += 1) {
      const wy = 6 + fy * stepY;
      for (let wx = bd.x + 12; wx < bd.x + bd.width - 8; wx += stepX) {
        // South face (+z) and north face (-z).
        g.quad([wx, wy, cz + bd.depth / 2 + 0.15], [wx + 9, wy, cz + bd.depth / 2 + 0.15],
          [wx + 9, wy + 4.5, cz + bd.depth / 2 + 0.15], [wx, wy + 4.5, cz + bd.depth / 2 + 0.15], winColor);
        g.quad([wx + 9, wy, cz - bd.depth / 2 - 0.15], [wx, wy, cz - bd.depth / 2 - 0.15],
          [wx, wy + 4.5, cz - bd.depth / 2 - 0.15], [wx + 9, wy + 4.5, cz - bd.depth / 2 - 0.15], winColor);
      }
      for (let wz = bd.z + 12; wz < bd.z + bd.depth - 8; wz += stepX) {
        g.quad([cx + bd.width / 2 + 0.15, wy, wz], [cx + bd.width / 2 + 0.15, wy, wz + 9],
          [cx + bd.width / 2 + 0.15, wy + 4.5, wz + 9], [cx + bd.width / 2 + 0.15, wy + 4.5, wz], winColor);
        g.quad([cx - bd.width / 2 - 0.15, wy, wz + 9], [cx - bd.width / 2 - 0.15, wy, wz],
          [cx - bd.width / 2 - 0.15, wy + 4.5, wz], [cx - bd.width / 2 - 0.15, wy + 4.5, wz + 9], winColor);
      }
    }
    // A neon sign strip on the taller buildings, facing the street.
    if (bd.floors >= 3 && random() < 0.6) {
      const neon = randomPick(random, NEON_COLORS);
      const signY = h - 3;
      const signW = Math.min(40, bd.width * 0.6);
      g.box(cx, signY, cz + bd.depth / 2 + 0.4, signW, 2.2, 0.8, neon);
      g.box(cx, signY - 4, cz + bd.depth / 2 + 0.4, signW * 0.6, 1.2, 0.8, neon);
    }
    // Rooftop box (AC unit / water tank) so skylines are not flat slabs.
    if (random() < 0.7) {
      b.box(cx + (random() - 0.5) * bd.width * 0.4, h + 1.5, cz + (random() - 0.5) * bd.depth * 0.4,
        8 + random() * 8, 3, 8 + random() * 8, '#3a3f4a');
    }
  }

  // Palm trees.
  for (const palm of city.palms) addPalm(b, palm.x, palm.z, 11 + random() * 5);

  // Street lamps: pole in the static mesh, glowing head in the glow mesh.
  for (const lamp of city.lamps) {
    b.cylinder(lamp.x, 5, lamp.z, 0.5, 10, '#2c303a', 6);
    b.box(lamp.x, 10, lamp.z, 0.4, 0.4, 3.4, '#2c303a');
    g.box(lamp.x, 10.2, lamp.z + 1.6, 1.6, 0.8, 1.6, '#fff2b0');
  }

  // Traffic-light poles at every intersection (heads are drawn per frame).
  for (let ix = 0; ix < CITY.roadsX.length; ix += 1) {
    for (let iz = 0; iz < CITY.roadsZ.length; iz += 1) {
      const rx = CITY.roadsX[ix];
      const rz = CITY.roadsZ[iz];
      b.cylinder(rx + CITY.road / 2 + 4, 4, rz + CITY.road / 2 + 4, 0.5, 8, '#2c303a', 6);
      b.box(rx + CITY.road / 2 + 4, 8.4, rz + CITY.road / 2 + 4, 1.6, 1.6, 1.6, '#1c1f26');
    }
  }

  // The harbor pier and the getaway boat, waiting at the south edge.
  p.box(1805, 0.8, CITY.harborZ + 30, 90, 1.6, 60, '#8a6f5c');
  for (let z = CITY.harborZ + 6; z < CITY.harborZ + 56; z += 8) {
    p.box(1805, 1.7, z, 90, 0.3, 2, '#a8836b');
  }
  p.box(1805, 2.2, CITY.harborZ + 58, 14, 2.4, 34, '#f2f5f7'); // hull
  p.box(1805, 4.6, CITY.harborZ + 52, 9, 2.6, 12, '#37e0d8'); // cabin
  p.box(1805, 6.4, CITY.harborZ + 52, 7, 1.2, 9, '#f2f5f7');

  return { staticMesh: b, glowMesh: g, waterMesh: w, pierMesh: p };
}

/** True when a circle of radius r at (x, z) overlaps a building. */
export function hitsBuilding(city, x, z, r) {
  for (const bd of city.buildings) {
    if (x + r > bd.x && x - r < bd.x + bd.width && z + r > bd.z && z - r < bd.z + bd.depth) return true;
  }
  return false;
}

/** Push a circle out of any building it overlaps; returns true when it moved. */
export function resolveBuildingCollision(city, body, r) {
  let moved = false;
  for (const bd of city.buildings) {
    const cx = Math.max(bd.x, Math.min(body.x, bd.x + bd.width));
    const cz = Math.max(bd.z, Math.min(body.z, bd.z + bd.depth));
    const dx = body.x - cx;
    const dz = body.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 0.01) {
      const d = Math.sqrt(d2);
      body.x = cx + (dx / d) * r;
      body.z = cz + (dz / d) * r;
      moved = true;
    } else if (d2 <= 0.01) {
      body.z = bd.z - r;
      moved = true;
    }
  }
  return moved;
}
