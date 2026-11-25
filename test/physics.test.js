'use strict';

const P = require('../game.js');

const G = 1500, L = 280, DAMP = 0.16, PUMP = 0.5;
const BAR_HALF = 38, CATCH_BASE = 46;

function catchRadius(sp) { return CATCH_BASE + Math.min(sp * 0.025, 36); }

function simulateRelease(p0, A, th, bar) {
  const v = P.speedAtAngle(L, G, th, A);
  let p = { x: p0.x + L * Math.sin(th), y: p0.y + L * Math.cos(th), vx: v * Math.cos(th), vy: -v * Math.sin(th), age: 0 };
  let minD = 1e9;
  for (let i = 0; i < 120 * 6; i++) {
    P.stepProjectile(p, 1 / 120, G);
    p.age += 1 / 120;
    const d = P.pointSegDist(p, { x: bar.x - BAR_HALF, y: bar.y }, { x: bar.x + BAR_HALF, y: bar.y });
    if (d < minD) minD = d;
    if (d < catchRadius(Math.hypot(p.vx, p.vy))) return { caught: true, minD };
    if (p.y > bar.y + 560) break;
  }
  return { caught: false, minD };
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  console.log('ok - ' + msg);
}

let s = { theta: 0, omega: 1.0 };
let maxA = 0;
for (let i = 0; i < 120 * 12; i++) {
  P.stepSwing(s, 1 / 120, { g: G, L, damping: DAMP, pump: PUMP, holding: true });
  maxA = Math.max(maxA, Math.abs(s.theta));
}
console.log('equilibrium amplitude after 12s holding: ' + (maxA * 180 / Math.PI).toFixed(1) + ' deg');
assert(maxA > 0.85 && maxA < 1.5, 'pumped amplitude lands in a playable band (49-86 deg), got ' + (maxA * 180 / Math.PI).toFixed(1));

let s2 = { theta: 0, omega: 1.0 };
let maxA2 = 0;
for (let i = 0; i < 120 * 30; i++) {
  P.stepSwing(s2, 1 / 120, { g: G, L, damping: DAMP, pump: PUMP, holding: false });
  if (i > 120 * 25) maxA2 = Math.max(maxA2, Math.abs(s2.theta));
}
assert(maxA2 < 0.15, 'swing gently decays when not holding (last 5s of 30s), residual amplitude ' + (maxA2 * 180 / Math.PI).toFixed(1) + ' deg');

const A = Math.max(maxA, 1.0);
const p0 = { x: 320, y: 150 };
let allCaught = true;
for (const f of [0, 0.25, 0.5, 0.75, 1]) {
  const p1 = P.placeNext(p0, L, G, A, f, 0);
  const bar = { x: p1.x, y: p1.y + L };
  let best = { caught: false, minD: 1e9 };
  for (let th = 0.05; th < A; th += 0.008) {
    const r = simulateRelease(p0, A, th, bar);
    if (r.minD < best.minD) best = r;
    if (r.caught) { best = r; break; }
  }
  console.log('optimal release  f=' + f + ' distance=' + (p1.x - p0.x).toFixed(0) + 'px  caught=' + best.caught + '  minDist=' + best.minD.toFixed(1));
  if (!best.caught) allCaught = false;
}
assert(allCaught, 'every placed trapeze is reachable from an optimal release');

let typicalCaught = true;
for (const f of [0, 0.25, 0.5, 0.75, 1]) {
  const p1 = P.placeNext(p0, L, G, A, f, 0);
  const bar = { x: p1.x, y: p1.y + L };
  const res = [0.3, 0.5, 0.7, 0.9, 1.1].map(th => simulateRelease(p0, A, th, bar));
  const any = res.some(r => r.caught);
  const bestMin = Math.min(...res.map(r => r.minD));
  console.log('typical release  f=' + f + ' distance=' + (p1.x - p0.x).toFixed(0) + 'px  caught=' + any + '  minDist=' + bestMin.toFixed(1));
  if (!any) typicalCaught = false;
}
assert(typicalCaught, 'forward-swing releases (theta 0.3-1.1 rad) catch every placement');

const att = P.attach(p0, L, p0.x, p0.y + L, 300, -100);
assert(Math.abs(att.theta) < 1e-9, 'attach directly below pivot gives theta ~ 0, got ' + att.theta);
const att2 = P.attach(p0, L, p0.x + L, p0.y, 0, 0);
assert(Math.abs(att2.theta - Math.PI / 2) < 1e-9, 'attach level with pivot gives theta ~ 90 deg');

const v = P.bobVel(L, 0.6, 2.0);
const back = P.attach(p0, L, p0.x + L * Math.sin(0.6), p0.y + L * Math.cos(0.6), v.x, v.y);
assert(Math.abs(back.theta - 0.6) < 1e-9 && Math.abs(back.omega - 2.0) < 1e-9, 'attach round-trips theta/omega');

console.log('all physics tests passed');
