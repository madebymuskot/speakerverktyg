/* Delat tillstånd för publikvy och kontroll. Mockas lokalt (localStorage + BroadcastChannel). */
window.PublikState = (() => {
  const KEY = "publikapp-state";
  const CHANNEL = "publikapp";
  const listeners = [];
  let data = null;
  let state = null;
  let channel = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function spotifySpellisteId(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const m = s.match(/(?:playlist[/:])([A-Za-z0-9]{22})/i) || s.match(/^([A-Za-z0-9]{22})$/);
    return m ? m[1] : "";
  }

  function warmupSpellista() {
    return spotifySpellisteId(state && state.spotifyWarmup) || spotifySpellisteId(data && data.spotify_warmup_playlist) || "";
  }

  function normalize(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    const meny = s.meny || {};
    const standard = (data && data.standard_match) || "90255224";
    let matchId = s.matchId || standard;
    if (data && data.matcher && !data.matcher.some((m) => m.id === matchId)) matchId = standard;
    return {
      matchAuto: s.matchAuto !== false,
      matchId,
      meny: {
        laglista: meny.laglista !== false,
        halvapott: meny.halvapott !== false,
        rosta: meny.rosta !== false,
        livestat: meny.livestat !== false,
      },
      halvapottUrl: (function () {
        const def = (data && data.halvapott_url) || "https://ff.nu/BDkh5";
        const raw = typeof s.halvapottUrl === "string" ? s.halvapottUrl.trim() : "";
        if (!raw || raw === "https://exempel.piteahockey.se/halvapott") return def;
        return raw;
      })(),
      rostningOppen: s.rostningOppen !== false,
      roster: s.roster && typeof s.roster === "object" ? s.roster : {},
      rosterArExempel: !!s.rosterArExempel,
      matchvard: (function () {
        const def = (data && data.matchvard_standard) || { pa: true, namn: "Laitis", logo: "logos/laitis.png", lank: "https://laitis.se/" };
        const mv = s.matchvard && typeof s.matchvard === "object" ? s.matchvard : {};
        return {
          pa: mv.pa !== false,
          namn: typeof mv.namn === "string" && mv.namn.trim() ? mv.namn.trim() : def.namn,
          logo: typeof mv.logo === "string" ? mv.logo.trim() : (def.logo || ""),
          lank: typeof mv.lank === "string" ? mv.lank.trim() : (def.lank || ""),
        };
      })(),
      spotifyWarmup: spotifySpellisteId(typeof s.spotifyWarmup === "string" ? s.spotifyWarmup : ""),
    };
  }

  function emit() {
    listeners.forEach((fn) => fn(state, data));
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    try { channel && channel.postMessage({ type: "state", state }); } catch (e) {}
    emit();
  }

  function applyIncoming(next) {
    state = normalize(next);
    emit();
  }

  async function init() {
    const [appRes, defRes] = await Promise.all([
      fetch("data/app.json"),
      fetch("data/default-state.json"),
    ]);
    data = await appRes.json();
    const def = await defRes.json();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
    state = normalize(saved || def);
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (ev) => {
        if (ev.data && ev.data.type === "state" && ev.data.state) applyIncoming(ev.data.state);
      };
    } catch (e) {}
    window.addEventListener("storage", (ev) => {
      if (ev.key === KEY && ev.newValue) {
        try { applyIncoming(JSON.parse(ev.newValue)); } catch (e) {}
      }
    });
    return { data, state };
  }

  function get() { return state; }
  function getData() { return data; }

  function set(partial) {
    state = normalize({ ...state, ...partial, meny: { ...state.meny, ...(partial.meny || {}) } });
    persist();
  }

  // En ishockeymatch räknas som pågående från nedsläpp och tre timmar framåt.
  const SPELTID_MS = 3 * 60 * 60 * 1000;

  function matchTid(m) {
    const t = Date.parse((m && m.datum) + "T" + ((m && m.tid) || "00:00") + ":00");
    return Number.isFinite(t) ? t : 0;
  }

  function narmasteMatch(matcher, nu) {
    const list = (matcher || (data && data.matcher) || []).map((m) => ({ m, t: matchTid(m) }));
    if (!list.length) return null;
    const now = nu == null ? Date.now() : nu;
    const pagaende = list.filter((x) => now >= x.t && now < x.t + SPELTID_MS).sort((a, b) => b.t - a.t);
    if (pagaende.length) return pagaende[0].m;
    const nasta = list.filter((x) => x.t > now).sort((a, b) => a.t - b.t);
    if (nasta.length) return nasta[0].m;
    return list.sort((a, b) => b.t - a.t)[0].m;
  }

  function visadMatchId() {
    if (state && state.matchAuto !== false) {
      const narmast = narmasteMatch();
      if (narmast) return narmast.id;
    }
    return (state && state.matchId) || (data && data.standard_match);
  }

  function match() {
    const id = visadMatchId();
    return (data.matcher.find((m) => m.id === id) || data.matcher.find((m) => m.id === data.standard_match) || data.matcher[0]);
  }


  // Live-data hämtas bara från våra egna hubmoduler (aldrig Swehockey).
  // Källor när anslutningen finns: matchklocka_state_v1
  //   ställning/period/speltid: goals, period, clock
  //   powerplay: pens[] + samma numerär som MK.strength (pp, left) — 10-min räknas inte
  //   paus: period === "PAUS", nedräkning clock.remain (len.PAUS); öppen OT-paus: openSince
  // Utan { mock: true } returneras null tills hubben är kopplad.
  function mockLive(match, opts) {
    const lage = (opts && opts.lage) || "live";
    const hemma = (match && match.hemma) || "Piteå HC";
    const bas = {
      kalla: "mock",
      mock: true,
      malHemma: 3,
      malBorta: 1,
    };
    if (lage === "paus") {
      return Object.assign(bas, {
        period: "PAUS",
        periodNamn: "Paus",
        speltid: "08:12",
        nastaNamn: "3:e perioden",
        status: { typ: "paus", tid: "08:12" },
      });
    }
    return Object.assign(bas, {
      period: 2,
      periodNamn: "2:a perioden",
      speltid: "12:34",
      status: { typ: "pp", lag: "hemma", lagNamn: hemma, tid: "1:24" },
    });
  }

  function liveFranKlocka(match, opts) {
    // TODO: läs matchklocka_state_v1 (klocka/utvisningar) från hubben. Inte Swehockey.
    if (opts && opts.mock) return mockLive(match, opts);
    return null;
  }

  /* Livestat hämtar ALLTID bara från våra egna hubmoduler – aldrig från Swehockey.
     Källor (LAN-nycklar via ws://<hubb>/lan och GET /lan/snapshot):
       matchklocka_state_v1  – period, speltid, ställning, rosters (namn till nummer)
       skott_v1              – puckinnehav (d[P].pos[0|1] ms) och tekningar (d[P].fo[0|1] antal)
       zon_v1                – zontid acc[P].hd|nz|bd = [hemma,borta,okänt] ms
                               (hd = hemmas försvar, bd = bortas försvar = hemmas anfall, nz = neutral)
       paisen_v1             – spelare på isen just nu: on[0], on[1] (tröjnummer);
                               namn slås upp i klockans rosters, inte via Swehockey
       speakerapp_protokoll_<id> – mål och målskyttar: typ "Mål", lag 0|1, per, tid,
                               sc:{no,name}, a1, a2 (Speaker/protokoll). Ställning även
                               från klockans goals. Inte från Swehockey.
     Den här första versionen returnerar märkt exempeldata med samma fält. */
  function plockaLivestatSpelare(lag, nrs) {
    const alla = (lag && lag.spelare) || [];
    const namn = (lag && lag.namn) || "";
    return nrs.map((nr) => {
      const p = alla.find((x) => String(x.nr) === String(nr));
      return {
        nr,
        namn: p ? p.namn : "",
        pos: p ? (p.pos_visning || p.pos || "") : "",
        lag: namn,
      };
    });
  }

  function mockLivestat(match, opts) {
    const lag = (opts && opts.lag) || { hemma: { spelare: [] }, borta: { spelare: [] } };
    return {
      mock: true,
      kalla: "exempel",
      periodNamn: "2:a perioden",
      speltid: "12:34",
      malHemma: 3,
      malBorta: 1,
      innehav: { hemma: 58, borta: 42 },
      tekning: {
        hemma: { vunna: 14, pct: 56 },
        borta: { vunna: 11, pct: 44 },
      },
      // Spelets zontid, lagets perspektiv: hemmas anfall = bortas försvar och tvärtom.
      zon: {
        hemma: { anfall: 41, neutral: 22, forsvar: 37 },
        borta: { anfall: 37, neutral: 22, forsvar: 41 },
      },
      paIsen: {
        hemma: plockaLivestatSpelare(lag.hemma, [31, 2, 3, 10, 27, 29]),
        borta: plockaLivestatSpelare(lag.borta, [1, 5, 26, 8, 19, 33]),
      },
      mal: [
        { per: "1", perEtikett: "P1", tid: "07:14", lag: "hemma", lagNamn: lag.hemma && lag.hemma.namn,
          skytt: plockaLivestatSpelare(lag.hemma, [27])[0],
          assist: plockaLivestatSpelare(lag.hemma, [10, 2]) },
        { per: "1", perEtikett: "P1", tid: "14:02", lag: "borta", lagNamn: lag.borta && lag.borta.namn,
          skytt: plockaLivestatSpelare(lag.borta, [19])[0],
          assist: plockaLivestatSpelare(lag.borta, [8]) },
        { per: "2", perEtikett: "P2", tid: "04:18", lag: "hemma", lagNamn: lag.hemma && lag.hemma.namn,
          skytt: plockaLivestatSpelare(lag.hemma, [29])[0],
          assist: plockaLivestatSpelare(lag.hemma, [27]) },
        { per: "2", perEtikett: "P2", tid: "11:05", lag: "hemma", lagNamn: lag.hemma && lag.hemma.namn,
          skytt: plockaLivestatSpelare(lag.hemma, [10])[0],
          assist: [] },
      ],
    };
  }

  function livestatFranHub(match, opts) {
    // TODO: läs skott_v1, zon_v1, paisen_v1, matchklocka_state_v1 och speakerapp_protokoll_* från hubben.
    // Anropa inte Swehockey.
    if (!opts || opts.mock !== false) return mockLivestat(match, opts);
    return null;
  }

  function trupp(namn) {
    return { namn, spelare: (data.trupper && data.trupper[namn]) || [] };
  }

  function lag() {
    const m = match();
    return { hemma: trupp(m.hemma), borta: trupp(m.borta) };
  }

  function playerId(lagNamn, nr) { return lagNamn + "|" + nr; }

  function rosterForMatch(id) {
    const mid = id || visadMatchId();
    return (state.roster && state.roster[mid]) || {};
  }

  function rostaPa(lagNamn, nr) {
    const mid = visadMatchId();
    const id = playerId(lagNamn, nr);
    const next = { ...state.roster };
    const bag = { ...(next[mid] || {}) };
    bag[id] = (bag[id] || 0) + 1;
    next[mid] = bag;
    state = normalize({ ...state, roster: next, rosterArExempel: false });
    persist();
    return bag[id];
  }

  function nollstallRoster() {
    const next = { ...state.roster, [visadMatchId()]: {} };
    state = normalize({ ...state, roster: next, rosterArExempel: false });
    persist();
  }


  // TODO: I framtiden ska logotyperna hämtas från klockan (homeLogo/awayLogo i matchläget),
  // så att publikappen och hubben visar samma bilder. Inte implementerat än.
  function logoUrl(lagNamn) {
    const fil = data && data.loggor && data.loggor[lagNamn];
    return fil || (data && data.logo_placeholder) || "logos/placeholder.png";
  }

  function onChange(fn) { listeners.push(fn); }

  return { init, get, getData, set, match, matchTid, narmasteMatch, visadMatchId, lag, logoUrl, liveFranKlocka, livestatFranHub, playerId, rosterForMatch, rostaPa, nollstallRoster, onChange, esc, spotifySpellisteId, warmupSpellista };
})();
