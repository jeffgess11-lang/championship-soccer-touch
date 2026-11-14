// Save/load: localStorage JSON (world + season state).
const KEY = 'cs_touch_save_v1';

export function save(world) {
  const data = {
    v: 1,
    world: {
      year: world.year, week: world.week, mode: world.mode,
      nextTeamId: world.nextTeamId, nextPlayerId: world.nextPlayerId,
      teams: [...world.teams.values()],
      players: [...world.players.values()],
      leagues: world.leagues,
      cups: world.cups.map(c => ({ ...c, rounds: c.rounds.map(r => ({ ...r, _next: undefined, _pendingWinners: undefined })) })),
      fixtures: world.fixtures,
      tableState: [...world.tableState.entries()].map(([k, m]) => [k, [...m.entries()]]),
      userTeamId: world.userTeamId, userPlayerId: world.userPlayerId,
      lineups: [...(world.lineups || new Map()).entries()],
      tactics: [...(world.tactics || new Map()).entries()],
      namesKeyList: [...world.names.keys()],
      countries: world.countries,
    },
  };
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { console.warn('save failed', e); return false; }
}

export function hasSave() { return !!localStorage.getItem(KEY); }

export function load() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    const w = d.world;
    const world = {
      startYear: w.year, year: w.year, week: w.week, mode: w.mode,
      nextTeamId: w.nextTeamId, nextPlayerId: w.nextPlayerId,
      teams: new Map(w.teams.map(t => [t.id, t])),
      players: new Map(w.players.map(p => [p.id, p])),
      leagues: w.leagues, cups: w.cups, countries: w.countries || [],
      names: new Map(), colors: null,
      userTeamId: w.userTeamId, userPlayerId: w.userPlayerId,
      lineups: new Map(w.lineups || []),
      tactics: new Map(w.tactics || []),
      fixtures: w.fixtures, results: [],
      tableState: new Map(w.tableState.map(([k, arr]) => [k, new Map(arr)])),
    };
    return world;
  } catch (e) { console.warn('load failed', e); return null; }
}

export function clearSave() { localStorage.removeItem(KEY); }
