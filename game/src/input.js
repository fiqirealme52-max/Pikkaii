// Keyboard and mouse input. Held keys give movement and driving; one-shot
// presses (confirm, pause, enter car, shoot) are queued as bit flags and taken
// once by the loop, so a press between two frames is never lost or counted twice.
// Dragging the mouse orbits the third-person camera; a short click shoots.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;
export const ACTION_SHOOT = 8;
export const ACTION_PUNCH = 16;
export const ACTION_RADIO = 32;
export const ACTION_MUTE = 64;
export const ACTION_CYCLE_WEAPON = 128;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER = new Set(['KeyE']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);
const RADIO = new Set(['KeyR']);
const MUTE = new Set(['KeyM']);
const CYCLE_WEAPON = new Set(['KeyQ']);

export function createInput(target) {
  const held = { up: false, down: false, left: false, right: false, run: false };
  let actions = 0;
  let mouseX = 0;
  let mouseY = 0;
  let mouseDown = false;
  // Camera orbit, in radians: yawOffset around the player, pitch above the horizon.
  let camYawOffset = 0;
  let camPitch = 0.32;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragging = false;
  let dragMoved = false;

  function keyDown(event) {
    if (UP.has(event.code)) held.up = true;
    else if (DOWN.has(event.code)) held.down = true;
    else if (LEFT.has(event.code)) held.left = true;
    else if (RIGHT.has(event.code)) held.right = true;
    else if (RUN.has(event.code)) held.run = true;
    else if (ENTER.has(event.code)) {
      if (!event.repeat) actions |= ACTION_ENTER;
    } else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (RADIO.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RADIO;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else if (CYCLE_WEAPON.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CYCLE_WEAPON;
    } else return;
    event.preventDefault();
  }

  function keyUp(event) {
    if (UP.has(event.code)) held.up = false;
    else if (DOWN.has(event.code)) held.down = false;
    else if (LEFT.has(event.code)) held.left = false;
    else if (RIGHT.has(event.code)) held.right = false;
    else if (RUN.has(event.code)) held.run = false;
  }

  function releaseAll() {
    held.up = false;
    held.down = false;
    held.left = false;
    held.right = false;
    held.run = false;
    mouseDown = false;
    dragging = false;
  }

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', releaseAll);

  target.addEventListener('pointerdown', (event) => {
    mouseDown = true;
    dragging = true;
    dragMoved = false;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
  });
  target.addEventListener('pointerup', () => {
    mouseDown = false;
    if (dragging && !dragMoved) actions |= ACTION_SHOOT | ACTION_CONFIRM;
    dragging = false;
  });
  target.addEventListener('pointermove', (event) => {
    const rect = target.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
    if (dragging) {
      const dx = event.clientX - dragStartX;
      const dy = event.clientY - dragStartY;
      if (Math.abs(dx) + Math.abs(dy) > 8) dragMoved = true;
      if (dragMoved) {
        camYawOffset -= dx * 0.005;
        camPitch = Math.max(0.08, Math.min(1.1, camPitch + dy * 0.003));
        dragStartX = event.clientX;
        dragStartY = event.clientY;
      }
    }
  });

  return {
    /** Normalized -1..1 steering / movement axes from held keys. */
    axes() {
      return {
        x: (held.right ? 1 : 0) - (held.left ? 1 : 0),
        y: (held.down ? 1 : 0) - (held.up ? 1 : 0),
        run: held.run,
        mouseDown,
        mouseX,
        mouseY,
      };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** The camera orbit the player set by dragging. */
    cameraOrbit() {
      return { yawOffset: camYawOffset, pitch: camPitch };
    },
    setCameraOrbit(yawOffset, pitch) {
      camYawOffset = yawOffset;
      camPitch = pitch;
    },
    releaseAll,
  };
}
