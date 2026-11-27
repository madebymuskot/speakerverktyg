(() => {
  const RUBRIKER = { meny: "Startmeny", laglista: "Laguppställning", rosta: "Matchens lirare", tack: "Matchens lirare", stangd: "Matchens lirare", livestat: "Livestat", spel: "Shootout", music: "Music" };
  const SPEL_BARA_I_PAUS = false; // tills vidare alltid synlig; true = bara i periodpaus
  const SPEL_SKOTT_MAX = 5;
  const SPEL_BASTA_KEY = "publikapp-spel-basta";
  const SPEL_NAMN_KEY = "publikapp-spel-namn";
  const GRUPP = { malvakter: "Målvakter", backar: "Backar", forwards: "Forwards" };
  const S = window.PublikState;
  const val = { vald: null, vy: "meny", oppnad: null, rostLag: "hemma" };
  let visadTrupp = null;
  let lagPoll = null;
  let portrattKarta = { spelare: {}, demo: null };

  const $ = (id) => document.getElementById(id);

  function visa(namn) {
    if (namn === "spel" && !spelSynligt()) namn = "meny";
    val.vy = namn;
    document.querySelectorAll(".vy").forEach((el) => {
      el.hidden = el.id !== "vy-" + namn;
    });
    const music = namn === "music";
    $("hSub").textContent = (namn === "meny" || music) ? "" : (RUBRIKER[namn] || "");
    $("hSub").hidden = namn === "meny" || music;
    const sponsor = $("hSponsor");
    if (sponsor) sponsor.hidden = !music;
    document.body.classList.toggle("inner", namn !== "meny");
    const hash = namn === "stangd" ? "rosta" : namn;
    history.replaceState(null, "", "#" + hash);
    window.scrollTo(0, 0);
    if (namn === "livestat") startaLivestat();
    else stoppaLivestat();
    if (namn === "spel") startaSpelVy();
    else pausaSpelVy();
    if (namn === "music") kopplaSpotify();
  }


  function gruppAv(pos, fallback) {
    if (pos === "Målvakt" || fallback === "malvakter") return "malvakter";
    if (pos === "Back" || fallback === "backar") return "backar";
    return "forwards";
  }

  function slåIhopsLag(lagNamn, officiella) {
    const sasong = ((S.getData() && S.getData().trupper) || {})[lagNamn] || [];
    const byNr = {};
    sasong.forEach((p) => { byNr[String(p.nr)] = p; });
    return (officiella || []).map((o) => {
      const grund = byNr[String(o.nr)] || sasong.find((p) => p.namn && o.efternamn && p.namn.split(" ").pop() === o.efternamn) || {};
      const pos = (o.pos === "Målvakt" || o.pos === "Back" || o.pos === "Forward") ? o.pos : (grund.pos || o.pos || "");
      return {
        ...grund,
        nr: o.nr,
        namn: grund.namn || o.namn,
        pos,
        grupp: gruppAv(pos, grund.grupp),
        line: o.line || "",
      };
    });
  }

  function visaTrupp(data) {
    const m = S.match();
    if (data && data.officiell && data.lag && data.lag.length) {
      const hemmaOff = data.lag.find((l) => l.namn === m.hemma) || data.lag[0];
      const bortaOff = data.lag.find((l) => l.namn === m.borta) || data.lag[1] || { namn: m.borta, spelare: [] };
      visadTrupp = {
        hemma: { namn: hemmaOff.namn, spelare: slåIhopsLag(hemmaOff.namn, hemmaOff.spelare) },
        borta: { namn: bortaOff.namn, spelare: slåIhopsLag(bortaOff.namn, bortaOff.spelare) },
      };
    } else {
      visadTrupp = null;
    }
    const lag = visadTrupp || S.lag();
    $("laglista-notis").textContent = (data && data.etikett) || "Officiell laguppställning publiceras före match";
    $("laglista").dataset.kalla = (data && data.kalla) || "sasong";
    $("laglista").innerHTML = lagHtml(lag.hemma, {}) + lagHtml(lag.borta, {});
    const params = new URLSearchParams(location.search);
    if (params.get("demo") === "info" && (val.vy === "laglista" || params.get("demo") === "info")) {
      const btn = document.querySelector('button.lagspelare[data-namn="Oscar Bramberg"]') || document.querySelector("button.lagspelare");
      if (btn) {
        val.oppnad = btn.dataset.id;
      }
    }
    ritaInfo();
  }

  function hamtaLaguppstallning() {
    if (lagPoll) { clearTimeout(lagPoll); lagPoll = null; }
    return fetch("data/laguppstallning.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        visaTrupp(data);
        return data;
      })
      .catch(() => {
        visaTrupp({ kalla: "sasong", etikett: "Officiell laguppställning publiceras före match", officiell: false });
      });
  }

  function lagHtml(lag, opts) {
    const rosta = opts && opts.rosta;
    const grupper = ["malvakter", "backar", "forwards"];
    const logo = S.logoUrl(lag.namn);
    const parts = [`<div class="lagblock"><div class="lagnamn"><img src="${S.esc(logo)}" alt="">${S.esc(lag.namn)}</div>`];
    for (const g of grupper) {
      const spelare = lag.spelare.filter((p) => p.grupp === g);
      if (!spelare.length) continue;
      parts.push(`<div class="gruppnamn">${GRUPP[g]}</div><div class="lista">`);
      for (const p of spelare) {
        const id = S.playerId(lag.namn, p.nr);
        if (rosta) {
          parts.push(
            `<button type="button" class="rad spelare" data-id="${S.esc(id)}" data-lag="${S.esc(lag.namn)}" data-nr="${S.esc(p.nr)}" data-namn="${S.esc(p.namn)}">` +
              `<span class="nr">${S.esc(p.nr)}</span><span class="namn">${S.esc(p.namn)}</span></button>`
          );
        } else {
          parts.push(
            `<div class="rad-wrap" data-id="${S.esc(id)}" data-lag="${S.esc(lag.namn)}" data-nr="${S.esc(p.nr)}">` +
              `<button type="button" class="rad lagspelare" data-id="${S.esc(id)}" data-lag="${S.esc(lag.namn)}" data-nr="${S.esc(p.nr)}" data-namn="${S.esc(p.namn)}">` +
              `<span class="nr">${S.esc(p.nr)}</span><span class="namn">${S.esc(p.namn)}</span></button></div>`
          );
        }
      }
      parts.push("</div>");
    }
    parts.push("</div>");
    return parts.join("");
  }

  function hittaSpelare(lagNamn, nr) {
    const lag = visadTrupp || S.lag();
    const names = lag.hemma.spelare.map((p) => ({ ...p, lag: lag.hemma.namn }))
      .concat(lag.borta.spelare.map((p) => ({ ...p, lag: lag.borta.namn })));
    return names.find((p) => p.lag === lagNamn && String(p.nr) === String(nr));
  }

  function alder(fodd) {
    if (!fodd || !/^\d{4}-\d{2}-\d{2}$/.test(fodd)) return null;
    const [y, m, d] = fodd.split("-").map(Number);
    const ref = (S.match() && S.match().datum) || "2026-11-27";
    const [Y, M, D] = ref.split("-").map(Number);
    let a = Y - y;
    if (M < m || (M === m && D < d)) a -= 1;
    return a;
  }

  function foddVis(fodd) {
    const [y, m, d] = fodd.split("-");
    return `${parseInt(d, 10)}/${m} ${y}`;
  }

  function skottVis(s) {
    return s === "L" ? "Vänster" : s === "R" ? "Höger" : s;
  }

  function fmtDec(n) {
    if (n == null || n === "") return "–";
    return String(n).replace(".", ",");
  }

  function kort(k, v, d) {
    return `<div class="info-kort-ruta"><div class="k">${S.esc(k)}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ""}</div>`;
  }

  function infoHtml(p) {
    const s = p.statistik;
    const meta = [];
    const pos = p.pos_visning || p.pos || "";
    const posExtra = p.pos && p.pos_visning && p.pos !== p.pos_visning ? ` (${p.pos})` : "";
    if (pos) meta.push(`<div class="info-rad"><span>Position</span><b>${S.esc(pos + posExtra)}</b></div>`);
    if (p.fodd) {
      const a = alder(p.fodd);
      meta.push(`<div class="info-rad"><span>Född</span><b>${S.esc(foddVis(p.fodd))}${a != null ? " (" + a + " år)" : ""}</b></div>`);
    }
    if (p.skott) meta.push(`<div class="info-rad"><span>Fattning</span><b>${S.esc(skottVis(p.skott))}</b></div>`);
    if (p.moderklubb) meta.push(`<div class="info-rad"><span>Moderklubb</span><b>${S.esc(p.moderklubb)}</b></div>`);

    let cards = "";
    if (!s) {
      cards = `<p class="info-saknas">Ingen seriestatistik i den lokala datan.</p>`;
    } else if (s.typ === "malvakt") {
      const sv = s.svp != null ? fmtDec(Math.round(s.svp * 10) / 10) + " %" : "–";
      const wl = [s.w != null ? s.w + " V" : null, s.l != null ? s.l + " F" : null].filter(Boolean).join(" · ");
      cards = kort("Matcher", S.esc(String(s.gpi ?? "–")), S.esc(wl || "i serien"))
        + kort("Räddningar", S.esc(String(s.svs ?? "–")), s.sog != null ? "av " + s.sog + " skott" : "i serien")
        + kort("Räddnings-%", S.esc(sv), "SV% i serien")
        + kort("Insläppta mål", S.esc(String(s.ga ?? "–")), "GA i serien")
        + kort("GAA", S.esc(s.gaa != null ? fmtDec(s.gaa) : "–"), "insläppta/60 min")
        + kort("Hållna nollor", S.esc(String(s.so ?? "–")), "shutouts");
    } else {
      const tp = `${s.g ?? 0}+${s.a ?? 0}=${s.tp ?? 0}`;
      const pm = s.plusminus;
      const pmVis = pm == null ? "–" : (pm > 0 ? "+" + pm : String(pm));
      const fo = (s.fo_won || 0) + (s.fo_lost || 0);
      const pp = (s.ppg || 0) + (s.ppa || 0);
      const pmDet = (s.plus != null) ? ("+" + s.plus + " / –" + s.minus) : "";
      cards = kort("Poäng i serien", S.esc(tp), s.gp != null ? s.gp + " matcher" : "")
        + kort("Poäng i powerplay", S.esc(String(pp)), `${s.ppg ?? 0} PP-mål · ${s.ppa ?? 0} PP-assist`)
        + kort("+/-", S.esc(pmVis), S.esc(pmDet))
        + kort("Utvisningsminuter", S.esc(String(s.pim ?? "–")), "PIM i serien")
        + kort("Vunna tekningar", fo ? S.esc(String(s.fo_won)) : "–", fo ? `av ${fo} (${Math.round(100 * s.fo_won / fo)} %)` : "inga tekningar");
    }
    const kalla = (S.getData() && S.getData().statistik_kalla) || "";
    const port = portrattFor(p);
    const portHtml = port
      ? `<div class="info-portratt${port.demo ? " demo" : ""}"><img src="${S.esc(port.src)}" alt="${S.esc(p.namn || "")}">${port.etikett ? `<p class="info-portratt-etikett">${S.esc(port.etikett)}</p>` : ""}</div>`
      : "";
    return `<div class="info-panel">${portHtml}${meta.join("")}<div class="info-kort">${cards}</div>${kalla ? `<p class="info-kalla">${S.esc(kalla)}</p>` : ""}</div>`;
  }

  function ritaInfo() {
    document.querySelectorAll(".rad-wrap").forEach((w) => {
      const open = w.dataset.id === val.oppnad;
      w.classList.toggle("oppen", open);
      const btn = w.querySelector(".lagspelare");
      if (btn) btn.classList.toggle("vald", open);
      let pan = w.querySelector(".info-panel");
      if (open && !pan) {
        const p = hittaSpelare(w.dataset.lag, w.dataset.nr);
        if (p) w.insertAdjacentHTML("beforeend", infoHtml({ ...p, lag: p.lag || w.dataset.lag }));
      } else if (pan) {
        pan.hidden = !open;
      }
    });
  }

  function scrollaTillOppnad(id) {
    const kor = (smooth) => {
      const rad = [...document.querySelectorAll("#vy-laglista .rad-wrap")].find((w) => w.dataset.id === id);
      if (!rad) return;
      const tillbaka = document.querySelector("#vy-laglista:not([hidden]) .tillbaka");
      const takH = tillbaka ? tillbaka.getBoundingClientRect().height : 0;
      const luft = 10;
      const mal = takH + luft;
      const prev = rad.previousElementSibling;
      const ankare = (prev && prev.classList && prev.classList.contains("rad-wrap")) ? prev : rad;
      const delta = ankare.getBoundingClientRect().top - mal;
      if (Math.abs(delta) < 4) return;
      window.scrollBy({ top: delta, behavior: smooth ? "smooth" : "auto" });
    };
    requestAnimationFrame(() => requestAnimationFrame(() => kor(true)));
    setTimeout(() => kor(false), 280);
  }

  function vaxlaInfo(id) {
    const stang = val.oppnad === id;
    val.oppnad = stang ? null : id;
    ritaInfo();
    if (!stang) scrollaTillOppnad(id);
  }

  function ritaMatchvard() {
    const box = $("matchvard");
    if (!box) return;
    const mv = S.get().matchvard;
    if (!mv || !mv.pa) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const img = mv.logo ? `<span class="mv-platta"><img src="${S.esc(mv.logo)}" alt="${S.esc(mv.namn || "")}"></span>` : "";
    const namn = (!mv.logo && mv.namn) ? `<div class="namn">${S.esc(mv.namn)}</div>` : "";
    const inner = img + namn;
    if (mv.lank) {
      box.innerHTML = `<div class="etikett">Dagens matchvärd</div><a class="mv-innehall" href="${S.esc(mv.lank)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    } else {
      box.innerHTML = `<div class="etikett">Dagens matchvärd</div><div class="mv-innehall">${inner}</div>`;
    }
  }


  let nedrakningTimer = null;

  const ETT_DYGN_MS = 24 * 60 * 60 * 1000;

  function nuMs() {
    const p = new URLSearchParams(location.search).get("nu");
    if (p) {
      const t = Date.parse(p);
      if (Number.isFinite(t)) return t;
    }
    return Date.now();
  }

  function formatCountdown(ms) {
    if (ms < 0) ms = 0;
    const sec = Math.floor(ms / 1000);
    const h = Math.floor(sec / 3600);
    const min = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = String(min).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    if (h > 0) return String(h).padStart(2, "0") + ":" + mm + ":" + ss;
    return mm + ":" + ss;
  }

  function liveLage() {
    const lage = new URLSearchParams(location.search).get("lage");
    if (lage === "live" || lage === "paus") return lage;
    return null;
  }

  function lageBadge(live, m) {
    const st = live && live.status;
    if (!st) return "";
    if (st.typ === "pp") {
      const namn = st.lagNamn || (st.lag === "borta" ? m.borta : m.hemma);
      return `<div class="lage-badge pp" aria-label="Powerplay ${S.esc(namn)} ${S.esc(st.tid)}">
        <img src="${S.esc(S.logoUrl(namn))}" alt="">
        <span class="badge-text">PP ${S.esc(namn)}</span>
        <span class="badge-tid">${S.esc(st.tid)}</span>
      </div>`;
    }
    if (st.typ === "paus") {
      return `<div class="lage-badge paus" aria-label="Paus ${S.esc(st.tid)}">
        <span class="badge-text">PAUS</span>
        <span class="badge-tid">${S.esc(st.tid)}</span>
      </div>`;
    }
    return "";
  }

  function ritaMatchkort(m) {
    const kort = $("matchkort");
    const lage = liveLage();
    const live = S.liveFranKlocka(m, { mock: !!lage, lage });
    const start = S.matchTid(m);
    const nu = nuMs();
    kort.classList.toggle("live", !!live);
    let mitten = `<div class="mot" aria-hidden="true">–</div>`;
    let nar;
    if (live) {
      mitten = `<div class="mot stallning" aria-label="Ställning ${live.malHemma}–${live.malBorta}"><span class="mal">${live.malHemma}</span><span class="streck">–</span><span class="mal">${live.malBorta}</span></div>`;
      const paus = live.status && live.status.typ === "paus";
      const periodRad = paus
        ? (live.nastaNamn ? `<div class="period nasta">Nästa: ${S.esc(live.nastaNamn)}</div>` : "")
        : `<div class="period">${S.esc(live.periodNamn)} · ${S.esc(live.speltid)}</div>`;
      nar = `<div class="när">
        ${periodRad}
        ${lageBadge(live, m)}
        ${live.mock ? `<div class="mock-marke">Exempeldata · inte från klockan ännu</div>` : ""}
        <div class="arena">${S.esc(m.arena)}</div>
      </div>`;
    } else if (nu < start && (start - nu) <= ETT_DYGN_MS) {
      nar = `<div class="när">
        <div class="dag">${S.esc(m.veckodag)} ${S.esc(m.datum_visning)}</div>
        <div class="nedslapp-etikett">Nedsläpp om</div>
        <div class="klockslag nedrakning" id="nedrakning">${formatCountdown(start - nu)}</div>
        <div class="arena">${S.esc(m.arena)}</div>
      </div>`;
    } else {
      nar = `<div class="när">
        <div class="dag">${S.esc(m.veckodag)} ${S.esc(m.datum_visning)}</div>
        <div class="klockslag">${S.esc(m.tid)}</div>
        <div class="arena">${S.esc(m.arena)}</div>
      </div>`;
    }
    kort.innerHTML =
      `<div class="etikett">Dagens match</div>` +
      `<div class="lagen-rutor">` +
        `<div class="lag"><img src="${S.esc(S.logoUrl(m.hemma))}" alt="${S.esc(m.hemma)}"><div class="namn">${S.esc(m.hemma)}</div></div>` +
        mitten +
        `<div class="lag"><img src="${S.esc(S.logoUrl(m.borta))}" alt="${S.esc(m.borta)}"><div class="namn">${S.esc(m.borta)}</div></div>` +
      `</div>` +
      nar;
  }

  function startaNedrakning() {
    if (nedrakningTimer) {
      clearInterval(nedrakningTimer);
      nedrakningTimer = null;
    }
    if (!$("nedrakning")) return;
    nedrakningTimer = setInterval(() => {
      const el = $("nedrakning");
      if (!el) {
        clearInterval(nedrakningTimer);
        nedrakningTimer = null;
        return;
      }
      const kvar = S.matchTid(S.match()) - nuMs();
      if (kvar <= 0 || kvar > ETT_DYGN_MS) {
        clearInterval(nedrakningTimer);
        nedrakningTimer = null;
        render();
        return;
      }
      el.textContent = formatCountdown(kvar);
    }, 1000);
  }

  let livestatTimer = null;

  function stoppaLivestat() {
    if (livestatTimer) {
      clearInterval(livestatTimer);
      livestatTimer = null;
    }
  }

  function startaLivestat() {
    ritaLivestat();
    stoppaLivestat();
    livestatTimer = setInterval(ritaLivestat, 1000);
  }

  function pctBar(a, b) {
    const tot = Math.max(0, (+a || 0) + (+b || 0));
    const va = tot ? Math.round((+a || 0) * 100 / tot) : 0;
    return `<div class="delad-falt" role="presentation"><i style="width:${va}%"></i></div>`;
  }

  function spelareRad(p) {
    const port = portrattFor(p);
    const src = port ? port.src : (p.lag ? S.logoUrl(p.lag) : "");
    const alt = port ? (p.namn || "") : (p.lag || "");
    const thumb = src ? `<img src="${S.esc(src)}" alt="${S.esc(alt)}">` : "";
    return `<li class="isen-rad">
      ${thumb}
      <span class="text"><b>#${S.esc(String(p.nr))} ${S.esc(p.namn || "")}</b></span>
    </li>`;
  }

  function zonBar(z) {
    const a = z.anfall || 0, n = z.neutral || 0, f = z.forsvar || 0;
    return `<div class="zon-falt" role="img" aria-label="Anfall ${a} procent, neutral ${n} procent, försvar ${f} procent">
      <span class="z anfall" style="flex:${a}"><b>${a}%</b></span>
      <span class="z neutral" style="flex:${n}"><b>${n}%</b></span>
      <span class="z forsvar" style="flex:${f}"><b>${f}%</b></span>
    </div>`;
  }

  function malRad(e, m) {
    const namn = e.lagNamn || (e.lag === "borta" ? m.borta : m.hemma);
    const skytt = e.skytt || {};
    const assist = (e.assist || []).filter((a) => a && a.namn);
    const assistTxt = assist.length
      ? `<small>Assist: ${assist.map((a) => "#" + a.nr + " " + a.namn).join(", ")}</small>`
      : "";
    return `<li class="mal-rad">
      <span class="mtid">${S.esc((e.perEtikett || e.per || "") + " " + (e.tid || ""))}</span>
      <img class="mlag" src="${S.esc(S.logoUrl(namn))}" alt="${S.esc(namn)}">
      <span class="mtext"><b>#${S.esc(String(skytt.nr || ""))} ${S.esc(skytt.namn || "")}</b>${assistTxt}</span>
    </li>`;
  }

  function ritaLivestat() {
    const box = $("livestat");
    if (!box) return;
    const m = S.match();
    const data = S.livestatFranHub(m, { mock: true, lag: S.lag() });
    if (!data) {
      box.innerHTML = `<p class="notis">Ingen livestat just nu.</p>`;
      return;
    }
    const inh = data.innehav || { hemma: 0, borta: 0 };
    const tek = data.tekning || { hemma: { vunna: 0, pct: 0 }, borta: { vunna: 0, pct: 0 } };
    const zon = data.zon || { hemma: { anfall: 0, neutral: 0, forsvar: 0 }, borta: { anfall: 0, neutral: 0, forsvar: 0 } };
    const isen = data.paIsen || { hemma: [], borta: [] };
    const mal = data.mal || [];
    box.innerHTML = `
      ${data.mock ? `<p class="mock-marke livestat-marke">Exempeldata · inte från hubben ännu</p>` : ""}
      <article class="stat-kort mal-kort">
        <div class="etikett">Mål</div>
        <div class="livestat-stallning" aria-label="Ställning ${data.malHemma}–${data.malBorta}">
          <img src="${S.esc(S.logoUrl(m.hemma))}" alt="${S.esc(m.hemma)}">
          <b>${data.malHemma}–${data.malBorta}</b>
          <img src="${S.esc(S.logoUrl(m.borta))}" alt="${S.esc(m.borta)}">
        </div>
        <p class="livestat-period">${S.esc(data.periodNamn || "")} · ${S.esc(data.speltid || "")}</p>
        <ol class="mallista">${mal.map((e) => malRad(e, m)).join("") || "<li class='tom'>Inga mål ännu</li>"}</ol>
      </article>
      <article class="stat-kort">
        <div class="etikett">Puckinnehav</div>
        <div class="delad">
          <div class="sida"><img src="${S.esc(S.logoUrl(m.hemma))}" alt="${S.esc(m.hemma)}"><b>${inh.hemma}%</b></div>
          ${pctBar(inh.hemma, inh.borta)}
          <div class="sida ho"><b>${inh.borta}%</b><img src="${S.esc(S.logoUrl(m.borta))}" alt="${S.esc(m.borta)}"></div>
        </div>
      </article>
      <article class="stat-kort">
        <div class="etikett">Tekningsvinst</div>
        <div class="delad">
          <div class="sida"><img src="${S.esc(S.logoUrl(m.hemma))}" alt="${S.esc(m.hemma)}"><b>${tek.hemma.pct}%</b></div>
          ${pctBar(tek.hemma.pct, tek.borta.pct)}
          <div class="sida ho"><b>${tek.borta.pct}%</b><img src="${S.esc(S.logoUrl(m.borta))}" alt="${S.esc(m.borta)}"></div>
        </div>
        <div class="delad-antal"><span>${tek.hemma.vunna} vunna</span><span>${tek.borta.vunna} vunna</span></div>
      </article>
      <article class="stat-kort">
        <div class="etikett">Zonprocent</div>
        <div class="zon-legend"><span class="p anfall">Anfallszon</span><span class="p neutral">Neutral zon</span><span class="p forsvar">Försvarszon</span></div>
        <div class="zon-lag"><img src="${S.esc(S.logoUrl(m.hemma))}" alt=""><b>${S.esc(m.hemma)}</b></div>
        ${zonBar(zon.hemma)}
        <div class="zon-lag"><img src="${S.esc(S.logoUrl(m.borta))}" alt=""><b>${S.esc(m.borta)}</b></div>
        ${zonBar(zon.borta)}
      </article>
      <article class="stat-kort">
        <div class="etikett">Spelare på isen just nu</div>
        <div class="isen-lag">
          <div class="zon-lag"><img src="${S.esc(S.logoUrl(m.hemma))}" alt=""><b>${S.esc(m.hemma)}</b></div>
          <ul class="isen-lista">${(isen.hemma || []).map(spelareRad).join("")}</ul>
        </div>
        <div class="isen-lag">
          <div class="zon-lag"><img src="${S.esc(S.logoUrl(m.borta))}" alt=""><b>${S.esc(m.borta)}</b></div>
          <ul class="isen-lista">${(isen.borta || []).map(spelareRad).join("")}</ul>
        </div>
      </article>`;
  }

  function render() {
    const st = S.get();
    const m = S.match();
    const lag = S.lag();
    ritaMatchkort(m);
    ritaMatchvard();
    $("val-laglista").hidden = !st.meny.laglista;
    $("halvapott").hidden = !st.meny.halvapott;
    $("val-rosta").hidden = !st.meny.rosta;
    if ($("val-livestat")) $("val-livestat").hidden = !st.meny.livestat;
    if ($("val-spel")) $("val-spel").hidden = !spelSynligt();
    $("halvapott").href = st.halvapottUrl;
    $("halvapott").classList.toggle("saknar-lank", !st.halvapottUrl);
    visaTrupp({ kalla: "sasong", etikett: "Officiell laguppställning publiceras före match", officiell: false });
    hamtaLaguppstallning();
    ritaRosta();
    ritaInfo();
    startaNedrakning();
    document.body.classList.add("ready");
  }

  function rostLagData() {
    const lag = visadTrupp || S.lag();
    return val.rostLag === "borta" ? lag.borta : lag.hemma;
  }

  const MINA_KEY = "publikapp-mina-roster";
  function lasMina() {
    try { return JSON.parse(localStorage.getItem(MINA_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function minaRoster(matchId) {
    return lasMina()[matchId || S.visadMatchId()] || {};
  }
  function harRostatLag(lagNamn) {
    return !!(lagNamn && minaRoster()[lagNamn]);
  }
  function sparaMinRost(rost) {
    const mid = S.visadMatchId();
    const all = lasMina();
    const bag = { ...(all[mid] || {}) };
    bag[rost.lag] = { lag: rost.lag, nr: rost.nr, namn: rost.namn };
    all[mid] = bag;
    try { localStorage.setItem(MINA_KEY, JSON.stringify(all)); } catch (e) {}
    return bag;
  }
  function matchLagNamn() {
    const m = S.match();
    return [m.hemma, m.borta].filter(Boolean);
  }
  function lagSida(namn) {
    return namn === S.match().borta ? "borta" : "hemma";
  }
  function rostKvar(bag) {
    const mina = bag || minaRoster();
    return matchLagNamn().filter((l) => !mina[l]);
  }

  function ritaRosta() {
    const m = S.match();
    const hemmaBtn = $("rosta-filter-hemma");
    const bortaBtn = $("rosta-filter-borta");
    function fyllFilter(btn, namn, on) {
      if (!btn) return;
      let img = btn.querySelector("img.rosta-laglogo");
      if (!img) {
        img = document.createElement("img");
        img.className = "rosta-laglogo";
        img.alt = "";
        btn.prepend(img);
      }
      img.src = S.logoUrl(namn);
      let sp = btn.querySelector("span.namn");
      if (!sp) {
        sp = document.createElement("span");
        sp.className = "namn";
        btn.append(sp);
      }
      sp.textContent = namn;
      btn.classList.toggle("on", on);
      btn.classList.toggle("rostad", harRostatLag(namn));
      btn.setAttribute("aria-selected", on ? "true" : "false");
      let chk = btn.querySelector(".rostad-check");
      if (harRostatLag(namn)) {
        if (!chk) {
          chk = document.createElement("span");
          chk.className = "rostad-check";
          chk.setAttribute("aria-hidden", "true");
          chk.textContent = "✓";
          btn.append(chk);
        }
      } else if (chk) {
        chk.remove();
      }
    }
    fyllFilter(hemmaBtn, m.hemma, val.rostLag !== "borta");
    fyllFilter(bortaBtn, m.borta, val.rostLag === "borta");
    const hint = $("rosta-hint");
    if (hint) {
      const kvar = rostKvar();
      const gjorda = matchLagNamn().length - kvar.length;
      if (!gjorda) {
        hint.textContent = "Rösta på en spelare i " + m.hemma + " och en i " + m.borta;
      } else if (kvar.length) {
        hint.textContent = gjorda + " av " + matchLagNamn().length + " – rösta nu på en spelare i " + kvar[0];
      } else {
        hint.textContent = "Du har röstat i båda lagen";
      }
    }
    const team = rostLagData();
    const lista = $("rostalista");
    const logo = S.logoUrl(team.namn);
    const grupper = ["malvakter", "backar", "forwards"];
    const spelare = [];
    grupper.forEach((g) => {
      team.spelare.filter((p) => p.grupp === g).forEach((p) => spelare.push(p));
    });
    if (!spelare.length) spelare.push(...(team.spelare || []));
    lista.innerHTML = spelare.map((p) => {
      const id = S.playerId(team.namn, p.nr);
      const pos = p.pos_visning || p.pos || "";
      const port = portrattFor({ ...p, lag: team.namn });
      const bilder = port
        ? `<img class="kort-portratt" src="${S.esc(port.src)}" alt="">` +
          `<img class="kort-laglogo" src="${S.esc(logo)}" alt="">`
        : `<img class="kort-laglogo" src="${S.esc(logo)}" alt="">`;
      return `<article class="rostakort${port ? " har-portratt" : ""}" role="option" data-id="${S.esc(id)}" data-lag="${S.esc(team.namn)}" data-nr="${S.esc(p.nr)}" data-namn="${S.esc(p.namn)}" data-pos="${S.esc(pos)}">` +
        bilder +
        `<div class="nr">${S.esc(p.nr)}</div>` +
        `<div class="namn">${S.esc(p.namn)}</div>` +
        (pos ? `<div class="pos">${S.esc(pos)}</div>` : "") +
        `</article>`;
    }).join("");
    const keep = val.vald && val.vald.lag === team.namn
      ? lista.querySelector(`.rostakort[data-id="${CSS.escape(val.vald.id)}"]`)
      : null;
    const target = keep || lista.querySelector(".rostakort");
    requestAnimationFrame(() => {
      if (target) {
        target.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
        markeraKort(target, false);
      } else {
        aterstallRostaknapp();
      }
    });
  }

  function kortIMitten() {
    const lista = $("rostalista");
    const mid = lista.getBoundingClientRect();
    const cx = mid.left + mid.width / 2;
    let best = null, bestDist = Infinity;
    lista.querySelectorAll(".rostakort").forEach((k) => {
      const r = k.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - cx);
      if (d < bestDist) { bestDist = d; best = k; }
    });
    return best;
  }

  function synkaRostaVal() {
    const k = kortIMitten();
    if (k) markeraKort(k, true);
  }

  function aterstallRostaknapp() {
    const k = $("rostaknapp");
    k.disabled = true;
    k.classList.remove("redo");
    k.textContent = "Välj en spelare";
  }

  function markeraKort(kort, sparaVal) {
    if (!kort) { aterstallRostaknapp(); return; }
    if (sparaVal !== false) {
      val.vald = {
        id: kort.dataset.id,
        lag: kort.dataset.lag,
        nr: kort.dataset.nr,
        namn: kort.dataset.namn,
      };
    }
    document.querySelectorAll(".rostakort").forEach((el) => {
      const on = el === kort;
      el.classList.toggle("vald", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
    const k = $("rostaknapp");
    if (harRostatLag(kort.dataset.lag)) {
      k.disabled = true;
      k.classList.remove("redo");
      k.textContent = "Redan röstat i det här laget";
    } else {
      k.disabled = false;
      k.classList.add("redo");
      k.textContent = "Rösta på #" + kort.dataset.nr;
    }
  }

  function markera(btn, sparaVal) {
    markeraKort(btn, sparaVal);
  }

  function ritaTack() {
    const lista = $("tacklista");
    if (!lista) return;
    const bag = minaRoster();
    const rader = matchLagNamn().map((l) => bag[l]).filter(Boolean);
    lista.innerHTML = rader.map((v) => {
      const port = portrattFor(v);
      const thumb = port
        ? `<img class="tack-portratt" src="${S.esc(port.src)}" alt="">`
        : `<img class="tack-logo" src="${S.esc(S.logoUrl(v.lag))}" alt="">`;
      return `<li class="tack-rad">${thumb}<div class="text"><span class="namn">#${S.esc(v.nr)} ${S.esc(v.namn)}</span><small>${S.esc(v.lag)}</small></div></li>`;
    }).join("");
  }

  function oppnRosta() {
    if (!S.get().rostningOppen) {
      visa("stangd");
      return;
    }
    if (!rostKvar().length) {
      ritaTack();
      visa("tack");
      return;
    }
    const kvar = rostKvar();
    if (kvar.length) val.rostLag = lagSida(kvar[0]);
    visa("rosta");
    ritaRosta();
  }

  function aktuellVald() {
    if (val.vald && val.vald.lag && val.vald.nr != null) return val.vald;
    const k = document.querySelector(".rostakort.vald") || (typeof kortIMitten === "function" ? kortIMitten() : null);
    if (!k) return null;
    return { id: k.dataset.id, lag: k.dataset.lag, nr: k.dataset.nr, namn: k.dataset.namn };
  }

  function skickaRost() {
    const rost = aktuellVald();
    if (!rost) return;
    val.vald = rost;
    if (!S.get().rostningOppen) {
      visa("stangd");
      return;
    }
    if (harRostatLag(val.vald.lag)) return;
    const bag = sparaMinRost(val.vald);
    S.rostaPa(val.vald.lag, val.vald.nr);
    const kvar = rostKvar(bag);
    if (!kvar.length) {
      ritaTack();
      visa("tack");
      return;
    }
    val.rostLag = lagSida(kvar[0]);
    val.vald = null;
    visa("rosta");
    ritaRosta();
  }

  function startVy() {
    const params = new URLSearchParams(location.search);
    let start = (location.hash || "#meny").slice(1);
    document.body.classList.toggle("platta-vit", params.get("platta") === "vit");
    if (!["meny", "laglista", "rosta", "tack", "stangd", "livestat", "spel", "music"].includes(start)) start = "meny";
    if (start === "rosta" || start === "stangd") oppnRosta();
    else if (start === "tack") { ritaTack(); visa("tack"); }
    else if (start === "livestat") { ritaLivestat(); visa("livestat"); }
    else visa(start);
    if (params.get("demo") === "vald") {
      visa("rosta");
      const paket = document.querySelector('.rostakort[data-namn="Nils Bolin"]') || document.querySelector(".rostakort");
      if (paket) {
        paket.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
        markeraKort(paket);
      }
    }
    if (params.get("demo") === "info") {
      visa("laglista");
      const btn = document.querySelector('button.lagspelare[data-namn="Oscar Bramberg"]') || document.querySelector("button.lagspelare");
      if (btn) vaxlaInfo(btn.dataset.id);
    }
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("#rostaknapp")) {
      e.preventDefault();
      skickaRost();
      return;
    }
    if (e.target.closest("#spel-igen")) {
      e.preventDefault();
      startaNyOmgang();
      return;
    }
    const meny = e.target.closest("[data-vy]");
    if (meny && meny.tagName === "BUTTON") {
      const namn = meny.dataset.vy;
      if (namn === "rosta") oppnRosta();
      else visa(namn);
      return;
    }
    const info = e.target.closest("button.lagspelare");
    if (info) {
      vaxlaInfo(info.dataset.id);
      return;
    }
    const filter = e.target.closest("[data-lagfilter]");
    if (filter && $("vy-rosta").contains(filter)) {
      val.rostLag = filter.dataset.lagfilter;
      if (val.vald && val.vald.lag !== rostLagData().namn) val.vald = null;
      ritaRosta();
      return;
    }
    const kort = e.target.closest(".rostakort");
    if (kort) {
      kort.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
      markeraKort(kort);
    }
  });
  let rostaScrollTimer = null;
  $("rostalista").addEventListener("scroll", () => {
    clearTimeout(rostaScrollTimer);
    rostaScrollTimer = setTimeout(synkaRostaVal, 80);
  }, { passive: true });

  function lasHash() {
    const start = (location.hash || "#meny").slice(1);
    if (start === "rosta" || start === "stangd") oppnRosta();
    else if (start === "tack") { ritaTack(); visa("tack"); }
    else if (["meny", "laglista", "livestat", "spel", "music"].includes(start)) visa(start);
  }
  window.addEventListener("hashchange", lasHash);


  function visaAlderDialog() {
    $("alder-dialog").hidden = false;
    $("alder-ja").focus();
  }
  function stangAlderDialog() {
    if ($("alder-dialog").hidden) return;
    $("alder-dialog").hidden = true;
    $("halvapott").focus();
  }
  $("halvapott").addEventListener("click", (e) => {
    e.preventDefault();
    if (!S.get().halvapottUrl) return;
    visaAlderDialog();
  });
  $("alder-ja").addEventListener("click", () => {
    const url = S.get().halvapottUrl;
    stangAlderDialog();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  });
  $("alder-nej").addEventListener("click", stangAlderDialog);
  $("alder-dialog").addEventListener("click", (e) => {
    if (e.target.id === "alder-dialog") stangAlderDialog();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") stangAlderDialog();
  });



  function kopplaSpotify() {
    const id = S.warmupSpellista ? S.warmupSpellista() : "";
    const ruta = $("music-lista");
    const ram = $("music-spotify");
    const lank = $("music-spotify-lank");
    if (!ram || !lank) return;
    if (!id) {
      if (ruta) ruta.hidden = true;
      return;
    }
    if (ruta) ruta.hidden = false;
    if (ram.dataset.id !== id) {
      ram.dataset.id = id;
      ram.src = "https://open.spotify.com/embed/playlist/" + id + "?theme=0";
    }
    lank.href = "https://open.spotify.com/playlist/" + id;
  }

  const musicForm = $("music-onskan");
  if (musicForm) {
    musicForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const lat = ($("music-lat").value || "").trim();
      const tack = $("music-tack");
      if (!lat) {
        if (tack) tack.hidden = true;
        $("music-lat").focus();
        return;
      }
      musicForm.reset();
      if (tack) {
        tack.hidden = false;
        tack.focus();
      }
    });
  }

  let tryckTimer = null;
  function slappTryck(el) {
    if (!el) return;
    clearTimeout(tryckTimer);
    tryckTimer = setTimeout(() => el.classList.remove("tryckt"), 160);
  }
  document.addEventListener("pointerdown", (e) => {
    const t = e.target.closest("body.publik .val");
    if (!t) return;
    clearTimeout(tryckTimer);
    t.classList.add("tryckt");
  });
  document.addEventListener("pointerup", (e) => slappTryck(e.target.closest && e.target.closest(".val")));
  document.addEventListener("pointercancel", (e) => slappTryck(e.target.closest && e.target.closest(".val")));

  function hamtaPortratt() {
    return fetch("portraits/index.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) portrattKarta = d; })
      .catch(() => {});
  }
  function portrattFor(p) {
    const map = (portrattKarta && portrattKarta.spelare) || {};
    const keys = [
      p && p.lag && p.nr != null ? p.lag + "|" + p.nr : "",
      p && p.namn ? p.namn : "",
    ].filter(Boolean);
    for (const k of keys) {
      if (map[k]) return { src: "portraits/" + map[k], etikett: null, demo: false };
    }
    const lagStd = (portrattKarta && portrattKarta.lagStandard) || {};
    if (p && p.lag) {
      const lk = Object.keys(lagStd).find((k) => String(p.lag).toLowerCase().startsWith(k.toLowerCase()));
      if (lk) return { src: "portraits/" + lagStd[lk], etikett: null, demo: false };
    }
    const params = new URLSearchParams(location.search);
    const demo = portrattKarta && portrattKarta.demo;
    if (demo && demo.fil && (params.get("demo") === "portratt" || params.get("demo") === "info")) {
      return { src: "portraits/" + demo.fil, etikett: demo.etikett || "Exempelporträtt", demo: true };
    }
    return null;
  }


  function visningsnamn(s) {
    const t = String(s || "");
    if (t && t === t.toUpperCase()) {
      return t.toLowerCase().replace(/(^|[\s/&-])(\S)/g, (m, a, b) => a + b.toUpperCase());
    }
    return t;
  }

  function ritaPartners(data) {
    const box = $("partners");
    if (!box) return;
    const lista = (data && data.sponsorer) || [];
    const medLogo = lista.filter((s) => s.logo);
    const utanLogo = lista.filter((s) => !s.logo);
    if (!lista.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const ruta = (s) => {
      const img = `<img src="logos/sponsorer/${S.esc(s.logo)}" alt="${S.esc(visningsnamn(s.namn))}">`;
      if (s.lank) {
        return `<a class="partner-ruta" href="${S.esc(s.lank)}" target="_blank" rel="noopener noreferrer">${img}</a>`;
      }
      return `<div class="partner-ruta">${img}</div>`;
    };
    const namnLi = (s) => {
      const n = S.esc(visningsnamn(s.namn));
      if (s.lank) return `<li><a href="${S.esc(s.lank)}" target="_blank" rel="noopener noreferrer">${n}</a></li>`;
      return `<li>${n}</li>`;
    };
    const under = "1986-Klubben säsongen 2026/27";
    box.innerHTML =
      `<h2 id="partners-rubrik">Våra partners</h2>` +
      `<p class="partners-under">${S.esc(under)}</p>` +
      (medLogo.length ? `<div class="partner-rutnat">${medLogo.map(ruta).join("")}</div>` : "") +
      (utanLogo.length ? `<ul class="partner-namnlista">${utanLogo.map(namnLi).join("")}</ul>` : "");
    box.hidden = false;
  }

  function hamtaSponsorer() {
    return fetch("logos/sponsorer/sponsorer.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { ritaPartners(d); })
      .catch(() => {});
  }


  function spelForhandsvisning() {
    return new URLSearchParams(location.search).get("spel") === "1";
  }

  function iPaus() {
    const lage = liveLage();
    if (lage === "paus") return true;
    if (!S.match) return false;
    const m = S.match();
    const live = S.liveFranKlocka(m, { mock: !!lage, lage });
    return !!(live && live.status && live.status.typ === "paus");
  }

  function spelSynligt() {
    if (spelForhandsvisning()) return true;
    if (!SPEL_BARA_I_PAUS) return true;
    return iPaus();
  }

  function lasSpelBasta() {
    const n = parseInt(localStorage.getItem(SPEL_BASTA_KEY) || "0", 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(SPEL_SKOTT_MAX, n)) : 0;
  }

  function sparaSpelBasta(n) {
    try { localStorage.setItem(SPEL_BASTA_KEY, String(n)); } catch (e) {}
  }

  function rensaSmeknamn(s) {
    return String(s || "")
      .replace(/[^\wÅÄÖåäöÉéÜü .-]/gi, "")
      .replace(/_+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 16);
  }

  const spel = {
    aktiv: false,
    bunden: false,
    raf: 0,
    forraTs: 0,
    fas: "redo",
    omgang: false,
    skottNr: 1,
    mal: 0,
    basta: 0,
    skickat: false,
    malvaktX: 0.5,
    malvaktTid: 0,
    malvaktMal: 0.5,
    puck: { x: 0.5, y: 0.9 },
    skott: null,
    swipe: null,
    w: 390,
    h: 520,
    canvas: null,
    ctx: null,
  };

  function puckStart() {
    return { x: 0.5, y: 0.9 };
  }

  function startaNyOmgang() {
    spel.omgang = true;
    spel.fas = "redo";
    spel.skottNr = 1;
    spel.mal = 0;
    spel.skickat = false;
    spel.skott = null;
    spel.swipe = null;
    spel.puck = puckStart();
    spel.malvaktX = 0.5;
    spel.malvaktTid = 0;
    spel.basta = lasSpelBasta();
    $("spel-resultat").hidden = true;
    $("spel-plan").hidden = false;
    $("spel-feedback").hidden = true;
    $("spel-hint").hidden = false;
    $("spel-namnform").hidden = false;
    $("spel-skickat").hidden = true;
    $("spel-namnfel").hidden = true;
    const namn = (function () {
      try { return localStorage.getItem(SPEL_NAMN_KEY) || ""; } catch (e) { return ""; }
    })();
    $("spel-namn").value = rensaSmeknamn(namn);
    $("spel-plan").dataset.fas = "redo";
    uppdateraSpelHud();
    storlekSpelCanvas();
    centreraSpelPlan();
  }

  function uppdateraSpelHud() {
    $("spel-nr").textContent = String(Math.min(spel.skottNr, SPEL_SKOTT_MAX));
    $("spel-mal").textContent = String(spel.mal);
    $("spel-basta").textContent = String(spel.basta);
  }

  function storlekSpelCanvas() {
    const canvas = $("spel-canvas");
    const box = $("spel-plan");
    if (!canvas || !box || box.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(280, box.clientWidth || 362);
    const hud = $("spel-hud");
    const footer = document.querySelector(".wrap > footer");
    const topp = hud ? hud.getBoundingClientRect().bottom : 0;
    const botten = footer ? Math.min(window.innerHeight, footer.getBoundingClientRect().top) : window.innerHeight;
    const tillganglig = Math.max(300, Math.floor(botten - topp - 10));
    const h = Math.max(300, Math.min(tillganglig, Math.round(w * 1.08)));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    spel.w = w;
    spel.h = h;
    spel.ctx = ctx;
    spel.canvas = canvas;
  }

  function startaSpelVy() {
    spel.basta = lasSpelBasta();
    if (!spel.omgang) startaNyOmgang();
    else {
      $("spel-resultat").hidden = spel.fas !== "slut";
      $("spel-plan").hidden = spel.fas === "slut";
      uppdateraSpelHud();
      if (spel.fas === "slut") hamtaSpelTopplista($("spel-topp"));
    }
    storlekSpelCanvas();
    bindSpelInput();
    laddaOlearys();
    spel.aktiv = true;
    spel.forraTs = 0;
    if (!spel.raf) spel.raf = requestAnimationFrame(tickSpel);
    centreraSpelPlan();
  }

  function centreraSpelPlan() {
    const plan = $("spel-plan");
    if (!plan || plan.hidden || val.vy !== "spel") return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        plan.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    });
  }

  function pausaSpelVy() {
    spel.aktiv = false;
    if (spel.raf) {
      cancelAnimationFrame(spel.raf);
      spel.raf = 0;
    }
  }

  function spelPek(e) {
    const r = spel.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
  }

  function naraPuck(pt) {
    const px = spel.puck.x * spel.w;
    const py = spel.puck.y * spel.h;
    const dx = pt.x - px;
    const dy = pt.y - py;
    return (dx * dx + dy * dy) <= 90 * 90 || pt.y > spel.h * 0.72;
  }

  function bindSpelInput() {
    if (spel.bunden) return;
    spel.bunden = true;
    const c = $("spel-canvas");
    c.addEventListener("pointerdown", (e) => {
      if (spel.fas !== "redo") return;
      const pt = spelPek(e);
      if (!naraPuck(pt)) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      spel.swipe = { x0: pt.x, y0: pt.y, x: pt.x, y: pt.y, t0: pt.t, t: pt.t };
      $("spel-hint").hidden = true;
    }, { passive: false });
    c.addEventListener("pointermove", (e) => {
      if (!spel.swipe) return;
      const pt = spelPek(e);
      spel.swipe.x = pt.x;
      spel.swipe.y = pt.y;
      spel.swipe.t = pt.t;
    });
    const slut = (e) => {
      if (!spel.swipe) return;
      try { c.releasePointerCapture(e.pointerId); } catch (err) {}
      const sw = spel.swipe;
      spel.swipe = null;
      avfyraskott(sw);
    };
    c.addEventListener("pointerup", slut);
    c.addEventListener("pointercancel", () => { spel.swipe = null; });
    window.addEventListener("resize", () => {
      if (val.vy === "spel") storlekSpelCanvas();
    });
    $("spel-namnform").addEventListener("submit", (e) => {
      e.preventDefault();
      skickaSpelResultat();
    });
    $("spel-namn").addEventListener("input", () => {
      const el = $("spel-namn");
      const caret = el.selectionStart;
      const rent = rensaSmeknamn(el.value);
      if (el.value !== rent) {
        el.value = rent;
        try { el.setSelectionRange(Math.min(caret, rent.length), Math.min(caret, rent.length)); } catch (e) {}
      }
    });
  }

  function avfyraskott(sw) {
    const dx = sw.x - sw.x0;
    const dy = sw.y - sw.y0;
    const dt = Math.max(16, (sw.t || performance.now()) - sw.t0);
    if (dy > -28 || Math.hypot(dx, dy) < 36) {
      $("spel-hint").hidden = false;
      $("spel-hint").textContent = "Svep uppåt från pucken";
      return;
    }
    const fart = Math.min(1.6, Math.hypot(dx, dy) / (dt * 0.35));
    // Sidled från svepets riktning, med dubbel förstärkning och lätt progressiv kurva
    // så att ett måttligt snett svep når stolpen, medan mer vinkel går utanför.
    const xNorm = dx / Math.hypot(dx, dy);
    const abs = Math.abs(xNorm);
    const kurva = Math.pow(abs, 0.8);
    const malX = Math.max(0.10, Math.min(0.90, 0.5 + Math.sign(xNorm || 1) * kurva * 0.76));
    const malY = 0.205;
    const tid = Math.max(0.28, Math.min(0.72, 0.7 / (0.55 + fart)));
    spel.fas = "skott";
    $("spel-plan").dataset.fas = "skott";
    $("spel-plan").dataset.malx = String(malX);
    spel.skott = {
      x0: spel.puck.x,
      y0: spel.puck.y,
      x1: malX,
      y1: malY,
      t0: performance.now(),
      tid: tid * 1000,
      reagerat: false,
      malX,
    };
    spel.malvaktMal = spel.malvaktX;
  }

  function tickSpel(ts) {
    if (!spel.aktiv) { spel.raf = 0; return; }
    spel.raf = requestAnimationFrame(tickSpel);
    const dt = Math.min(0.04, (ts - (spel.forraTs || ts)) / 1000);
    spel.forraTs = ts;
    uppdateraSpel(ts, dt);
    ritaSpel();
  }

  function uppdateraSpel(ts, dt) {
    if (spel.fas === "redo" || spel.fas === "skott") {
      spel.malvaktTid += dt;
      if (spel.fas === "redo") {
        spel.malvaktX = 0.5 + Math.sin(spel.malvaktTid * 1.55) * 0.16;
        spel.malvaktMal = spel.malvaktX;
      } else if (spel.skott) {
        const s = spel.skott;
        const k = Math.min(1, (ts - s.t0) / s.tid);
        if (!s.reagerat && (ts - s.t0) >= 90) {
          s.reagerat = true;
          spel.malvaktMal = s.malX;
        }
        if (s.reagerat) {
          const maxv = 0.58;
          const d = spel.malvaktMal - spel.malvaktX;
          const steg = Math.max(-maxv * dt, Math.min(maxv * dt, d));
          spel.malvaktX += steg;
        }
        const lyft = 0.08 * Math.sin(k * Math.PI);
        spel.puck.x = s.x0 + (s.x1 - s.x0) * k;
        spel.puck.y = s.y0 + (s.y1 - s.y0) * k - lyft;
        if (k >= 1) avslutaSkott();
      }
    }
  }

  function avslutaSkott() {
    const s = spel.skott;
    spel.skott = null;
    const stolpeV = 0.255;
    const stolpeH = 0.745;
    const px = spel.puck.x;
    let utfall = "mal";
    if (px < stolpeV - 0.012 || px > stolpeH + 0.012) {
      utfall = "ute";
    } else {
      const tackning = 0.105;
      if (Math.abs(spel.malvaktX - px) <= tackning) utfall = "raddning";
    }
    if (utfall === "mal") {
      spel.mal += 1;
      visaSpelFeedback("MÅL!", "mal");
    } else if (utfall === "raddning") {
      visaSpelFeedback("RÄDDNING", "raddning");
    } else {
      visaSpelFeedback("UTANFÖR", "ute");
    }
    uppdateraSpelHud();
    spel.fas = "vantan";
    $("spel-plan").dataset.fas = "vantan";
    setTimeout(nastaSkott, 1150);
  }

  function visaSpelFeedback(text, typ) {
    const el = $("spel-feedback");
    el.textContent = text;
    el.className = "spel-feedback " + typ;
    el.hidden = false;
  }

  function nastaSkott() {
    if (val.vy !== "spel") return;
    $("spel-feedback").hidden = true;
    if (spel.skottNr >= SPEL_SKOTT_MAX) {
      avslutaOmgang();
      return;
    }
    spel.skottNr += 1;
    spel.puck = puckStart();
    spel.fas = "redo";
    $("spel-plan").dataset.fas = "redo";
    $("spel-hint").hidden = false;
    $("spel-hint").textContent = "Svep uppåt från pucken";
    uppdateraSpelHud();
  }

  function avslutaOmgang() {
    spel.fas = "slut";
    $("spel-plan").dataset.fas = "slut";
    if (spel.mal > spel.basta) {
      spel.basta = spel.mal;
      sparaSpelBasta(spel.basta);
    }
    $("spel-slutmal").textContent = String(spel.mal);
    $("spel-slutbasta").textContent = String(spel.basta);
    uppdateraSpelHud();
    $("spel-plan").hidden = true;
    $("spel-resultat").hidden = false;
    $("spel-namnform").hidden = false;
    $("spel-skickat").hidden = true;
    $("spel-namnfel").hidden = true;
    $("spel-skicka").disabled = false;
    hamtaSpelTopplista($("spel-topp"));
  }

  function ritaSpelTopp(lista, ol) {
    const topp = (lista && lista.topp) || [];
    if (!topp.length) {
      ol.innerHTML = "<li class='tom'>Inga resultat ännu</li>";
      return;
    }
    ol.innerHTML = topp.map((r) => {
      const jag = rensaSmeknamn($("spel-namn").value) && rensaSmeknamn($("spel-namn").value).toLowerCase() === String(r.namn || "").toLowerCase();
      return `<li class="${jag ? "jag" : ""}"><span class="namn">${S.esc(r.namn)}</span><span class="poang">${S.esc(r.mal)}/${S.esc(r.skott || SPEL_SKOTT_MAX)}</span></li>`;
    }).join("");
  }

  const SPEL_TOPP_KEY = "publikapp-demo-topplista";

  function lasDemoTopp() {
    try {
      const data = JSON.parse(localStorage.getItem(SPEL_TOPP_KEY) || '{"poster":[]}');
      if (!data || !Array.isArray(data.poster)) return { poster: [] };
      return data;
    } catch (e) {
      return { poster: [] };
    }
  }

  function sparaDemoTopp(data) {
    try { localStorage.setItem(SPEL_TOPP_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function demoToppTio(data) {
    const poster = ((data && data.poster) || []).filter((p) => p && p.namn);
    poster.sort((a, b) => (Number(b.mal) || 0) - (Number(a.mal) || 0) || String(a.tid || "").localeCompare(String(b.tid || "")));
    return poster.slice(0, 10).map((p) => ({
      namn: String(p.namn || "").slice(0, 16),
      mal: Number(p.mal) || 0,
      skott: Number(p.skott) || SPEL_SKOTT_MAX,
      tid: p.tid || "",
    }));
  }

  function lagTillDemoTopp(data, post) {
    const nyckel = post.namn.toLowerCase();
    const kvar = [];
    let basta = post;
    for (const p of (data.poster || [])) {
      if (!p || typeof p !== "object") continue;
      if (String(p.namn || "").toLowerCase() === nyckel) {
        const gammalt = Number(p.mal) || 0;
        if (gammalt > post.mal || (gammalt === post.mal && p.tid)) basta = p;
        continue;
      }
      kvar.push(p);
    }
    kvar.push(basta);
    kvar.sort((a, b) => (Number(b.mal) || 0) - (Number(a.mal) || 0) || String(a.tid || "").localeCompare(String(b.tid || "")));
    data.poster = kvar.slice(0, 200);
  }

  function hamtaSpelTopplista(ol) {
    if (!ol) return Promise.resolve();
    try {
      ritaSpelTopp({ topp: demoToppTio(lasDemoTopp()) }, ol);
    } catch (e) {
      ol.innerHTML = "<li class='tom'>Inga resultat ännu</li>";
    }
    return Promise.resolve();
  }

  function skickaSpelResultat() {
    if (spel.skickat || spel.fas !== "slut") return;
    const namn = rensaSmeknamn($("spel-namn").value);
    const fel = $("spel-namnfel");
    if (!namn) {
      fel.textContent = "Skriv ett smeknamn först";
      fel.hidden = false;
      $("spel-namn").focus();
      return;
    }
    fel.hidden = true;
    $("spel-skicka").disabled = true;
    try { localStorage.setItem(SPEL_NAMN_KEY, namn); } catch (e) {}
    const post = {
      namn,
      mal: spel.mal,
      skott: SPEL_SKOTT_MAX,
      tid: new Date().toISOString(),
    };
    const data = lasDemoTopp();
    lagTillDemoTopp(data, post);
    sparaDemoTopp(data);
    spel.skickat = true;
    $("spel-namnform").hidden = true;
    $("spel-skickat").hidden = false;
    $("spel-skicka").disabled = false;
    ritaSpelTopp({ topp: demoToppTio(data) }, $("spel-topp"));
  }

  function rundad(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function ritaMalvakt(ctx, x, y, s, lut) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lut);
    ctx.scale(s, s);
    // skugga
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.beginPath();
    ctx.ellipse(0, 8, 28, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // klubba
    ctx.strokeStyle = "#c4a574";
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-26, 6);
    ctx.lineTo(-8, -22);
    ctx.stroke();
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-30, 6);
    ctx.lineTo(-14, 8);
    ctx.stroke();
    // benskydd
    const pad = (px) => {
      ctx.fillStyle = "#f3f3f3";
      ctx.strokeStyle = "rgba(20,3,6,.35)";
      ctx.lineWidth = 1.2;
      rundad(ctx, px - 11, -22, 22, 34, 6);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#8b1c28";
      rundad(ctx, px - 8, -6, 16, 6, 2);
      ctx.fill();
    };
    pad(-13);
    pad(13);
    // byxa / torso
    ctx.fillStyle = "#1a0508";
    rundad(ctx, -16, -40, 32, 22, 6);
    ctx.fill();
    ctx.fillStyle = "#8b1c28";
    rundad(ctx, -15, -58, 30, 24, 7);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillRect(-15, -42, 30, 3);
    // blocker
    ctx.fillStyle = "#eee";
    rundad(ctx, 16, -50, 16, 20, 4);
    ctx.fill();
    // handske
    ctx.fillStyle = "#d8d8d8";
    ctx.beginPath();
    ctx.ellipse(-22, -44, 9, 8, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // hjälm
    ctx.fillStyle = "#f2f2f2";
    ctx.beginPath();
    ctx.ellipse(0, -68, 13, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8b1c28";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -66, 10, 9, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();
    ctx.strokeStyle = "rgba(20,3,6,.55)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-7, -66);
    ctx.lineTo(-7, -60);
    ctx.moveTo(0, -67);
    ctx.lineTo(0, -59);
    ctx.moveTo(7, -66);
    ctx.lineTo(7, -60);
    ctx.stroke();
    ctx.restore();
  }



  function laddaOlearys() {
    if (spel.olearys || spel.olearysLaddar) return;
    spel.olearysLaddar = true;
    const img = new Image();
    img.onload = () => { spel.olearys = img; };
    img.onerror = () => { spel.olearysLaddar = false; };
    img.src = "logos/sponsorer/olearys_gron.png";
  }

  function ritaOlearys(ctx, W, H, linjeY) {
    const y = linjeY + (0.9 * H - linjeY) * 0.42;
    const maxW = W * 0.56;
    const squash = 0.69;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.translate(W / 2, y);
    ctx.scale(1, squash);
    const img = spel.olearys;
    if (img && img.complete && img.naturalWidth) {
      const aspect = img.naturalWidth / img.naturalHeight;
      const dw = maxW;
      const dh = dw / aspect;
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.font = "800 40px system-ui,Arial,sans-serif";
      ctx.fillStyle = "rgba(45,155,135,0.95)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("O'LEARYS", 0, 0);
    }
    ctx.restore();
  }


  function ritaHockeymal(ctx, xL, xR, gy) {
    const bredd = xR - xL;
    const mx = (xL + xR) / 2;
    const hojd = Math.min(bredd * 0.22, gy - 40);
    const djup = Math.min(bredd * 0.20, gy - hojd - 12);
    const topp = gy - hojd;
    const bakBot = gy - djup;
    const bakTopp = bakBot - hojd * 0.78;
    const insk = bredd * 0.07;
    const bakL = xL + insk;
    const bakR = xR - insk;
    const bage = Math.max(10, djup * 0.62);
    const bakBageY = bakBot - bage;
    const bakToppBageY = bakTopp - bage * 0.55;
    const tjock = Math.max(7.5, bredd * 0.05);
    const rod = "#c31b2f";
    const rodMork = "#7a101c";
    const rodLjus = "#f06a76";

    function ror(x1, y1, x2, y2, w) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = rodMork;
      ctx.lineWidth = w + 1.8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.strokeStyle = rod;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = rodLjus;
      ctx.lineWidth = Math.max(1.3, w * 0.2);
      ctx.beginPath();
      ctx.moveTo(x1 - dy / L * w * 0.18, y1 + dx / L * w * 0.18);
      ctx.lineTo(x2 - dy / L * w * 0.18, y2 + dx / L * w * 0.18);
      ctx.stroke();
    }

    function rorKurva(x1, y1, cpx, cpy, x2, y2, w) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = rodMork;
      ctx.lineWidth = w + 1.8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cpx, cpy, x2, y2);
      ctx.stroke();
      ctx.strokeStyle = rod;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cpx, cpy, x2, y2);
      ctx.stroke();
      ctx.strokeStyle = rodLjus;
      ctx.lineWidth = Math.max(1.3, w * 0.2);
      ctx.beginPath();
      ctx.moveTo(x1, y1 - w * 0.16);
      ctx.quadraticCurveTo(cpx, cpy - w * 0.16, x2, y2 - w * 0.16);
      ctx.stroke();
    }

    // Nätets volym: öppning + djup bakåt med bukt
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(xL, gy);
    ctx.lineTo(xL, topp);
    ctx.lineTo(bakL, bakTopp);
    ctx.quadraticCurveTo(mx, bakToppBageY, bakR, bakTopp);
    ctx.lineTo(xR, topp);
    ctx.lineTo(xR, gy);
    ctx.lineTo(bakR, bakBot);
    ctx.quadraticCurveTo(mx, bakBageY, bakL, bakBot);
    ctx.closePath();
    ctx.fillStyle = "rgba(18, 4, 8, 0.42)";
    ctx.fill();
    ctx.save();
    ctx.clip();
    const meshL = xL - 8;
    const meshR = xR + 8;
    const meshT = bakToppBageY - 8;
    const meshB = gy + 2;
    ctx.strokeStyle = "rgba(255,255,255,0.62)";
    ctx.lineWidth = 0.7;
    const steg = 4;
    for (let x = meshL; x <= meshR; x += steg) {
      ctx.beginPath();
      ctx.moveTo(x, meshT);
      ctx.lineTo(x, meshB);
      ctx.stroke();
    }
    for (let y = meshT; y <= meshB; y += steg) {
      ctx.beginPath();
      ctx.moveTo(meshL, y);
      ctx.lineTo(meshR, y);
      ctx.stroke();
    }
    // lätt bukt bakåt: ett par svagare bågar i nätet
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 0.8;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const y = topp + (bakToppBageY - topp) * t;
      ctx.beginPath();
      ctx.moveTo(xL + (bakL - xL) * t, topp + (gy - topp) * 0);
      ctx.moveTo(xL + (bakL - xL) * (0.15 + t * 0.7), y + 6);
      ctx.quadraticCurveTo(mx, y - 4, xR - (xR - bakR) * (0.15 + t * 0.7), y + 6);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();

    // Skugga på isen under ramen
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = tjock * 0.7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(xL + 2, gy + 2);
    ctx.lineTo(bakL + 2, bakBot + 2);
    ctx.quadraticCurveTo(mx, bakBageY + 2, bakR + 2, bakBot + 2);
    ctx.lineTo(xR + 2, gy + 2);
    ctx.stroke();
    ctx.restore();

    // Bakre/undre ram: sidor + bågformad bakram på isen
    ror(xL, gy, bakL, bakBot, tjock * 0.82);
    ror(xR, gy, bakR, bakBot, tjock * 0.82);
    rorKurva(bakL, bakBot, mx, bakBageY, bakR, bakBot, tjock * 0.82);
    // övre sidor och bakre ribba
    ror(xL, topp, bakL, bakTopp, tjock * 0.78);
    ror(xR, topp, bakR, bakTopp, tjock * 0.78);
    rorKurva(bakL, bakTopp, mx, bakToppBageY, bakR, bakTopp, tjock * 0.78);
    // bakstolpar
    ror(bakL, bakBot, bakL, bakTopp, tjock * 0.78);
    ror(bakR, bakBot, bakR, bakTopp, tjock * 0.78);
    // främre stolpar och ribba (samma x som träffytan)
    ror(xL, gy, xL, topp, tjock);
    ror(xR, gy, xR, topp, tjock);
    ror(xL, topp, xR, topp, tjock);
  }

  function ritaTekningscirkel(ctx, cx, cy, r) {
    const rod = "rgba(180,30,40,.5)";
    ctx.save();
    ctx.strokeStyle = rod;
    ctx.fillStyle = rod;
    ctx.lineWidth = 1.7;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // tekningspunkt i mitten: liten ring + prick
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(5.2, r * 0.15), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2.4, r * 0.07), 0, Math.PI * 2);
    ctx.fill();
    // hash marks på vänster och höger sida, parallella med mållinjen
    const langs = Math.max(10, r * 0.32);
    const ut = Math.max(3, r * 0.06);
    const sprid = Math.max(7, r * 0.28);
    for (const side of [-1, 1]) {
      const x0 = cx + side * (r + ut);
      const x1 = cx + side * (r + ut + langs);
      for (const yOff of [-sprid, sprid]) {
        ctx.beginPath();
        ctx.moveTo(x0, cy + yOff);
        ctx.lineTo(x1, cy + yOff);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function ritaPuck(ctx, x, y, skala) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(skala, skala);
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.beginPath();
    ctx.ellipse(0, 5, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#141414";
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 6.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.ellipse(0, -2.2, 12, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.16)";
    ctx.beginPath();
    ctx.ellipse(-3, -3.2, 5, 1.6, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function ritaSpel() {
    const ctx = spel.ctx, W = spel.w, H = spel.h;
    if (!ctx || !W) return;
    ctx.clearRect(0, 0, W, H);
    rundad(ctx, 0, 0, W, H, 20);
    ctx.fillStyle = "#3a0c12";
    ctx.fill();
    const ix = 11, iy = 11, iw = W - 22, ih = H - 22;
    rundad(ctx, ix, iy, iw, ih, 16);
    const ice = ctx.createLinearGradient(0, iy, 0, iy + ih);
    ice.addColorStop(0, "#d4ebf5");
    ice.addColorStop(0.45, "#eef7fb");
    ice.addColorStop(1, "#c8deea");
    ctx.fillStyle = ice;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const mx = W / 2;
    const gy = H * 0.205;
    const gw = W * 0.49;
    const linjeY = H * 0.50;
    // Tekningscirklar: centrum utanför vänster/högerkant, bara en båge med hash marks syns.
    const tr = Math.min(W * 0.30, H * 0.28);
    const inskott = Math.max(40, tr * 0.38);
    const tcy = gy + Math.min(52, tr * 0.42);
    const cxV = ix - tr + inskott;
    const cxH = ix + iw + tr - inskott;
    ritaTekningscirkel(ctx, cxV, tcy, tr);
    ritaTekningscirkel(ctx, cxH, tcy, tr);
    // röda linjen
    ctx.strokeStyle = "rgba(180,30,40,.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ix + 16, linjeY);
    ctx.lineTo(ix + iw - 16, linjeY);
    ctx.stroke();
    // isreklam framför (närmare spelaren än) röda linjen, under puck och svep
    ritaOlearys(ctx, W, H, linjeY);
    // målområde
    ctx.strokeStyle = "rgba(180,30,40,.7)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(mx - gw / 2, gy);
    ctx.lineTo(mx + gw / 2, gy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, gy, W * 0.2, 0, Math.PI);
    ctx.strokeStyle = "rgba(40,90,140,.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(70,130,180,.08)";
    ctx.beginPath();
    ctx.arc(mx, gy, W * 0.2, 0, Math.PI);
    ctx.fill();
    // mål: samma stolp-x och mållinje (gy) som träffytan
    const stolpeV = W * 0.255;
    const stolpeH = W * 0.745;
    ritaHockeymal(ctx, stolpeV, stolpeH, gy);
    // målvakt (x i 0–1 mappas över målet)
    const mvx = W * spel.malvaktX;
    const mvy = gy + 6;
    const lut = (spel.fas === "skott")
      ? Math.max(-0.18, Math.min(0.18, (spel.malvaktMal - spel.malvaktX) * 1.2))
      : Math.sin(spel.malvaktTid * 1.55) * 0.05;
    ritaMalvakt(ctx, mvx, mvy + H * 0.02, Math.max(0.82, W / 390), lut);
    // riktlinje
    if (spel.swipe) {
      ctx.strokeStyle = "rgba(20,3,6,.4)";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 7]);
      ctx.beginPath();
      ctx.moveTo(spel.swipe.x0, spel.swipe.y0);
      ctx.lineTo(spel.swipe.x, spel.swipe.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // puck
    const pk = (spel.fas === "skott") ? 1.05 : 1;
    ritaPuck(ctx, spel.puck.x * W, spel.puck.y * H, pk);
    ctx.restore();
    // innerkant
    rundad(ctx, ix, iy, iw, ih, 16);
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }


  S.init().then(() => {
    return hamtaPortratt().then(() => {
      render();
      startVy();
      hamtaSponsorer();
      S.onChange(() => {
        render();
        kopplaSpotify();
        if ((val.vy === "rosta" || val.vy === "stangd") && location.hash.slice(1) === "rosta") oppnRosta();
      });
    });
  }).catch((err) => {
    console.error(err);
    $("hSub").textContent = "Kunde inte läsa matchdata";
  });
})();
