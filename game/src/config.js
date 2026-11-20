// Neon Bay — every tuning number, colour and mission in one place.
// A 3D open world: a 3600 x 2600 city (x east, z south, y up) the camera
// follows in third person through a 1280x720 viewport. Nothing here depends
// on the window size.

export const STEP = 1 / 60;

export const VIEW = { width: 1280, height: 720 };

/**
 * The 32-bit (PS1-era) look: the 3D scene is rendered into a low-resolution
 * framebuffer and upscaled with nearest-neighbour filtering, vertices snap
 * to the low-res pixel grid (the classic wobble), and colours are quantised
 * to 15-bit with ordered dithering. The DOM HUD stays crisp on top, like a
 * PS1 game's HUD. Toggle `enabled` off to get the smooth render back.
 */
export const RETRO = {
  enabled: true,
  /** Internal render width in pixels; height follows the canvas aspect. */
  width: 320,
  /** Colour levels per channel (32 = PS1's 15-bit colour). */
  levels: 32,
  /** 1 = ordered 2x2 Bayer dither on the upscale, 0 = plain quantisation. */
  dither: 1,
};

export const WORLD = { width: 3600, depth: 2600 };

/** The city grid: roads run every BLOCK+ROAD units; blocks hold buildings, parks and lots. */
export const CITY = {
  road: 96,
  block: 304,
  /** Roads are centred on these x / z lines. */
  roadsX: [200, 600, 1000, 1400, 1800, 2200, 2600, 3000, 3400],
  roadsZ: [200, 600, 1000, 1400, 1800, 2200],
  harborZ: 2400,
};

/** One full day/night cycle, in seconds. The game opens at golden hour. */
export const DAY_LENGTH = 240;
export const CLOCK_START = 0;

/** On foot: run speed, health, and the punch/shoot reach. */
export const PLAYER = {
  radius: 3,
  walkSpeed: 11,
  runSpeed: 16,
  health: 100,
  armor: 50,
  punchRange: 3.2,
  punchDamage: 25,
  shootDamage: 34,
  fireInterval: 0.22,
  ammoStart: 24,
  maxAmmo: 120,
};

/** Cars: parked, traffic and police share one body model. Length is along the heading. */
export const CAR = {
  length: 7.2,
  width: 3.4,
  height: 1.9,
  accel: 26,
  brake: 42,
  reverseAccel: 14,
  maxSpeed: 38,
  maxReverse: 11,
  turnRate: 2.4,
  grip: 3.2,
  health: 100,
};

export const POLICE = {
  maxSpeed: 34,
  accel: 30,
  bustTime: 1.6,
  spawnDistance: 90,
  /** Beyond this distance a cop loses the trail and stops chasing. */
  loseTrackDistance: 120,
};

export const HELI = {
  height: 55,
  orbitRadius: 60,
  speed: 0.35,
};

/** Wanted stars 0-5; each crime adds heat, hiding cools it down. */
export const WANTED = {
  stealCar: 1,
  hitPedestrian: 1,
  shoot: 1,
  killCop: 2,
  decaySeconds: 12,
  max: 5,
};

/** Cash pickups and mission rewards, in dollars. */
export const ECONOMY = { startMoney: 250, pickupValue: 60, bustFine: 150 };

/**
 * The story: Rico Vale, a courier who owes the club owner Marina Kessler $40,000,
 * works it off one job at a time across Neon Bay. Missions run in order; each one
 * names its goal, its marker, its reward and its opening line.
 */
export const MISSIONS = [
  {
    id: 'first-wheels',
    title: '1 — First Wheels',
    goal: 'Steal any parked car (walk up to it, press E) and drive to the paint shop',
    briefing: 'Marina: "You need wheels, Rico. Borrow one. The paint shop on Coral Ave will make it yours."',
    target: { x: 1400, z: 200, label: 'Paint shop' },
    kind: 'steal-and-drive',
    reward: 300,
  },
  {
    id: 'pizza-run',
    title: '2 — Pizza Run',
    goal: 'Deliver 3 parcels to the glowing markers before the timer runs out',
    briefing: 'Marina: "Three parcels, three doors, no questions. The clock is already running."',
    target: { x: 2600, z: 1000, label: 'Delivery' },
    kind: 'deliver',
    deliveries: 3,
    timeLimit: 150,
    reward: 500,
  },
  {
    id: 'harbor-heat',
    title: '3 — Harbor Heat',
    goal: 'Go to the harbor, deal with the 4 Dock Rats, grab the briefcase, bring it home',
    briefing: 'Marina: "The Rats took my briefcase at the harbor. Get it back. Loud is fine."',
    target: { x: 1800, z: 2400, label: 'Harbor' },
    kind: 'fight-and-fetch',
    rivals: 4,
    reward: 800,
  },
  {
    id: 'getaway',
    title: '4 — Getaway',
    goal: 'The cops are on you. Lose the heat (3 stars) and reach the hideout',
    briefing: 'Marina: "You tripped every alarm in the city. Lose them, then come home."',
    target: { x: 600, z: 600, label: 'Hideout' },
    kind: 'escape',
    reward: 700,
  },
  {
    id: 'big-score',
    title: '5 — The Big Score',
    goal: 'Rob the Neon Bay bank vault, grab the cash, escape to the boat at the harbor',
    briefing: 'Marina: "Last job, Rico. The bank vault, then the boat. After this, you are free."',
    target: { x: 3000, z: 600, label: 'Bank' },
    kind: 'heist',
    reward: 2000,
  },
];

/** Districts and landmarks, drawn on the map and the minimap. */
export const DISTRICTS = [
  { name: 'CORAL AVE', x: 1400, z: 130 },
  { name: 'PALM ROW', x: 600, z: 530 },
  { name: 'DOWNTOWN', x: 2200, z: 930 },
  { name: 'OLD PORT', x: 1000, z: 1930 },
  { name: 'NEON STRIP', x: 2600, z: 1730 },
  { name: 'HARBOR', x: 1800, z: 2470 },
];

export const PALETTE = {
  backdrop: '#0e1420',
  grass: '#7fae5a',
  grassDark: '#6f9c4c',
  sand: '#e8d29a',
  water: '#2e7f9e',
  waterDeep: '#256b87',
  road: '#3a3f4a',
  roadEdge: '#2c303a',
  lane: '#e8d44d',
  sidewalk: '#b9b3a4',
  building: '#8a6f5c',
  buildingRoof: '#a8836b',
  glass: '#7fc4d8',
  neonPink: '#ff4d9d',
  neonCyan: '#37e0d8',
  neonYellow: '#ffd23e',
  player: '#37e0d8',
  playerDark: '#1d9e97',
  police: '#2f6df6',
  policeLight: '#ff3b30',
  traffic: '#e8e4da',
  ped: '#f2c94c',
  rival: '#e5534b',
  cash: '#7ee081',
  health: '#ff5a5a',
  hud: '#10151f',
  hudText: '#f2f5f7',
  hudMuted: '#9aa5b1',
  star: '#ffd23e',
  marker: '#ff4d9d',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the save lives between visits (this browser only). */
export const SAVE_KEY = 'neon-bay.save.v1';
export const BEST_KEY = 'neon-bay.best.v1';
