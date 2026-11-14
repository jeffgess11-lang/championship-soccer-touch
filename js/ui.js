// UI screens (DOM) for dashboard + match HUD wiring.
import { kitColors } from './pitch.js';
import { SLOT_POS, squadOf, posCompatible } from './world.js';
import { tableFor, fixturesOfWeek, resultsOfWeek, LEAGUE_START_WEEK, WEEKS } from './season.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return el;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.screens = $('#screens');
    this.tab = 'home';
  }

  setHTML(node) { this.screens.innerHTML = ''; this.screens.appendChild(node); }

  // ---------- main menu ----------
  mainMenu() {
    const el = h('div', { class: 'menu-main' },
      h('h1', {}, 'Championship ', h('span', {}, 'Soccer'), ' Touch'),
      h('button', { class: 'btn primary', onclick: () => this.leagueSelect() }, 'Start a new career'),
      h('button', { class: 'btn', onclick: () => this.app.quickStart() }, 'Quick start (England + Germany)'),
      h('button', { class: 'btn', onclick: () => this.app.continueCareer(), disabled: this.app.hasSave() ? null : 'true' }, 'Continue career'),
      h('div', { class: 'muted' }, 'Data from the official free Pro Edition package · v1 touch port'),
    );
    this.setHTML(el);
  }

  // ---------- league select ----------
  leagueSelect() {
    const { availableCountries } = this.app;
    const chosen = new Set(['England', 'Germany']);
    const el = h('div', { class: 'dash' },
      h('div', { class: 'topbar' }, h('div', { class: 'title' }, 'Select leagues'), h('button', { class: 'btn small', onclick: () => this.mainMenu() }, 'Back')),
      h('div', { class: 'card' },
        h('div', { class: 'checks' },
          availableCountries.map(c =>
            h('label', {},
              h('input', { type: 'checkbox', checked: chosen.has(c) ? 'true' : null, onchange: (e) => { e.target.checked ? chosen.add(c) : chosen.delete(c); } }),
              h('span', {}, c),
            )))),
      h('div', { class: 'muted', style: 'margin-bottom:8px' }, 'More countries = slower season processing. International file is approximated in v1.'),
      h('button', { class: 'btn primary', style: 'width:100%', onclick: async () => {
        await this.app.newCareer([...chosen]);
      } }, 'Start game'),
    );
    this.setHTML(el);
  }

  // ---------- team select ----------
  teamSelect(teams, mode) {
    const list = teams.sort((a, b) => b.rep - a.rep || a.name.localeCompare(b.name));
    const el = h('div', { class: 'dash' },
      h('div', { class: 'topbar' }, h('div', { class: 'title' }, mode === 'player' ? 'Choose your club (lower leagues)' : 'Choose your club')),
      h('div', { class: 'card' },
        h('ul', { class: 'list' }, list.map(t =>
          h('li', {},
            h('span', {}, t.name),
            h('button', { class: 'btn small primary', onclick: () => this.app.startCareerWith(t, mode) }, 'Select'))))),
    );
    this.setHTML(el);
  }

  // ---------- player creation (player mode) ----------
  playerCreate(team) {
    const state = { pos: 'F C', roll: null };
    const draw = () => {
      const skills = this.app.rollSkills();
      state.roll = skills;
      render(skills);
    };
    const box = h('div', { class: 'card' });
    const render = (skills) => {
      box.innerHTML = '';
      box.appendChild(h('div', {},
        Object.entries(skills).map(([k, v]) => h('div', { class: 'pitem' }, h('span', { class: 'nm' }, k), h('span', { class: 'ab' }, '' + v)))));
    };
    const el = h('div', { class: 'dash' },
      h('div', { class: 'topbar' }, h('div', { class: 'title' }, 'Create player'), h('button', { class: 'btn small', onclick: () => this.mainMenu() }, 'Back')),
      h('div', { class: 'card' },
        h('div', { class: 'seg' }, ['GK C', 'D L', 'D C', 'D R', 'DM C', 'M L', 'M C', 'M R', 'AM C', 'F C', 'F L', 'F R'].map(p =>
          h('button', { class: 'btn small' + (p === state.pos ? ' sel' : ''), onclick: (e) => { state.pos = p; [...e.target.parentNode.children].forEach(c => c.classList.remove('sel')); e.target.classList.add('sel'); } }, p)))),
      box,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: draw }, 'Re-roll'),
        h('button', { class: 'btn primary', onclick: () => this.app.startPlayerCareer(team, state.pos, state.roll) }, 'Apply')),
    );
    this.setHTML(el);
    draw();
  }

  // ---------- dashboard ----------
  dash() {
    const app = this.app, w = app.world;
    const team = w.teams.get(w.userTeamId);
    const tabs = [
      ['home', 'Home'], ['squad', 'Squad'], ['table', 'Table'], ['results', 'Results'],
      ['cups', 'Cups'], ['scorers', 'Top'], ['more', 'More'],
    ];
    const top = h('div', { class: 'topbar' },
      h('div', { class: 'title' }, team.name),
      h('div', { class: 'muted' }, `Season ${w.year} · Week ${Math.min(w.week, WEEKS)}`),
    );
    const seg = h('div', { class: 'seg', style: 'margin-bottom:10px' },
      tabs.map(([k, label]) => h('button', { class: 'btn small' + (this.tab === k ? ' sel' : ''), onclick: (e) => { this.tab = k; this.dash(); } }, label)));
    const body = h('div', {});
    this.setHTML(h('div', { class: 'dash' }, top, seg, body));
    this['tab_' + this.tab](body);
  }

  tab_home(body) {
    const app = this.app, w = app.world;
    const team = w.teams.get(w.userTeamId);
    const next = w.fixtures.filter(f => !f.played && (f.homeId === team.id || f.awayId === team.id)).sort((a, b) => a.week - b.week)[0];
    const parts = [];
    if (next) {
      const opp = w.teams.get(next.homeId === team.id ? next.awayId : next.homeId);
      parts.push(h('div', { class: 'card' },
        h('h2', {}, next.cup ? next.cup + ' · ' + next.roundName : 'League · Round ' + next.round),
        h('div', { style: 'font-size:20px;font-weight:700' }, next.homeId === team.id ? team.name + ' vs ' + opp.name : opp.name + ' vs ' + team.name),
        h('div', { class: 'muted' }, 'Week ' + next.week + (next.homeId === team.id ? ' · Home' : ' · Away')),
        next.week === w.week ? h('button', { class: 'btn primary', style: 'margin-top:8px', onclick: () => app.playNext() }, 'Play match') : h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => app.advanceToMatch() }, 'Advance to match week')));
    } else {
      parts.push(h('div', { class: 'card' }, h('h2', {}, 'Season complete'), h('button', { class: 'btn primary', onclick: () => app.endSeason() }, 'End season → next season')));
    }
    // last result
    const last = w.fixtures.filter(f => f.played && (f.homeId === team.id || f.awayId === team.id)).sort((a, b) => b.week - a.week)[0];
    if (last) {
      const opp = w.teams.get(last.homeId === team.id ? last.awayId : last.homeId);
      const my = last.homeId === team.id ? last.hg : last.ag, th = last.homeId === team.id ? last.ag : last.hg;
      parts.push(h('div', { class: 'card' },
        h('h2', {}, 'Last result (week ' + last.week + ')'),
        h('div', { style: 'font-size:17px' }, `${team.name} ${my}:${th} ${opp.name}`)));
    }
    // this week's other fixtures quick list
    const wk = fixturesOfWeek(w, w.week).filter(f => f.league === team.league).slice(0, 6);
    if (wk.length) {
      parts.push(h('div', { class: 'card' }, h('h2', {}, 'This week'),
        h('ul', { class: 'list' }, wk.map(f => h('li', {}, h('span', {}, w.teams.get(f.homeId).name + ' – ' + w.teams.get(f.awayId).name), h('span', { class: 'muted' }, f.played ? f.hg + ':' + f.ag : ''))))));
    }
    body.appendChild(h('div', {}, parts));
  }

  tab_squad(body) {
    const app = this.app, w = app.world;
    const team = w.teams.get(w.userTeamId);
    this.squadSel = null;
    const board = h('div', { class: 'pitchbox' });
    const listEl = h('div', { class: 'squadlist' });
    const lineupIds = app.getLineup(team.id);
    const squad = squadOf(w, team.id);
    const benchIds = team.players.filter(id => !lineupIds.includes(id));
    const render = () => {
      board.innerHTML = ''; listEl.innerHTML = '';
      lineupIds.forEach((pid, i) => {
        const p = w.players.get(pid);
        const [pos, side] = SLOT_POS[i].split(' ');
        const fx = side === 'L' ? 25 : side === 'R' ? 75 : 50;
        const depth = { GK: 92, SW: 72, D: 68, DM: 55, M: 45, AM: 32, F: 18 }[pos] || 45;
        const chip = h('div', { class: 'pchip' + (p ? '' : ' dim') + (this.squadSel === i ? ' sel' : '') },
          h('div', { class: 'mark' }, SLOT_POS[i]),
          p ? (p.sur + ' ' + p.ability) : '—');
        const slot = h('div', { class: 'slot', style: `left:${fx}%;top:${depth}%` }, chip);
        slot.addEventListener('click', () => {
          if (this.squadSel === null) { this.squadSel = i; }
          else if (this.squadSel === i) { this.squadSel = null; }
          else {
            const a = lineupIds[this.squadSel]; lineupIds[this.squadSel] = lineupIds[i]; lineupIds[i] = a;
            this.squadSel = null;
          }
          render();
        });
        board.appendChild(slot);
      });
      const mkItem = (pid, i, bench) => {
        const p = w.players.get(pid);
        return h('div', { class: 'pitem' + (this.squadSel === i && !bench ? ' sel' : '') },
          h('span', { class: 'num' }, bench ? 'B' : ('' + (i + 1))),
          h('span', { class: 'player-pos' }, p.pos),
          h('span', { class: 'nm' }, p.sur + ', ' + p.first),
          h('span', { class: 'ab' }, '' + p.ability),
          h('span', { class: 'muted' }, ' ' + p.age),
          h('button', { class: 'btn small', onclick: () => this.playerSheet(w, p) }, 'i'));
      };
      lineupIds.forEach((pid, i) => listEl.appendChild(mkItem(pid, i, false)));
      listEl.appendChild(h('div', { class: 'benchhead' }, 'Bench'));
      benchIds.forEach(pid => listEl.appendChild(mkItem(pid, -1, true)));
      // bench tap swaps into selected slot
      listEl.querySelectorAll('.pitem').forEach((it, idx) => {
        it.addEventListener('click', (e) => {
          if (e.target.tagName === 'BUTTON') return;
          if (this.squadSel !== null) {
            const benchEntry = idx >= lineupIds.length ? benchIds[idx - lineupIds.length] : null;
            if (benchEntry) {
              const out = lineupIds[this.squadSel];
              lineupIds[this.squadSel] = benchEntry;
              render();
            }
          }
        });
      });
    };
    render();
    body.appendChild(h('div', { class: 'board' }, board, listEl));
  }

  playerSheet(w, p) {
    const skills = p.skills;
    const rows = Object.entries(skills).map(([k, v]) => h('div', { class: 'pitem' }, h('span', { class: 'nm' }, k), h('span', { class: 'ab' }, '' + v)));
    this.sheet(h('div', {},
      h('h3', {}, p.sur + ', ' + p.first + '  ·  ' + p.pos + '  ·  age ' + p.age),
      h('div', { class: 'muted', style: 'margin-bottom:8px' }, `Ability ${p.ability} · Potential ${p.potential} · ${p.nat} · Season: ${p.season.goals} goals, ${p.season.apps} apps`),
      rows));
  }

  sheet(content) {
    const s = h('div', { class: 'sheet' },
      h('div', { class: 'inner' },
        h('button', { class: 'btn small close', onclick: () => s.remove() }, 'Close'),
        content));
    s.addEventListener('click', (e) => { if (e.target === s) s.remove(); });
    document.getElementById('screens').appendChild(s);
  }

  tab_table(body) {
    const w = this.app.world;
    const team = w.teams.get(w.userTeamId);
    const lg = w.leagues.find(l => l.name === team.league);
    body.appendChild(h('h2', {}, lg.name));
    const rows = tableFor(w, lg.name);
    const teamsIn = new Set(lg.teams);
    body.appendChild(h('table', { class: 'tbl' },
      h('tr', {}, h('th', {}, '#'), h('th', {}, 'Team'), h('th', { class: 'num' }, 'P'), h('th', { class: 'num' }, 'W'), h('th', { class: 'num' }, 'D'), h('th', { class: 'num' }, 'L'), h('th', { class: 'num' }, 'GD'), h('th', { class: 'num' }, 'Pts')),
      rows.map((r, i) => {
        const t = w.teams.get(r.id);
        const rel = i >= rows.length - lg.relegations;
        const prom = i < lg.promotions;
        return h('tr', { class: (t.id === team.id ? 'me ' : '') + (rel ? 'rel' : '') },
          h('td', {}, '' + (i + 1) + (prom ? ' ↑' : rel ? ' ↓' : '')),
          h('td', {}, t.name),
          h('td', { class: 'num' }, '' + r.p), h('td', { class: 'num' }, '' + r.w), h('td', { class: 'num' }, '' + r.d), h('td', { class: 'num' }, '' + r.l),
          h('td', { class: 'num' }, (r.gd > 0 ? '+' : '') + r.gd), h('td', { class: 'num' }, '' + r.pts));
      })));
    // other divisions quick links
    const others = w.leagues.filter(l => l.country === lg.country && l.division !== lg.division);
    if (others.length) {
      body.appendChild(h('h2', { style: 'margin-top:12px' }, 'Other divisions'));
      body.appendChild(h('div', { class: 'seg' }, others.map(o => h('button', { class: 'btn small', onclick: () => {
        const r2 = tableFor(w, o.name);
        this.sheet(h('div', {}, h('h3', {}, o.name), h('table', { class: 'tbl' },
          r2.map((r, i) => { const t = w.teams.get(r.id); return h('tr', {}, h('td', {}, '' + (i + 1)), h('td', {}, t.name), h('td', { class: 'num' }, '' + r.pts)); }))));
      } }, o.name))));
    }
  }

  tab_results(body) {
    const w = this.app.world;
    const team = w.teams.get(w.userTeamId);
    const lgFix = w.fixtures.filter(f => f.league === team.league);
    const played = lgFix.filter(f => f.played).slice(-30).reverse();
    const upcoming = lgFix.filter(f => !f.played).slice(0, 12);
    body.appendChild(h('h2', {}, 'Recent results'));
    body.appendChild(h('ul', { class: 'list' }, played.map(f =>
      h('li', {}, h('span', {}, w.teams.get(f.homeId).name + ' – ' + w.teams.get(f.awayId).name), h('span', {}, f.hg + ':' + f.ag)))));
    body.appendChild(h('h2', { style: 'margin-top:12px' }, 'Upcoming'));
    body.appendChild(h('ul', { class: 'list' }, upcoming.map(f =>
      h('li', {}, h('span', {}, w.teams.get(f.homeId).name + ' – ' + w.teams.get(f.awayId).name), h('span', { class: 'muted' }, 'W' + f.week)))));
  }

  tab_cups(body) {
    const w = this.app.world;
    body.appendChild(h('h2', {}, 'Competitions'));
    for (const cup of w.cups) {
      const rounds = cup.rounds.map(r => `${r.name} (W${r.weeks ? r.weeks[0] : r.week})`).join(', ');
      body.appendChild(h('div', { class: 'card' },
        h('h3', { style: 'font-size:15px' }, cup.name),
        h('div', { class: 'muted' }, `${cup.country} · reputation ${cup.reputation}${cup.international ? ' · international' : ''}`),
        h('div', { style: 'font-size:12px;margin-top:4px' }, rounds || '—')));
    }
  }

  tab_scorers(body) {
    const w = this.app.world;
    const team = w.teams.get(w.userTeamId);
    const lg = w.leagues.find(l => l.name === team.league);
    const ids = new Set(lg.teams);
    const scorers = [...w.players.values()].filter(p => ids.has(p.teamId) && p.season.goals > 0)
      .sort((a, b) => b.season.goals - a.season.goals).slice(0, 20);
    body.appendChild(h('h2', {}, 'Top scorers · ' + lg.name));
    body.appendChild(h('table', { class: 'tbl' },
      scorers.map((p, i) => h('tr', { class: p.teamId === team.id ? 'me' : '' },
        h('td', {}, '' + (i + 1)),
        h('td', {}, p.sur + ', ' + p.first),
        h('td', { class: 'muted' }, (w.teams.get(p.teamId) || { name: '' }).name),
        h('td', { class: 'num' }, '' + p.season.goals)))));
  }

  tab_more(body) {
    const w = this.app.world;
    const team = w.teams.get(w.userTeamId);
    body.appendChild(h('div', { class: 'card' },
      h('h3', { style: 'font-size:15px' }, 'Finances'),
      h('div', {}, 'Funds: ' + team.finance.toLocaleString())));
    body.appendChild(h('div', { class: 'card' },
      h('h3', { style: 'font-size:15px' }, 'Game'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { this.app.saveGame(); this.toast('Saved'); } }, 'Save game'),
        h('button', { class: 'btn danger', onclick: () => this.app.exitToMenu() }, 'Exit to menu'))));
  }

  toast(msg) {
    const t = h('div', { style: 'position:fixed;left:50%;bottom:60px;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:10px 16px;border-radius:10px;z-index:99' }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  // ---------- match HUD ----------
  matchHUD(match, handlers) {
    const hud = $('#matchhud');
    hud.innerHTML = '';
    hud.classList.remove('hidden');
    document.body.classList.add('match');
    const score = h('div', { class: 'score' }, '0:0');
    const clock = h('div', { class: 'clock' }, "0'");
    const msg = h('div', { class: 'hud-msg' });
    const topbar = h('div', { class: 'hud-top' }, score, clock, msg);
    topbar.style.pointerEvents = 'none';
    hud.appendChild(topbar);

    // right buttons
    const btns = h('div', { class: 'hud-btns' });
    if (handlers.mode === 'player') {
      btns.appendChild(h('button', { class: 'btn', onclick: handlers.pause }, 'Pause'));
    } else {
      btns.appendChild(h('button', { class: 'btn', onclick: handlers.tactics }, 'Tactics'));
      btns.appendChild(h('button', { class: 'btn', onclick: handlers.subs }, 'Subs'));
      btns.appendChild(h('button', { class: 'btn', onclick: handlers.pause }, 'Pause'));
    }
    btns.appendChild(h('button', { class: 'btn danger', onclick: handlers.quit }, 'Quit'));
    hud.appendChild(btns);

    // speed
    const speed = h('div', { class: 'hud-speed' });
    [1, 2, 4].forEach(s => {
      const b = h('button', { class: 'btn small' + (s === 1 ? ' sel' : ''), onclick: (e) => { match.speed = s; [...speed.children].forEach(c => c.classList.remove('sel')); e.target.classList.add('sel'); } }, 'x' + s);
      speed.appendChild(b);
    });
    speed.appendChild(h('button', { class: 'btn small', onclick: handlers.skip }, 'Skip'));
    hud.appendChild(speed);

    if (handlers.mode === 'player') {
      const joy = h('div', { id: 'joy' }, h('div', { id: 'joyknob' }));
      hud.appendChild(joy);
      const acts = h('div', { class: 'actbtns' },
        h('div', { class: 'actbtn pass', onpointerdown: () => handlers.action('pass') }, 'PASS'),
        h('div', { class: 'actbtn shoot', onpointerdown: () => handlers.action('shoot') }, 'SHOOT'));
      hud.appendChild(acts);
      handlers.onJoyAttached(joy);
    } else {
      const bar = h('div', { class: 'ctlbar' });
      hud.appendChild(bar);
    }
    return {
      update() {
        score.textContent = match.score.home + ':' + match.score.away;
        clock.textContent = Math.floor(Math.min(90, match.minute)) + "'";
        if (match.msg) { msg.textContent = match.msg; msg.classList.add('show'); }
        else msg.classList.remove('show');
      },
      hide() { hud.innerHTML = ''; hud.classList.add('hidden'); document.body.classList.remove('match'); },
    };
  }

  tacticsSheet(match) {
    const t = match.tactic.home;
    const mk = (label, key) => {
      const row = h('div', { class: 'pitem' },
        h('span', { class: 'nm' }, label),
        h('span', { class: 'seg' }, [1, 2, 3, 4, 5].map(v =>
          h('button', { class: 'btn small' + (t[key] === v ? ' sel' : ''), onclick: (e) => { t[key] = v; [...e.target.parentNode.children].forEach(c => c.classList.remove('sel')); e.target.classList.add('sel'); } }, '' + v))));
      return row;
    };
    this.sheet(h('div', {},
      h('h3', {}, 'Tactics (live)'),
      mk('Pressing', 'pressing'), mk('Defensive line', 'line'), mk('Tempo', 'tempo')));
  }

  subsSheet(match, world, teamId) {
    const team = world.teams.get(teamId);
    const bench = match.bench.home;
    const onPitch = match.players.filter(p => p.side === 0);
    const out = h('div', {},
      h('h3', {}, 'Substitute (3 max)'),
      h('div', { class: 'muted', style: 'margin-bottom:6px' }, 'Tap on-pitch player, then bench player.'),
      h('ul', { class: 'list' },
        onPitch.map(p => h('li', { style: 'cursor:pointer', onclick: () => { selected = p; [...onList.children].forEach(c => c.style.background = ''); li.style.background = 'rgba(46,155,68,.3)'; } },
          h('span', { class: 'player-pos' }, p.pos), h('span', {}, p.ref.sur + ' (' + Math.round(p.stamina * 100) + '%)')))));
    const onList = out.querySelector('ul');
    let selected = null;
    const bl = h('ul', { class: 'list', style: 'margin-top:8px' });
    bench.forEach((p, i) => {
      if (!p) return;
      bl.appendChild(h('li', { style: 'cursor:pointer', onclick: () => {
        if (!selected) { this.toast('Select on-pitch player first'); return; }
        const slotIdx = selected.slotIdx;
        if (match.substitute(0, slotIdx, i)) { s.remove(); this.toast('Sub on: ' + p.sur); }
        else this.toast('No substitutions left');
      } },
        h('span', { class: 'player-pos' }, p.pos), h('span', {}, p.sur + ' (' + p.ability + ')')));
    });
    out.appendChild(h('div', { class: 'muted' }, 'Bench'));
    out.appendChild(bl);
    const s = h('div', { class: 'sheet' }, h('div', { class: 'inner' }, h('button', { class: 'btn small close', onclick: () => s.remove() }, 'Close'), out));
    s.addEventListener('click', (e) => { if (e.target === s) s.remove(); });
    document.getElementById('screens').appendChild(s);
  }
}
