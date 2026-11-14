// Championship Soccer - data file loaders (league/team/names DSL from Data/ + docs/HowToEdit.txt)

export function stripBOM(s) { return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; }

function unquote(v) {
  v = v.trim();
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') return v.slice(1, -1);
  return v;
}

// Split a line honoring quotes, so  ! Names "a b_1.txt" "a b_2.txt"  works.
function splitArgs(s) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { q = !q; cur += c; continue; }
    if (c === ' ' && !q) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

// ---- color table: $rrggbb name [aliases...] ----
export function parseColorTable(text) {
  const colors = new Map(); // canonical name -> hex (#rrggbb)
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line[0] !== '$') continue;
    const sp = line.indexOf(' ');
    const hex = '#' + line.slice(1, sp).toLowerCase();
    const names = line.slice(sp + 1).trim().split(/\s+/);
    for (const n of names) colors.set(n.toLowerCase(), hex);
  }
  return colors;
}

// ---- names DB: 1st = first names, 2nd = surnames ----
export function parseNames(text) { return stripBOM(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean); }

// ---- league file ----
// ! Country "X" | ! AdditionalCountry "X" | ! Names/! TempNames f1 f2
// * CupName  -> cup: + reputation, + international, + nations, + round i "name" a-b [week], + matches w1 w2,
//              + add N from "Country", + groups G, + week w..., + year Y, + offset N, + venue "C", + intro "f"
// : LeagueName -> league: + Division N, + promotions N, + relegations N, + reputation N, then team-name lines
export function parseLeagueFile(text) {
  const file = { country: null, additional: false, names: null, cups: [], leagues: [], reputation: 15 };
  let curCup = null, curLeague = null, pendingRound = null;
  for (let raw of stripBOM(text).split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line[0] === '#' || line[0] === ';') { if (pendingRound) { flushRound(); } continue; }
    const c0 = line[0];
    if (c0 === '!') {
      const m = line.match(/^!\s*(\w+)\s*(.*)$/);
      if (!m) continue;
      const cmd = m[1].toLowerCase(), rest = m[2];
      if (cmd === 'country') { file.country = unquote(rest); file.additional = false; }
      else if (cmd === 'additionalcountry') { file.country = unquote(rest); file.additional = true; }
      else if (cmd === 'names' || cmd === 'tempnames') { file.names = splitArgs(rest).map(unquote); }
      else if (cmd === 'reputation') { file.reputation = parseInt(rest, 10) || 15; }
      if (pendingRound) flushRound();
      continue;
    }
    if (c0 === '*') { if (pendingRound) flushRound(); curLeague = null; curCup = { name: line.slice(1).trim(), reputation: 15, international: false, nations: false, year: null, offset: 0, rounds: [], adds: [], intro: null }; file.cups.push(curCup); continue; }
    if (c0 === ':') { if (pendingRound) flushRound(); curCup = null; curLeague = { name: line.slice(1).trim(), division: 1, promotions: 0, relegations: 0, reputation: 10, teams: [] }; file.leagues.push(curLeague); continue; }
    if (c0 === '+') {
      const m = line.match(/^\+\s*(\S+)\s*(.*)$/);
      if (!m) continue;
      const cmd = m[1].toLowerCase(), rest = m[2].trim();
      if (curCup) {
        if (cmd === 'reputation') curCup.reputation = parseInt(rest, 10) || 10;
        else if (cmd === 'international') curCup.international = true;
        else if (cmd === 'nations') curCup.nations = true;
        else if (cmd === 'year') curCup.year = parseInt(rest, 10) || null;
        else if (cmd === 'offset') curCup.offset = parseInt(rest, 10) || 0;
        else if (cmd === 'intro') curCup.intro = unquote(rest);
        else if (cmd === 'venue') curCup.adds.push({ type: 'venue', value: unquote(rest) });
        else if (cmd === 'groups') { /* groups stage size info; stored, engine v1 ignores */ curCup.groups = parseInt(rest, 10) || 0; }
        else if (cmd === 'week') { if (pendingRound) pendingRound.weeks = rest.split(/\s+/).map(n => parseInt(n, 10) || 0); }
        else if (cmd === 'round') {
          if (pendingRound) flushRound();
          const rm = rest.match(/^(\d+)\s+\"([^\"]*)\"\s+(\d+)(?:-(\d+))?(?:\s+(\d+))?$/);
          if (rm) {
            pendingRound = { index: parseInt(rm[1], 10), name: rm[2], from: parseInt(rm[3], 10), to: rm[4] ? parseInt(rm[4], 10) : parseInt(rm[3], 10), week: rm[5] ? parseInt(rm[5], 10) : 0, weeks: null, matches: null };
          }
        }
        else if (cmd === 'matches') { if (pendingRound) pendingRound.matches = rest.split(/\s+/).map(n => parseInt(n, 10) || 0); }
        else if (cmd === 'add') {
          const am = rest.match(/^(\d+)\s+from\s+\"([^\"]*)\"$/i);
          if (am) { if (pendingRound) { flushRound(); } curCup.adds.push({ type: 'from', count: parseInt(am[1], 10), from: am[2] }); }
          const am2 = rest.match(/^(?:<(\d+)\s+)?add\s+(\d+)\s+cup-winner\s+\"([^\"]*)\"$/i) || rest.match(/^(\d+)\s+cup-winner\s+\"([^\"]*)\"$/i);
          if (am2) curCup.adds.push({ type: 'cup-winner', lt: am2[1] ? parseInt(am2[1], 10) : 0, count: parseInt(am2[2] || am2[1], 10), from: am2[3] });
          const am3 = rest.match(/^(?:<(\d+)\s+)?add\s+(\d+)\s+team\s+\"([^\"]*)\"$/i);
          if (am3) curCup.adds.push({ type: 'team', lt: am3[1] ? parseInt(am3[1], 10) : 0, count: parseInt(am3[2] || am3[1], 10), from: am3[3] });
        }
      } else if (curLeague) {
        if (cmd === 'division') curLeague.division = parseInt(rest, 10) || 1;
        else if (cmd === 'promotions') curLeague.promotions = parseInt(rest, 10) || 0;
        else if (cmd === 'relegations') curLeague.relegations = parseInt(rest, 10) || 0;
        else if (cmd === 'reputation') curLeague.reputation = parseInt(rest, 10) || 10;
        else if (cmd === 'country') { /* optional in league block, ignored */ }
      } else {
        // country-level reputation block (AdditionalCountry sections)
        if (cmd === 'reputation') file.reputation = parseInt(rest, 10) || file.reputation;
      }
      continue;
    }
    // plain team-name line
    if (pendingRound) flushRound();
    if (curLeague) curLeague.teams.push(line);
  }
  function flushRound() { if (pendingRound) curCup.rounds.push(pendingRound); pendingRound = null; }
  flushRound();
  return file;
}

// ---- team file (national teams): ! name, dresses, optional $ player blocks ----
export function parseTeamFile(text) {
  const team = { name: null, dresses: [], players: [] };
  let cur = null;
  for (let raw of stripBOM(text).split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    if (line[0] === '!') {
      const m = line.match(/^!\s*(\S+)\s*(.*)$/);
      if (!m) continue;
      const cmd = m[1].toLowerCase(); const rest = m[2].trim();
      if (cmd === 'name') team.name = unquote(rest);
      else if (cmd === 'reputation') team.reputation = parseInt(rest, 10) || 10;
      else if (/^[123]$/.test(cmd[0])) {
        const dm = cmd.match(/^([123])(.*)$/);
        const dn = parseInt(dm[1], 10), typ = dm[2].trim().toLowerCase();
        let d = team.dresses.find(d => d.n === dn);
        if (!d) { d = { n: dn, shirt: 'white', stripes: null, sleeves: null, shorts: null, socks: null }; team.dresses.push(d); }
        d[typ] = unquote(rest);
      }
      continue;
    }
    if (line[0] === '$') {
      const nm = line.match(/^\$\s*([^:]*?)\s*\((\d{4})\)/);
      cur = { name: nm ? nm[1] : line.slice(1).trim(), born: nm ? parseInt(nm[2], 10) : 1975, fields: {} };
      team.players.push(cur); continue;
    }
    if (cur && line.includes('=')) {
      const km = line.match(/^([^=]+?)\s*=\s*(.*)$/);
      if (km) cur.fields[km[1].trim().toLowerCase()] = km[2].trim();
      continue;
    }
    // simple player line: "Surname, Firstname: GK C"
    const pm = line.match(/^([^:]+):\s*(.*)$/);
    if (pm) team.players.push({ name: pm[1].trim(), pos: pm[2].trim(), simple: true });
  }
  return team;
}

// ---- language file: "0000 : Text" with $1..$n placeholders ----
export function parseLanguage(text) {
  const lang = {};
  for (let raw of stripBOM(text).split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line[0] === '#') continue;
    const m = line.match(/^(\d+)\s*:\s*(.*)$/);
    if (m) lang[m[1]] = m[2];
  }
  return lang;
}

export function fmt(lang, key, ...args) {
  let s = lang[key] || key;
  args.forEach((a, i) => { s = s.split('$' + (i + 1)).join(a); });
  return s;
}
