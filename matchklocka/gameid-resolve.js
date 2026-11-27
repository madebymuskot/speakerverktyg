/* Gemensam upplösning av matchnummer: 7-siffrigt game_id eller grupp + match (schedule_id).
   Schema-id används aldrig som LineUps-/Events-id. */
(function (root) {
  'use strict';
  var BASE = 'https://stats.swehockey.se';
  var GROUP_SERIES = {
    '90255': {seriesId: 21043, lag: 'A', namn: 'Hockeyettan Norra'},
    '96761': {seriesId: 21300, lag: 'U18', namn: 'U18'},
    '96702': {seriesId: 21294, lag: 'U20', namn: 'U20'},
    '96210': {seriesId: 21319, lag: 'HT2', namn: 'HockeyTvåan Region Norr A'}
  };
  var KNOWN_SERIES = [];
  (function () {
    var seen = {};
    Object.keys(GROUP_SERIES).forEach(function (k) {
      var s = GROUP_SERIES[k];
      if (!seen[s.seriesId]) { seen[s.seriesId] = 1; KNOWN_SERIES.push(s); }
    });
  })();
  var PROBE_BEFORE = 40, PROBE_AFTER = 150, PROBE_PARALLEL = 10;
  var LS_KEY = 'swehockey_gameid_cache_v1';
  var MSG = {
    empty: 'Ange matchnummer eller grupp + match, till exempel 96210 031.',
    bad: 'Ogiltigt matchnummer. Ange 7-siffrigt matchnummer eller grupp + match, till exempel 96210 031.',
    notFound: function (sid) {
      return 'Hittade inte match ' + sid + ' i schemat. Kontrollera grupp- och matchnummer, eller klistra in det 7-siffriga matchnumret från Swehockey.';
    },
    noLineup: function (info) {
      return 'Matchen finns i schemat' + (info ? ' (' + info + ')' : '') + ' men laglistan är inte publicerad ännu. Klistra in det 7-siffriga matchnumret om du har det.';
    }
  };

  function ws(s) { return String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }

  function parseMatchInput(raw) {
    var s = ws(raw);
    if (!s) return {kind: 'error', message: MSG.empty};
    var um = s.match(/\/Game\/(?:LineUps|Events)\/(\d{6,7})\b/);
    if (um) return {kind: 'game_id', gameId: um[1]};
    var m = s.match(/^(\d{5})[\s/.\-]+(\d{1,3})$/);
    if (m) {
      var sid = m[1] + m[2].padStart(3, '0');
      return {kind: 'schedule_id', scheduleId: sid, group: m[1], gameNo: m[2].padStart(3, '0')};
    }
    if (/^\d{8}$/.test(s)) {
      return {kind: 'schedule_id', scheduleId: s, group: s.slice(0, 5), gameNo: s.slice(5)};
    }
    if (/^\d{6,7}$/.test(s)) return {kind: 'game_id', gameId: s};
    return {kind: 'error', message: MSG.bad};
  }

  function loadLsCache() {
    if (typeof localStorage === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveLsCache(cache) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch (e) {}
  }

  function parseSchedule(html, lag) {
    var out = [];
    var date = '';
    var rows = String(html || '').split(/<tr\b/i).slice(1);
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i].replace(/^[^>]*>/, '').split(/<\/tr>/i)[0];
      var tds = [];
      var tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi, td;
      while ((td = tdRe.exec(tr))) tds.push(td[1]);
      if (tds.length < 4) continue;
      var txt = tds.map(function (cell) { return ws(cell.replace(/<[^>]+>/g, ' ')); });
      var dm = txt[0].match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (dm) date = dm[1];
      var timeCell = txt.find(function (t) { return /^(?:\d{4}-\d{2}-\d{2} )?\d{1,2}:\d{2}$/.test(t); });
      var game = txt.find(function (t) { return /.+ - .+/.test(t) && !/\d+ - \d+$/.test(t); });
      if (!date || !timeCell || !game) continue;
      var teams = game.split(' - ').map(ws);
      if (teams.length < 2) continue;
      var ev = tr.match(/\/Game\/(?:Events|LineUps)\/(\d+)/);
      var tip = tr.match(/lnkTooltip"[^>]*title="(\d+)"/i) || tr.match(/title="(\d+)"[^>]*lnkTooltip/i);
      var sid = tip ? tip[1] : null;
      var gid = ev ? ev[1] : null;
      if (gid && sid && gid === sid) gid = null;
      out.push({
        date: date,
        time: timeCell.slice(-5),
        teams: teams,
        arena: txt[txt.length - 1],
        lag: lag || '',
        scheduleId: sid,
        gid: gid
      });
    }
    return out;
  }

  function lineupMatches(html, g) {
    var t = ws(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')).toLowerCase();
    if (!t) return false;
    var h = ws(g.teams[0]).toLowerCase(), a = ws(g.teams[1]).toLowerCase();
    return t.indexOf(g.date) !== -1 && t.indexOf(h + ' - ' + a) !== -1;
  }

  async function getPath(path, getFn) {
    if (getFn) return getFn(path);
    var r = await fetch(BASE + path, {cache: 'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  }

  async function mapPool(items, n, fn) {
    var ret = new Array(items.length);
    var i = 0;
    async function worker() {
      while (i < items.length) {
        var j = i++;
        try { ret[j] = await fn(items[j]); } catch (e) { ret[j] = null; }
      }
    }
    var w = [];
    for (var k = 0; k < Math.max(1, n); k++) w.push(worker());
    await Promise.all(w);
    return ret;
  }

  async function probeGame(row, games, opts) {
    var known = games.map(function (g) { return g.gid; }).filter(function (id) {
      return id && /^\d+$/.test(id) && !games.some(function (x) { return x.scheduleId === id; });
    }).map(Number).sort(function (a, b) { return a - b; });
    if (!known.length) return null;
    var lo = known[0] - PROBE_BEFORE, hi = known[known.length - 1] + PROBE_AFTER;
    var skip = {};
    known.forEach(function (id) { skip[id] = 1; });
    var cands = [];
    for (var i = lo; i <= hi; i++) if (!skip[i]) cands.push(i);
    var found = null;
    await mapPool(cands, (opts && opts.parallel) || PROBE_PARALLEL, async function (id) {
      if (found) return null;
      var html;
      try { html = await getPath('/Game/LineUps/' + id, opts && opts.get); } catch (e) { return null; }
      if (found) return null;
      if (lineupMatches(html, row)) found = String(id);
      return null;
    });
    return found;
  }

  function remember(cache, sid, gid, saveFn) {
    cache[sid] = String(gid);
    (saveFn || saveLsCache)(cache);
  }

  async function findRow(sid, group, opts) {
    var getFn = opts && opts.get;
    var mapped = GROUP_SERIES[group];
    var games = [], row = null, lastErr = null;
    async function scan(list) {
      for (var i = 0; i < list.length; i++) {
        var ser = list[i];
        try {
          var html = await getPath('/ScheduleAndResults/Schedule/' + ser.seriesId, getFn);
          var gs = parseSchedule(html, ser.lag);
          games = games.concat(gs);
          var hit = gs.find(function (g) { return g.scheduleId === sid; });
          if (hit) { row = hit; return; }
        } catch (e) { lastErr = e; }
      }
    }
    if (mapped) await scan([mapped]);
    if (!row) {
      var rest = KNOWN_SERIES.filter(function (s) { return !mapped || s.seriesId !== mapped.seriesId; });
      await scan(rest);
    }
    return {row: row, games: games, lastErr: lastErr};
  }

  async function resolveGameId(raw, opts) {
    opts = opts || {};
    var p = parseMatchInput(raw);
    if (p.kind === 'error') throw new Error(p.message);
    if (p.kind === 'game_id') return p.gameId;
    var sid = p.scheduleId;
    var cache = opts.cache || loadLsCache();
    if (cache[sid]) return String(cache[sid]);
    var found = await findRow(sid, p.group, opts);
    if (!found.row) throw new Error(MSG.notFound(sid));
    var row = found.row;
    var gid = row.gid && row.gid !== sid ? String(row.gid) : null;
    if (!gid) gid = await probeGame(row, found.games, opts);
    if (gid) {
      remember(cache, sid, gid, opts.saveCache);
      return String(gid);
    }
    var info = [row.teams && row.teams.join(' – '), row.date].filter(Boolean).join(', ');
    throw new Error(MSG.noLineup(info));
  }

  var api = {
    BASE: BASE,
    GROUP_SERIES: GROUP_SERIES,
    KNOWN_SERIES: KNOWN_SERIES,
    MSG: MSG,
    parseMatchInput: parseMatchInput,
    parseSchedule: parseSchedule,
    lineupMatches: lineupMatches,
    resolveGameId: resolveGameId,
    probeGame: probeGame
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GameId = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
