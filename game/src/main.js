// Neon Bay — boot and the one loop: input is read every frame, the world
// advances in fixed 1/60 s steps, and the renderer paints what is there. The
// game moves between five screens: title, play, paused, game over and free.
// Progress (money, mission, best haul) is saved to localStorage on every
// mission, every twenty seconds and every pause, and offered back as Continue.
//
// ?seed=N fixes the city and the traffic. ?shot=start|drive|chase|mission (with
// &seed=N) stages that scene instead of running the loop, paints it until the
// camera settles, and sets window.__shotReady for a screenshot.

import { BEST_KEY, SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld, EVENT_BUSTED, EVENT_MISSION_DONE, EVENT_STORY_DONE, EVENT_WASTED,
} from './world.js';
import {
  ACTION_CONFIRM, ACTION_CYCLE_WEAPON, ACTION_ENTER, ACTION_MUTE, ACTION_PAUSE, ACTION_RADIO,
  ACTION_SHOOT, createInput,
} from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;
const SAVE_EVERY_SECONDS = 20;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const audio = createAudio();

function $(id) {
  return document.getElementById(id);
}

const hud = {
  money: $('money'),
  healthFill: $('healthFill'),
  armorFill: $('armorFill'),
  ammo: $('ammo'),
  stars: $('stars'),
  speed: $('speed'),
  clock: $('clock'),
  radio: $('radio'),
  bust: $('bust'),
  bustFill: $('bustFill'),
  minimap: $('minimap'),
  mission: $('mission'),
  missionTitle: $('missionTitle'),
  missionGoal: $('missionGoal'),
  missionTimer: $('missionTimer'),
  missionStage: $('missionStage'),
  toast: $('toast'),
  hint: $('hint'),
  title: $('title'),
  paused: $('paused'),
  over: $('over'),
  win: $('win'),
  district: $('district'),
  districtName: $('districtName'),
  districtStand: $('districtStand'),
  respectFill: $('respectFill'),
  respectText: $('respectText'),
  roster: $('roster'),
  rosterTitle: $('rosterTitle'),
  rosterList: $('rosterList'),
  carinfo: $('carinfo'),
  carName: $('carName'),
  carStats: $('carStats'),
  dialog: $('dialog'),
  dialogFace: $('dialogFace'),
  dialogName: $('dialogName'),
  dialogText: $('dialogText'),
  wheel: $('wheel'),
  radioStation: 'NEON FM — Synthwave',
};

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw);
    if (typeof save.money !== 'number' || typeof save.missionIndex !== 'number') return null;
    return save;
  } catch {
    return null;
  }
}

function writeSave(world) {
  try {
    const save = {
      money: world.state.player.money,
      missionIndex: world.state.mission.index,
      bestMoney: world.state.bestMoney,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Storage can be off (private windows): progress then lasts this visit only.
  }
}

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Ignore.
  }
}

const saved = readSave();
const world = createWorld(createRandom(seed), saved);
const renderer = createRenderer(canvas, hud);

function runShot(name) {
  const scene = stageShot(name, world);
  // Expose the staged world for inspection (screenshots, debugging).
  window.__shotWorld = world;
  window.__shotScene = scene;
  let painted = 0;
  // Paint enough frames for the chase camera to settle behind the player
  // (its yaw and distance smooth a little every frame) before the shot.
  const PAINT_FRAMES = 40;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best);
    painted += 1;
    if (painted < PAINT_FRAMES) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = Math.max(readBest(), saved?.bestMoney ?? 0, world.state.player.money);
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;
  let lastScreen = SCREEN_TITLE;
  let radioMuted = false;

  function announce(message) {
    status.textContent = message;
  }

  function startGame(fresh) {
    if (fresh) {
      world.state.player.money = 250;
      world.state.mission.index = 0;
      world.state.bestMoney = best;
    }
    world.reset();
    accumulator = 0;
    saveTimer = 0;
    screen = SCREEN_PLAY;
    audio.unlock();
    audio.radioOn();
    hud.radioStation = audio.stationName();
    announce(`Playing Neon Bay. Mission: ${world.currentMission()?.title ?? 'Free roam'}.`);
  }

  function endGame(wasted) {
    screen = wasted ? SCREEN_OVER : SCREEN_WIN;
    if (world.state.player.money > best) {
      best = world.state.player.money;
      saveBest(best);
    }
    writeSave(world);
    announce(wasted ? `Wasted. You kept $${world.state.player.money}.` : 'Free at last. Neon Bay is yours.');
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_RADIO) {
      hud.radioStation = audio.nextStation();
      world.state.message = hud.radioStation;
      world.state.messageTimer = 2;
    }
    if (actions & ACTION_MUTE) {
      radioMuted = audio.toggleRadio();
      world.state.message = radioMuted ? 'Radio off' : audio.stationName();
      world.state.messageTimer = 2;
    }
    if (actions & ACTION_CONFIRM) {
      audio.unlock();
      if (screen === SCREEN_TITLE) startGame(false);
      else if (screen === SCREEN_OVER) startGame(false);
      else if (screen === SCREEN_WIN) startGame(false);
      else if (screen === SCREEN_PAUSED) screen = SCREEN_PLAY;
    } else if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        writeSave(world);
        announce('Paused. Progress saved.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    }
    return actions;
  }

  function step(actions) {
    if (screen === SCREEN_TITLE) {
      world.state.orbit = input.cameraOrbit();
      world.step(STEP, { axes: { x: 0, y: 0, run: false }, actions: 0, aimX: 640, aimZ: 360, cameraYaw: 0 }, audio);
      return;
    }
    const axes = input.axes();
    const aim = renderer.aimPoint(axes.mouseX, axes.mouseY) || { x: 0, z: 0 };
    world.state.orbit = input.cameraOrbit();
    const events = world.step(STEP, {
      axes,
      actions: (actions & ACTION_ENTER ? 4 : 0) | (actions & ACTION_SHOOT || axes.mouseDown ? 8 : 0),
      weaponCycle: !!(actions & ACTION_CYCLE_WEAPON),
      aimX: aim.x,
      aimZ: aim.z,
      cameraYaw: renderer.cameraYaw(),
      mouseDown: axes.mouseDown,
    }, audio);
    if (events & EVENT_MISSION_DONE) {
      writeSave(world);
      if (events & EVENT_STORY_DONE) {
        screen = SCREEN_WIN;
        endGame(false);
      }
    }
    if (events & EVENT_WASTED) endGame(true);
    else if (events & EVENT_BUSTED) announce('Busted! Back at the hideout.');
    saveTimer += STEP;
    if (saveTimer >= SAVE_EVERY_SECONDS) {
      saveTimer = 0;
      writeSave(world);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      // One-shot presses belong to the first step of the frame only: at low
      // frame rates a frame runs many steps, and re-feeding E would enter a
      // car and exit it again in the same frame.
      let firstStep = true;
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step(firstStep ? actions : 0);
        firstStep = false;
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    if (screen !== lastScreen) {
      lastScreen = screen;
      if (screen === SCREEN_TITLE) announce('Neon Bay. Press Space or click to start.');
    }
    renderer.draw(world.state, screen, best);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      writeSave(world);
      announce('Paused.');
    }
  });

  // A handle for automated playtests: the world, the screen and the renderer.
  window.__game = {
    world,
    get screen() { return screen; },
    renderer,
    startGame,
  };

  announce(saved && saved.missionIndex > 0
    ? `Neon Bay. Welcome back — mission ${saved.missionIndex + 1} of 5, $${saved.money}. Press Space or click to continue.`
    : 'Neon Bay. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
