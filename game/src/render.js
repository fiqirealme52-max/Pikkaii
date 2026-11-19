// Drawing only: the world's state and the current screen in, pixels out. The
// camera follows the player over the city; the HUD and the minimap are drawn in
// screen space on top. Flat shapes, canvas text and a warm sun-soaked palette.

import { CAR, CITY, DISTRICTS, MISSIONS, PALETTE, PLAYER, VIEW, WORLD } from './config.js';
import { isRoadAt } from './city.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_WIN = 'win';

const MINIMAP = { x: VIEW.width - 216, y: 14, width: 202, height: 146 };

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    view.scale = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
    view.x = (canvas.width - VIEW.width * view.scale) / 2;
    view.y = (canvas.height - VIEW.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align, baseline) {
    const key = `${size}`;
    if (!fonts.has(key)) fonts.set(key, `bold ${size}px ${'system-ui, sans-serif'}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.textBaseline = baseline || 'alphabetic';
    context.fillText(value, x, y);
  }

  function drawGround(state) {
    const city = state.city;
    // Grass base.
    context.fillStyle = PALETTE.grass;
    context.fillRect(0, 0, WORLD.width, CITY.harborY);
    // Mown stripes for a sun-soaked look.
    context.fillStyle = PALETTE.grassDark;
    for (let y = 0; y < CITY.harborY; y += 160) context.fillRect(0, y, WORLD.width, 40);
    // Beach and harbor water along the south edge.
    context.fillStyle = PALETTE.sand;
    context.fillRect(0, CITY.harborY - 26, WORLD.width, 26);
    context.fillStyle = PALETTE.water;
    context.fillRect(0, CITY.harborY, WORLD.width, WORLD.height - CITY.harborY);
    context.fillStyle = PALETTE.waterDeep;
    for (let x = 0; x < WORLD.width; x += 260) {
      context.fillRect(x + 40, CITY.harborY + 40, 120, 10);
      context.fillRect(x + 160, CITY.harborY + 120, 90, 10);
    }
    // Sidewalks, then asphalt, then lane dashes.
    context.fillStyle = PALETTE.sidewalk;
    for (const rx of CITY.roadsX) context.fillRect(rx - CITY.road / 2 - 10, 0, CITY.road + 20, CITY.harborY);
    for (const ry of CITY.roadsY) context.fillRect(0, ry - CITY.road / 2 - 10, WORLD.width, CITY.road + 20);
    context.fillStyle = PALETTE.road;
    for (const rx of CITY.roadsX) context.fillRect(rx - CITY.road / 2, 0, CITY.road, CITY.harborY);
    for (const ry of CITY.roadsY) context.fillRect(0, ry - CITY.road / 2, WORLD.width, CITY.road);
    context.fillStyle = PALETTE.lane;
    for (const rx of CITY.roadsX) {
      for (let y = 0; y < CITY.harborY; y += 64) context.fillRect(rx - 3, y, 6, 30);
    }
    for (const ry of CITY.roadsY) {
      for (let x = 0; x < WORLD.width; x += 64) context.fillRect(x, ry - 3, 30, 6);
    }
    // Parks, lots and buildings.
    for (const park of city.parks) {
      context.fillStyle = '#5d8f43';
      context.fillRect(park.x, park.y, park.width, park.height);
    }
    for (const lot of city.lots) {
      context.fillStyle = '#9a938a';
      context.fillRect(lot.x, lot.y, lot.width, lot.height);
      context.strokeStyle = '#e8e4da';
      context.lineWidth = 3;
      for (let x = lot.x + 30; x < lot.x + lot.width - 20; x += 60) {
        context.beginPath();
        context.moveTo(x, lot.y + 12);
        context.lineTo(x, lot.y + 52);
        context.stroke();
      }
    }
    for (const b of city.buildings) {
      context.fillStyle = b.color;
      context.fillRect(b.x, b.y, b.width, b.height);
      context.fillStyle = b.roof;
      context.fillRect(b.x + 8, b.y + 8, b.width - 16, b.height - 16);
      context.fillStyle = PALETTE.glass;
      for (let wy = b.y + 24; wy < b.y + b.height - 16; wy += 34) {
        for (let wx = b.x + 18; wx < b.x + b.width - 16; wx += 34) {
          context.fillRect(wx, wy, 16, 12);
        }
      }
    }
    for (const palm of city.palms) {
      context.fillStyle = '#6b4a2f';
      context.fillRect(palm.x - 3, palm.y - 3, 6, 6);
      context.fillStyle = '#4e8f3e';
      context.beginPath();
      context.arc(palm.x, palm.y, 14, 0, Math.PI * 2);
      context.fill();
    }
    // District names on the ground.
    for (const d of DISTRICTS) {
      text(d.name, d.x, d.y, 26, 'rgba(16,21,31,0.55)', 'center');
    }
    // The boat at the harbor, waiting for the final escape.
    context.fillStyle = '#f2f5f7';
    context.fillRect(1760, CITY.harborY + 60, 90, 26);
    context.fillStyle = PALETTE.neonCyan;
    context.fillRect(1780, CITY.harborY + 44, 50, 18);
    text('BOAT', 1805, CITY.harborY + 110, 16, '#f2f5f7', 'center');
  }

  function drawCarBody(car) {
    context.save();
    context.translate(car.x, car.y);
    context.rotate(car.angle);
    context.fillStyle = '#1c1f26';
    context.fillRect(-CAR.length / 2 - 3, -CAR.width / 2 - 3, 8, 7);
    context.fillRect(-CAR.length / 2 - 3, CAR.width / 2 - 4, 8, 7);
    context.fillRect(CAR.length / 2 - 5, -CAR.width / 2 - 3, 8, 7);
    context.fillRect(CAR.length / 2 - 5, CAR.width / 2 - 4, 8, 7);
    context.fillStyle = car.color;
    context.fillRect(-CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width);
    context.fillStyle = PALETTE.glass;
    context.fillRect(-6, -CAR.width / 2 + 4, 18, CAR.width - 8);
    context.fillStyle = 'rgba(0,0,0,0.25)';
    context.fillRect(CAR.length / 2 - 12, -CAR.width / 2 + 4, 8, CAR.width - 8);
    if (car.kind === 'police') {
      // A flashing halo, so a police car reads as police at a glance.
      const flash = Math.floor(performance.now() / 250) % 2 === 0;
      context.strokeStyle = flash ? 'rgba(255,59,48,0.7)' : 'rgba(47,109,246,0.7)';
      context.lineWidth = 4;
      context.beginPath();
      context.arc(0, 0, 36, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = flash ? '#ff3b30' : '#2f6df6';
      context.fillRect(-14, -CAR.width / 2 - 2, 12, 5);
      context.fillStyle = flash ? '#2f6df6' : '#ff3b30';
      context.fillRect(2, -CAR.width / 2 - 2, 12, 5);
      text('PD', 0, 5, 13, '#ffffff', 'center', 'middle');
    }
    context.restore();
  }

  function drawPerson(x, y, angle, color, label) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, 11, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(0,0,0,0.4)';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * 18, y + Math.sin(angle) * 18);
    context.stroke();
    if (label) text(label, x, y - 18, 13, '#ffffff', 'center');
  }

  function drawWorld(state) {
    drawGround(state);
    // Cash pickups.
    for (const pickup of state.pickups) {
      if (pickup.taken) continue;
      context.fillStyle = PALETTE.cash;
      context.beginPath();
      context.arc(pickup.x, pickup.y, 13, 0, Math.PI * 2);
      context.fill();
      text('$', pickup.x, pickup.y + 5, 16, '#10330f', 'center');
    }
    // Mission marker: a pulsing pink diamond over the target.
    const target = state.missionTarget;
    if (target) {
      const pulse = 1 + Math.sin(state.time * 4) * 0.15;
      context.save();
      context.translate(target.x, target.y - 30);
      context.scale(pulse, pulse);
      context.rotate(Math.PI / 4);
      context.fillStyle = PALETTE.marker;
      context.fillRect(-13, -13, 26, 26);
      context.restore();
      context.strokeStyle = PALETTE.marker;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(target.x, target.y, 46 + Math.sin(state.time * 4) * 6, 0, Math.PI * 2);
      context.stroke();
      text(target.label || 'GO', target.x, target.y - 52, 18, PALETTE.marker, 'center');
    }
    if (state.mission && state.mission.briefcase) {
      const b = state.mission.briefcase;
      context.fillStyle = '#8a6f5c';
      context.fillRect(b.x - 14, b.y - 10, 28, 20);
      context.fillStyle = PALETTE.neonYellow;
      context.fillRect(b.x - 4, b.y - 14, 8, 6);
    }
    // Vault circle during the heist.
    if (state.mission && state.mission.stage === 'vault') {
      context.strokeStyle = PALETTE.neonYellow;
      context.lineWidth = 4;
      context.beginPath();
      context.arc(3000, 600, 120, 0, Math.PI * 2);
      context.stroke();
      text('CRACKING THE VAULT…', 3000, 600, 20, PALETTE.neonYellow, 'center');
    }
    for (const ped of state.peds) {
      if (ped.dead) {
        context.strokeStyle = ped.color;
        context.lineWidth = 4;
        context.beginPath();
        context.moveTo(ped.x - 10, ped.y - 8);
        context.lineTo(ped.x + 10, ped.y + 8);
        context.moveTo(ped.x + 10, ped.y - 8);
        context.lineTo(ped.x - 10, ped.y + 8);
        context.stroke();
      } else {
        drawPerson(ped.x, ped.y, ped.angle, ped.color);
      }
    }
    for (const rival of state.rivals) {
      if (!rival.alive) continue;
      drawPerson(rival.x, rival.y, 0, '#e5534b', 'RAT');
      context.fillStyle = '#1c1f26';
      context.fillRect(rival.x - 16, rival.y - 30, 32, 6);
      context.fillStyle = '#e5534b';
      context.fillRect(rival.x - 16, rival.y - 30, 32 * (rival.health / 60), 6);
    }
    for (const car of state.cars) {
      if (car.kind === 'player') continue;
      drawCarBody(car);
    }
    const player = state.player;
    if (player.inCar) {
      drawCarBody(player.inCar);
    } else {
      drawPerson(player.x, player.y, player.angle, PALETTE.player, 'RICO');
    }
    for (const bullet of state.bullets) {
      context.fillStyle = '#ffd23e';
      context.beginPath();
      context.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
      context.fill();
    }
    for (const p of state.particles) {
      context.globalAlpha = Math.max(0, p.life * 2);
      context.fillStyle = p.color;
      context.fillRect(p.x - 3, p.y - 3, 6, 6);
      context.globalAlpha = 1;
    }
  }

  function drawMinimap(state) {
    const m = MINIMAP;
    const sx = m.width / WORLD.width;
    const sy = m.height / CITY.harborY;
    context.fillStyle = 'rgba(16,21,31,0.85)';
    context.fillRect(m.x - 6, m.y - 6, m.width + 12, m.height + 12);
    context.fillStyle = '#5d8f43';
    context.fillRect(m.x, m.y, m.width, m.height);
    context.fillStyle = PALETTE.water;
    context.fillRect(m.x, m.y + CITY.harborY * sy - 8, m.width, 8);
    context.strokeStyle = '#3a3f4a';
    context.lineWidth = 3;
    for (const rx of CITY.roadsX) {
      context.beginPath();
      context.moveTo(m.x + rx * sx, m.y);
      context.lineTo(m.x + rx * sx, m.y + m.height);
      context.stroke();
    }
    for (const ry of CITY.roadsY) {
      context.beginPath();
      context.moveTo(m.x, m.y + ry * sy);
      context.lineTo(m.x + m.width, m.y + ry * sy);
      context.stroke();
    }
    const dot = (x, y, color, size) => {
      context.fillStyle = color;
      context.fillRect(m.x + x * sx - size / 2, m.y + y * sy - size / 2, size, size);
    };
    for (const car of state.cars) {
      if (car.kind === 'police') dot(car.x, car.y, '#2f6df6', 6);
      else if (car.kind === 'traffic') dot(car.x, car.y, '#e8e4da', 3);
    }
    const target = state.missionTarget;
    if (target) dot(target.x, target.y, PALETTE.marker, 9);
    dot(state.player.x, state.player.y, PALETTE.player, 8);
    context.strokeStyle = 'rgba(255,255,255,0.5)';
    context.lineWidth = 2;
    const vx = (state.camera.x - VIEW.width / 2) * sx;
    const vy = (state.camera.y - VIEW.height / 2) * sy;
    context.strokeRect(m.x + vx, m.y + vy, VIEW.width * sx, VIEW.height * sy);
    text('NEON BAY', m.x + m.width / 2, m.y + m.height + 18, 13, PALETTE.hudText, 'center');
  }

  function drawHud(state, best) {
    const player = state.player;
    const mission = MISSIONS[state.mission.index] || null;
    context.fillStyle = 'rgba(16,21,31,0.82)';
    context.fillRect(0, 0, VIEW.width, 54);
    // Health.
    text('RICO VALE', 16, 20, 16, PALETTE.hudText, 'left', 'top');
    context.fillStyle = '#3a3f4a';
    context.fillRect(16, 34, 180, 12);
    context.fillStyle = player.health > 30 ? '#7ee081' : '#ff5a5a';
    context.fillRect(16, 34, 180 * (player.health / 100), 12);
    // Money, ammo, speed.
    text(`$${player.money}`, 220, 20, 22, '#7ee081', 'left', 'top');
    text(player.inCar ? `SPEED ${Math.round(Math.abs(player.inCar.speed) * 0.12)} mph` : 'ON FOOT', 220, 40, 14, PALETTE.hudMuted, 'left', 'top');
    text(`AMMO ${player.ammo}`, 380, 20, 18, PALETTE.hudText, 'left', 'top');
    text(`BEST $${Math.max(best, player.money)}`, 380, 40, 14, PALETTE.hudMuted, 'left', 'top');
    // Wanted stars: centred, clear of the minimap at the top right.
    const starX = 560;
    text('WANTED', starX, 20, 16, PALETTE.hudMuted, 'left', 'top');
    for (let i = 0; i < 5; i += 1) {
      text('★', starX + 84 + i * 26, 26, 24, i < player.wanted ? PALETTE.star : '#3a3f4a', 'left', 'top');
    }
    if (player.bustTimer > 0) {
      context.fillStyle = '#3a3f4a';
      context.fillRect(starX, 40, 130, 8);
      context.fillStyle = '#ff5a5a';
      context.fillRect(starX, 40, 130 * (player.bustTimer / 1.6), 8);
      text('BUSTED?', starX + 140, 44, 13, '#ff5a5a', 'left', 'top');
    }
    drawMinimap(state);
    // Mission banner.
    if (mission && !state.storyDone) {
      context.fillStyle = 'rgba(16,21,31,0.82)';
      context.fillRect(16, VIEW.height - 64, 760, 48);
      context.fillStyle = PALETTE.neonPink;
      context.fillRect(16, VIEW.height - 64, 6, 48);
      text(mission.title, 36, VIEW.height - 48, 17, PALETTE.neonPink, 'left', 'top');
      text(mission.goal, 36, VIEW.height - 28, 15, PALETTE.hudText, 'left', 'top');
      if (mission.kind === 'deliver' && state.mission) {
        text(`TIME ${Math.max(0, Math.ceil(state.mission.timer))}s`, 700, VIEW.height - 48, 17, PALETTE.neonYellow, 'left', 'top');
      }
      if (mission.kind === 'heist' && state.mission && state.mission.stage === 'vault') {
        text(`VAULT ${Math.max(0, Math.ceil(state.mission.vaultTimer))}s`, 700, VIEW.height - 48, 17, PALETTE.neonYellow, 'left', 'top');
      }
    }
    // Toast message.
    if (state.messageTimer > 0 && state.message) {
      context.fillStyle = 'rgba(16,21,31,0.85)';
      const w = Math.min(900, 40 + state.message.length * 8);
      context.fillRect((VIEW.width - w) / 2, 66, w, 34);
      text(state.message, VIEW.width / 2, 88, 16, PALETTE.hudText, 'center');
    }
    // Controls hint, first seconds only.
    if (state.time < 14) {
      text('WASD move / drive  •  E enter car  •  Click shoot  •  P pause  •  Missions pay, cops cost', VIEW.width / 2, VIEW.height - 76, 14, 'rgba(242,245,247,0.75)', 'center');
    }
  }

  function drawPanel(title, lines, prompt) {
    const width = 680;
    const height = 150 + lines.length * 34;
    const x = (VIEW.width - width) / 2;
    const y = (VIEW.height - height) / 2;
    context.fillStyle = 'rgba(16,21,31,0.94)';
    context.fillRect(x, y, width, height);
    context.fillStyle = PALETTE.neonPink;
    context.fillRect(x, y, width, 6);
    text(title, VIEW.width / 2, y + 62, 46, PALETTE.neonCyan, 'center');
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], VIEW.width / 2, y + 108 + i * 34, 19, PALETTE.hudText, 'center');
    }
    text(prompt, VIEW.width / 2, y + height - 30, 20, PALETTE.neonYellow, 'center');
  }

  /** Paint one frame: the world through the camera, then the HUD or a panel. */
  function draw(state, screen, best) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const camX = state.camera.x - VIEW.width / 2;
    const camY = state.camera.y - VIEW.height / 2;
    context.setTransform(view.scale, 0, 0, view.scale, view.x - camX * view.scale, view.y - camY * view.scale);
    drawWorld(state);
    // Back to screen space for HUD and panels.
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    if (screen === SCREEN_TITLE) {
      drawPanel('NEON BAY', [
        'Rico Vale owes Marina Kessler $40,000 — and Neon Bay always collects.',
        'Steal cars, run jobs, dodge the cops. Five missions. One way out.',
        'WASD move & drive  •  E enter a car  •  Click to shoot  •  P pause',
        `Best haul so far: $${best}`,
      ], 'Press Space or click to start');
      return;
    }
    drawHud(state, best);
    if (screen === SCREEN_PAUSED) {
      drawPanel('PAUSED', ['The city waits. Your save is safe.', 'Missions and money are kept in this browser.'], 'Press P to keep playing');
    } else if (screen === SCREEN_OVER) {
      drawPanel('WASTED', [`Rico went down in Neon Bay.`, `You kept $${state.player.money} — the debt is still there.`], 'Press Space to try again');
    } else if (screen === SCREEN_WIN) {
      drawPanel('FREE AT LAST', ['All five jobs done. The boat is waiting at the harbor.', `Final haul: $${state.player.money}. Neon Bay is yours now.`], 'Press Space to keep cruising');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, view };
}
