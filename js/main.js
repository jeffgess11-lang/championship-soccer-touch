// App controller: data loading, career flow, match loop (fixed 60 Hz + rAF).
import { parseColorTable, parseTeamFile, parseLanguage } from './loader.js';
import { buildWorld, setWorld, setSeed, makePlayer, squadOf, posCompatible } from './world.js';
import { initTables, buildFixtures, applyResult, quickResult, endOfSeason, pairCupRounds, WEEKS } from './season.js';
import { Match, TICK } from './match.js';
import { render, kitColors } from './pitch.js';
import { UI, $, h } from './ui.js';
import { audio } from './audio.js';
import { attachJoystick } from './touch.js';
import * as save from './save.js';

const LEAGUE_FILES = [
  'Argentina', 'Austria', 'Belgium', 'Croatia', 'Czech Republic', 'England', 'France',
  'Germany', 'Greece', 'Holland', 'Italy', 'Poland', 'Portugal', 'Qatar', 'Russia',
  'Scotland', 'South Africa', 'Spain', 'Sweden', 'Switzerland', 'Turkey', 'Ukraine', 'Yugoslavia',
];
const TEAM_FILES = ['Albania', 'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahrain', 'Belarus', 'Belgium', 'Benin', 'Bolivia', 'Bosnia-Herzegovina', 'Botswana', 'Brazil', 'Bulgaria', 'Cameroon', 'Canada', 'Cape Verde Islands', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Costa Rica', 'Croatia', 'Cyprus', 'Czech Republic', 'Democratic Republic of Congo', 'Denmark', 'Djibouti', 'Ecuador', 'Egypt', 'El Salvador', 'England', 'Estonia', 'Faroe Islands', 'Fiji', 'Finland', 'France', 'FYR of Macedonia', 'Gabon', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Guatemala', 'Guinea', 'Holland', 'Honduras', 'Hungary', 'Iceland', 'Iran', 'Iraq', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Kazakhstan', 'Kenya', 'Kosovo', 'Kuwait', 'Latvia', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Malta', 'Mauritania', 'Mexico', 'Moldova', 'Montenegro', 'Morocco', 'Mozambique', 'Namibia', 'New Caledonia', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'Northern Ireland', 'Norway', 'Oman', 'Panama', 'Paraguay', 'Peru', 'Poland', 'Portugal', 'Qatar', 'Republic of Ireland', 'Romania', 'Russia', 'Rwanda', 'San Marino', 'Saudi Arabia', 'Scotland', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'South Africa', 'South Korea', 'Spain', 'Sudan', 'Surinam', 'Swaziland', 'Sweden', 'Switzerland', 'Tahiti', 'Tanzania', 'Thailand', 'The Congo', 'The Gambia', 'The Philippines', 'Togo', 'Tonga', 'Trinidad & Tobago', 'Tunisia', 'Turkey', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Venezuela', 'Wales', 'Yugoslavia', 'Zambia', 'Zimbabwe'];

class App {
  constructor() {
    this.ui = new UI(this);
    this.world = null;
    this.availableCountries = LEAGUE_FILES;
    this.colors = null;
    this.lang = null;
    this.match = null;
    this.hud = null;
    this.joy = null;
    this.canvas = $('#pitch');
    this.ctx = this.canvas.getContext('2d');
  }

  async boot() {
    const [colors, lang, manifest] = await Promise.all([
      fetch('assets/data/color_table.txt').then(r => r.text()),
      fetch('assets/data/English.txt').then(r => r.text()),
      fetch('assets/manifest.json').then(r => r.json()).catch(() => null),
    ]);
    this.colors = parseColorTable(colors);
    this.lang = parseLanguage(lang);
    this.manifest = manifest; // actual asset paths; GitHub Pages is case-sensitive
    this.manifestMap = manifest ? new Map(manifest.map(p => [p.toLowerCase(), p])) : null;
    this.ui.mainMenu();
  }

  readText(relPath) {
    // data/names/X.txt -> assets/data/names/X.txt ; data/League/X -> assets/data/leagues/X.txt
    let p = relPath.replace(/\\/g, '/').toLowerCase();
    p = p.replace(/^data\/league\//, 'assets/data/leagues/');
    p = p.replace(/^data\/team\//, 'assets/data/teams/');
    p = p.replace(/^data\/names\//, 'assets/data/names/');
    p = p.replace(/^data\//, 'assets/data/');
    if (!/\.txt$/i.test(p)) p += '.txt';
    // resolve to actual on-disk case (GitHub Pages is case-sensitive)
    if (this.manifestMap) {
      const real = this.manifestMap.get(p);
      if (real) p = real;
    }
    return fetch(p).then(r => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.text(); });
  }

  hasSave() { return save.hasSave(); }

  async newCareer(countries) {
    this.ui.setHTML(h('div', { class: 'dash' }, h('h2', {}, 'Building world…')));
    setSeed(0xC0FFEE);
    const files = [];
    for (const c of countries) {
      try {
        const text = await this.readText('data/League/' + c);
        files.push({ name: c, text });
      } catch (e) { console.warn('league missing', c); }
    }
    // national team kit files for selected countries
    const teamFiles = [];
    for (const c of countries) {
      try {
        const text = await this.readText('data/Team/' + c);
        teamFiles.push({ name: c, parsed: parseTeamFile(text) });
      } catch (e) { /* no file */ }
    }
    const startYear = 2010;
    const world = await buildWorld({
      leagueFiles: files, teamFiles, startYear,
      colors: this.colors,
      readText: (p) => this.readText(p),
    });
    world.mode = 'manager';
    world.lineups = new Map();
    world.tactics = new Map();
    initTables(world);
    buildFixtures(world);
    setWorld(world);
    this.world = world;
    // team select from top division of first country
    const first = world.leagues.filter(l => l.division === 1);
    const teams = [];
    for (const lg of first) for (const id of lg.teams) teams.push(world.teams.get(id));
    this.ui.teamSelect(teams, 'manager');
  }

  quickStart() {
    this.newCareer(['England', 'Germany']).then(() => { /* team select shown */ });
  }

  continueCareer() {
    const w = save.load();
    if (!w) return;
    w.colors = this.colors;
    setWorld(w);
    this.world = w;
    this.ui.dash();
  }

  async startCareerWith(team, mode) {
    const w = this.world;
    w.userTeamId = team.id;
    w.mode = mode;
    this.ui.modeSelect ? null : null;
    // default lineup + tactic
    this.getLineup(team.id);
    if (!w.tactics.has(team.id)) w.tactics.set(team.id, { pressing: 3, line: 3, tempo: 3 });
    if (mode === 'player') { this.ui.playerCreate(team); return; }
    this.saveGame();
    this.ui.dash();
  }

  rollSkills() {
    // player skills on 1..200-ish scale; a few random archetypes
    const base = 120 + Math.round(Math.random() * 50);
    const out = {};
    for (const k of ['speed','shotPower','shotControl','stamina','dribbling','jumping','anticipation','agility','tackling','heading','ballControl','handling','reflexes','aggression','teamwork','offensiveness','vision']) {
      out[k] = Math.max(30, Math.min(200, Math.round(base + (Math.random() * 60 - 30))));
    }
    return out;
  }

  startPlayerCareer(team, pos, skills) {
    const w = this.world;
    const db = w.names.get(team.namesKey) || { first: ['Alex'], second: ['Touch'] };
    const first = db.first[Math.floor(Math.random() * db.first.length)] || 'Alex';
    const sur = db.second[Math.floor(Math.random() * db.second.length)] || 'Touch';
    const p = makePlayer(w, first, sur, team.country, Math.round((skills.speed + skills.shotPower + skills.ballControl) / 3), pos, 18, 60);
    // apply rolled skills
    for (const [k, v] of Object.entries(skills)) p.skills[k] = v;
    team.players.unshift(p.id);
    p.teamId = team.id;
    w.userPlayerId = p.id;
    w.mode = 'player';
    this.getLineup(team.id);
    this.saveGame();
    this.ui.dash();
  }

  getLineup(teamId) {
    const w = this.world;
    if (!w.lineups.has(teamId)) {
      const team = w.teams.get(teamId);
      const xi = this.autoLineup(teamId);
      w.lineups.set(teamId, xi);
    }
    return w.lineups.get(teamId);
  }

  autoLineup(teamId) {
    const w = this.world;
    const team = w.teams.get(teamId);
    const squad = squadOf(w, teamId);
    const SLOTS = ['GK C','D L','D C','D C','D R','M L','DM C','AM C','M R','F C','F C'];
    const used = new Set(); const xi = [];
    for (const slot of SLOTS) {
      let best = null, bs = -1e9;
      for (const p of squad) {
        if (!p || used.has(p.id)) continue;
        let s = p.ability;
        if (p.pos === slot) s += 60;
        else if (posCompatible(p.pos, slot)) s += 15;
        else s -= 80;
        if (s > bs) { bs = s; best = p; }
      }
      if (best) { used.add(best.id); xi.push(best.id); } else xi.push(null);
    }
    return xi;
  }

  benchFor(teamId) {
    const w = this.world;
    const team = w.teams.get(teamId);
    const xi = this.getLineup(teamId);
    return team.players.filter(id => !xi.includes(id)).slice(0, 7);
  }

  saveGame() { if (this.world) { save.save(this.world); } }

  exitToMenu() { this.match = null; this.world = null; setWorld(null); this.ui.mainMenu(); }

  // ---------- season flow ----------
  advanceToMatch() {
    this.processWeeks(true);
    this.ui.dash();
  }

  processWeeks(stopAtUser) {
    const w = this.world;
    let guard = 0;
    while (w.week <= WEEKS && guard++ < WEEKS + 4) {
      const fxs = w.fixtures.filter(f => f.week === w.week && !f.played);
      const userFx = fxs.find(f => f.homeId === w.userTeamId || f.awayId === w.userTeamId);
      if (userFx && stopAtUser) { this.ui.dash(); return; }
      for (const f of fxs) {
        if (f.homeId === w.userTeamId || f.awayId === w.userTeamId) continue;
        const { hg, ag } = quickResult(w, f);
        f.hg = hg; f.ag = ag; f.played = true;
        applyResult(w, f);
      }
      // cup pairing of winners into next rounds
      this.pairCupRounds(w);
      w.week++;
    }
    // season end
    if (w.week > WEEKS) this.endSeason();
    this.ui.dash();
  }

  pairCupRounds(w) { pairCupRounds(w); }

  playNext() {
    const w = this.world;
    const fxs = w.fixtures.filter(f => f.week === w.week && !f.played);
    const userFx = fxs.find(f => f.homeId === w.userTeamId || f.awayId === w.userTeamId);
    if (!userFx) { this.processWeeks(false); return; }
    this.startMatch(userFx);
  }

  endSeason() {
    const w = this.world;
    // finish any remaining
    while (w.week <= WEEKS) {
      for (const f of w.fixtures.filter(f => f.week === w.week && !f.played)) {
        const { hg, ag } = quickResult(w, f);
        f.hg = hg; f.ag = ag; f.played = true;
        applyResult(w, f);
      }
      w.week++;
    }
    endOfSeason(w);
    w.week = 1;
    // rebuild lineups for promoted teams unchanged; ok
    this.saveGame();
    this.ui.dash();
  }

  // ---------- interactive match ----------
  kitFor(side, homeTeam, awayTeam) {
    const w = this.world;
    const kh = kitColors(homeTeam.kit, w.colors);
    let ka = kitColors(awayTeam.kit, w.colors);
    if (kh.shirt && ka.shirt && kh.shirt.toLowerCase() === ka.shirt.toLowerCase()) {
      const alt = awayTeam.kit && awayTeam.kit[1] ? awayTeam.kit[1] : null;
      ka = kitColors(alt || { shirt: 'yellow', shorts: 'black' }, w.colors);
    }
    return side === 0 ? kh : ka;
  }

  startMatch(f) {
    const w = this.world;
    const homeTeam = w.teams.get(f.homeId), awayTeam = w.teams.get(f.awayId);
    const home = { team: homeTeam, xi: this.getLineup(homeTeam.id), bench: this.benchFor(homeTeam.id) };
    const away = { team: awayTeam, xi: this.getLineup(awayTeam.id), bench: this.benchFor(awayTeam.id) };
    const isUser = f.homeId === w.userTeamId || f.awayId === w.userTeamId;
    const userSide = f.awayId === w.userTeamId ? 1 : 0;
    this.match = new Match(w, home, away, {
      userPlayerId: w.mode === 'player' ? w.userPlayerId : null,
      tacticHome: w.tactics.get(homeTeam.id), tacticAway: w.tactics.get(awayTeam.id),
      onEvent: (e) => {
        if (e.type === 'goal') audio.play('goal');
        if (e.type === 'full') audio.play('whistle');
      },
      onSound: (s) => audio.play(s),
    });
    this.match.fx = f;
    this.match.userSide = isUser ? userSide : -1;
    this.uiKit = { kitHome: this.kitFor(0, homeTeam, awayTeam), kitAway: this.kitFor(1, homeTeam, awayTeam) };
    audio.unlock(); audio.startCrowd();
    this.hud = this.ui.matchHUD(this.match, {
      mode: isUser ? w.mode : 'watch',
      pause: () => { this.match.paused = !this.match.paused; },
      tactics: () => this.ui.tacticsSheet(this.match),
      subs: () => this.ui.subsSheet(this.match, w, w.userTeamId),
      skip: () => this.skipMatch(),
      quit: () => this.abortMatch(),
      action: (k) => this.match.userAction(k),
      onJoyAttached: (el) => {
        if (this.joy) this.joy.detach();
        this.joy = attachJoystick(el, (x, y) => { this.match.userInput = { x, y }; });
      },
    });
    this.lastT = performance.now();
    this.acc = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  frame(now) {
    const m = this.match;
    if (!m) return;
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dt > 0.25) dt = 0.25; // tab switch guard
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK && steps < 8) {
      m.simulate(TICK);
      this.acc -= TICK;
      steps++;
    }
    if (m.minute >= 45 && !m._secondHalfSpeed && m.speed < 2) { /* optional auto speed */ }
    render(this.ctx, m, this.uiKit);
    this.hud.update();
    if (!m.finished) requestAnimationFrame((t) => this.frame(t));
    else this.finishMatch();
  }

  skipMatch() {
    const m = this.match;
    // fast-forward synchronously in bounded chunks
    const chunk = () => {
      for (let i = 0; i < 600 && !m.finished; i++) m.simulate(TICK);
      if (!m.finished) requestAnimationFrame(chunk);
      else { render(this.ctx, m, this.uiKit); this.finishMatch(); }
    };
    chunk();
  }

  abortMatch() {
    if (this.joy) { this.joy.detach(); this.joy = null; }
    this.hud.hide();
    audio.stopCrowd();
    this.match = null;
    this.ui.dash();
  }

  finishMatch() {
    const m = this.match, w = this.world;
    if (this.joy) { this.joy.detach(); this.joy = null; }
    audio.stopCrowd();
    audio.play('whistle');
    const f = m.fx;
    f.hg = m.score.home; f.ag = m.score.away; f.played = true;
    applyResult(w, f);
    // ratings for user players (simple)
    if (w.mode === 'player' && w.userPlayerId) {
      const p = w.players.get(w.userPlayerId);
      p.season.apps++;
      const g = [...m.players.filter(q => q.id === w.userPlayerId && q.ref === p).reduce((a, q) => a + q.rating, 0), 6][0] || 6;
      p.season.rating += g; p.season.ratingN++;
    }
    this.pairCupRounds(w);
    w.week++;
    this.match = null;
    this.hud.hide();
    this.saveGame();
    // continue to next user match or dashboard
    this.processWeeks(true);
  }
}

const app = new App();
app.boot();
window.csApp = app;
