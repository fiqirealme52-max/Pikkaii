// Sound, synthesized live with WebAudio: no audio files, no network.
// Engine hum follows speed, the siren wails while the police chase, and every
// action (shot, pickup, mission done) has its own short blip. Everything is
// guarded, so a browser with no audio still plays silently.

export function createAudio() {
  let context = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;
  let sirenHigh = false;

  function ensure() {
    if (context) return context;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      context = new AudioContext();
    } catch {
      context = null;
    }
    return context;
  }

  /** Call from any user gesture: browsers only allow audio after one. */
  function unlock() {
    const ctx = ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function blip(freq, duration, type, volume, slideTo) {
    const ctx = ensure();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
      gain.gain.setValueAtTime(volume || 0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Sound is garnish: never let it break the game.
    }
  }

  return {
    unlock,
    /** A gunshot: a short noise-like burst. */
    shot() { blip(220, 0.12, 'sawtooth', 0.12, 60); },
    /** A punch landing. */
    thud() { blip(90, 0.1, 'sine', 0.14, 50); },
    /** Cash collected. */
    pickup() { blip(880, 0.12, 'sine', 0.09, 1320); },
    /** Mission complete: three rising notes. */
    jingle() {
      blip(523, 0.14, 'sine', 0.1);
      setTimeout(() => blip(659, 0.14, 'sine', 0.1), 120);
      setTimeout(() => blip(784, 0.22, 'sine', 0.1), 240);
    },
    /** The player got hurt. */
    hurt() { blip(160, 0.18, 'sawtooth', 0.12, 70); },
    /** A car door / entering a car. */
    door() { blip(300, 0.08, 'square', 0.06, 180); },

    /** Engine hum: call every frame with speed 0..1 while driving. */
    engine(speed) {
      const ctx = ensure();
      if (!ctx) return;
      try {
        if (!engineOsc) {
          engineOsc = ctx.createOscillator();
          engineGain = ctx.createGain();
          engineOsc.type = 'sawtooth';
          engineOsc.frequency.value = 50;
          engineGain.gain.value = 0;
          engineOsc.connect(engineGain);
          engineGain.connect(ctx.destination);
          engineOsc.start();
        }
        engineOsc.frequency.setTargetAtTime(50 + speed * 140, ctx.currentTime, 0.05);
        engineGain.gain.setTargetAtTime(speed > 0.02 ? 0.03 + speed * 0.03 : 0, ctx.currentTime, 0.1);
      } catch {
        // Ignore.
      }
    },

    /** Police siren: call every frame; pass true while any cop chases. */
    siren(active, dt) {
      const ctx = ensure();
      if (!ctx) return;
      try {
        if (!active) {
          if (sirenGain) sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
          return;
        }
        if (!sirenOsc) {
          sirenOsc = ctx.createOscillator();
          sirenGain = ctx.createGain();
          sirenOsc.type = 'sine';
          sirenOsc.frequency.value = 700;
          sirenGain.gain.value = 0.04;
          sirenOsc.connect(sirenGain);
          sirenGain.connect(ctx.destination);
          sirenOsc.start();
        }
        sirenTimer += dt;
        if (sirenTimer > 0.45) {
          sirenTimer = 0;
          sirenHigh = !sirenHigh;
          sirenOsc.frequency.setTargetAtTime(sirenHigh ? 950 : 650, ctx.currentTime, 0.05);
        }
        sirenGain.gain.setTargetAtTime(0.035, ctx.currentTime, 0.1);
      } catch {
        // Ignore.
      }
    },
  };
}
