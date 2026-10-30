(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;
  const FONT = 'ui-rounded, "Avenir Next", "Segoe UI", system-ui, sans-serif';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = $('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  const UI = {
    banner: $('banner'),
    bannerTitle: $('bannerTitle'),
    bannerSub: $('bannerSub'),
    toast: $('toast'),
    hint: $('hint'),
    hintText: $('hintText'),
    card: [$('card0'), $('card1')],
    hp: [$('hp0'), $('hp1')],
    hpBar: [$('hpBar0'), $('hpBar1')],
    hpNum: [$('hpNum0'), $('hpNum1')],
    windChip: $('windChip'),
    windArrow: $('windArrow'),
    windVal: $('windVal'),
    roundLabel: $('roundLabel'),
    tiltBtn: $('tiltBtn'),
    tiltLabel: $('tiltLabel'),
    tiltDot: $('tiltDot'),
    helpBtn: $('helpBtn'),
    soundBtn: $('soundBtn'),
    help: $('help'),
    helpClose: $('helpClose'),
    helpCloseX: $('helpCloseX'),
    over: $('over'),
    result: document.querySelector('.result'),
    resultTitle: $('resultTitle'),
    resultSub: $('resultSub'),
    resultEyebrow: $('resultEyebrow'),
    resultCrest: $('resultCrest'),
    statShots: $('statShots'),
    statHits: $('statHits'),
    statAcc: $('statAcc'),
    againBtn: $('againBtn')
  };

  if (ctx && !ctx.roundRect) {
    ctx.roundRect = function (x, y, w, h, r) {
      const radius = typeof r === 'number' ? r : Math.min(w, h) / 2;
      this.moveTo(x + radius, y);
      this.arcTo(x + w, y, x + w, y + h, radius);
      this.arcTo(x + w, y + h, x, y + h, radius);
      this.arcTo(x, y + h, x, y, radius);
      this.arcTo(x, y, x + w, y, radius);
      this.closePath();
      return this;
    };
  }

  let W = 0;
  let H = 0;
  let DPR = 1;
  let S = 1;
  let groundY = 0;
  let gravity = 1500;
  let maxDrag = 190;
  let barrelLength = 42;

  const players = [
    {
      id: 0, name: 'Azure', color: '#63e6ff', facing: 1, x: 0, cannonY: 0,
      hp: 100, aimAngle: 48, aimPower: 0.56, visualAngle: 48, recoil: 0,
      hit: { x: 0, y: 0, w: 0, h: 0 }
    },
    {
      id: 1, name: 'Crimson', color: '#ff7081', facing: -1, x: 0, cannonY: 0,
      hp: 100, aimAngle: 48, aimPower: 0.56, visualAngle: 48, recoil: 0,
      hit: { x: 0, y: 0, w: 0, h: 0 }
    }
  ];

  const game = {
    token: 0,
    time: 0,
    phase: 'aim',
    turn: 0,
    round: 1,
    wind: 0,
    windAccel: 0,
    shots: [0, 0],
    hits: [0, 0],
    projectile: null,
    particles: [],
    texts: [],
    drag: null,
    ai: null,
    shake: 0,
    flash: 0,
    flashColor: '#ffffff',
    over: false,
    winner: null,
    paused: false,
    pausedAt: 0
  };

  const motion = {
    enabled: false,
    gotData: false,
    needsBaseline: true,
    baseline: 0,
    raw: 0,
    target: 0,
    offset: 0
  };

  const scenery = {
    stars: [],
    clouds: [],
    birds: [],
    ridges: [],
    grass: [],
    rocks: [],
    fireflies: []
  };

  const Sound = {
    ctx: null,
    master: null,
    noiseBuffer: null,
    muted: false,
    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = this.muted ? 0 : 0.62;
          this.master.connect(this.ctx.destination);
        } catch {
          return;
        }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    },
    setMuted(value) {
      this.muted = value;
      try { localStorage.setItem('pocketsiege.muted', value ? '1' : '0'); } catch {}
      if (this.master && this.ctx) {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setTargetAtTime(value ? 0 : 0.62, t, 0.02);
      }
    },
    tone({ freq = 440, dur = 0.18, type = 'sine', vol = 0.12, slide = 0, delay = 0 }) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.04);
    },
    noise(dur = 0.35, vol = 0.2, cutoff = 900, delay = 0) {
      if (!this.ctx || this.muted) return;
      if (!this.noiseBuffer) {
        const length = Math.floor(this.ctx.sampleRate * 1.2);
        const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        this.noiseBuffer = buffer;
      }
      const t0 = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, t0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.3), t0 + dur);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter).connect(gain).connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    },
    fire() {
      this.noise(0.2, 0.16, 1500);
      this.tone({ freq: 170, dur: 0.22, type: 'sawtooth', vol: 0.07, slide: -110 });
    },
    boom() {
      this.noise(0.5, 0.3, 520);
      this.tone({ freq: 95, dur: 0.4, type: 'sine', vol: 0.18, slide: -45 });
      this.tone({ freq: 155, dur: 0.24, type: 'triangle', vol: 0.08, slide: -75, delay: 0.02 });
    },
    click() {
      this.tone({ freq: 620, dur: 0.055, type: 'triangle', vol: 0.055 });
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        this.tone({ freq, dur: 0.36, type: 'triangle', vol: 0.1, delay: i * 0.12 });
      });
    },
    lose() {
      [392, 329.63, 261.63].forEach((freq, i) => {
        this.tone({ freq, dur: 0.42, type: 'sine', vol: 0.1, delay: i * 0.15 });
      });
    }
  };

  try { Sound.muted = localStorage.getItem('pocketsiege.muted') === '1'; } catch {}

  function schedule(fn, ms) {
    const token = game.token;
    return window.setTimeout(() => {
      if (token === game.token) fn();
    }, ms);
  }

  function powerSpeed(power) {
    return Math.sqrt(W * gravity * (0.22 + clamp(power, 0, 1) * 1.08));
  }

  function effectivePlayerAngle() {
    return clamp(players[0].aimAngle + (motion.enabled ? motion.offset : 0), 6, 88);
  }

  function muzzlePoint(player, angleDeg) {
    const angle = angleDeg * Math.PI / 180;
    const rot = player.facing === 1 ? -angle : Math.PI + angle;
    const len = barrelLength - player.recoil * 10 * S;
    return {
      x: player.x + Math.cos(rot) * len,
      y: player.cannonY + Math.sin(rot) * len
    };
  }

  function makeRidge(baseY, amplitude, seed) {
    const points = [];
    const count = 20;
    for (let i = 0; i <= count; i++) {
      const x = -W * 0.06 + (i / count) * W * 1.12;
      const n = Math.sin(i * 1.37 + seed) * 0.52 +
        Math.sin(i * 0.63 + seed * 2.1) * 0.31 +
        Math.sin(i * 2.4 + seed * 0.7) * 0.17;
      const h = clamp(0.46 + n * 0.6, 0.08, 1.15);
      points.push({ x, y: baseY - amplitude * h });
    }
    return points;
  }

  function buildScenery() {
    scenery.stars = Array.from({ length: 90 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.72,
      r: rand(0.5, 1.7),
      phase: rand(0, TAU),
      speed: rand(0.4, 1.5)
    }));

    scenery.clouds = Array.from({ length: 6 }, (_, i) => ({
      x: Math.random(),
      y: rand(0.08, 0.52),
      scale: rand(0.55, 1.25),
      speed: rand(3, 9) * (Math.random() < 0.5 ? -1 : 1),
      alpha: rand(0.07, 0.17),
      warm: i % 2 === 0
    }));

    scenery.birds = Array.from({ length: 3 }, () => ({
      x: Math.random(),
      y: rand(0.16, 0.36),
      speed: rand(7, 15),
      scale: rand(0.7, 1.15)
    }));

    scenery.ridges = [
      { points: makeRidge(groundY * 0.71, groundY * 0.2, 1.4), color: '#2b2147', rim: 'rgba(168, 119, 161, .22)' },
      { points: makeRidge(groundY * 0.9, groundY * 0.13, 4.2), color: '#211b39', rim: 'rgba(190, 126, 140, .16)' },
      { points: makeRidge(groundY * 1.02, groundY * 0.07, 8.6), color: '#17142a', rim: 'rgba(255, 173, 120, .08)' }
    ];

    scenery.grass = Array.from({ length: 74 }, () => ({
      x: Math.floor(rand(-30, W + 30)),
      y: rand(groundY + 6, H - 4),
      h: rand(5, 22) * S,
      lean: rand(-4, 4),
      phase: rand(0, TAU),
      shade: rand(0.1, 0.42)
    }));

    scenery.rocks = Array.from({ length: 22 }, () => ({
      x: rand(-10, W + 10),
      y: rand(groundY + 8, H - 10),
      w: rand(3, 14) * S,
      h: rand(2, 7) * S,
      alpha: rand(0.08, 0.22)
    }));

    scenery.fireflies = Array.from({ length: 15 }, () => ({
      x: rand(0.04, 0.96),
      y: rand(0.62, 0.92),
      phase: rand(0, TAU),
      speed: rand(0.3, 0.9),
      size: rand(1, 2.2)
    }));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(280, rect.width || window.innerWidth);
    H = Math.max(320, rect.height || window.innerHeight);
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const aspect = H / W;
    S = H > W
      ? clamp(W / 430, 0.86, 1.32)
      : clamp(Math.min(W / 700, H / 480), 0.8, 1.45);
    groundY = H * clamp(0.8 - 0.09 * clamp(aspect - 1, 0, 1.2), 0.68, 0.82);
    gravity = 1500 * clamp(H / 800, 0.78, 1.28);
    maxDrag = clamp(Math.min(W, H) * 0.47, 116, 460);
    barrelLength = 43 * S;

    players[0].x = W * 0.18;
    players[1].x = W * 0.82;

    for (const p of players) {
      p.cannonY = groundY - 107 * S;
      p.hit = {
        x: p.x - 49 * S,
        y: p.cannonY - 4 * S,
        w: 98 * S,
        h: groundY - p.cannonY + 8 * S
      };
    }

    if (game.wind) game.windAccel = game.wind * gravity * 0.011;
    buildScenery();
  }

  function windAccelFor(wind) {
    return wind * gravity * 0.011;
  }

  function rollWind() {
    game.wind = Math.round(rand(-8, 8));
    if (Math.abs(game.wind) < 2 && Math.random() < 0.55) game.wind = 0;
    game.windAccel = windAccelFor(game.wind);
    updateWindUI();
  }

  function updateWindUI() {
    const wind = game.wind;
    UI.windVal.textContent = wind === 0 ? 'Calm' : String(Math.abs(wind));
    UI.windArrow.style.transform = wind < 0 ? 'rotate(180deg)' : 'rotate(0deg)';
    UI.windChip.classList.toggle('calm', wind === 0);
    UI.windChip.setAttribute('title', wind === 0
      ? 'Calm — no wind this turn'
      : `Wind blowing ${wind > 0 ? 'right' : 'left'} at ${Math.abs(wind)}`);
  }

  function updateHPUI() {
    for (let i = 0; i < 2; i++) {
      const hp = Math.round(players[i].hp);
      UI.hp[i].style.width = `${hp}%`;
      UI.hpNum[i].textContent = String(hp);
      UI.hpBar[i].setAttribute('aria-valuenow', String(hp));
      UI.hpBar[i].classList.toggle('low', hp <= 30);
    }
  }

  function updateTurnUI() {
    players.forEach((p, i) => {
      UI.card[i].classList.toggle('active', !game.over && game.turn === i);
    });
    UI.roundLabel.textContent = `Round ${game.round}`;
  }

  function setHint(text, enemy = false) {
    UI.hintText.textContent = text;
    UI.hint.classList.toggle('enemy', enemy);
  }

  let bannerTimer = 0;
  function showBanner(title, sub, color) {
    UI.bannerTitle.textContent = title;
    UI.bannerSub.textContent = sub;
    UI.banner.style.setProperty('--banner-color', color);
    UI.banner.classList.remove('show');
    void UI.banner.offsetWidth;
    UI.banner.classList.add('show');
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => UI.banner.classList.remove('show'), 1650);
  }

  let toastTimer = 0;
  function toast(text) {
    UI.toast.textContent = text;
    UI.toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => UI.toast.classList.remove('show'), 2900);
  }

  function updateSoundUI() {
    UI.soundBtn.classList.toggle('muted', Sound.muted);
    UI.soundBtn.setAttribute('aria-pressed', String(!Sound.muted));
    UI.soundBtn.setAttribute('aria-label', Sound.muted ? 'Unmute sound' : 'Mute sound');
  }

  function setTiltUI() {
    UI.tiltBtn.setAttribute('aria-pressed', String(motion.enabled));
    UI.tiltBtn.setAttribute('aria-label', motion.enabled ? 'Disable tilt aiming' : 'Enable optional tilt aiming');
    UI.tiltLabel.textContent = motion.enabled ? 'Tilt on' : 'Tilt aim';
  }

  function tiltValue(event) {
    let angle = 0;
    if (screen.orientation && typeof screen.orientation.angle === 'number') angle = screen.orientation.angle;
    else if (typeof window.orientation === 'number') angle = window.orientation;
    angle = ((angle % 360) + 360) % 360;

    if (event.gamma == null && event.beta == null) return null;
    if (angle === 90) return -(event.beta ?? 0);
    if (angle === 270) return event.beta ?? 0;
    return event.gamma ?? 0;
  }

  function onOrientation(event) {
    const value = tiltValue(event);
    if (value == null || !Number.isFinite(value)) return;
    motion.gotData = true;
    if (motion.needsBaseline) {
      motion.baseline = value;
      motion.needsBaseline = false;
    }
    motion.raw = clamp(value - motion.baseline, -38, 38);
    motion.target = motion.raw * 0.82;
  }

  let tiltBusy = false;
  async function toggleTilt() {
    if (tiltBusy) return;
    if (motion.enabled) {
      motion.enabled = false;
      motion.offset = 0;
      motion.target = 0;
      window.removeEventListener('deviceorientation', onOrientation);
      setTiltUI();
      toast('Tilt aim off — drag to aim');
      Sound.click();
      return;
    }

    tiltBusy = true;
    UI.tiltBtn.classList.add('pending');
    try {
      const orient = window.DeviceOrientationEvent;
      const motionEvent = window.DeviceMotionEvent;
      if (!orient && !motionEvent) {
        toast('No motion sensor found — touch aiming works everywhere');
        return;
      }
      if (orient && typeof orient.requestPermission === 'function') {
        const result = await orient.requestPermission();
        if (result !== 'granted') {
          toast('Motion permission denied — drag to aim instead');
          return;
        }
      } else if (!orient && motionEvent && typeof motionEvent.requestPermission === 'function') {
        const result = await motionEvent.requestPermission();
        if (result !== 'granted') {
          toast('Motion permission denied — drag to aim instead');
          return;
        }
      }

      motion.enabled = true;
      motion.gotData = false;
      motion.needsBaseline = true;
      motion.raw = 0;
      motion.target = 0;
      motion.offset = 0;
      window.addEventListener('deviceorientation', onOrientation);
      setTiltUI();
      Sound.click();
      toast('Tilt aim on — tilt your device to fine-tune');
      window.setTimeout(() => {
        if (motion.enabled && !motion.gotData) {
          toast('No motion data on this device — drag to aim');
        }
      }, 1500);
    } catch {
      toast('Motion access unavailable — drag to aim instead');
    } finally {
      tiltBusy = false;
      UI.tiltBtn.classList.remove('pending');
    }
  }

  function openHelp() {
    if (!game.over && !game.paused) {
      game.paused = true;
      game.pausedAt = performance.now();
    }
    UI.help.hidden = false;
    requestAnimationFrame(() => UI.help.classList.add('show'));
    UI.helpClose.focus({ preventScroll: true });
    Sound.click();
  }

  function closeHelp() {
    if (game.paused) {
      const elapsed = performance.now() - game.pausedAt;
      if (game.ai) {
        game.ai.start += elapsed;
        game.ai.fireAt += elapsed;
      }
      game.paused = false;
    }
    UI.help.classList.remove('show');
    window.setTimeout(() => { UI.help.hidden = true; }, 220);
  }

  function simulatePath(origin, angleDeg, power, facing, windAccel, maxTime = 4.5, step = 1 / 60) {
    const angle = angleDeg * Math.PI / 180;
    const speed = powerSpeed(power);
    let x = origin.x;
    let y = origin.y;
    let vx = Math.cos(angle) * speed * facing;
    let vy = -Math.sin(angle) * speed;
    const points = [{ x, y }];
    for (let t = 0; t < maxTime; t += step) {
      vx += windAccel * step;
      vy += gravity * step;
      x += vx * step;
      y += vy * step;
      points.push({ x, y });
      if (y >= groundY + 2 || x < -W * 0.35 || x > W * 1.35) break;
    }
    return points;
  }

  function closestDistanceToRect(points, rect) {
    let best = Infinity;
    for (const p of points) {
      const dx = Math.max(rect.x - p.x, 0, p.x - (rect.x + rect.w));
      const dy = Math.max(rect.y - p.y, 0, p.y - (rect.y + rect.h));
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
    return best;
  }

  function planAI() {
    const shooter = players[1];
    const target = players[0];
    const origin = muzzlePoint(shooter, shooter.visualAngle);
    const angles = [34, 40, 46, 52, 58, 64, 70];
    let best = { d: Infinity, angle: 50, power: 0.55 };
    for (const angle of angles) {
      for (let power = 0.3; power <= 1.001; power += 0.035) {
        const path = simulatePath(origin, angle, power, -1, game.windAccel, 4, 1 / 45);
        const d = closestDistanceToRect(path, target.hit);
        if (d < best.d) best = { d, angle, power };
      }
    }
    const angle = clamp(best.angle + rand(-4.2, 4.2), 20, 80);
    const power = clamp(best.power + rand(-0.14, 0.14), 0.18, 1);
    const now = performance.now();
    game.ai = {
      fromAngle: shooter.visualAngle,
      fromPower: shooter.aimPower,
      angle,
      power,
      start: now,
      fireAt: now + rand(980, 1420),
      fired: false
    };
  }

  function startTurn() {
    game.turn = 1 - game.turn;
    game.phase = game.turn === 0 ? 'aim' : 'ai';
    game.projectile = null;
    game.drag = null;
    game.ai = null;
    rollWind();
    updateTurnUI();

    if (game.turn === 0) {
      setHint('Drag back to aim · release to fire');
      showBanner('Your turn', 'Read the wind · pick your power', players[0].color);
    } else {
      setHint('Crimson is taking aim…', true);
      showBanner('Crimson turn', 'The enemy is lining up a shot', players[1].color);
      planAI();
    }
  }

  function beginMatch() {
    game.over = false;
    game.winner = null;
    game.phase = 'aim';
    game.turn = 0;
    game.projectile = null;
    game.particles = [];
    game.texts = [];
    game.drag = null;
    game.ai = null;
    game.shake = 0;
    game.flash = 0;
    game.shots = [0, 0];
    game.hits = [0, 0];

    for (const p of players) {
      p.hp = 100;
      p.aimAngle = 48;
      p.aimPower = 0.56;
      p.visualAngle = 48;
      p.recoil = 0;
    }

    UI.over.classList.remove('show');
    UI.over.hidden = true;
    rollWind();
    updateHPUI();
    updateTurnUI();
    setHint('Drag back to aim · release to fire');
    showBanner('Your turn', 'Drag back from the cannon · release to fire', players[0].color);
  }

  function resetMatch() {
    game.token++;
    game.round++;
    beginMatch();
    Sound.click();
  }

  function fireShot(player, angle, power) {
    const origin = muzzlePoint(player, angle);
    const a = angle * Math.PI / 180;
    const speed = powerSpeed(power);
    const projectile = {
      owner: player.id,
      x: origin.x,
      y: origin.y,
      vx: Math.cos(a) * speed * player.facing,
      vy: -Math.sin(a) * speed,
      age: 0,
      trail: [{ x: origin.x, y: origin.y }]
    };
    game.projectile = projectile;
    game.shots[player.id]++;
    player.recoil = 1;
    game.phase = 'flying';
    game.drag = null;

    spawnMuzzle(origin.x, origin.y, player.color);
    game.shake = reduceMotion ? 0 : 2.5;
    Sound.fire();
    if (player.id === 0) setHint('Shot away — watch the arc');
    else setHint('Incoming!', true);
  }

  function firePlayer() {
    if (game.phase !== 'aim' || game.turn !== 0 || game.over) return;
    const angle = effectivePlayerAngle();
    players[0].aimAngle = angle;
    fireShot(players[0], angle, clamp(players[0].aimPower, 0.12, 1));
  }

  function fireAI() {
    if (game.phase !== 'ai' || !game.ai || game.over) return;
    const angle = game.ai.angle;
    players[1].aimAngle = angle;
    players[1].aimPower = game.ai.power;
    players[1].visualAngle = angle;
    fireShot(players[1], angle, game.ai.power);
  }

  function addFloatingText(text, x, y, color, size = 18) {
    game.texts.push({
      text,
      x,
      y,
      color,
      size,
      life: 1.1,
      max: 1.1,
      vy: -34 * S
    });
  }

  function spawnMuzzle(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      const speed = rand(25, 160) * S;
      game.particles.push({
        type: 'spark',
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 20,
        life: rand(0.18, 0.55),
        max: 0.55,
        size: rand(1, 3) * S,
        color: Math.random() < 0.5 ? '#fff1be' : color,
        grav: 120 * S,
        drag: 0.93
      });
    }
    game.particles.push({
      type: 'ring',
      x, y,
      life: 0.32,
      max: 0.32,
      size: 3 * S,
      grow: 38 * S,
      color
    });
  }

  function explode(x, y, color, big = true) {
    const count = big ? 46 : 22;
    const palette = ['#fff4c9', '#ffd479', '#ff9d57', '#ff6b4a', color];
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const speed = rand(35, big ? 330 : 190) * S;
      game.particles.push({
        type: 'spark',
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - rand(0, 50) * S,
        life: rand(0.25, big ? 1 : 0.65),
        max: 1,
        size: rand(1.2, big ? 4.2 : 3) * S,
        color: palette[Math.floor(Math.random() * palette.length)],
        grav: 360 * S,
        drag: 0.955
      });
    }
    for (let i = 0; i < (big ? 16 : 8); i++) {
      game.particles.push({
        type: 'smoke',
        x: x + rand(-14, 14) * S,
        y: y + rand(-10, 10) * S,
        vx: rand(-22, 22) * S,
        vy: rand(-48, -12) * S,
        life: rand(0.7, 1.6),
        max: 1.6,
        size: rand(9, 24) * S,
        color: Math.random() < 0.4 ? '#7b6f86' : '#4b435c',
        grav: -8 * S,
        drag: 0.975
      });
    }
    game.particles.push({
      type: 'ring',
      x, y,
      life: 0.5,
      max: 0.5,
      size: 6 * S,
      grow: (big ? 150 : 85) * S,
      color: '#ffd479'
    });
    game.shake = reduceMotion ? 0 : Math.max(game.shake, big ? 11 : 6);
  }

  function spawnDust(x, y, color) {
    for (let i = 0; i < 12; i++) {
      game.particles.push({
        type: 'smoke',
        x: x + rand(-8, 8) * S,
        y: y + rand(-4, 4) * S,
        vx: rand(-45, 45) * S,
        vy: rand(-35, -5) * S,
        life: rand(0.4, 0.9),
        max: 0.9,
        size: rand(4, 11) * S,
        color,
        grav: 30 * S,
        drag: 0.94
      });
    }
  }

  function spawnConfetti() {
    const palette = ['#ffd479', '#63e6ff', '#ff7081', '#9dff9a', '#c4a6ff', '#fff4c9'];
    for (let i = 0; i < 110; i++) {
      game.particles.push({
        type: 'confetti',
        x: rand(0, W),
        y: rand(-H * 0.35, 0),
        vx: rand(-30, 30) * S,
        vy: rand(40, 130) * S,
        life: rand(2.6, 4.2),
        max: 4.2,
        size: rand(2.4, 5.2) * S,
        color: palette[Math.floor(Math.random() * palette.length)],
        grav: 60 * S,
        drag: 0.995,
        rot: rand(0, TAU),
        vr: rand(-7, 7)
      });
    }
  }

  function spawnDamageText(target, damage, direct) {
    addFloatingText(
      `-${Math.round(damage)}`,
      target.x + (target.id === 0 ? -8 : 8) * S,
      target.cannonY - 20 * S,
      direct ? '#ffd479' : '#ffb0a0',
      direct ? 22 : 16
    );
    if (direct) addFloatingText('DIRECT HIT', target.x, target.cannonY - 47 * S, '#fff4c9', 10);
  }

  function resolveImpact(kind, projectile, target) {
    const owner = projectile.owner;
    let damage = 0;
    let direct = false;
    let impactX = projectile.x;
    let impactY = Math.min(projectile.y, groundY);

    if (kind === 'direct') {
      direct = true;
      damage = rand(31, 39);
      impactX = clamp(projectile.x, target.hit.x, target.hit.x + target.hit.w);
      impactY = clamp(projectile.y, target.hit.y, groundY);
    } else if (kind === 'ground') {
      const dx = Math.abs(projectile.x - target.x);
      if (dx < 128 * S) {
        damage = rand(10, 16) * (1 - dx / (170 * S));
        damage = Math.max(6, damage);
      }
    }

    if (kind === 'direct') {
      explode(impactX, impactY, target.color, true);
      Sound.boom();
      game.flash = 0.34;
      game.flashColor = target.id === 0 ? '#ff7081' : '#63e6ff';
    } else if (kind === 'ground') {
      explode(impactX, groundY - 2, '#ffb27a', damage > 0);
      spawnDust(impactX, groundY - 2, '#4a3850');
      Sound.boom();
      game.flash = 0.18;
      game.flashColor = '#ffb27a';
    }

    if (damage > 0) {
      target.hp = Math.max(0, target.hp - damage);
      game.hits[owner]++;
      spawnDamageText(target, damage, direct);
      updateHPUI();
    } else {
      addFloatingText('MISS', impactX, Math.max(impactY - 18 * S, 40), 'rgba(230,240,255,.55)', 13);
    }

    game.projectile = null;
    game.phase = 'settle';

    if (target.hp <= 0) {
      schedule(() => winGame(owner), 720);
      return;
    }

    const hitMessage = direct ? 'Direct hit! The keep is crumbling'
      : damage > 0 ? 'Splash damage — close one'
        : 'Missed — adjust for the wind';
    setHint(owner === 0 ? hitMessage : (direct ? 'Crimson lands a direct hit!' : 'Crimson fires wide'), owner === 1);

    schedule(() => {
      if (game.over) return;
      startTurn();
    }, 980);
  }

  function winGame(winner) {
    if (game.over) return;
    game.over = true;
    game.phase = 'over';
    game.winner = winner;
    game.shake = reduceMotion ? 0 : 12;

    const loser = players[1 - winner];
    explode(loser.x, loser.cannonY - 20 * S, loser.color, true);
    explode(loser.x + rand(-20, 20) * S, groundY - 60 * S, '#ffb27a', true);

    if (winner === 0) {
      showBanner('Victory', 'The Crimson keep has fallen', '#ffd479');
      spawnConfetti();
      Sound.win();
    } else {
      showBanner('Defeat', 'Your keep has fallen', '#ff7081');
      Sound.lose();
    }

    updateTurnUI();
    schedule(showResult, 1250);
  }

  function showResult() {
    const won = game.winner === 0;
    const shots = game.shots[0];
    const hits = game.hits[0];
    UI.resultTitle.textContent = won ? 'Victory' : 'Defeat';
    UI.resultSub.textContent = won ? 'The Crimson keep has fallen.' : 'The Crimson keep stands. Try a new angle.';
    UI.resultEyebrow.textContent = won ? 'Duel complete' : 'Duel lost';
    UI.result.classList.toggle('defeat', !won);
    UI.statShots.textContent = String(shots);
    UI.statHits.textContent = String(hits);
    UI.statAcc.textContent = `${shots ? Math.round(hits / shots * 100) : 0}%`;
    UI.over.hidden = false;
    requestAnimationFrame(() => UI.over.classList.add('show'));
    UI.againBtn.focus({ preventScroll: true });
    if (!won) spawnDust(players[0].x, players[0].cannonY, '#6d5a76');
  }

  function updateProjectile(dt) {
    const p = game.projectile;
    if (!p) return;

    let remaining = dt;
    while (remaining > 0 && game.projectile === p) {
      const step = Math.min(remaining, 1 / 180);
      remaining -= step;

      p.vx += game.windAccel * step;
      p.vy += gravity * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.age += step;

      const target = players[1 - p.owner];
      const r = target.hit;
      const pad = 6 * S;
      if (p.x + pad > r.x && p.x - pad < r.x + r.w && p.y + pad > r.y && p.y - pad < r.y + r.h) {
        resolveImpact('direct', p, target);
        return;
      }
      if (p.y >= groundY) {
        resolveImpact('ground', p, target);
        return;
      }
      if (p.x < -W * 0.4 || p.x > W * 1.4 || p.y > H * 1.25 || p.age > 8) {
        resolveImpact('lost', p, target);
        return;
      }
    }

    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 28) p.trail.shift();
  }

  function updateParticles(dt) {
    for (const p of game.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.grav) p.vy += p.grav * dt;
      if (p.drag) {
        const d = Math.pow(p.drag, dt * 60);
        p.vx *= d;
        p.vy *= d;
      }
      if (p.rot != null) p.rot += (p.vr || 0) * dt;
    }
    if (game.particles.length) game.particles = game.particles.filter((p) => p.life > 0);

    for (const t of game.texts) {
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= Math.pow(0.94, dt * 60);
    }
    if (game.texts.length) game.texts = game.texts.filter((t) => t.life > 0);
  }

  function update(dt, now) {
    game.time += dt;
    if (game.paused) return;

    if (motion.enabled) {
      motion.offset += (motion.target - motion.offset) * (1 - Math.exp(-dt * 7));
    }

    players[0].visualAngle = effectivePlayerAngle();

    if (game.phase === 'ai' && game.ai && !game.ai.fired) {
      const range = Math.max(1, game.ai.fireAt - game.ai.start);
      const t = clamp((now - game.ai.start) / range, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      players[1].aimAngle = lerp(game.ai.fromAngle, game.ai.angle, eased);
      players[1].aimPower = lerp(game.ai.fromPower, game.ai.power, eased);
      players[1].visualAngle = players[1].aimAngle;
      if (t >= 1) {
        game.ai.fired = true;
        fireAI();
      }
    }

    updateProjectile(dt);
    updateParticles(dt);

    for (const p of players) {
      p.recoil = Math.max(0, p.recoil - dt * 4.5);
      if (p.hp > 0 && p.hp < 55 && Math.random() < dt * (p.hp < 25 ? 3.4 : 1.5)) {
        game.particles.push({
          type: 'smoke',
          x: p.x + rand(-20, 20) * S,
          y: groundY - rand(66, 112) * S,
          vx: rand(-7, 7) * S,
          vy: rand(-30, -13) * S,
          life: rand(0.9, 1.8),
          max: 1.8,
          size: rand(6, 15) * S,
          color: '#383346',
          grav: -6 * S,
          drag: 0.99
        });
      }
    }

    game.shake = Math.max(0, game.shake - dt * 32);
    game.flash = Math.max(0, game.flash - dt * 2.8);
  }

  function drawSky(t) {
    const sky = ctx.createLinearGradient(0, 0, 0, groundY + 24);
    sky.addColorStop(0, '#080a1b');
    sky.addColorStop(0.28, '#12132c');
    sky.addColorStop(0.52, '#291f46');
    sky.addColorStop(0.7, '#573052');
    sky.addColorStop(0.85, '#a84f5d');
    sky.addColorStop(1, '#e58a57');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, groundY + 26);

    for (const star of scenery.stars) {
      const alpha = 0.18 + 0.34 * (0.5 + 0.5 * Math.sin(t * star.speed + star.phase));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#dfe9ff';
      ctx.beginPath();
      ctx.arc(star.x * W, star.y * groundY, star.r * S, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const sx = W * 0.73;
    const sy = groundY * 0.47;
    const sr = clamp(Math.min(W, H) * 0.042, 18, 46);

    const glow = ctx.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 7);
    glow.addColorStop(0, 'rgba(255, 228, 170, .5)');
    glow.addColorStop(0.2, 'rgba(255, 175, 108, .2)');
    glow.addColorStop(0.55, 'rgba(255, 130, 96, .07)');
    glow.addColorStop(1, 'rgba(255, 120, 90, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - sr * 7, sy - sr * 7, sr * 14, sr * 14);

    const disc = ctx.createRadialGradient(sx - sr * 0.3, sy - sr * 0.3, sr * 0.1, sx, sy, sr);
    disc.addColorStop(0, '#fff8df');
    disc.addColorStop(0.55, '#ffd58c');
    disc.addColorStop(1, '#ff9d68');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#ffd7a0';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 1.16, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    for (const cloud of scenery.clouds) {
      const span = W + 420;
      let x = ((cloud.x * W + t * cloud.speed * (0.5 + Math.abs(game.wind) * 0.09)) % span + span) % span - 210;
      const y = cloud.y * groundY;
      const s = cloud.scale * S;
      ctx.save();
      ctx.globalAlpha = cloud.alpha;
      ctx.fillStyle = cloud.warm ? '#ffcba6' : '#a99ac6';
      ctx.beginPath();
      ctx.ellipse(x, y, 64 * s, 13 * s, 0, 0, TAU);
      ctx.ellipse(x + 36 * s, y - 8 * s, 40 * s, 12 * s, 0, 0, TAU);
      ctx.ellipse(x - 42 * s, y + 2 * s, 35 * s, 9 * s, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(26, 24, 52, .55)';
    ctx.lineWidth = 1.4;
    for (const bird of scenery.birds) {
      const span = W + 80;
      const x = ((bird.x * W + t * bird.speed) % span + span) % span - 40;
      const y = bird.y * groundY + Math.sin(t * 0.9 + bird.x * 12) * 5;
      const s = bird.scale * S;
      ctx.beginPath();
      ctx.moveTo(x - 4 * s, y);
      ctx.quadraticCurveTo(x - 1.5 * s, y - 2.5 * s, x, y);
      ctx.quadraticCurveTo(x + 1.5 * s, y - 2.5 * s, x + 4 * s, y);
      ctx.stroke();
    }
  }

  function drawRidge(layer) {
    const pts = layer.points;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, H + 20);
    ctx.lineTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.lineTo(pts[pts.length - 1].x, H + 20);
    ctx.closePath();
    ctx.fillStyle = layer.color;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = layer.rim;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function drawScenery(t) {
    for (const layer of scenery.ridges) drawRidge(layer);

    const haze = ctx.createLinearGradient(0, groundY * 0.62, 0, groundY);
    haze.addColorStop(0, 'rgba(255, 142, 110, 0)');
    haze.addColorStop(0.62, 'rgba(255, 142, 110, .045)');
    haze.addColorStop(1, 'rgba(255, 182, 128, .13)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, groundY * 0.62, W, groundY * 0.38 + 2);

    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(W * 0.73, groundY * 0.94, 0, W * 0.73, groundY * 0.94, W * 0.62);
    glow.addColorStop(0, 'rgba(255, 150, 96, .06)');
    glow.addColorStop(0.45, 'rgba(255, 120, 90, .028)');
    glow.addColorStop(1, 'rgba(255, 120, 90, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, groundY * 0.5, W, groundY * 0.5);
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawGround(t) {
    const grad = ctx.createLinearGradient(0, groundY - 6, 0, H);
    grad.addColorStop(0, '#241d3a');
    grad.addColorStop(0.32, '#171329');
    grad.addColorStop(1, '#090812');
    ctx.fillStyle = grad;
    ctx.fillRect(0, groundY - 4, W, H - groundY + 4);

    const rim = ctx.createLinearGradient(0, 0, W, 0);
    rim.addColorStop(0, 'rgba(255, 178, 118, 0)');
    rim.addColorStop(0.28, 'rgba(255, 178, 118, .3)');
    rim.addColorStop(0.5, 'rgba(255, 199, 139, .5)');
    rim.addColorStop(0.72, 'rgba(255, 178, 118, .3)');
    rim.addColorStop(1, 'rgba(255, 178, 118, 0)');
    ctx.fillStyle = rim;
    ctx.fillRect(0, groundY - 1.5, W, 2.2);

    for (const p of players) {
      ctx.save();
      ctx.fillStyle = p.id === 0 ? 'rgba(28, 51, 73, .55)' : 'rgba(65, 28, 44, .5)';
      ctx.beginPath();
      ctx.ellipse(p.x, groundY + 5 * S, 75 * S, 17 * S, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    for (const rock of scenery.rocks) {
      ctx.globalAlpha = rock.alpha;
      ctx.fillStyle = '#9a8cae';
      ctx.beginPath();
      ctx.ellipse(rock.x, rock.y, rock.w, rock.h, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const windLean = clamp(game.wind * 0.55, -5, 5);
    for (const blade of scenery.grass) {
      const sway = Math.sin(t * 1.5 + blade.phase) * (1.2 + Math.abs(game.wind) * 0.28);
      ctx.strokeStyle = `rgba(10, 11, 22, ${blade.shade})`;
      ctx.lineWidth = Math.max(1, 1.2 * S);
      ctx.beginPath();
      ctx.moveTo(blade.x, blade.y);
      ctx.quadraticCurveTo(
        blade.x + (blade.lean + windLean + sway) * 0.5,
        blade.y - blade.h * 0.55,
        blade.x + blade.lean + windLean + sway,
        blade.y - blade.h
      );
      ctx.stroke();
    }

    for (const fly of scenery.fireflies) {
      const x = fly.x * W + Math.sin(t * fly.speed + fly.phase) * 22 * S;
      const y = groundY + (fly.y - 0.62) * (H - groundY) + Math.cos(t * fly.speed * 0.8 + fly.phase) * 12 * S;
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2 + fly.phase));
      const glow = ctx.createRadialGradient(x, y, 0, x, y, fly.size * 5 * S);
      glow.addColorStop(0, `rgba(255, 232, 154, ${a})`);
      glow.addColorStop(1, 'rgba(255, 210, 120, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, fly.size * 5 * S, 0, TAU);
      ctx.fill();
    }
  }

  function drawArchWindow(x, y, w, h, team) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + h);
    ctx.lineTo(x - w / 2, y);
    ctx.arc(x, y, w / 2, Math.PI, 0);
    ctx.lineTo(x + w / 2, y + h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 11, 26, .92)';
    ctx.fill();

    const glow = ctx.createLinearGradient(0, y + h, 0, y);
    glow.addColorStop(0, 'rgba(255, 176, 92, .55)');
    glow.addColorStop(1, 'rgba(255, 214, 140, .06)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.24, y + h - 1);
    ctx.lineTo(x - w * 0.24, y + h * 0.42);
    ctx.arc(x, y + h * 0.42, w * 0.24, Math.PI, 0);
    ctx.lineTo(x + w * 0.24, y + h - 1);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, .08)';
    ctx.lineWidth = Math.max(1, S);
    ctx.stroke();
    ctx.fillStyle = team;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x - w * 0.09, y - w * 0.35, w * 0.18, h * 0.55);
    ctx.globalAlpha = 1;
  }

  function drawCastle(player, t) {
    const s = S;
    const cx = player.x;
    const base = groundY;
    const bodyW = 88 * s;
    const bodyH = 104 * s;
    const top = base - bodyH;
    const azure = player.id === 0;

    const stone = azure
      ? ['#8299d3', '#4c5c88', '#252d4f']
      : ['#c0848f', '#7d4959', '#3c2438'];
    const trim = azure ? 'rgba(99, 230, 255, .55)' : 'rgba(255, 112, 129, .55)';

    ctx.save();
    ctx.fillStyle = 'rgba(5, 6, 16, .5)';
    ctx.beginPath();
    ctx.ellipse(cx, base + 3 * s, bodyW * 0.86, 13 * s, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    for (const side of [-1, 1]) {
      const tw = 23 * s;
      const th = 72 * s;
      const tx = cx + side * bodyW * 0.58;
      const g = ctx.createLinearGradient(tx - tw / 2, base - th, tx + tw / 2, base);
      g.addColorStop(0, stone[1]);
      g.addColorStop(0.6, stone[2]);
      g.addColorStop(1, '#171b31');
      ctx.fillStyle = g;
      ctx.fillRect(tx - tw / 2, base - th, tw, th);
      ctx.fillStyle = stone[2];
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(tx - tw / 2 + i * tw / 3 + tw * 0.05, base - th - 7 * s, tw * 0.24, 8 * s);
      }
      drawArchWindow(tx, base - th * 0.72, tw * 0.36, th * 0.3, player.color);
    }

    const g = ctx.createLinearGradient(cx - bodyW / 2, top, cx + bodyW / 2, base);
    g.addColorStop(0, stone[0]);
    g.addColorStop(0.46, stone[1]);
    g.addColorStop(1, stone[2]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - bodyW / 2, base);
    ctx.lineTo(cx - bodyW / 2, top + 10 * s);
    ctx.lineTo(cx + bodyW / 2, top + 10 * s);
    ctx.lineTo(cx + bodyW / 2, base);
    ctx.closePath();
    ctx.fill();

    const merlonCount = 5;
    const merlonW = bodyW / merlonCount;
    for (let i = 0; i < merlonCount; i++) {
      if (player.hp < 45 && i === 3) continue;
      const mx = cx - bodyW / 2 + i * merlonW + merlonW * 0.11;
      ctx.fillStyle = i % 2 === 0 ? stone[1] : stone[0];
      ctx.fillRect(mx, top, merlonW * 0.64, 12 * s);
      ctx.fillStyle = 'rgba(255, 255, 255, .09)';
      ctx.fillRect(mx, top, merlonW * 0.64, Math.max(1, 1.4 * s));
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - bodyW / 2, top + 10 * s, bodyW, bodyH - 10 * s);
    ctx.clip();

    ctx.strokeStyle = 'rgba(8, 10, 24, .16)';
    ctx.lineWidth = Math.max(0.7, 1.1 * s);
    for (let y = top + 24 * s, row = 0; y < base; y += 13 * s, row++) {
      ctx.beginPath();
      ctx.moveTo(cx - bodyW / 2, y);
      ctx.lineTo(cx + bodyW / 2, y);
      ctx.stroke();
      for (let x = cx - bodyW / 2 + (row % 2 ? 8 * s : 0); x < cx + bodyW / 2; x += 17 * s) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, Math.min(y + 13 * s, base));
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, .08)';
    ctx.lineWidth = Math.max(1, 1.3 * s);
    ctx.beginPath();
    ctx.moveTo(cx - bodyW / 2 + 1, top + 10 * s);
    ctx.lineTo(cx - bodyW / 2 + 1, base);
    ctx.moveTo(cx + bodyW / 2 - 1, top + 10 * s);
    ctx.lineTo(cx + bodyW / 2 - 1, base);
    ctx.stroke();

    const doorW = 19 * s;
    const doorH = 27 * s;
    ctx.beginPath();
    ctx.moveTo(cx - doorW / 2, base);
    ctx.lineTo(cx - doorW / 2, base - doorH + doorW / 2);
    ctx.arc(cx, base - doorH + doorW / 2, doorW / 2, Math.PI, 0);
    ctx.lineTo(cx + doorW / 2, base);
    ctx.closePath();
    ctx.fillStyle = '#101124';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, .1)';
    ctx.stroke();

    drawArchWindow(cx - 19 * s, top + 34 * s, 8 * s, 17 * s, player.color);
    drawArchWindow(cx + 19 * s, top + 34 * s, 8 * s, 17 * s, player.color);
    drawArchWindow(cx, top + 17 * s, 11 * s, 25 * s, player.color);

    if (player.hp < 72) {
      const cracks = [
        [[0.17, 0.26], [0.23, 0.35], [0.19, 0.44], [0.27, 0.55], [0.22, 0.64]],
        [[0.69, 0.33], [0.64, 0.42], [0.7, 0.5], [0.63, 0.61]]
      ];
      const amount = player.hp < 40 ? 2 : 1;
      ctx.strokeStyle = 'rgba(8, 9, 20, .55)';
      ctx.lineWidth = Math.max(1, 1.7 * s);
      for (let c = 0; c < amount; c++) {
        const path = cracks[c];
        ctx.beginPath();
        ctx.moveTo(cx + (path[0][0] - 0.5) * bodyW, top + path[0][1] * bodyH);
        for (let i = 1; i < path.length; i++) {
          ctx.lineTo(cx + (path[i][0] - 0.5) * bodyW, top + path[i][1] * bodyH);
        }
        ctx.stroke();
      }
      if (player.hp < 40) {
        ctx.fillStyle = 'rgba(12, 13, 27, .5)';
        ctx.beginPath();
        ctx.moveTo(cx + bodyW * 0.26, top + bodyH * 0.52);
        ctx.lineTo(cx + bodyW * 0.36, top + bodyH * 0.48);
        ctx.lineTo(cx + bodyW * 0.33, top + bodyH * 0.58);
        ctx.closePath();
        ctx.fill();
      }
    }

    const poleX = cx - player.facing * bodyW * 0.3;
    const poleTop = top - 50 * s;
    ctx.strokeStyle = '#aebbd9';
    ctx.lineWidth = Math.max(1, 1.6 * s);
    ctx.beginPath();
    ctx.moveTo(poleX, top - 2 * s);
    ctx.lineTo(poleX, poleTop);
    ctx.stroke();

    const wave = Math.sin(t * 2.4 + player.id * 1.7) * 4.5 * s + game.wind * 0.35 * s;
    const dir = azure ? -1 : 1;
    const flagW = 27 * s;
    const flagH = 18 * s;
    ctx.beginPath();
    ctx.moveTo(poleX, poleTop);
    ctx.quadraticCurveTo(poleX + dir * flagW * 0.45, poleTop - 2.5 * s + wave, poleX + dir * flagW, poleTop + 3 * s + wave * 0.6);
    ctx.quadraticCurveTo(poleX + dir * flagW * 0.7, poleTop + flagH * 0.6, poleX + dir * flagW * 0.92, poleTop + flagH + wave * 0.4);
    ctx.quadraticCurveTo(poleX + dir * flagW * 0.42, poleTop + flagH * 0.82, poleX, poleTop + flagH * 0.8);
    ctx.closePath();
    const flagGrad = ctx.createLinearGradient(poleX, poleTop, poleX + dir * flagW, poleTop + flagH);
    flagGrad.addColorStop(0, player.color);
    flagGrad.addColorStop(1, azure ? '#1f7ea8' : '#a8324c');
    ctx.fillStyle = flagGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, .24)';
    ctx.lineWidth = Math.max(0.7, s);
    ctx.stroke();

    ctx.fillStyle = 'rgba(9, 13, 30, .55)';
    ctx.beginPath();
    ctx.arc(poleX + dir * flagW * 0.46, poleTop + flagH * 0.4, 3.1 * s, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = trim;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = Math.max(1, 1.4 * s);
    ctx.beginPath();
    ctx.moveTo(cx - bodyW / 2, top + 10 * s);
    ctx.lineTo(cx + bodyW / 2, top + 10 * s);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawWheel(x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#171a2d';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(215, 224, 245, .55)';
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(215, 224, 245, .34)';
    ctx.lineWidth = Math.max(0.8, r * 0.1);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
      ctx.lineTo(-Math.cos(a) * r * 0.78, -Math.sin(a) * r * 0.78);
      ctx.stroke();
    }
    ctx.fillStyle = '#d9e4ff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.17, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawCannon(player, t) {
    const s = S;
    const cx = player.x;
    const cy = player.cannonY;
    const angle = player.visualAngle * Math.PI / 180;
    const rot = player.facing === 1 ? -angle : Math.PI + angle;

    ctx.save();
    ctx.fillStyle = 'rgba(7, 9, 20, .45)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 12 * s, 37 * s, 8 * s, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#2a2233';
    ctx.beginPath();
    ctx.moveTo(cx - 25 * s, cy + 8 * s);
    ctx.lineTo(cx - 18 * s, cy - 2 * s);
    ctx.lineTo(cx + 18 * s, cy - 2 * s);
    ctx.lineTo(cx + 25 * s, cy + 8 * s);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = player.id === 0 ? 'rgba(99, 230, 255, .34)' : 'rgba(255, 112, 129, .34)';
    ctx.fillRect(cx - 15 * s, cy + 2 * s, 30 * s, 3 * s);

    drawWheel(cx - 15 * s, cy + 8 * s, 7.5 * s);
    drawWheel(cx + 15 * s, cy + 8 * s, 7.5 * s);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.translate(-player.recoil * 10 * s, 0);

    const bg = ctx.createLinearGradient(0, -8 * s, 0, 8 * s);
    bg.addColorStop(0, '#d6e0f4');
    bg.addColorStop(0.22, '#94a4c7');
    bg.addColorStop(0.55, '#4d5a7c');
    bg.addColorStop(0.82, '#262d45');
    bg.addColorStop(1, '#101426');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(-6 * s, -8 * s, barrelLength + 6 * s, 16 * s, 7 * s);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, .28)';
    ctx.beginPath();
    ctx.roundRect(2 * s, -6 * s, barrelLength - 12 * s, 2.2 * s, 1 * s);
    ctx.fill();

    ctx.fillStyle = player.id === 0 ? '#2c748f' : '#823a4c';
    ctx.beginPath();
    ctx.roundRect(barrelLength - 7 * s, -9 * s, 8 * s, 18 * s, 3 * s);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, .2)';
    ctx.beginPath();
    ctx.roundRect(barrelLength - 6 * s, -7.5 * s, 2 * s, 14 * s, 1 * s);
    ctx.fill();

    ctx.fillStyle = '#0b0e1d';
    ctx.beginPath();
    ctx.ellipse(barrelLength, 0, 2.6 * s, 6.4 * s, 0, 0, TAU);
    ctx.fill();

    ctx.restore();

    if (player.recoil > 0.08) {
      const a = Math.random() * TAU;
      ctx.globalAlpha = player.recoil * 0.55;
      ctx.fillStyle = '#fff1be';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(rot) * barrelLength, cy + Math.sin(rot) * barrelLength, rand(1, 4) * s, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (game.phase === 'aim' && player.id === 0) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.4);
      ctx.strokeStyle = `rgba(99, 230, 255, ${0.1 + pulse * 0.18})`;
      ctx.lineWidth = Math.max(1, 1.4 * s);
      ctx.beginPath();
      ctx.arc(cx, cy, (27 + pulse * 4) * s, 0.15, Math.PI - 0.15);
      ctx.stroke();
    }
  }

  function drawReticle(x, y, color, scale = 1) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.2, 1.6 * S);
    ctx.beginPath();
    ctx.arc(x, y, 10 * S * scale, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 15 * S * scale, y);
    ctx.lineTo(x - 5 * S * scale, y);
    ctx.moveTo(x + 5 * S * scale, y);
    ctx.lineTo(x + 15 * S * scale, y);
    ctx.moveTo(x, y - 15 * S * scale);
    ctx.lineTo(x, y - 5 * S * scale);
    ctx.moveTo(x, y + 5 * S * scale);
    ctx.lineTo(x, y + 15 * S * scale);
    ctx.stroke();
    ctx.restore();
  }

  function drawAim(t) {
    if (game.phase !== 'aim' || game.turn !== 0 || game.over) return;
    const player = players[0];
    const angle = effectivePlayerAngle();
    const power = player.aimPower;
    const origin = muzzlePoint(player, angle);
    const path = simulatePath(origin, angle, power, 1, game.windAccel, 4.2, 1 / 55);

    const alpha = game.drag ? 1 : 0.5;
    const shown = [];

    for (let i = 4; i < path.length; i += 3) {
      shown.push(path[i]);
    }

    const color = power > 0.72 ? '255, 212, 121' : '99, 230, 255';
    for (let i = 0; i < shown.length; i++) {
      const p = shown[i];
      const ratio = i / Math.max(1, shown.length - 1);
      const a = alpha * (0.78 - ratio * 0.46);
      ctx.fillStyle = `rgba(${color}, ${Math.max(0.08, a)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, lerp(3.3, 1.2, ratio) * S, 0, TAU);
      ctx.fill();
    }

    const target = players[1].hit;
    let hitPoint = null;
    for (const p of path) {
      if (p.x > target.x && p.x < target.x + target.w && p.y > target.y && p.y < target.y + target.h) {
        hitPoint = p;
        break;
      }
    }
    if (hitPoint) {
      drawReticle(hitPoint.x, hitPoint.y, `rgba(255, 212, 121, ${0.55 + (game.drag ? 0.35 : 0)})`, 0.75);
    } else {
      const last = path[path.length - 1];
      if (last.y >= groundY - 3) {
        drawReticle(last.x, Math.min(groundY - 2, last.y), `rgba(99, 230, 255, ${0.45 + (game.drag ? 0.35 : 0)})`, 0.62);
      }
    }

    if (game.drag) {
      const dx = player.x - game.drag.x;
      const dy = game.drag.y - player.cannonY;
      const distance = Math.hypot(dx, dy);
      const pull = clamp(distance / maxDrag, 0, 1);

      ctx.save();
      ctx.strokeStyle = 'rgba(99, 230, 255, .28)';
      ctx.lineWidth = Math.max(1.2, 1.7 * S);
      ctx.setLineDash([3 * S, 6 * S]);
      ctx.beginPath();
      ctx.moveTo(player.x, player.cannonY);
      ctx.lineTo(game.drag.x, game.drag.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const ringX = clamp(game.drag.x, 30 * S, W - 30 * S);
      const ringY = clamp(game.drag.y, 30 * S, H - 30 * S);
      ctx.strokeStyle = power > 0.72 ? '#ffd479' : '#63e6ff';
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(2, 2.6 * S);
      ctx.beginPath();
      ctx.arc(ringX, ringY, 18 * S, -Math.PI / 2, -Math.PI / 2 + pull * TAU);
      ctx.stroke();

      ctx.globalAlpha = 0.32;
      ctx.lineWidth = Math.max(1, 1.2 * S);
      ctx.beginPath();
      ctx.arc(ringX, ringY, 18 * S, 0, TAU);
      ctx.stroke();

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#effcff';
      ctx.font = `800 ${Math.max(9, 10 * S)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(pull * 100)}`, ringX, ringY + 0.5);
      ctx.restore();
    }
  }

  function drawProjectile() {
    const p = game.projectile;
    if (!p) return;

    ctx.save();
    for (let i = 0; i < p.trail.length; i++) {
      const point = p.trail[i];
      const life = i / p.trail.length;
      const alpha = life * 0.38;
      ctx.fillStyle = `rgba(255, 200, 122, ${alpha})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, lerp(1, 4.2, life) * S, 0, TAU);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26 * S);
    glow.addColorStop(0, 'rgba(255, 250, 220, .95)');
    glow.addColorStop(0.22, 'rgba(255, 214, 121, .8)');
    glow.addColorStop(0.55, 'rgba(255, 130, 80, .24)');
    glow.addColorStop(1, 'rgba(255, 110, 70, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26 * S, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#fff9e8';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.2 * S, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of game.particles) {
      const lifeRatio = clamp(p.life / p.max, 0, 1);
      if (p.type === 'spark') {
        ctx.globalAlpha = lifeRatio;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.8, p.size);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
        ctx.stroke();
      } else if (p.type === 'smoke') {
        ctx.globalAlpha = lifeRatio * 0.22;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.2 - lifeRatio * 0.5), 0, TAU);
        ctx.fill();
      } else if (p.type === 'ring') {
        ctx.globalAlpha = lifeRatio * 0.7;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1.2, 2.4 * S * lifeRatio);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + (1 - lifeRatio) * p.grow, 0, TAU);
        ctx.stroke();
      } else if (p.type === 'confetti') {
        ctx.save();
        ctx.globalAlpha = clamp(lifeRatio * 2, 0, 1);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size * 0.6, -p.size * 0.28, p.size * 1.2, p.size * 0.56);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  function drawTexts() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of game.texts) {
      const lifeRatio = clamp(t.life / t.max, 0, 1);
      ctx.globalAlpha = lifeRatio;
      ctx.font = `900 ${t.size * S}px ${FONT}`;
      ctx.fillStyle = t.color;
      ctx.shadowColor = 'rgba(0, 0, 0, .5)';
      ctx.shadowBlur = 8;
      ctx.fillText(t.text, t.x, t.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  function render(t) {
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (game.shake > 0.1 && !reduceMotion) {
      ctx.translate(rand(-game.shake, game.shake) * 0.6, rand(-game.shake, game.shake) * 0.6);
    }

    drawSky(t);
    drawScenery(t);
    drawGround(t);

    drawCastle(players[0], t);
    drawCastle(players[1], t);
    drawCannon(players[0], t);
    drawCannon(players[1], t);
    drawAim(t);
    drawProjectile();
    drawParticles();
    drawTexts();

    ctx.restore();

    if (game.flash > 0.005) {
      ctx.globalAlpha = Math.min(0.5, game.flash);
      ctx.fillStyle = game.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  function updateDragPosition(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const player = players[0];
    const dx = player.x - x;
    const dy = y - player.cannonY;
    const distance = Math.hypot(dx, dy);
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (dx < 0) angle = 88;
    player.aimAngle = clamp(angle, 6, 88);
    player.aimPower = clamp(distance / maxDrag, 0.08, 1);
    game.drag.x = x;
    game.drag.y = y;
  }

  canvas.addEventListener('pointerdown', (event) => {
    Sound.init();
    if (game.phase !== 'aim' || game.turn !== 0 || game.over) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    game.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!game.drag || event.pointerId !== game.drag.id) return;
    event.preventDefault();
    if (!game.drag.moved && Math.hypot(event.clientX - game.drag.startX, event.clientY - game.drag.startY) > 10) {
      game.drag.moved = true;
    }
    if (game.drag.moved) updateDragPosition(event);
  });

  function releaseDrag(event) {
    if (!game.drag || (event && event.pointerId !== game.drag.id)) return;
    const player = players[0];
    const power = player.aimPower;
    const moved = game.drag.moved;
    game.drag = null;
    if (moved && power >= 0.12) {
      firePlayer();
    } else if (moved) {
      player.aimPower = 0.56;
      setHint('Pull farther back for more power');
    } else {
      setHint('Drag back to aim');
    }
  }

  function cancelDrag() {
    if (!game.drag) return;
    game.drag = null;
    players[0].aimPower = 0.56;
  }

  canvas.addEventListener('pointerup', releaseDrag);
  canvas.addEventListener('pointercancel', cancelDrag);
  window.addEventListener('pointerup', (event) => {
    if (game.drag) releaseDrag(event);
  });

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (!UI.help.hidden) {
      if (event.key === 'Escape') closeHelp();
      return;
    }
    if (!UI.over.hidden) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        resetMatch();
      }
      return;
    }
    if (event.key === '?' || event.key === 'h') {
      event.preventDefault();
      openHelp();
      return;
    }
    if (game.phase !== 'aim' || game.turn !== 0 || game.over) return;

    const player = players[0];
    const angleStep = event.shiftKey ? 0.5 : 2;
    const powerStep = event.shiftKey ? 0.01 : 0.03;
    let handled = true;

    if (event.key === 'ArrowUp') player.aimAngle = clamp(player.aimAngle + angleStep, 6, 88);
    else if (event.key === 'ArrowDown') player.aimAngle = clamp(player.aimAngle - angleStep, 6, 88);
    else if (event.key === 'ArrowLeft') player.aimPower = clamp(player.aimPower - powerStep, 0.08, 1);
    else if (event.key === 'ArrowRight') player.aimPower = clamp(player.aimPower + powerStep, 0.08, 1);
    else if (event.key === ' ' || event.key === 'Enter') firePlayer();
    else handled = false;

    if (handled) {
      event.preventDefault();
      Sound.init();
    }
  });

  UI.tiltBtn.addEventListener('click', toggleTilt);

  UI.soundBtn.addEventListener('click', () => {
    Sound.init();
    Sound.setMuted(!Sound.muted);
    updateSoundUI();
    if (!Sound.muted) Sound.click();
  });

  UI.helpBtn.addEventListener('click', openHelp);
  UI.helpClose.addEventListener('click', closeHelp);
  UI.helpCloseX.addEventListener('click', closeHelp);
  UI.help.addEventListener('click', (event) => {
    if (event.target === UI.help) closeHelp();
  });

  UI.againBtn.addEventListener('click', () => {
    Sound.init();
    resetMatch();
  });

  document.addEventListener('pointerdown', () => Sound.init(), { passive: true });
  document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => {
    window.setTimeout(() => {
      resize();
      motion.needsBaseline = true;
      motion.offset = 0;
      motion.target = 0;
    }, 220);
  });

  window.PocketSiege = {
    get state() {
      return {
        phase: game.phase,
        turn: game.turn,
        round: game.round,
        wind: game.wind,
        hp: players.map((p) => Math.round(p.hp)),
        shots: [...game.shots],
        hits: [...game.hits],
        over: game.over,
        tilt: motion.enabled,
        aim: {
          angle: Number(effectivePlayerAngle().toFixed(2)),
          power: Number(players[0].aimPower.toFixed(3)),
          tiltOffset: Number(motion.offset.toFixed(2))
        },
        positions: players.map((p) => ({ x: p.x, y: p.cannonY }))
      };
    },
    fire() { firePlayer(); },
    reset() { resetMatch(); }
  };

  updateSoundUI();
  setTiltUI();
  updateWindUI();
  resize();
  beginMatch();
  updateHPUI();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt, now);
    render(now / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
