// Neon Bay — the dense HUD systems: police roster, crew dialogue, district
// standing, respect, the weapon wheel, radio tracks, car identity and the
// day counter. This module only READS world state and computes what the HUD
// shows; it never mutates the simulation, so the game rules stay untouched.

import { DISTRICTS } from './config.js';

/** Police callsign pool: each cop that spawns takes the next free one. */
export const POLICE_CALLSIGNS = [
  'PELICAN-11', 'TAC-45', 'VIPER-22', 'FALCON-08',
  'RAMMER-31', 'COBRA-19', 'HAWK-07', 'BULLDOG-52',
];

/** Roles a ground unit can hold while chasing. */
export const POLICE_ROLES = ['PURSUE', 'RAMMING', 'ROADBLOCK', 'CUT-OFF'];

/** The crew: who talks, what colour their portrait is, their role. */
export const CREW = {
  marina: { name: 'MARINA KESSLER', role: 'THE BOSS', color: '#ff4d9d', initial: 'M' },
  rico: { name: 'RICO VALE', role: 'THE DRIVER', color: '#37e0d8', initial: 'R' },
  marco: { name: 'MARCO "WRENCH" DIALLO', role: 'THE FIXER', color: '#ffd23e', initial: 'W' },
  mira: { name: 'MIRA KESANG', role: 'THE INSIDER', color: '#b388ff', initial: 'K' },
};

/** Weapon wheel: five named slots. Only the pistol is open at the start;
 * the rest unlock with respect (see RESPECT in config). */
export const WEAPONS = [
  { id: 'fists', name: 'FISTS', price: 0, ammo: '∞', damage: 'LOW' },
  { id: 'vesper', name: 'VESPER 9MM', price: 0, ammo: 'AMMO', damage: 'MED' },
  { id: 'mako', name: 'MAKO SMG', price: 1200, ammo: 'AMMO', damage: 'HIGH' },
  { id: 'breaker', name: 'BREAKER 12G', price: 3800, ammo: 'AMMO', damage: 'MAX' },
  { id: 'kestrel', name: 'KESTREL RIFLE', price: 6500, ammo: 'AMMO', damage: 'MAX' },
];

/** Radio tracks: the station name plus the song playing on it. */
export const RADIO_TRACKS = {
  'NEON FM — Synthwave': ['Midnight Overdrive — Vector Nine', 'Chrome Hearts — Laser Palms', 'Sunset Run — Night Drive'],
  'PALM RADIO — Chill': ['Slow Tide — Coral Keys', 'Palm Shadows — The Drifters', 'Golden Hour — Marisol'],
  'HARBOR BEATS — Drive': ['Dockside Hustle — Big Tuna', 'Neon Mile — V8 Soul', 'Harbor Lights — The Breakers'],
};

/** Car models: a parked/traffic car gets a name from its colour + kind. */
/** Car models: a parked/traffic car gets a name from its colour + kind. */
const CAR_MODELS = ['VELOZ COMET RS', 'STRADA GT', 'MARLIN COUPE', 'DELTA SEDAN', 'CORSA HATCH', 'BUCCANEER 4X4'];

export function carModelName(car) {
  const seed = ((car.id * 2654435761) >>> 0);
  return CAR_MODELS[seed % CAR_MODELS.length];
}

/** The district the player is standing in right now. */
export function districtAt(x, z) {
  let best = DISTRICTS[0];
  let bestD = Infinity;
  for (const d of DISTRICTS) {
    const dd = (x - d.x) ** 2 + (z - d.z) ** 2;
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return best;
}

/**
 * The police roster for the HUD: every live police unit, bound to a real
 * car or the helicopter, with callsign, role and live distance in metres.
 * Sorted nearest first; the header code rises with the wanted level.
 */
export function policeRoster(state) {
  const px = state.player.inCar ? state.player.inCar.x : state.player.x;
  const pz = state.player.inCar ? state.player.inCar.z : state.player.z;
  const units = [];
  for (const car of state.cars) {
    if (car.kind !== 'police' && car.kind !== 'roadblock') continue;
    const d = Math.hypot(car.x - px, car.z - pz);
    units.push({
      callsign: car.callsign || 'PCPD-??',
      role: car.role || (car.kind === 'roadblock' ? 'ROADBLOCK' : 'PURSUE'),
      dist: Math.round(d),
      lost: !!car.lost,
      kind: car.kind,
    });
  }
  if (state.heli.active) {
    const d = Math.hypot(state.heli.x - px, state.heli.z - pz);
    units.push({ callsign: 'AIR-1', role: 'SPOTLIGHT', dist: Math.round(d), lost: false, kind: 'heli' });
  }
  units.sort((a, b) => a.dist - b.dist);
  const code = state.player.wanted >= 4 ? 'CODE 4' : state.player.wanted >= 3 ? 'CODE 3' : state.player.wanted >= 2 ? 'CODE 2' : 'CODE 1';
  return { units, code, count: units.length };
}

/** Mission card presentation: chapter, stage and the live countdown. */
export function missionCard(state, missionDef) {
  if (!missionDef || state.storyDone) return null;
  const m = state.mission;
  const stages = {
    'steal-and-drive': m.stage === 'drive' ? ['STEAL THE CAR', 'DRIVE TO THE PAINT SHOP'] : ['STEAL THE CAR', 'DRIVE TO THE PAINT SHOP'],
    deliver: ['PICK UP PARCEL 1', 'PICK UP PARCEL 2', 'PICK UP PARCEL 3'],
    'fight-and-fetch': ['REACH THE HARBOR', 'DEAL WITH THE DOCK RATS', 'GRAB THE BRIEFCASE', 'BRING IT HOME'],
    escape: ['LOSE THE HEAT', 'REACH THE HIDEOUT'],
    heist: ['REACH THE BANK', 'CRACK THE VAULT', 'ESCAPE TO THE BOAT'],
  };
  const list = stages[missionDef.kind] || ['COMPLETE THE JOB'];
  let done = 0;
  if (missionDef.kind === 'steal-and-drive') done = m.stage === 'drive' ? 1 : 0;
  else if (missionDef.kind === 'deliver') done = m.deliveryIndex;
  else if (missionDef.kind === 'fight-and-fetch') {
    done = m.stage === 'return' ? 3 : m.briefcase ? 2 : (m.rivalsSpawned ? 1 : 0);
  } else if (missionDef.kind === 'escape') done = 0;
  else if (missionDef.kind === 'heist') {
    done = m.stage === 'vault' ? 1 : m.stage === 'run' ? 2 : 0;
  }
  const stageLabel = list[Math.min(done, list.length - 1)];
  let timer = '';
  if (missionDef.kind === 'deliver' && m.timer > 0) timer = `${Math.max(0, Math.ceil(m.timer))}s`;
  if (missionDef.kind === 'heist' && m.stage === 'vault') timer = `${Math.max(0, Math.ceil(m.vaultTimer))}s`;
  return {
    chapter: `CH.${state.mission.index + 1} / 5`,
    stage: `STAGE ${Math.min(done + 1, list.length)} / ${list.length}`,
    stageLabel,
    timer,
  };
}

/** Respect rank name for a respect value 0..550. */
export function respectRank(respect) {
  if (respect >= 500) return 'LEGEND';
  if (respect >= 350) return 'KINGPIN';
  if (respect >= 220) return 'MADE';
  if (respect >= 120) return 'HUSTLER';
  if (respect >= 50) return 'RUNNER';
  return 'NOBODY';
}

/** District standing label for a standing value 0..100. */
export function standingLabel(standing) {
  if (standing >= 80) return 'RESPECTED';
  if (standing >= 60) return 'FRIENDLY';
  if (standing >= 40) return 'NEUTRAL';
  if (standing >= 20) return 'COLD';
  return 'HOSTILE';
}
