// Pitch renderer: 800x600 logical canvas, meters -> px, prerendered pitch layer.
import { FIELD, MARGIN, PPM } from './scale.js';

let pitchLayer = null;

export function ensurePitch(ctx) {
  if (pitchLayer) return pitchLayer;
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const g = c.getContext('2d');
  drawPitch(g);
  pitchLayer = c;
  return pitchLayer;
}

function sx(m) { return (m + MARGIN) * PPM.x; }
function sy(m) { return (m + MARGIN) * PPM.y; }

function drawPitch(g) {
  // grass base with stripes
  g.fillStyle = '#156b26'; g.fillRect(0, 0, 800, 600);
  const stripe = (FIELD.w + 16) / 14;
  for (let i = 0; i < 14; i++) {
    if (i % 2) continue;
    g.fillStyle = '#18702a';
    g.fillRect(sx(-FIELD.w / 2 + i * stripe), sy(-FIELD.h / 2), sx(-FIELD.w / 2 + (i + 1) * stripe) - sx(-FIELD.w / 2 + i * stripe), sy(FIELD.h / 2) - sy(-FIELD.h / 2));
  }
  // lines
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2;
  g.strokeRect(sx(-FIELD.w / 2), sy(-FIELD.h / 2), sx(FIELD.w / 2) - sx(-FIELD.w / 2), sy(FIELD.h / 2) - sy(-FIELD.h / 2));
  // halfway
  g.beginPath(); g.moveTo(sx(0), sy(-FIELD.h / 2)); g.lineTo(sx(0), sy(FIELD.h / 2)); g.stroke();
  g.beginPath(); g.arc(sx(0), sy(0), 9.15 * PPM.x, 0, Math.PI * 2); g.stroke();
  // boxes
  const box = (x0, sign) => {
    const w = 16.5, h = 40.3;
    g.strokeRect(sx(sign > 0 ? x0 : x0 - w), sy(-h / 2), sx(sign > 0 ? x0 + w : x0) - sx(sign > 0 ? x0 : x0 - w), sy(h / 2) - sy(-h / 2));
    const w2 = 5.5, h2 = 18.3;
    g.strokeRect(sx(sign > 0 ? x0 : x0 - w2), sy(-h2 / 2), sx(sign > 0 ? x0 + w2 : x0) - sx(sign > 0 ? x0 : x0 - w2), sy(h2 / 2) - sy(-h2 / 2));
    // goal
    g.save();
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath();
    g.moveTo(sx(sign > 0 ? FIELD.w / 2 : -FIELD.w / 2), sy(-FIELD.goal / 2));
    g.lineTo(sx(sign > 0 ? FIELD.w / 2 + 2 : -FIELD.w / 2 - 2), sy(-FIELD.goal / 2));
    g.lineTo(sx(sign > 0 ? FIELD.w / 2 + 2 : -FIELD.w / 2 - 2), sy(FIELD.goal / 2));
    g.lineTo(sx(sign > 0 ? FIELD.w / 2 : -FIELD.w / 2), sy(FIELD.goal / 2));
    g.stroke(); g.restore();
  };
  box(FIELD.w / 2, 1);
  box(-FIELD.w / 2, -1);
  // penalty arcs (approx)
  g.beginPath(); g.arc(sx(FIELD.w / 2 - 11), sy(0), 9.15 * PPM.x, Math.PI * 0.62, Math.PI * 1.38); g.stroke();
  g.beginPath(); g.arc(sx(-FIELD.w / 2 + 11), sy(0), 9.15 * PPM.x, -Math.PI * 0.38, Math.PI * 0.38); g.stroke();
  // corner arcs
  for (const [cx, cy] of [[-FIELD.w / 2, -FIELD.h / 2], [FIELD.w / 2, -FIELD.h / 2], [-FIELD.w / 2, FIELD.h / 2], [FIELD.w / 2, FIELD.h / 2]]) {
    g.beginPath(); g.arc(sx(cx), sy(cy), 1 * PPM.x, 0, Math.PI * 2); g.stroke();
  }
}

// colors from Data/graphics/color_table.txt names
const COLOR_MAP = {
  red: '#f50000', red2: '#f00000', deepred: '#dd0000', white: '#ffffff', blue: '#1010fa',
  lightgrey: '#bbbbbb', grey: '#999999', darkgray: '#555555', green: '#05aa05',
  lightgreen: '#07bb07', darkgreen: '#007700', yellow: '#fdfd02', darkyellow: '#e8ed00',
  lightblue: '#9999fc', brown: '#cc5555', deepblue: '#000099', purple: '#cf91ec',
  violet: '#500050', black: '#000000', orange: '#ee8800', gold: '#d9b128', pink: '#ff9595',
};

export function kitColors(kit, worldColors) {
  const res = {};
  for (const k of ['shirt', 'stripes', 'sleeves', 'shorts', 'socks']) {
    const v = kit ? kit[k] : null;
    if (!v) { res[k] = k === 'shorts' || k === 'socks' ? '#ffffff' : null; continue; }
    res[k] = (worldColors && worldColors.get && worldColors.get(v)) || COLOR_MAP[v] || '#ffffff';
  }
  if (!res.stripes) res.stripes = null;
  return res;
}

export function render(ctx, match, ui) {
  const layer = ensurePitch(ctx);
  ctx.drawImage(layer, 0, 0);
  const b = match.ball;

  // restart indicator
  if (match.restart) {
    // handled after placeRestart clears it; skip
  }

  // players: shadow, body circle with shirt color, shorts ring, number-ish head dot
  const drawPlayer = (p) => {
    const px = (p.x + MARGIN) * PPM.x, py = (p.y + MARGIN) * PPM.y;
    const kit = p.side === 0 ? ui.kitHome : ui.kitAway;
    const shirt = kit.shirt || '#fff';
    const shorts = kit.shorts || '#000';
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(px + 2, py + 3, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
    // body
    const R = 8;
    ctx.fillStyle = shirt;
    if (kit.stripes) {
      ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = kit.stripes;
      for (let i = -R; i < R; i += 4) ctx.fillRect(px + i, py - R, 2, R * 2);
      ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2); ctx.fill();
    }
    // shorts
    ctx.fillStyle = shorts;
    ctx.beginPath(); ctx.arc(px, py + 7, 4.5, 0, Math.PI * 2); ctx.fill();
    // outline: red card/black? highlight user
    if (p.id === match.opts.userPlayerId) {
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(px, py, R + 3, 0, Math.PI * 2); ctx.stroke();
    } else if (p.yellow > 0 || p.red) {
      ctx.strokeStyle = p.red ? '#ff4040' : 'rgba(255,210,60,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, R + 2, 0, Math.PI * 2); ctx.stroke();
    }
    // name tag for user player
    if (p.id === match.opts.userPlayerId) {
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      const nm = p.ref.sur || '';
      ctx.font = '11px -apple-system, sans-serif';
      const w = ctx.measureText(nm).width + 8;
      ctx.fillRect(px - w / 2, py - 26, w, 14);
      ctx.fillStyle = '#ffd24a';
      ctx.textAlign = 'center';
      ctx.fillText(nm, px, py - 15);
      ctx.textAlign = 'start';
    }
    return { px, py };
  };

  // sort so user drawn last
  const arr = match.players.slice();
  arr.sort((a, b) => (a.id === match.opts.userPlayerId ? 1 : 0) - (b.id === match.opts.userPlayerId ? 1 : 0));
  for (const p of arr) drawPlayer(p);

  // ball
  const bx = (b.x + MARGIN) * PPM.x, by = (b.y + MARGIN) * PPM.y - b.z * 2.2;
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse((b.x + MARGIN) * PPM.x, (b.y + MARGIN) * PPM.y + 3, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(bx, by, 4.5 + Math.min(3, b.z), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(bx, by, 4.5 + Math.min(3, b.z), 0, Math.PI * 2); ctx.stroke();
}

// minimap used on dashboards
export function drawMiniPitch(canvas, kitHome, kitAway) {
  const g = canvas.getContext('2d');
  g.fillStyle = '#156b26'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1;
  g.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  g.beginPath(); g.moveTo(canvas.width / 2, 6); g.lineTo(canvas.width / 2, canvas.height - 6); g.stroke();
  g.fillStyle = kitHome.shirt || '#fff';
  g.beginPath(); g.arc(canvas.width * 0.25, canvas.height / 2, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = kitAway.shirt || '#fff';
  g.beginPath(); g.arc(canvas.width * 0.75, canvas.height / 2, 6, 0, Math.PI * 2); g.fill();
}
