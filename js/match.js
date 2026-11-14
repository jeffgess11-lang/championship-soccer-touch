// Match engine: fixed 60 Hz simulation. 105x68 m pitch, meters.
// Skills follow Documentation/Manual.txt 1.5 semantics (speed, shot power/control,
// stamina, dribbling, anticipation, agility, tackling, heading, ball control,
// handling/reflexes for GKs, aggression).
import { posCompatible } from './world.js';

import { FIELD as F, PPM } from './scale.js';

export const TICK = 1 / 60;
export const FIELD = F;
export const PX_W = 800, PX_H = 600;
export const MARGIN = 6; // meters rendered beyond lines
const PPM_X = PPM.x;
const PPM_Y = PPM.y;
export function toPx(m, cam) { return { x: (m.x + MARGIN) * PPM_X, y: (m.y + MARGIN) * PPM_Y }; }
export const SCALE = { x: PPM_X, y: PPM_Y };

function n2(a, b) { return a * a + b * b; }
function len(ax, ay) { return Math.sqrt(ax * ax + ay * ay); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

const DRIBBLE_FRICTION = 0.55; // per second on ground
const AIR_DRAG = 0.25;
const GRAV = 9.81;
const CONTROL_R = 1.35;      // meters
const TACKLE_R = 1.5;

export class Match {
  // home/away: {team, xi: [playerIds aligned to SLOT_POS], kit, userPlayerId}
  constructor(world, home, away, opts = {}) {
    this.world = world;
    this.home = home; this.away = away;
    this.opts = opts;
    this.minute = 0;
    this.half = 1;
    this.speed = opts.speed || 1; // minutes of match per real second baseline 0.1875*tick
    this.score = { home: 0, away: 0 };
    this.events = [];
    this.finished = false;
    this.paused = opts.paused || false;
    this.rngState = (Date.now() ^ 0x1234abcd) >>> 0;
    this.players = []; // active 22
    this.bench = { home: [], away: [] };
    this.subsUsed = { home: 0, away: 0 };
    this.stat = { home: { shots: 0, onTarget: 0, poss: 0, tackles: 0, fouls: 0, corners: 0 }, away: { shots: 0, onTarget: 0, poss: 0, tackles: 0, fouls: 0, corners: 0 } };
    this.msg = null; this.msgT = 0;
    this.restart = null; // {type:'kickoff'|'throwin'|'corner'|'goalkick', team:0/1, x,y}
    this.lastTouchTeam = 0;
    this.tacklesWindow = 0;
    // home attacks +x in half 1 (dirSide[0]=1), away -x (dirSide[1]=-1); flipped at half-time
    this.dirSide = [1, -1];
    this.userSlot = -1;
    this.tactic = {
      home: opts.tacticHome || { pressing: 3, line: 3, tempo: 3 },
      away: opts.tacticAway || { pressing: 3, line: 3, tempo: 3 },
    };
    this.build(home, away);
    this.kickoff(0);
  }

  r01() { this.rngState ^= this.rngState << 13; this.rngState >>>= 0; this.rngState ^= this.rngState >>> 17; this.rngState ^= this.rngState << 5; this.rngState >>>= 0; return this.rngState / 4294967296; }

  build(home, away) {
    const mk = (side, info, dir) => {
      info.xi.forEach((pid, slotIdx) => {
        const p = this.world.players.get(pid);
        if (!p) return;
        const s = p.skills;
        const anchor = slotAnchor(slotIdx, dir);
        const basePos = p.pos.split(' ')[0];
        const pl = {
          id: pid, ref: p, side, slotIdx, pos: basePos,
          x: anchor.x, y: anchor.y, vx: 0, vy: 0,
          speedMax: 6.2 + (s.speed / 225) * 4.6,
          accel: 5.5 + (s.anticipation / 225) * 5,
          agilityF: 1 - (s.agility / 225) * 0.35,
          stamina: 1, staminaRate: 0.0022 + (1 - s.stamina / 225) * 0.004,
          tackleP: 0.55 + (s.tackling / 225) * 0.9,
          aggrP: 0.2 + (s.aggression / 225) * 1.2,
          controlR: 0.9 + (s.ballControl / 225) * 0.8,
          passAcc: 0.5 + (s.shotControl / 225) * 1.4,
          shotP: 17 + (s.shotPower / 225) * 15,
          shotAcc: 0.5 + (s.shotControl / 225) * 1.5,
          isGK: basePos === 'GK',
          gkReach: basePos === 'GK' ? 1.4 + (s.handling / 225) * 2.6 : 0,
          gkReflex: basePos === 'GK' ? 0.25 + (s.reflexes / 225) * 0.35 : 0,
          anchor, dir, sideInfo: info,
          rating: 6, hasBall: false, cooldown: 0, yellow: 0, red: false,
        };
        this.players.push(pl);
      });
    };
    mk(0, home, 1);   // home attacks +x
    mk(1, away, -1);  // away attacks -x
    this.bench.home = (home.bench || []).map(id => this.world.players.get(id));
    this.bench.away = (away.bench || []).map(id => this.world.players.get(id));
    this.ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: null, lastKicker: null };
    // user player slot
    if (this.opts.userPlayerId) {
      const pl = this.players.find(q => q.id === this.opts.userPlayerId);
      if (pl) this.userSlot = this.players.indexOf(pl);
    }
  }

  gk(side) { return this.players.find(p => p.side === side && p.isGK); }
  teamPlayers(side) { return this.players.filter(p => p.side === side && !p.red); }

  kickoff(sideWithBall) {
    this.ball.x = 0; this.ball.y = 0; this.ball.z = 0;
    this.ball.vx = this.ball.vy = this.ball.vz = 0; this.ball.owner = null; this.ball.saveChecked = false; this.ball.shotOutcome = null; this.lastTouchTeam = sideWithBall;
    for (const p of this.players) {
      const a = slotAnchor(p.slotIdx, p.dir);
      // pull into own half for kickoff
      p.x = clamp(a.x * 0.75, p.dir === 1 ? -FIELD.w / 2 + 1 : 1, p.dir === 1 ? -1 : FIELD.w / 2 - 1);
      p.y = a.y; p.vx = p.vy = 0;
    }
    const takers = this.teamPlayers(sideWithBall).filter(p => !p.isGK);
    if (takers.length) {
      const t = takers[Math.floor(this.r01() * takers.length)];
      t.x = -t.dir * 0.8; t.y = 0;
    }
    this.restart = null;
  }

  setMessage(txt, t = 2.2) { this.msg = txt; this.msgT = t; if (this.opts.onEvent) this.opts.onEvent({ type: 'msg', text: txt }); }

  goal(side) { // side scored
    if (side === 0) this.score.home++; else this.score.away++;
    this.events.push({ type: 'goal', side, minute: Math.floor(this.minute) });
    this.setMessage(side === 0 ? 'GOAL!' : 'GOAL - ' + this.away.team.name, 2.6);
    if (this.opts.onEvent) this.opts.onEvent({ type: 'goal', side, minute: Math.floor(this.minute) });
    this.kickoff(side === 0 ? 1 : 0);
  }

  simulate(dt) { // dt in real seconds; converts to match time via speed
    if (this.paused || this.finished) return;
    const matchDt = dt * TICK_RATE * this.speed; // match-minutes this tick
    this.minute += matchDt;
    if (this.half === 1 && this.minute >= 45) {
      this.half = 2; this.minute = 45;
      this.setMessage('Half-time', 2.0);
      // swap ends: mirror dir and positions
      for (const p of this.players) { p.dir *= -1; p.anchor = slotAnchor(p.slotIdx, p.dir); }
      this.dirSide = [this.dirSide[0] * -1, this.dirSide[1] * -1];
      this.kickoff(1);
      if (this.opts.onEvent) this.opts.onEvent({ type: 'half' });
    }
    if (this.half === 2 && this.minute >= 90) {
      this.finished = true;
      this.setMessage('Full-time', 3);
      if (this.opts.onEvent) this.opts.onEvent({ type: 'full', score: { ...this.score } });
      return;
    }
    this.step(matchDt * 60); // ts = match-seconds this tick
    if (this.msgT > 0) this.msgT -= dt;
    else this.msg = null;
  }

  step(ts) { // ts: match-seconds this tick
    const b = this.ball;
    for (const p of this.players) if (p.cooldown > 0) p.cooldown -= ts;
    // decisions once per tick
    const owner = b.owner;
    if (owner && !owner.red) {
      this.decideOwner(owner, ts);
      this.stat[owner.side === 0 ? 'home' : 'away'].poss += ts;
    }
    for (const p of this.players) {
      if (p === owner) continue;
      this.moveOffBall(p, ts);
    }
    // physics in substeps so fast balls don't tunnel through receivers or nets
    const N = 4;
    const h = ts / N;
    for (let i = 0; i < N; i++) {
      this.moveBall(h);
      for (const p of this.players) this.movePlayer(p, h);
      this.ballInteractions(h);
      this.outOfBounds();
    }
  }

  tacticFor(side) { return side === 0 ? this.tactic.home : this.tactic.away; }

  decideOwner(p, ts) {
    const b = this.ball;
    const dir = p.dir;
    // GK: immediate distribution upfield
    if (p.isGK) {
      const mates = this.teamPlayers(p.side).filter(q => !q.isGK);
      let best = null, bs = -1e9;
      for (const q of mates) {
        const fwd = (q.x - p.x) * p.dir;
        const d = len(q.x - p.x, q.y - p.y);
        const s = fwd - Math.abs(d - 24);
        if (s > bs) { bs = s; best = q; }
      }
      if (best) { this.pass(p, best); return; }
    }
    // user-controlled owner: joystick steers, buttons act; no auto decisions
    if (p === this.userPlayer()) {
      this.moveUser(p, ts);
      return;
    }
    const gx = dir * (FIELD.w / 2 - 9); // dribble target: edge of box, not the goal line
    const goalX = dir * FIELD.w / 2;
    const dGoal = len(goalX - p.x, p.y);
    const press = this.tacticFor(p.side).pressing;
    // shoot?
    const sRange = 17 + p.shotP * 0.15;
    if (dGoal < sRange && Math.abs(p.y) < 26 && this.shotChance(p, dGoal) > this.r01() * 850) {
      this.shoot(p);
      return;
    }
    // pass?
    const options = this.teamPlayers(p.side).filter(q => q !== p);
    let best = null, bestScore = 0;
    for (const q of options) {
      const d = len(q.x - p.x, q.y - p.y);
      if (d < 4 || d > 42) continue;
      const forward = (q.x - p.x) * dir;
      let score = forward * 0.9 - d * 0.12;
      // nearest opponent pressure on q
      let press2 = 1e9;
      for (const o of this.teamPlayers(1 - p.side)) {
        const dd = len(o.x - q.x, o.y - q.y);
        if (dd < press2) press2 = dd;
      }
      score += Math.min(press2, 12) * 0.55;
      // lane blocked?
      const steps = Math.ceil(d / 3);
      let blocked = false;
      for (let i = 1; i < steps; i++) {
        const lx = p.x + (q.x - p.x) * i / steps, ly = p.y + (q.y - p.y) * i / steps;
        for (const o of this.teamPlayers(1 - p.side)) {
          if (n2(o.x - lx, o.y - ly) < 4) { blocked = true; break; }
        }
        if (blocked) { score -= 8; break; }
      }
      if (score > bestScore) { bestScore = score; best = q; }
    }
    const wantPass = 0.9 + (1 - press / 3) * 0.6;
    if (best && this.r01() < ts * 1.7 && bestScore > 2 * wantPass) { this.pass(p, best); return; }
    // dribble: toward goal with lateral jitter
    const t = this.tacticFor(p.side).tempo;
    let tx = gx, ty = clamp(p.y * 0.6, -20, 20);
    if (dGoal < 30 && p.y > 8) ty = 6; // cut inside
    const sp = (2.6 + p.speedMax * 0.45) * (0.8 + t * 0.08);
    const dx = tx - p.x, dy = ty - p.y, dl = len(dx, dy) || 1;
    p.vx = dx / dl * sp; p.vy = dy / dl * sp; // integrated by movePlayer, ball glued there
    p.stamina = Math.max(0, p.stamina - p.staminaRate * ts * 1.4);
  }

  shotChance(p, d) {
    const base = clamp(1.6 - d / 18, 0.05, 1.1);
    return base * (0.5 + p.shotAcc / 2);
  }

  shoot(p) {
    const b = this.ball;
    const gx = p.dir * FIELD.w / 2;
    const d0 = Math.abs(gx - p.x);
    // aim: tighter up close, wider with distance — some long shots go wide (→ corners)
    const spread = (FIELD.goal / 2) * Math.max(0.4, 0.55 - 0.08 * p.shotAcc + d0 * 0.04) * (1 + Math.min(Math.abs(p.y) / 40, 0.6));
    const gy = (this.r01() * 2 - 1) * spread;
    const d = len(gx - p.x, gy - p.y);
    const sp = p.shotP;
    b.owner = null; b.lastKicker = p;
    b.vx = (gx - p.x) / d * sp; b.vy = (gy - p.y) / d * sp;
    b.vz = clamp(2.5 + this.r01() * 3 - d * 0.04, 0.5, 4.5);
    b.z = 0.2;
    b.saveChecked = false;
    this.lastTouchTeam = p.side;
    this.stat[p.side === 0 ? 'home' : 'away'].shots++;
    p.rating += 0.05;
    p.cooldown = 0.35;
    // pre-roll the shot outcome; applied when the ball reaches the goal plane
    b.shotOutcome = null;
    if (Math.abs(gy) < FIELD.goal / 2 - 0.2) {
      const gk = this.gk(1 - p.side);
      const saveP = gk ? clamp(0.57 + gk.gkReflex * 0.9 - Math.min(Math.abs(gy), 3) * 0.08, 0.15, 0.92) : 0.5;
      const roll = this.r01();
      if (roll < saveP) b.shotOutcome = { kind: this.r01() < 0.6 ? 'catch' : 'parry', side: p.side };
      else b.shotOutcome = { kind: 'goal', side: p.side };
    }
    if (this.opts.onSound) this.opts.onSound('kick');
  }

  pass(p, q) {
    const b = this.ball;
    const lead = 0.55;
    const tx = q.x + q.vx * lead, ty = q.y + q.vy * lead;
    const d = len(tx - p.x, ty - p.y) || 1;
    // arrival speed: with linear drag k, total travel ≈ v0/k; aim to stop near target
    const sp = clamp(d * 0.63, 8, 20);
    const noise = (1 - clamp(p.passAcc / 2.2, 0.2, 0.95)) * 2.5;
    b.owner = null; b.lastKicker = p;
    b.shotOutcome = null; b.saveChecked = false;
    b.vx = (tx - p.x) / d * sp + (this.r01() * 2 - 1) * noise;
    b.vy = (ty - p.y) / d * sp + (this.r01() * 2 - 1) * noise;
    b.vz = d > 24 ? 1.8 : 0.1; b.z = 0.1;
    b.saveChecked = false;
    this.lastTouchTeam = p.side;
    p.cooldown = 0.3;
    if (this.opts.onSound) this.opts.onSound('kick');
  }

  moveBall(ts) {
    const b = this.ball;
    if (b.owner) { b.z = 0; b.vx = b.vy = b.vz = 0; return; }
    const drag = b.z > 0.05 ? AIR_DRAG : DRIBBLE_FRICTION;
    const f = Math.max(0, 1 - drag * ts);
    b.vx *= f; b.vy *= f;
    if (b.z > 0 || b.vz > 0) {
      b.vz -= GRAV * ts;
      b.z += b.vz * ts;
      if (b.z <= 0) { b.z = 0; b.vz = b.vz < -2 ? -b.vz * 0.45 : 0; }
    }
    b.x += b.vx * ts; b.y += b.vy * ts;
    // goal-line / post handling in outOfBounds
  }

  movePlayer(p, ts) {
    if (p === this.ball.owner) {
      // dribble velocity set by decideOwner; ball glued to feet
      p.x += p.vx * ts; p.y += p.vy * ts;
      p.x = clamp(p.x, -FIELD.w / 2 - 2, FIELD.w / 2 + 2);
      p.y = clamp(p.y, -FIELD.h / 2 - 2, FIELD.h / 2 + 2);
      const b = this.ball;
      b.x = p.x; b.y = p.y;
      return;
    }
    // steering toward moveTarget set by moveOffBall
    const a = p.accel * (p.vx || p.vy ? p.agilityF : 1);
    if (p.tx != null) {
      const dx = p.tx - p.x, dy = p.ty - p.y, dl = len(dx, dy);
      const st = 0.55 + 0.45 * p.stamina;
      const vmax = p.speedMax * st;
      if (dl > 0.2) {
        p.vx += (dx / dl * vmax - p.vx) * Math.min(1, a * ts);
        p.vy += (dy / dl * vmax - p.vy) * Math.min(1, a * ts);
      }
    }
    p.x += p.vx * ts; p.y += p.vy * ts;
    p.x = clamp(p.x, -FIELD.w / 2 - 2, FIELD.w / 2 + 2);
    p.y = clamp(p.y, -FIELD.h / 2 - 2, FIELD.h / 2 + 2);
    // stamina recovery when slow
    const speed2 = n2(p.vx, p.vy);
    if (speed2 < 4) p.stamina = Math.min(1, p.stamina + ts * 0.004);
  }

  formationTarget(p) {
    const t = this.tacticFor(p.side);
    const b = this.ball;
    const attacking = b.owner && b.owner.side === p.side;
    const dir = p.dir;
    const ballX = b.x;
    // line position: anchor x shifted toward ball, capped by pressing/line
    const shift = (ballX * dir) * 0.42 + (attacking ? (2 + t.tempo * 2.2) : -(6 - t.line * 1.4));
    let tx = p.anchor.x + shift * dir;
    // clamp depth
    const maxAdv = attacking ? FIELD.w / 2 - 6 : FIELD.w / 2 - 18;
    tx = clamp(tx, -maxAdv, maxAdv);
    // lateral: slide toward ball with weight by distance to ball line
    const latW = p.isGK ? 0.25 : clamp(0.5 - Math.abs(tx - ballX) / 60, 0.12, 0.5);
    let ty = p.anchor.y + (b.y - p.anchor.y) * latW * 0.7;
    if (p.isGK) {
      // stay on goal line, track ball angle
      const gx = -dir * (FIELD.w / 2 - 0.6);
      const ang = clamp((b.y - 0) / (Math.abs(b.x - gx) + 1), -1, 1);
      tx = gx + dir * (attacking ? 1.5 : 0);
      ty = clamp(ang * 5.5, -FIELD.goal / 2 + 0.3, FIELD.goal / 2 - 0.3);
    } else if (attacking && p.pos.startsWith('F')) {
      // strikers push to last defender line
      const defX = Math.min(...this.teamPlayers(1 - p.side).map(o => o.x * dir));
      tx = clamp((defX - 1.5) * dir, -maxAdv, maxAdv) * 1;
      ty = p.anchor.y + (b.y - p.anchor.y) * 0.25;
    }
    return { x: clamp(tx, -FIELD.w / 2, FIELD.w / 2), y: clamp(ty, -FIELD.h / 2, FIELD.h / 2) };
  }

  moveOffBall(p, ts) {
    const b = this.ball;
    // user-controlled player steered externally
    if (p === this.userPlayer()) { this.moveUser(p, ts); return; }
    const t = this.formationTarget(p);
    let tx = t.x, ty = t.y, sprint = false;
    // chase ball if closest on team and ball loose
    if (!b.owner) {
      let closest = null, cd = 1e9;
      for (const q of this.teamPlayers(p.side)) {
        const d = n2(q.x - b.x, q.y - b.y) + (q.isGK ? 500 : 0);
        if (d < cd) { cd = d; closest = q; }
      }
      if (closest === p) { tx = b.x + b.vx * 0.3; ty = b.y + b.vy * 0.3; sprint = true; }
    } else if (b.owner.side !== p.side && !p.isGK) {
      // defend: press owner or mark zone
      const press = this.tacticFor(p.side).pressing;
      const d = len(p.x - b.x, p.y - b.y);
      const shouldPress = d < 14 + press * 4 || p.pos.startsWith('D') || p.pos.startsWith('DM');
      if (shouldPress) { tx = b.x; ty = b.y; sprint = d > 3; }
    }
    p.tx = tx; p.ty = ty; p.sprint = sprint;
    if (sprint) p.stamina = Math.max(0, p.stamina - p.staminaRate * ts * 1.6);
  }

  userPlayer() { return this.userSlot >= 0 ? this.players[this.userSlot] : null; }

  moveUser(p, ts) {
    const j = this.userInput || { x: 0, y: 0 };
    const st = 0.55 + 0.45 * p.stamina;
    const vmax = p.speedMax * st * (1 + (p.sprint ? 0.12 : 0));
    const dl = len(j.x, j.y);
    if (dl > 0.08) {
      p.vx += (j.x / dl * vmax - p.vx) * Math.min(1, p.accel * ts);
      p.vy += (j.y / dl * vmax - p.vy) * Math.min(1, p.accel * ts);
    } else {
      p.vx *= Math.max(0, 1 - 6 * ts); p.vy *= Math.max(0, 1 - 6 * ts);
    }
    p.tx = null;
    if (this.ball.owner === p) p.stamina = Math.max(0, p.stamina - p.staminaRate * ts * 1.3);
  }

  // action buttons from touch layer
  userAction(kind) {
    const p = this.userPlayer();
    if (!p) return;
    const b = this.ball;
    if (kind === 'shoot') {
      if (b.owner === p) this.shoot(p);
      else if (len(p.x - b.x, p.y - b.y) < 3.5 && !b.owner) { // first-time shot
        b.owner = p; this.shoot(p);
      }
    } else if (kind === 'pass') {
      if (b.owner === p) {
        const mates = this.teamPlayers(p.side).filter(q => q !== p);
        let best = null, bs = -1e9;
        for (const q of mates) {
          const d = len(q.x - p.x, q.y - p.y);
          const dirDot = (q.x - p.x) * p.dir;
          let s = dirDot * 0.6 - Math.abs(d - 14);
          if (s > bs) { bs = s; best = q; }
        }
        if (best) this.pass(p, best);
      } else if (len(p.x - b.x, p.y - b.y) < 3.5 && !b.owner) {
        b.owner = p; this.lastTouchTeam = p.side;
      }
    } else if (kind === 'sprint') {
      p.sprint = !p.sprint;
    }
  }

  ballInteractions(ts) {
    const b = this.ball;
    // loose-ball pickup; shot saves resolve only via pre-rolled shotOutcome at the goal plane
    if (!b.owner) {
      // pick up loose ball
      let taker = null, takerD = 1e9, takerSpeed = 0;
      for (const p of this.players) {
        if (p.cooldown > 0 || p.red) continue;
        const d = len(p.x - b.x, p.y - b.y);
        const speed = len(b.vx, b.vy);
        let r;
        if (p === this.userPlayer()) r = p.controlR + 0.5;
        else if (p.isGK) r = speed > 10 ? -1 : p.controlR + 2.4; // keeper never claims fast balls; saves resolve at the plane
        else r = speed < 16 ? p.controlR : 0.7; // fast balls: only a close block
        if (d < r + 0.6 && d < takerD) { taker = p; takerD = d; takerSpeed = speed; }
      }
      if (taker) {
        if (takerSpeed >= 16 && !taker.isGK) {
          // close block: deflect, don't collect
          const ang = (this.r01() * 2 - 1) * 0.9;
          const cs = Math.cos(ang), sn = Math.sin(ang);
          const nvx = b.vx * cs - b.vy * sn, nvy = b.vx * sn + b.vy * cs;
          b.vx = nvx * 0.55; b.vy = nvy * 0.55; b.vz = Math.max(b.vz, 0.8);
          b.shotOutcome = null;
          this.lastTouchTeam = taker.side;
          taker.cooldown = 0.3;
          return;
        }
        if (b.owner && b.owner !== taker) return; // handled via tackles
        // any touch kills a pre-rolled shot outcome unless the taker is the shooter
        if (taker !== b.lastKicker) b.shotOutcome = null;
        b.owner = taker;
        b.lastKicker = taker;
        this.lastTouchTeam = taker.side;
        taker.hasBall = true;
      }
    }
    // tackles on owner
    const o = b.owner;
    if (o) {
      for (const q of this.teamPlayers(1 - o.side)) {
        if (q.cooldown > 0 || q.red || q.isGK) continue;
        const d = len(q.x - o.x, q.y - o.y);
        if (d < TACKLE_R) {
          const rate = q.tackleP * (0.5 + q.aggrP * 0.35) * ts * 2.2;
          if (this.r01() < rate) {
            b.owner = null;
            b.shotOutcome = null;
            b.vx = (this.r01() * 2 - 1) * 6; b.vy = (this.r01() * 2 - 1) * 6;
            o.cooldown = 0.7; q.cooldown = 0.5;
            q.rating += 0.03;
            this.stat[q.side === 0 ? 'home' : 'away'].tackles++;
            // foul?
            if (this.r01() < 0.011 * q.aggrP) {
              this.stat[q.side === 0 ? 'home' : 'away'].fouls++;
              q.rating -= 0.08;
              if (this.r01() < 0.12) {
                q.yellow++;
                if (q.yellow >= 2) { q.red = true; this.setMessage('Red card! ' + q.ref.sur, 2.2); this.events.push({ type: 'red', side: q.side, player: q.ref.sur, minute: Math.floor(this.minute) }); if (this.opts.onEvent) this.opts.onEvent({ type: 'red', side: q.side }); }
                else { this.setMessage('Yellow card: ' + q.ref.sur, 1.8); this.events.push({ type: 'yellow', side: q.side, player: q.ref.sur, minute: Math.floor(this.minute) }); }
                if (this.opts.onSound) this.opts.onSound('boos');
              }
            }
            break;
          }
        }
      }
    }
  }

  // ball reached goal plane `end` (0 = +x end, 1 = -x end)
  resolveCross(end) {
    const b = this.ball;
    const o = b.shotOutcome;
    b.shotOutcome = null;
    if (o && o.kind === 'goal') { this.goal(o.side); return; }
    if (o && (o.kind === 'catch' || o.kind === 'parry')) {
      const gk = this.gk(1 - o.side);
      this.stat[o.side === 0 ? 'home' : 'away'].onTarget++;
      if (gk) gk.rating += 0.12;
      if (o.kind === 'catch' && gk) {
        b.owner = gk; b.lastKicker = gk; this.lastTouchTeam = gk.side;
        b.x = clamp(b.x, -FIELD.w / 2 + 0.5, FIELD.w / 2 - 0.5);
        b.vx = b.vy = b.vz = 0; b.z = 0;
        gk.cooldown = 0.4;
        this.setMessage('Save!', 1.2);
        if (this.opts.onSound) this.opts.onSound('bounce');
      } else {
        // parry back out
        b.x = clamp(b.x, -FIELD.w / 2 + 0.5, FIELD.w / 2 - 0.5);
        b.vx = (end === 0 ? -1 : 1) * (5 + this.r01() * 6);
        b.vy = (this.r01() * 2 - 1) * 10;
        b.vz = 2.5; b.z = Math.max(b.z, 0.4);
        this.lastTouchTeam = gk ? gk.side : 1 - o.side;
        this.setMessage('Save!', 1.2);
        if (this.opts.onSound) this.opts.onSound('bounce');
      }
      return;
    }
    // deflection/pass into the goalmouth: attacker's ball crossing = goal for the
    // side attacking that end (rare); keep it simple and count it.
    const scorer = end === 0 ? (this.dirSide[0] === 1 ? 0 : 1) : (this.dirSide[0] === 1 ? 1 : 0);
    this.goal(scorer);
  }

  outOfBounds() {
    const b = this.ball;
    if (b.owner) return;
    const HW = FIELD.w / 2, HH = FIELD.h / 2;
    // goals: only count the ball crossing the goal plane inside the frame.
    // Pre-rolled shot outcomes resolve here; other balls (passes/deflections) don't score.
    const inMouth = b.z < FIELD.goalH && Math.abs(b.y) < FIELD.goal / 2;
    if (inMouth && b.x >= HW && b.x < HW + 1.05) { this.resolveCross(0); return; }
    if (inMouth && b.x <= -HW && b.x > -HW - 1.05) { this.resolveCross(1); return; }
    if (Math.abs(b.x) > HW + 0.5) {
      // over goal line: corner or goal kick. The end is defended by the side attacking the other end.
      const endSide = this.dirSide[0] === 1 ? (b.x > 0 ? 1 : 0) : (b.x > 0 ? 0 : 1);
      const last = this.lastTouchTeam;
      const corner = last === endSide ? false : true;
      if (corner) {
        this.stat[last === 0 ? 'home' : 'away'].corners++;
        this.restart = { type: 'corner', side: 1 - endSide, x: Math.sign(b.x) * (HW - 0.5), y: Math.sign(b.y || 1) * (HH - 0.5) };
      } else {
        this.restart = { type: 'goalkick', side: endSide, x: Math.sign(b.x) * (HW - 5.5), y: 0 };
      }
      this.placeRestart();
      return;
    }
    if (Math.abs(b.y) > HH + 0.5) {
      this.restart = { type: 'throwin', side: this.lastTouchTeam === 0 ? 1 : 0, x: clamp(b.x, -HW + 1, HW - 1), y: Math.sign(b.y) * (HH - 0.5) };
      this.placeRestart();
      return;
    }
  }

  placeRestart() {
    const b = this.ball, r = this.restart;
    b.x = r.x; b.y = r.y; b.z = 0; b.vx = b.vy = b.vz = 0; b.owner = null;
    b.saveChecked = false; b.shotOutcome = null;
    // nearest player of restarting team takes it
    let taker = null, td = 1e9;
    for (const p of this.teamPlayers(r.side)) {
      const d = len(p.x - r.x, p.y - r.y);
      if (d < td) { td = d; taker = p; }
    }
    if (taker) { taker.x = r.x; taker.y = r.y; taker.tx = null; }
    // goal kicks always taken by the keeper
    if (r.type === 'goalkick') {
      const gk = this.gk(r.side);
      if (gk) { gk.x = r.x; gk.y = r.y; gk.tx = null; taker = gk; }
    }
    if (this.opts.onSound) this.opts.onSound('whistle');
    this.restart = null;
  }

  // substitution (manager live control): index into bench
  substitute(side, outSlotIdx, benchIdx) {
    const list = side === 0 ? this.bench.home : this.bench.away;
    const inP = list[benchIdx];
    if (!inP) return false;
    const outP = this.players.find(p => p.side === side && p.slotIdx === outSlotIdx);
    if (!outP) return false;
    const used = this.subsUsed[side === 0 ? 'home' : 'away'];
    if (used >= 3) return false;
    this.subsUsed[side === 0 ? 'home' : 'away'] = used + 1;
    // swap identity in-place
    outP.id = inP.id; outP.ref = inP; outP.pos = inP.pos;
    outP.speedMax = 6.2 + (inP.skills.speed / 225) * 4.6;
    outP.accel = 5.5 + (inP.skills.anticipation / 225) * 5;
    outP.stamina = 1;
    outP.tackleP = 0.55 + (inP.skills.tackling / 225) * 0.9;
    outP.aggrP = 0.2 + (inP.skills.aggression / 225) * 1.2;
    outP.controlR = 0.9 + (inP.skills.ballControl / 225) * 0.8;
    outP.passAcc = 0.5 + (inP.skills.shotControl / 225) * 1.4;
    outP.shotP = 17 + (inP.skills.shotPower / 225) * 15;
    outP.shotAcc = 0.5 + (inP.skills.shotControl / 225) * 1.5;
    outP.isGK = inP.pos.split(' ')[0] === 'GK';
    outP.anchor = slotAnchor(outP.slotIdx, outP.dir);
    this.setMessage('Sub: ' + inP.sur, 1.6);
    return true;
  }
}

export const TICK_RATE = 0.125; // match-minutes per real-second at speed 1 (90 min ≈ 12 real min)

// slot anchor: fraction of pitch for each SLOT_POS index, dir=+1 attacks +x
export function slotAnchor(slotIdx, dir) {
  const T = [
    [-44, 0], [-30, -14], [-32, -5], [-32, 5], [-30, 14],
    [-12, -15], [-20, 0], [-4, 0], [-12, 15],
    [8, -6], [8, 6],
  ];
  const t = T[slotIdx % T.length];
  return { x: t[0] * dir, y: t[1] };
}
