// Season: calendar (52 weeks), league fixtures, cup rounds, tables, promotion/relegation.
// Rules from package: league rounds from week 7 (Manual 3); cup rounds have fixed weeks;
// promotions/relegations connect divisions; start year 2010 (Data/StartYear.txt).
import { setSeed, ri } from './world.js';

export const WEEKS = 52;
export const LEAGUE_START_WEEK = 7;
export const LEAGUE_END_WEEK = 46;

export function buildFixtures(world) {
  setSeed((world.year * 2654435761) >>> 0);
  world.fixtures = [];
  const leagues = world.leagues.filter(l => l.teams.length >= 3);
  for (const lg of leagues) {
    const ids = lg.teams.slice();
    shuffle(ids);
    const n = ids.length;
    const rounds = 2 * (n - 1);
    // schedule league rounds over weeks LEAGUE_START..LEAGUE_END, 1 round/week,
    // skipping weeks that this country's cups also use (matches moved to next free week)
    const busy = new Set();
    for (const cup of world.cups) {
      if (cup.international || cup.country !== lg.country) continue;
      for (const r of cup.rounds) {
        const wk = r.weeks ? r.weeks[0] : r.week;
        if (wk >= LEAGUE_START_WEEK && wk <= LEAGUE_END_WEEK) busy.add(wk);
      }
    }
    const weeks = [];
    for (let w = LEAGUE_START_WEEK; w <= LEAGUE_END_WEEK && weeks.length < rounds; w++) {
      if (!busy.has(w)) weeks.push(w);
    }
    let wi = 0;
    // round robin (circle method), second half mirrored
    for (let r = 0; r < rounds; r++) {
      const wk = weeks[Math.min(wi++, weeks.length - 1)] || LEAGUE_END_WEEK;
      for (let i = 0; i < n / 2; i++) {
        const a = ids[i], b = ids[n - 1 - i];
        const home = (r % 2 === 0) ? a : b;
        const away = (r % 2 === 0) ? b : a;
        if (home !== away) addFixture(world, { homeId: home, awayId: away, week: wk, league: lg.name, round: r + 1 });
      }
      ids.splice(1, 0, ids.pop()); // rotate
    }
  }
  // cups: entries + pairings
  for (const cup of world.cups) {
    buildCup(world, cup);
  }
  world.fixtures.sort((a, b) => a.week - b.week || (a.league || '').localeCompare(b.league || ''));
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } }

export function addFixture(world, f) {
  const fx = { id: 'f' + world.fixtures.length, played: false, hg: null, ag: null, ...f };
  world.fixtures.push(fx);
  return fx;
}

// Cup filling per DSL semantics:
//  round i "Name" a-b [week] means: round contains (a-b) teams (b-a+1 when both given? docs: "1-128" = all 128 play).
//  We interpret: round takes the (to - from + 1) winners/entries available, fills from adds if first round.
//  adds: N from "Country" (best teams), N cup-winner "Cup RoundName", N team "Name" (conditional <K).
function buildCup(world, cup) {
  if (cup.international) { buildInternational(world, cup); return; }
  const country = cup.country;
  const byRep = [...world.teams.values()].filter(t => t.country === country && !t.isNational)
    .sort((a, b) => b.rep - a.rep || a.name.localeCompare(b.name));
  let pool = byRep.slice();
  let round = cup.rounds.find(r => r.adds && r.adds.length) || cup.rounds[0];
  // first round entries: count = from..to span of first round with adds before it
  let entries = [];
  for (const r of cup.rounds) {
    if (r.adds) {
      for (const a of r.adds) {
        if (a.type === 'from') {
          entries.push(...pool.slice(0, a.count)); pool = pool.slice(a.count);
        }
      }
    }
  }
  // fallback: no adds -> seed from cup country reputation list
  if (!entries.length) {
    const r0 = cup.rounds[0];
    const span = r0.from - r0.to >= 0 ? r0.from : r0.to;
    entries = pool.slice(0, Math.min(pool.length, span));
  }
  cup.entries = entries.map(t => t.id);
  // pair only the first round; later rounds are paired dynamically from winners
  // (main.js pairCupRounds). Never emit placeholder fixtures with null team ids.
  let current = cup.entries.slice();
  for (const r of cup.rounds) {
    if (!current.length) break;
    const size = Math.max(2, Math.min(current.length, r.to - r.from + 1 > 0 ? r.to - r.from + 1 : current.length));
    const target = Math.min(current.length, Math.max(2, size));
    current = current.slice(0, target);
    const weeks = r.weeks ? r.weeks : (r.week ? [r.week] : []);
    const legWeeks = r.matches ? r.matches.slice(0, 2) : null;
    r._tieWeeks = legWeeks ? legWeeks : weeks;
    for (let i = 0; i + 1 < current.length; i += 2) {
      const a = current[i], b = current[i + 1];
      r.teams.push(a, b);
      if (legWeeks && legWeeks.length >= 2) {
        addFixture(world, { homeId: b, awayId: a, week: legWeeks[0], cup: cup.name, roundName: r.name, leg: 1, tie: cup.name + ':' + r.name + ':' + (i / 2) });
        addFixture(world, { homeId: a, awayId: b, week: legWeeks[1], cup: cup.name, roundName: r.name, leg: 2, tie: cup.name + ':' + r.name + ':' + (i / 2) });
      } else if (weeks.length) {
        addFixture(world, { homeId: a, awayId: b, week: weeks[0], cup: cup.name, roundName: r.name, tie: cup.name + ':' + r.name + ':' + (i / 2) });
      }
    }
    // stop: subsequent rounds get fixtures from dynamic winner pairing
    current = [];
  }
}

function buildInternational(world, cup) {
  // v1 approximation: national-team tournament for top nations by country reputation.
  // Domestic DSL (groups/venues/cup-winner seeding) needs the engine's full semantics;
  // we schedule a 16-team knockout in the cup's declared weeks.
  const nations = [...world.teams.values()].filter(t => t.isNational && t.players.length)
    .sort((a, b) => b.rep - a.rep);
  const rounds = cup.rounds.filter(r => r.weeks && r.weeks.length);
  if (!rounds.length || nations.length < 16) return;
  const seeds = nations.slice(0, 16).map(t => t.id);
  cup.entries = seeds.slice();
  let current = shuffle(seeds.slice());
  for (let i = 0; i + 1 < current.length; i += 2) {
    const r = rounds[0];
    addFixture(world, { homeId: current[i], awayId: current[i + 1], week: r.weeks[0], cup: cup.name, roundName: r.name, tie: cup.name + ':' + r.name + ':' + i / 2 });
  }
  // later rounds are paired from winners at runtime (same as domestic)
}

// ---------------- cup progression (winners -> next round pairing, with byes) ----------------
function computeWinners(w, cup, rfx) {
  const winners = [];
  const ties = new Map();
  for (const f of rfx) {
    const key = f.tie || f.id;
    if (!ties.has(key)) ties.set(key, []);
    ties.get(key).push(f);
  }
  for (const [, legs] of ties) {
    const a0 = legs[0].homeId, b0 = legs[0].awayId;
    if (legs.length >= 2) {
      const aggA = legs[0].hg + legs[1].ag, aggB = legs[0].ag + legs[1].hg;
      if (aggA > aggB) winners.push(a0);
      else if (aggB > aggA) winners.push(b0);
      else {
        const ta = w.teams.get(a0), tb = w.teams.get(b0);
        winners.push(Math.random() < 0.5 + (ta.rep - tb.rep) * 0.012 ? a0 : b0);
      }
    } else {
      const f = legs[0];
      if (f.hg > f.ag) winners.push(f.homeId);
      else if (f.ag > f.hg) winners.push(f.awayId);
      else {
        const ta = w.teams.get(f.homeId), tb = w.teams.get(f.awayId);
        winners.push(Math.random() < 0.5 + (ta.rep - tb.rep) * 0.012 ? f.homeId : f.awayId);
      }
    }
  }
  return winners;
}

function makeRoundFixtures(w, cup, r, entrants) {
  const weeks = r.weeks && r.weeks.length ? r.weeks : (r.week ? [r.week] : [w.week + 1]);
  const twoLeg = r.matches && r.matches.length >= 2;
  for (let k = 0; k + 1 < entrants.length; k += 2) {
    const tie = cup.name + ':' + r.name + ':' + (k / 2);
    if (twoLeg) {
      w.fixtures.push({ id: 'f' + w.fixtures.length, played: false, hg: null, ag: null,
        homeId: entrants[k + 1], awayId: entrants[k], week: r.matches[0], cup: cup.name, roundName: r.name, leg: 1, tie });
      w.fixtures.push({ id: 'f' + w.fixtures.length, played: false, hg: null, ag: null,
        homeId: entrants[k], awayId: entrants[k + 1], week: r.matches[1], cup: cup.name, roundName: r.name, leg: 2, tie });
    } else {
      w.fixtures.push({ id: 'f' + w.fixtures.length, played: false, hg: null, ag: null,
        homeId: entrants[k], awayId: entrants[k + 1], week: weeks[0] || w.week + 1, cup: cup.name, roundName: r.name, tie });
    }
  }
  // odd leftover team carries into the round after that (bye)
  r._byes = entrants.length % 2 ? [entrants[entrants.length - 1]] : [];
}

// resolve rounds fed purely by byes (no fixtures yet): pair, or carry lone team forward
function resolveByes(w, cup, startIdx) {
  for (let j = startIdx; j < cup.rounds.length; j++) {
    const r = cup.rounds[j];
    if (w.fixtures.some(f => f.cup === cup.name && f.roundName === r.name && f.homeId)) return;
    const entrants = (r._byes || []).filter(id => w.teams.has(id));
    if (entrants.length >= 2) { makeRoundFixtures(w, cup, r, entrants); return; }
    if (entrants.length === 1) {
      const nnr = cup.rounds[j + 1];
      if (!nnr) { if (!cup.winnerId) cup.winnerId = entrants[0]; }
      else { nnr._byes = (nnr._byes || []).concat(entrants); r._byes = []; continue; }
    }
    return;
  }
}

export function pairCupRounds(world) {
  const w = world;
  for (const cup of w.cups) {
    for (let i = 0; i < cup.rounds.length; i++) {
      const r = cup.rounds[i];
      const rfx = w.fixtures.filter(f => f.cup === cup.name && f.roundName === r.name && f.homeId);
      if (!rfx.length || r._paired || !rfx.every(f => f.played)) continue;
      const winners = computeWinners(w, cup, rfx);
      const nr = cup.rounds[i + 1];
      if (!nr) {
        if (!cup.winnerId && winners.length) cup.winnerId = winners[0];
      } else {
        // forward stranded byes of this round + winners into next round
        nr._byes = (nr._byes || []).filter(id => w.teams.has(id))
          .concat((r._byes || []).filter(id => w.teams.has(id)))
          .concat(winners.filter(x => x));
        r._byes = [];
        const hasFx = w.fixtures.some(f => f.cup === cup.name && f.roundName === nr.name && f.homeId);
        if (!hasFx && nr._byes.length >= 2) makeRoundFixtures(w, cup, nr, nr._byes);
      }
      r._paired = true;
      resolveByes(w, cup, i + 1);
    }
  }
}

// ---------------- tables ----------------
export function initTables(world) {
  world.tableState = new Map();
  for (const lg of world.leagues) {
    const st = new Map();
    for (const id of lg.teams) st.set(id, { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
    world.tableState.set(lg.name, st);
  }
}

export function applyResult(world, f) {
  if (f.league) {
    const st = world.tableState.get(f.league);
    if (!st) return;
    const h = st.get(f.homeId), a = st.get(f.awayId);
    if (!h || !a) return;
    h.p++; a.p++; h.gf += f.hg; h.ga += f.ag; a.gf += f.ag; a.ga += f.hg;
    if (f.hg > f.ag) { h.w++; a.l++; h.pts += 3; }
    else if (f.hg < f.ag) { a.w++; h.l++; a.pts += 3; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  // player stats
  for (const side of ['home', 'away']) {
    const tid = side === 'home' ? f.homeId : f.awayId;
    const goals = side === 'home' ? f.hg : f.ag;
    const t = world.teams.get(tid);
    if (!t || !t.players.length || !goals) continue;
    const ps = t.players.map(id => world.players.get(id));
    const attack = ps.filter(p => p && (p.pos.startsWith('F') || p.pos.startsWith('AM') || p.pos.startsWith('M')));
    for (let g = 0; g < goals; g++) {
      if (!attack.length) break;
      const p = attack[ri(attack.length)];
      p.season.goals++; p.career.goals++;
    }
  }
}

export function tableFor(world, leagueName) {
  const st = world.tableState.get(leagueName);
  if (!st) return [];
  const rows = [...st.entries()].map(([id, s]) => ({ id, ...s, gd: s.gf - s.ga }));
  rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.id.localeCompare(b.id));
  return rows;
}

// ---------------- season progression ----------------
export function endOfSeason(world) {
  // promotions/relegations between divisions of same country
  const byCountry = new Map();
  for (const lg of world.leagues) {
    if (!byCountry.has(lg.country)) byCountry.set(lg.country, []);
    byCountry.get(lg.country).push(lg);
  }
  for (const [country, lgs] of byCountry) {
    lgs.sort((a, b) => a.division - b.division);
    for (let i = 0; i < lgs.length - 1; i++) {
      const hi = lgs[i], lo = lgs[i + 1];
      const hiTable = tableFor(world, hi.name);
      const loTable = tableFor(world, lo.name);
      if (hiTable.length < hi.relegations || loTable.length < lo.promotions) continue;
      const down = hiTable.slice(hiTable.length - hi.relegations).map(r => r.id);
      const up = loTable.slice(0, lo.promotions).map(r => r.id);
      for (let k = 0; k < Math.min(down.length, up.length); k++) {
        swapTeam(world, hi, down[k], lo, up[k]);
      }
    }
  }
  // reset stats
  world.year++;
  for (const p of world.players.values()) {
    p.season = { goals: 0, assists: 0, apps: 0, rating: 0, ratingN: 0, motm: 0, cards: 0 };
    // aging
    p.age++;
    if (p.age > 30) p.ability = Math.max(30, p.ability - Math.round((p.age - 30) * 2 * Math.random()));
    else if (p.age < 25 && p.potential > p.ability) p.ability = Math.min(p.potential, p.ability + Math.round(1 + 4 * Math.random()));
  }
  world.fixtures = [];
  world.results = [];
  initTables(world);
  buildFixtures(world);
}

function swapTeam(world, hi, downId, lo, upId) {
  hi.teams = hi.teams.map(id => id === downId ? upId : id);
  lo.teams = lo.teams.map(id => id === upId ? downId : id);
  const d = world.teams.get(downId), u = world.teams.get(upId);
  if (d) { d.league = hi.name; d.division = hi.division; }
  if (u) { u.league = lo.name; u.division = lo.division; }
}

export function fixturesOfWeek(world, week) {
  return world.fixtures.filter(f => f.week === week && !f.played);
}

export function resultsOfWeek(world, week) {
  return world.fixtures.filter(f => f.week === week && f.played);
}

// quick statistical sim for non-user matches (fidelity per reputation/ability)
export function quickResult(world, f) {
  const th = world.teams.get(f.homeId), ta = world.teams.get(f.awayId);
  const sh = strength(world, th), sa = strength(world, ta);
  const homeAdv = 1.18;
  const xh = 1.35 * Math.pow(sh / 120, 2) * homeAdv, xa = 1.35 * Math.pow(sa / 120, 2);
  return { hg: pois(Math.max(0.05, xh)), ag: pois(Math.max(0.05, xa)) };
}
function strength(world, t) {
  if (!t || !t.players.length) return t ? t.rep * 10 : 100;
  let s = 0, n = 0;
  for (const id of t.players.slice(0, 14)) { const p = world.players.get(id); if (p) { s += p.ability; n++; } }
  return n ? s / n : t.rep * 10;
}
function pois(lambda) {
  const L = Math.exp(-lambda); let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}
