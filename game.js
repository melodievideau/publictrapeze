'use strict';

const Physics = {
  stepSwing(s, dt, o) {
    let acc = -(o.g / o.L) * Math.sin(s.theta) - o.damping * s.omega;
    if (o.holding) acc += o.pump * Math.tanh(s.omega * 2);
    s.omega += acc * dt;
    s.theta += s.omega * dt;
    return s;
  },
  bobPos(pivot, L, theta) {
    return { x: pivot.x + L * Math.sin(theta), y: pivot.y + L * Math.cos(theta) };
  },
  bobVel(L, theta, omega) {
    return { x: L * omega * Math.cos(theta), y: -L * omega * Math.sin(theta) };
  },
  speedAtAngle(L, g, theta, A) {
    const v2 = 2 * g * L * (Math.cos(theta) - Math.cos(A));
    return v2 > 0 ? Math.sqrt(v2) : 0;
  },
  maxRange(L, g, A) {
    let best = 0;
    for (let th = 0.02; th < A; th += 0.004) {
      const v = Physics.speedAtAngle(L, g, th, A);
      const r = (v * v / g) * Math.sin(2 * th);
      if (r > best) best = r;
    }
    return best;
  },
  placeNext(pivot, L, g, A, f, dy, grow) {
    const range = Physics.maxRange(L, g, A);
    const frac = Math.min(0.78 + 0.14 * f + (grow || 0), 0.97);
    const d = range * frac;
    const yOff = dy !== undefined ? dy : Math.random() * 50 - 20;
    return { x: pivot.x + d, y: pivot.y + yOff };
  },
  attach(pivot, L, x, y, vx, vy) {
    const dx = x - pivot.x, dy = y - pivot.y;
    const theta = Math.atan2(dx, dy);
    const omega = (vx * Math.cos(theta) - vy * Math.sin(theta)) / L;
    return { theta, omega };
  },
  stepProjectile(p, dt, g) {
    p.vy += g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return p;
  },
  pointSegDist(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby)));
    const cx = a.x + abx * t, cy = a.y + aby * t;
    return Math.hypot(p.x - cx, p.y - cy);
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = Physics;

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', startGame);
}

function startGame() {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const countEl = document.getElementById('count');
  const bestEl = document.getElementById('best');
  const muteBtn = document.getElementById('mute');
  const overlay = document.getElementById('overlay');

  let W = 0, H = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const G = 1500, L = 280, DAMP = 0.16, PUMP = 0.5;
  const AMP = 1.3;
  const BAR_HALF = 38;
  const CATCH_BASE = 46;
  const MAX_THETA = 1.5;

  const PALETTES = [
    { ph: 0.00, top: '#232b5c', mid: '#6a4c93', bot: '#ef9a76' },
    { ph: 0.30, top: '#141b41', mid: '#3b2f63', bot: '#a06a9a' },
    { ph: 0.62, top: '#060a1c', mid: '#101c3a', bot: '#274060' },
    { ph: 0.88, top: '#1a2140', mid: '#4a3f6b', bot: '#c97b84' },
  ];
  const SKY_PERIOD = 200;

  const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
  const CHORDS = [
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
    [220.0, 261.63, 392.0],
  ];

  const PRAISE = ['smooth.', 'nice.', 'again.', 'steady.', 'breathe.', 'so soft.', 'there it is.', 'lovely.'];
  const MISS_MSGS = ['soft landing.', 'the night is patient.', 'again, gently.', 'rest a moment.'];

  const AudioSys = {
    ctx: null, master: null, windGain: null, muted: false, chordIdx: 0, chordTimer: 0,
    start() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4;
      const padGain = this.ctx.createGain(); padGain.gain.value = 0.05;
      lp.connect(padGain); padGain.connect(this.master);
      this.padOsc = CHORDS[0].map(f => {
        const o = this.ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        o.connect(lp); o.start();
        return o;
      });
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.06;
      const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 140;
      lfo.connect(lfoGain); lfoGain.connect(lp.frequency); lfo.start();
      const noiseBuf = this.noiseBuffer(2);
      const wind = this.ctx.createBufferSource();
      wind.buffer = noiseBuf; wind.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 0.5;
      this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0;
      wind.connect(bp); bp.connect(this.windGain); this.windGain.connect(this.master);
      wind.start();
    },
    noiseBuffer(sec) {
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    },
    setWind(v) {
      if (this.windGain) this.windGain.gain.setTargetAtTime(Math.min(0.1, v), this.ctx.currentTime, 0.1);
    },
    tick(dt) {
      if (!this.ctx) return;
      this.chordTimer += dt;
      if (this.chordTimer > 9) {
        this.chordTimer = 0;
        this.chordIdx = (this.chordIdx + 1) % CHORDS.length;
        const t = this.ctx.currentTime;
        CHORDS[this.chordIdx].forEach((f, i) => this.padOsc[i].frequency.linearRampToValueAtTime(f, t + 4));
      }
    },
    env(node, peak, dur) {
      const t = this.ctx.currentTime;
      node.gain.setValueAtTime(peak, t);
      node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    },
    pluck(count) {
      if (!this.ctx) return;
      const f = PENTA[count % PENTA.length] * (1 + Math.floor(count / 16) * 0.5);
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
      const g = this.ctx.createGain(); const g2 = this.ctx.createGain();
      g2.gain.value = 0.35;
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.master);
      this.env(g, 0.16, 1.5);
      o.start(); o2.start();
      o.stop(this.ctx.currentTime + 1.6); o2.stop(this.ctx.currentTime + 1.6);
    },
    whoosh() {
      if (!this.ctx) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer(0.5);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 1.1;
      const t = this.ctx.currentTime;
      bp.frequency.setValueAtTime(320, t);
      bp.frequency.exponentialRampToValueAtTime(1500, t + 0.35);
      const g = this.ctx.createGain();
      src.connect(bp); bp.connect(g); g.connect(this.master);
      this.env(g, 0.18, 0.5);
      src.start(); src.stop(t + 0.55);
    },
    softMiss() {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator(); o.type = 'sine';
      const t = this.ctx.currentTime;
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(155, t + 0.7);
      const g = this.ctx.createGain();
      o.connect(g); g.connect(this.master);
      this.env(g, 0.1, 1.3);
      o.start(); o.stop(t + 1.4);
    },
    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
      muteBtn.textContent = this.muted ? 'sound off' : 'sound on';
    },
    suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  };

  const game = {
    started: false,
    mode: 'swing',
    pivot: { x: 320, y: 150 },
    releaseFrom: null,
    s: { theta: 0, omega: 1.1 },
    proj: null,
    next: null,
    count: 0,
    best: 0,
    holding: false,
    cam: { x: 0, y: 0 },
    t: 0,
    trail: [],
    scarf: [],
    particles: [],
    msg: null,
    fade: 0,
    missTimer: -1,
    hintShown: false,
  };
  try { game.best = parseInt(localStorage.getItem('trapeze.best') || '0', 10) || 0; } catch (e) { game.best = 0; }
  bestEl.textContent = game.best > 0 ? 'best ' + game.best : '';
  game.next = Physics.placeNext(game.pivot, L, G, AMP, 0.5, 0, 0);

  const stars = [];
  for (let i = 0; i < 150; i++) {
    stars.push({ x: Math.random() * 4000, y: Math.random(), r: 0.5 + Math.random() * 1.3, tw: 0.5 + Math.random() * 2, ph: Math.random() * 6.28 });
  }
  const clouds = [];
  for (let i = 0; i < 7; i++) {
    clouds.push({ x: Math.random() * 4000, y: 60 + Math.random() * 260, s: 0.6 + Math.random() * 1.2, v: 4 + Math.random() * 8 });
  }
  const fireflies = [];
  for (let i = 0; i < 22; i++) {
    fireflies.push({ x: Math.random() * 2000, y: Math.random(), ph: Math.random() * 6.28, sp: 0.3 + Math.random() * 0.7 });
  }

  function setMsg(text, dur) {
    game.msg = { text, t: 0, dur: dur || 3.5 };
  }

  function spawnBurst(x, y, n, color, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, v = spd * (0.3 + Math.random());
      game.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0, max: 0.6 + Math.random() * 0.6, color, size: 1.5 + Math.random() * 2.5 });
    }
  }

  function barOf(p) { return { x: p.x, y: p.y + L }; }

  function doRelease() {
    if (game.mode !== 'swing') return;
    const bob = Physics.bobPos(game.pivot, L, game.s.theta);
    const vel = Physics.bobVel(L, game.s.theta, game.s.omega);
    const sp = Math.hypot(vel.x, vel.y);
    if (sp < 80) {
      setMsg('a little more swing…', 2);
      return;
    }
    game.releaseFrom = game.pivot;
    game.proj = { x: bob.x, y: bob.y, vx: vel.x, vy: vel.y, age: 0 };
    game.mode = 'fly';
    game.trail.length = 0;
    AudioSys.whoosh();
  }

  function onCatch() {
    const p = game.proj;
    const nb = barOf(game.next);
    game.s = Physics.attach(game.next, L, p.x, p.y, p.vx, p.vy);
    game.s.omega = Math.max(-6, Math.min(6, game.s.omega));
    game.s.theta = Math.max(-MAX_THETA, Math.min(MAX_THETA, game.s.theta));
    game.pivot = game.next;
    game.proj = null;
    game.mode = 'swing';
    game.count++;
    countEl.textContent = game.count;
    if (game.count > game.best) {
      game.best = game.count;
      bestEl.textContent = 'best ' + game.best;
      try { localStorage.setItem('trapeze.best', String(game.best)); } catch (e) {}
    }
    AudioSys.pluck(game.count);
    spawnBurst(nb.x, nb.y, 20, '#ffd9a0', 130);
    if (game.count === 1) setMsg(PRAISE[Math.floor(Math.random() * PRAISE.length)], 3);
    else if (game.count % 5 === 0) setMsg(PRAISE[Math.floor(Math.random() * PRAISE.length)], 3.5);
    game.next = Physics.placeNext(game.pivot, L, G, AMP, Math.random(), undefined, Math.min(game.count * 0.008, 0.19));
  }

  function onMiss() {
    game.mode = 'swing';
    game.pivot = game.releaseFrom || game.pivot;
    game.s = { theta: -0.45, omega: 0 };
    game.proj = null;
    game.missTimer = 0.45;
    game.fade = 1;
    AudioSys.softMiss();
    setMsg(MISS_MSGS[Math.floor(Math.random() * MISS_MSGS.length)], 3);
  }

  function pressStart(e) {
    if (e) e.preventDefault();
    if (!game.started) return;
    if (game.holding || game.mode !== 'swing') return;
    game.holding = true;
  }
  function pressEnd(e) {
    if (e) e.preventDefault();
    if (!game.started || !game.holding) return;
    game.holding = false;
    doRelease();
  }
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') { pressStart(e); e.preventDefault(); }
    if (e.key === 'm' || e.key === 'M') AudioSys.toggleMute();
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') pressEnd(e); });
  window.addEventListener('pointerdown', pressStart);
  window.addEventListener('pointerup', pressEnd);
  window.addEventListener('pointercancel', pressEnd);
  muteBtn.addEventListener('click', e => { e.stopPropagation(); AudioSys.toggleMute(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) AudioSys.suspend(); else AudioSys.resume();
  });

  overlay.addEventListener('click', () => {
    if (game.started) return;
    game.started = true;
    overlay.classList.add('hidden');
    AudioSys.start();
    AudioSys.resume();
    setMsg('hold to swing — let go on the forward swing to fly', 6);
    game.hintShown = true;
  });

  function update(dt) {
    game.t += dt;
    AudioSys.tick(dt);
    if (!game.started) return;

    let bob;
    if (game.mode === 'swing') {
      Physics.stepSwing(game.s, dt, { g: G, L, damping: DAMP, pump: PUMP, holding: game.holding });
      if (Math.abs(game.s.theta) > MAX_THETA) {
        game.s.theta = Math.sign(game.s.theta) * MAX_THETA;
        game.s.omega *= 0.85;
      }
      bob = Physics.bobPos(game.pivot, L, game.s.theta);
      const sp = Math.abs(game.s.omega) * L;
      AudioSys.setWind(sp / 2600);
    } else {
      const p = game.proj;
      Physics.stepProjectile(p, dt, G);
      p.age += dt;
      bob = { x: p.x, y: p.y };
      AudioSys.setWind(Math.hypot(p.vx, p.vy) / 2600);
      const nb = barOf(game.next);
      const a = { x: nb.x - BAR_HALF, y: nb.y };
      const b = { x: nb.x + BAR_HALF, y: nb.y };
      const d = Physics.pointSegDist(p, a, b);
      const sp = Math.hypot(p.vx, p.vy);
      const r = CATCH_BASE + Math.min(sp * 0.025, 36);
      if (d < r) { onCatch(); }
      else if (p.y > nb.y + 560 || p.x > game.next.x + L + 380 || p.x < game.pivot.x - L - 380 || p.age > 6) { onMiss(); }
    }

    game.trail.push({ x: bob.x, y: bob.y });
    if (game.trail.length > 34) game.trail.shift();
    game.scarf.push({ x: bob.x, y: bob.y, t: game.t });
    if (game.scarf.length > 16) game.scarf.shift();

    for (let i = game.particles.length - 1; i >= 0; i--) {
      const q = game.particles[i];
      q.life += dt;
      q.vy += 60 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.life > q.max) game.particles.splice(i, 1);
    }

    if (game.missTimer >= 0) {
      game.missTimer -= dt;
      if (game.missTimer <= 0) game.missTimer = -1;
    }
    game.fade = Math.max(0, game.fade - dt * 1.6);

    if (game.msg) {
      game.msg.t += dt;
      if (game.msg.t > game.msg.dur) game.msg = null;
    }

    const camTX = bob.x - W * 0.36;
    const camTY = Math.max(-70, Math.min(280, bob.y - H * 0.55));
    game.cam.x += (camTX - game.cam.x) * Math.min(1, dt * 3);
    game.cam.y += (camTY - game.cam.y) * Math.min(1, dt * 3);
  }

  function hexRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function mix(c1, c2, t) {
    const a = hexRgb(c1), b = hexRgb(c2);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }
  function shade(h, f) {
    const a = hexRgb(h);
    return 'rgb(' + Math.round(a[0] * f) + ',' + Math.round(a[1] * f) + ',' + Math.round(a[2] * f) + ')';
  }
  function skyAt(ph) {
    let i = 0;
    while (i < PALETTES.length - 2 && PALETTES[i + 1].ph < ph) i++;
    const a = PALETTES[i], b = PALETTES[i + 1];
    const t = Math.max(0, Math.min(1, (ph - a.ph) / (b.ph - a.ph)));
    return { top: mix(a.top, b.top, t), mid: mix(a.mid, b.mid, t), bot: mix(a.bot, b.bot, t), topRaw: a.top };
  }
  function darknessOf(topHex) {
    const a = hexRgb(topHex);
    return Math.max(0, Math.min(1, (60 - (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2])) / 55));
  }

  function ridgeY(x, base, amp, seed) {
    return base + amp * (Math.sin(x * 0.0016 + seed) * 0.6 + Math.sin(x * 0.0042 + seed * 2.3) * 0.3 + Math.sin(x * 0.011 + seed * 4.1) * 0.12);
  }

  function drawTrapeze(p, isNext) {
    const b = barOf(p);
    const sx = b.x - game.cam.x, sy = b.y - game.cam.y;
    const px = p.x - game.cam.x, py = p.y - game.cam.y;
    if (sx < -300 || sx > W + 300) return;
    if (isNext) {
      const pulse = 0.5 + 0.5 * Math.sin(game.t * 2.2);
      const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, 70 + pulse * 14);
      g.addColorStop(0, 'rgba(255, 217, 160, ' + (0.22 + pulse * 0.12) + ')');
      g.addColorStop(1, 'rgba(255, 217, 160, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, 84 + pulse * 14, 0, 6.29); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(245, 234, 217, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px, py); ctx.lineTo(sx - BAR_HALF + 6, sy);
    ctx.moveTo(px, py); ctx.lineTo(sx + BAR_HALF - 6, sy);
    ctx.stroke();
    ctx.fillStyle = 'rgba(245, 234, 217, 0.9)';
    ctx.beginPath(); ctx.arc(px, py, 4, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#d9a066';
    ctx.strokeStyle = 'rgba(60, 35, 20, 0.55)';
    ctx.lineWidth = 2;
    roundRect(sx - BAR_HALF, sy - 5, BAR_HALF * 2, 10, 5);
    ctx.fill(); ctx.stroke();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFigure(bob) {
    let x = bob.x - game.cam.x, y = bob.y - game.cam.y;
    ctx.save();
    ctx.lineCap = 'round';
    if (game.mode === 'swing') {
      const th = game.s.theta;
      const dx = Math.sin(th), dy = Math.cos(th);
      const px = Math.cos(th), py = -Math.sin(th);
      const sh = { x: x + 11 * dx, y: y + 11 * dy };
      const hip = { x: x + 34 * dx, y: y + 34 * dy };
      const knee = { x: hip.x + 10 * dx + 6 * px, y: hip.y + 10 * dy + 6 * py };
      const foot = { x: hip.x + 20 * dx + 9 * px, y: hip.y + 20 * dy + 9 * py };
      ctx.strokeStyle = '#f2e8d8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 9, y); ctx.lineTo(sh.x, sh.y);
      ctx.moveTo(x + 9, y); ctx.lineTo(sh.x, sh.y);
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y); ctx.lineTo(hip.x, hip.y);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y); ctx.lineTo(knee.x, knee.y); ctx.lineTo(foot.x, foot.y);
      ctx.stroke();
      ctx.fillStyle = '#f2e8d8';
      ctx.beginPath(); ctx.arc(x + 21 * dx, y + 21 * dy, 7, 0, 6.29); ctx.fill();
    } else {
      const p = game.proj;
      const a = Math.atan2(p.vy, p.vx);
      const dx = Math.cos(a), dy = Math.sin(a);
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.strokeStyle = '#f2e8d8';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(10, 0); ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-30, -5); ctx.stroke();
      ctx.fillStyle = '#f2e8d8';
      ctx.beginPath(); ctx.arc(17, 0, 7, 0, 6.29); ctx.fill();
      ctx.restore();
      ctx.save();
    }
    ctx.restore();
  }

  function drawScarf() {
    if (game.scarf.length < 2) return;
    for (let i = 1; i < game.scarf.length; i++) {
      const p0 = game.scarf[i - 1], p1 = game.scarf[i];
      const t = i / game.scarf.length;
      ctx.strokeStyle = 'rgba(239, 131, 84, ' + (t * 0.55) + ')';
      ctx.lineWidth = 1 + t * 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p0.x - game.cam.x, p0.y - game.cam.y + 4);
      ctx.lineTo(p1.x - game.cam.x, p1.y - game.cam.y + 4);
      ctx.stroke();
    }
  }

  function drawTrail() {
    if (game.trail.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < game.trail.length; i++) {
      const t = i / game.trail.length;
      ctx.strokeStyle = 'rgba(255, 240, 210, ' + (t * 0.22) + ')';
      ctx.lineWidth = 1 + t * 5;
      ctx.beginPath();
      ctx.moveTo(game.trail[i - 1].x - game.cam.x, game.trail[i - 1].y - game.cam.y);
      ctx.lineTo(game.trail[i].x - game.cam.x, game.trail[i].y - game.cam.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    const ph = (game.t / SKY_PERIOD) % 1;
    const sky = skyAt(ph);
    const dark = darknessOf(sky.topRaw);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, sky.top);
    grad.addColorStop(0.55, sky.mid);
    grad.addColorStop(1, sky.bot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (dark > 0.03) {
      for (const st of stars) {
        let sx = (st.x - game.cam.x * 0.12) % (W + 60);
        if (sx < -30) sx += W + 60;
        sx -= 30;
        const sy = st.y * H * 0.72 - game.cam.y * 0.05;
        const a = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(game.t * st.tw + st.ph))) * dark;
        ctx.fillStyle = 'rgba(255, 250, 235, ' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(sx, sy, st.r, 0, 6.29); ctx.fill();
      }
      const mx = (((W * 0.78 - game.cam.x * 0.07) % (W + 400)) + W + 400) % (W + 400) - 200;
      const my = H * 0.16 - game.cam.y * 0.06;
      const mg = ctx.createRadialGradient(mx, my, 6, mx, my, 90);
      mg.addColorStop(0, 'rgba(255, 244, 220, ' + (0.5 * dark + 0.1) + ')');
      mg.addColorStop(1, 'rgba(255, 244, 220, 0)');
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(mx, my, 90, 0, 6.29); ctx.fill();
      ctx.fillStyle = 'rgba(255, 246, 224, ' + (0.75 + dark * 0.25) + ')';
      ctx.beginPath(); ctx.arc(mx, my, 26, 0, 6.29); ctx.fill();
    }

    const cloudCol = mix(sky.bot, '#ffffff', 0.45);
    for (const c of clouds) {
      c.x += c.v * 0.016;
      let sx = ((c.x - game.cam.x * 0.35) % (W + 500) + W + 500) % (W + 500) - 250;
      const sy = c.y - game.cam.y * 0.25;
      const rgb = hexRgb(cloudCol);
      ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.10)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 90 * c.s, 20 * c.s, 0, 0, 6.29);
      ctx.ellipse(sx + 50 * c.s, sy + 6 * c.s, 60 * c.s, 15 * c.s, 0, 0, 6.29);
      ctx.ellipse(sx - 55 * c.s, sy + 7 * c.s, 55 * c.s, 13 * c.s, 0, 0, 6.29);
      ctx.fill();
    }

    drawRidge(0.22, H * 0.78, 60, 1.7, shade(sky.mid, 0.55));
    drawRidge(0.45, H * 0.88, 46, 4.2, shade(sky.mid, 0.38));
    drawRidge(0.7, H * 1.0, 34, 8.8, shade(sky.bot, 0.3));

    if (dark > 0.15) {
      for (const f of fireflies) {
        const fx = ((f.x + game.t * 12 * f.sp - game.cam.x * 0.6) % (W + 100) + W + 100) % (W + 100) - 50;
        const fy = H * (0.55 + 0.4 * f.y) + Math.sin(game.t * f.sp + f.ph) * 18 - game.cam.y * 0.4;
        const a = (0.5 + 0.5 * Math.sin(game.t * 1.4 + f.ph * 3)) * dark * 0.8;
        ctx.fillStyle = 'rgba(255, 220, 140, ' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(fx, fy, 2, 0, 6.29); ctx.fill();
      }
    }

    drawTrapeze(game.pivot, false);
    if (game.next) drawTrapeze(game.next, true);

    drawTrail();
    drawScarf();

    const bob = game.mode === 'swing'
      ? Physics.bobPos(game.pivot, L, game.s.theta)
      : { x: game.proj.x, y: game.proj.y };
    drawFigure(bob);

    for (const q of game.particles) {
      const a = Math.max(0, 1 - q.life / q.max);
      ctx.fillStyle = q.color;
      ctx.globalAlpha = a * 0.9;
      ctx.beginPath();
      ctx.arc(q.x - game.cam.x, q.y - game.cam.y, q.size * a + 0.4, 0, 6.29);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(8, 8, 26, 0)');
    vg.addColorStop(1, 'rgba(8, 8, 26, 0.38)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if (game.msg) {
      const m = game.msg;
      const a = Math.min(1, m.t / 0.6, (m.dur - m.t) / 0.8);
      ctx.font = 'italic 16px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(245, 234, 217, ' + Math.max(0, a * 0.85).toFixed(3) + ')';
      ctx.shadowColor = 'rgba(10, 10, 40, 0.8)';
      ctx.shadowBlur = 10;
      ctx.fillText(m.text, W / 2, H - 46);
      ctx.shadowBlur = 0;
    }

    if (game.fade > 0) {
      ctx.fillStyle = 'rgba(8, 10, 25, ' + (game.fade * 0.9).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawRidge(par, base, amp, seed, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-20, H + 20);
    for (let sx = -20; sx <= W + 20; sx += 16) {
      const wx = sx + game.cam.x * par;
      const sy = ridgeY(wx, base, amp, seed) - game.cam.y * par * 0.6;
      ctx.lineTo(sx, sy);
    }
    ctx.lineTo(W + 20, H + 20);
    ctx.closePath();
    ctx.fill();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
