// World generation: teams from league files, squads from names DBs.
// Faithful to package rules (Documentation/HowToEdit.txt):
//  - average ability of a team = team reputation * 10 (clamped 1..225)
//  - <11 defined players -> fill with generated players
//  - names DB: <country>_1st.txt = first names, <country>_2nd.txt = surnames
import { parseLeagueFile, parseNames } from './loader.js';

let rngState = (Date.now() ^ 0x9e3779b9) >>> 0;
function rnd() { // xorshift32
  rngState ^= rngState << 13; rngState >>>= 0;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5; rngState >>>= 0;
  return rngState / 4294967296;
}
export function setSeed(s) { rngState = s >>> 0; }
export function ri(n) { return Math.floor(rnd() * n) % n; }
function pick(a) { return a[ri(a.length)]; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function gauss() { return (rnd() + rnd() + rnd() + rnd() - 2) * 1.2; }

// Formation template (position + side), HowToEdit example + common 4-4-2 shape.
const FORMATION = [
  ['GK', 'C'], ['D', 'L'], ['D', 'C'], ['D', 'C'], ['D', 'R'],
  ['M', 'L'], ['DM', 'C'], ['AM', 'C'], ['M', 'R'], ['F', 'C'], ['F', 'C'],
];
export const SLOT_POS = FORMATION.map(p => p[0] + ' ' + p[1]);

const SKILLS = ['speed','shotPower','shotControl','stamina','dribbling','jumping','anticipation','agility','tackling','heading','ballControl','handling','reflexes','aggression','teamwork','offensiveness','vision'];

export function genSkills(ability, pos) {
  const s = {};
  for (const k of SKILLS) s[k] = clamp(Math.round(ability + gauss() * 12), 5, 225);
  // positional shaping (goalies lean on jumping/handling/reflexes per Manual 1.5)
  if (pos.startsWith('GK')) {
    s.handling = clamp(s.handling + 25, 5, 225); s.reflexes = clamp(s.reflexes + 20, 5, 225);
    s.jumping = clamp(s.jumping + 15, 5, 225); s.shotPower = clamp(s.shotPower - 40, 5, 225);
    s.tackling = clamp(s.tackling - 40, 5, 225); s.dribbling = clamp(s.dribbling - 40, 5, 225);
  } else {
    s.handling = clamp(s.handling - 70, 5, 100); s.reflexes = clamp(s.reflexes - 60, 5, 150);
    if (pos.startsWith('F')) { s.shotPower = clamp(s.shotPower + 18, 5, 225); s.heading = clamp(s.heading + 10, 5, 225); s.tackling = clamp(s.tackling - 25, 5, 225); }
    if (pos.startsWith('D')) { s.tackling = clamp(s.tackling + 22, 5, 225); s.jumping = clamp(s.jumping + 10, 5, 225); s.shotPower = clamp(s.shotPower - 20, 5, 225); }
    if (pos.startsWith('M') || pos.startsWith('AM') || pos.startsWith('DM')) { s.ballControl = clamp(s.ballControl + 12, 5, 225); s.vision = clamp(s.vision + 10, 5, 225); }
  }
  return s;
}

export function makePlayer(world, firstName, surname, nationality, ability, pos, age, rep) {
  const id = 'p' + world.nextPlayerId++;
  const p = {
    id, first: firstName, sur: surname, nat: nationality,
    ability: clamp(Math.round(ability), 5, 225), reputation: clamp(Math.round(rep ?? ability), 5, 225),
    potential: 0, age, pos, skills: null, teamId: null,
    season: { goals: 0, assists: 0, apps: 0, rating: 0, ratingN: 0, motm: 0, cards: 0 },
    career: { goals: 0, apps: 0 },
  };
  p.skills = genSkills(p.ability, pos);
  p.potential = clamp(p.ability + Math.round((225 - p.ability) * 0.35 * rnd() + 5), p.ability, 225);
  world.players.set(id, p);
  return p;
}

function genPlayerFor(world, namesDB, nationality, teamRep, slotIdx, ageBias) {
  const first = pick(namesDB.first);
  const sur = pick(namesDB.second);
  const pos = SLOT_POS[slotIdx % SLOT_POS.length];
  // ability spread around team average: stars and weak players, Gauss
  const ability = clamp(teamRep * 10 + gauss() * 22, 30, 225);
  const age = clamp(Math.round(17 + Math.abs(gauss()) * 8 + ageBias), 16, 37);
  const p = makePlayer(world, first, sur, nationality, ability, pos, age, clamp(Math.round(ability + gauss() * 10), 10, 225));
  return p;
}

export function makeTeam(world, name, rep, country, namesKey, teamFile) {
  const id = 't' + world.nextTeamId++;
  const t = {
    id, name, country, rep,
    namesKey, players: [], kit: null, natKit: null,
    morale: 60, finance: Math.round(rep * 40000 + 50000), wageBudget: 0,
    division: null, league: null,
  };
  t.kit = genKit(rep, name);
  const nat = teamFile && teamFile.dresses.length ? teamFile.dresses : null;
  if (nat) t.natKit = nat.map(d => ({ n: d.n, shirt: d.shirt, stripes: d.stripes, sleeves: d.sleeves, shorts: d.shorts, socks: d.socks }));
  world.teams.set(id, t);
  return t;
}

const KIT_COLORS = ['red','white','blue','green','yellow','black','orange','purple','lightblue','deepred','darkgreen','brown','gold','pink'];
function genKit(rep, name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const a = KIT_COLORS[(h >>> 3) % KIT_COLORS.length];
  const b = KIT_COLORS[(h >>> 11) % KIT_COLORS.length];
  const shirt = (h & 1) ? a : b, shorts = (h & 2) ? (shirt === a ? b : a) : 'white';
  const second = (h & 4) ? b : 'white';
  return [
    { n: 1, shirt, stripes: (h & 8) ? second : null, sleeves: null, shorts, socks: null },
    { n: 2, shirt: second, stripes: null, sleeves: null, shorts: second === 'white' ? 'black' : 'white', socks: null },
  ];
}

export async function buildWorld(opts) {
  const world = {
    startYear: opts.startYear || 2010,
    year: opts.startYear || 2010, week: 1,
    nextTeamId: 1, nextPlayerId: 1,
    teams: new Map(), players: new Map(),
    leagues: [], cups: [], countries: [],
    names: new Map(), // namesKey -> {first:[], second:[]}
    colors: opts.colors,
    userPlayerId: null, userTeamId: null, mode: 'manager',
    fixtures: [], results: [], tableState: new Map(),
  };
  const { leagueFiles, teamFiles, startYear } = opts;
  world.startYear = world.year = startYear;

  // parse files
  const parsed = [];
  for (const lf of leagueFiles) {
    const f = parseLeagueFile(lf.text);
    f.fileName = lf.name;
    parsed.push(f);
  }
  // names DBs (unique per file pair)
  for (const f of parsed) {
    if (!f.names) continue;
    const key = f.names[0];
    if (world.names.has(key)) continue;
    let first = [], second = [];
    try {
      const t1 = await opts.readText(f.names[0]);
      const t2 = await opts.readText(f.names[1]);
      first = parseNames(t1); second = parseNames(t2);
    } catch (e) { console.warn('names db missing', f.names, e); }
    world.names.set(key, { first, second, key, country: f.country });
  }

  // create teams (league files first: they define canonical clubs)
  const seenNames = new Set();
  function countryKey(country) {
    for (const f of parsed) if (f.country === country) return f.names ? f.names[0] : null;
    return null;
  }
  function createClub(name, rep, country) {
    const existing = [...world.teams.values()].find(t => t.name === name);
    if (existing) return existing;
    seenNames.add(name);
    const key = countryKey(country);
    const t = makeTeam(world, name, rep, country, key, null);
    return t;
  }
  for (const f of parsed) {
    if (f.additional) continue;
    if (!f.country) continue;
    if (!world.countries.includes(f.country)) world.countries.push(f.country);
    for (const lg of f.leagues) {
      const league = { name: lg.name, country: f.country, division: lg.division, promotions: lg.promotions, relegations: lg.relegations, reputation: lg.reputation, teams: [] };
      world.leagues.push(league);
      for (const tname of lg.teams) {
        const t = createClub(tname, lg.reputation, f.country);
        t.league = league.name; t.division = lg.division;
        league.teams.push(t.id);
      }
    }
  }
  // national teams from Data/Team/*.txt
  for (const tf of teamFiles) {
    const parsedTeam = tf.parsed;
    const name = parsedTeam.name || tf.name.replace(/\.txt$/i, '');
    const t = [...world.teams.values()].find(x => x.name === name);
    const nat = t || makeTeam(world, name, 15, name, null, parsedTeam);
    nat.natKit = parsedTeam.dresses.map(d => ({ n: d.n, shirt: d.shirt, stripes: d.stripes, sleeves: d.sleeves, shorts: d.shorts, socks: d.socks }));
    nat.isNational = true;
  }
  // national team squads from country of the same name if a league file supplied names
  for (const t of world.teams.values()) {
    if (!t.isNational) continue;
    const key = countryKey(t.name);
    if (key && world.names.has(key)) {
      const db = world.names.get(key);
      const rep = clamp(10 + world.leagues.filter(l => l.country === t.name).reduce((a, l) => Math.max(a, l.reputation), 0), 12, 20);
      t.rep = rep;
      const squad = [];
      for (let i = 0; i < 18; i++) squad.push(genPlayerFor(world, db, t.name, rep, i, 0));
      t.players = squad.map(p => p.id);
      for (const p of squad) p.teamId = t.id;
    }
  }
  // clubs: squads
  for (const t of world.teams.values()) {
    if (t.players.length || t.isNational) continue;
    const db = t.namesKey && world.names.get(t.namesKey);
    const rep = t.rep;
    const squad = [];
    if (db && db.first.length && db.second.length) {
      for (let i = 0; i < 18; i++) squad.push(genPlayerFor(world, db, t.country, rep, i, 0));
    } else {
      // fallback: any names db
      const fb = [...world.names.values()].find(n => n.first.length);
      for (let i = 0; i < 18; i++) squad.push(genPlayerFor(world, fb || { first: ['Sam'], second: ['Player'] }, t.country, rep, i, 0));
    }
    t.players = squad.map(p => p.id);
    for (const p of squad) p.teamId = t.id;
  }
  // cup definitions (non-international first pass)
  for (const f of parsed) {
    for (const cd of f.cups) {
      const cup = { name: cd.name, country: f.country, reputation: cd.reputation, international: cd.international, nations: cd.nations, rounds: cd.rounds.map(r => ({ ...r, teams: [] })), entries: [], winnerId: null, intro: cd.intro };
      world.cups.push(cup);
    }
  }
  // sort leagues: country division order
  world.leagues.sort((a, b) => a.country.localeCompare(b.country) || a.division - b.division);
  return world;
}

export function squadOf(world, teamId) { return world.teams.get(teamId).players.map(id => world.players.get(id)); }
export function bestXI(team) {
  // pick strongest legal XI by ability in SLOT_POS shape
  const ps = team.players.map(id => worldCache.players.get(id));
  const used = new Set(); const xi = [];
  for (const slot of SLOT_POS) {
    let best = null, bestScore = -1;
    for (const p of ps) {
      if (used.has(p.id)) continue;
      let score = p.ability;
      if (p.pos === slot) score += 60;
      else if (posCompatible(p.pos, slot)) score += 15;
      else score -= 80;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best) { used.add(best.id); xi.push(best); } else xi.push(null);
  }
  return xi;
}
export function posCompatible(a, b) {
  if (a === b) return true;
  const A = a.split(' ')[0], B = b.split(' ')[0];
  const rank = { GK: 0, SW: 1, D: 2, DM: 3, M: 4, AM: 5, F: 6 };
  return Math.abs(rank[A] - rank[B]) <= 1 && !(A === 'GK' || B === 'GK');
}

// module-level cache so bestXI can work without passing world everywhere
let worldCache = null;
export function setWorld(w) { worldCache = w; }
export function getWorld() { return worldCache; }
