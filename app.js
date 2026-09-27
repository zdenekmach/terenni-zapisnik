// Terénní zápisník — soukromý zápis pozorování mimo ptáky.
// PRD: PersonalSkills/10-Projects/foto-ai-wf/outputs/2026-09-27-terenni-zapisnik-prd.md
//
// Zadávání jako v navigaci v autě: skupina → klávesnice, na které svítí jen
// písmena, jimiž může některý název pokračovat → když zbude ≤ 10 druhů, výběr.
// Hledá se česky, anglicky i latinsky, od začátku kteréhokoli slova; diakritika
// se nerozlišuje. Vše běží offline, zápisy leží v IndexedDB telefonu.
'use strict';

const VERZE = '0.1.0';
const LIMIT = 10;                // tolik druhů a méně → rovnou výběr
const CEKAT_NA_GPS_MS = 3000;    // uložení nečeká na polohu déle (PRD P0-2)
const ABECEDA = 'abcdefghijklmnopqrstuvwxyz'.split('');
const IKONY = {savec: '🦊', motyl: '🦋', vazka: '🪽', brouk: '🐞', hmyz: '🦗', pavouk: '🕷️',
  jesterka: '🦎', had: '🐍', zaba: '🐸', rostlina: '🌿', houba: '🍄', jine: '🐌'};

const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

// ── úložiště (IndexedDB bez knihovny — tři tabulky, víc netřeba) ─────────
let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((ok, chyba) => {
    const r = indexedDB.open('zapisnik', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('zapisy', {keyPath: 'id'}).createIndex('cas', 'cas');
      d.createObjectStore('seznamy', {keyPath: 'zeme'});
      d.createObjectStore('nastaveni', {keyPath: 'k'});
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => chyba(r.error);
  });
  return _db;
}
async function tx(tab, rezim, fn) {
  const d = await db();
  return new Promise((ok, chyba) => {
    const t = d.transaction(tab, rezim);
    const vysledek = fn(t.objectStore(tab));
    t.oncomplete = () => ok(vysledek && 'result' in vysledek ? vysledek.result : vysledek);
    t.onerror = () => chyba(t.error);
  });
}
const uloz = (tab, x) => tx(tab, 'readwrite', s => s.put(x));
const nacti = (tab, k) => tx(tab, 'readonly', s => s.get(k));
const vse = tab => tx(tab, 'readonly', s => s.getAll());
const nastav = (k, v) => uloz('nastaveni', {k, v});
const nastaveni = async k => (await nacti('nastaveni', k))?.v;

// ── čas a poloha ─────────────────────────────────────────────────────────
function casTed() {
  // Místní čas s pásmem: deník počítá dny v místním čase, pásmo pro jistotu.
  const d = new Date(), o = -d.getTimezoneOffset(), p = n => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:` +
    `${p(d.getSeconds())}${o >= 0 ? '+' : '-'}${p(o / 60)}:${p(o % 60)}`;
}
function zjistiPolohu() {
  return new Promise(ok => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(
      p => ok({lat: p.coords.latitude, lon: p.coords.longitude, presnost_m: Math.round(p.coords.accuracy)}),
      () => ok(null), {enableHighAccuracy: true, timeout: 15000, maximumAge: 60000});
  });
}
const pockej = ms => new Promise(ok => setTimeout(() => ok(null), ms));

// ── hledání: seřazené klíče a binární hledání rozsahu předpony ───────────
function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, ' ').trim();
}
function postavIndex(skupina) {
  // Klíč = název od každého slova (ve třech jazycích). `cely` = od začátku
  // celého názvu — takové shody jdou ve výběru první.
  const klice = [];
  skupina.druhy.forEach(([lat, cz, en], i) => {
    const videno = new Set();
    for (const jm of [cz, en, lat]) {
      const w = norm(jm).split(' ').filter(Boolean);
      for (let j = 0; j < w.length; j++) {
        const k = w.slice(j).join(' ');
        if (!videno.has(k)) { videno.add(k); klice.push({k, i, cely: j === 0}); }
      }
    }
  });
  klice.sort((a, b) => a.k < b.k ? -1 : a.k > b.k ? 1 : 0);
  return klice;
}
function dolniMez(klice, p) {
  let lo = 0, hi = klice.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (klice[m].k < p) lo = m + 1; else hi = m; }
  return lo;
}
function rozsah(klice, p) {
  const lo = dolniMez(klice, p);
  let hi = lo;
  while (hi < klice.length && klice[hi].k.startsWith(p)) hi++;
  return [lo, hi];
}
function kandidati(klice, p) {
  const [lo, hi] = rozsah(klice, p), s = new Set();
  for (let j = lo; j < hi; j++) s.add(klice[j].i);
  return s;
}
function dalsiZnaky(klice, p) {
  const [lo, hi] = rozsah(klice, p), s = new Set();
  let konec = false;
  for (let j = lo; j < hi; j++) {
    const k = klice[j].k;
    if (k.length === p.length) konec = true; else s.add(k[p.length]);
  }
  return {znaky: s, konec};
}

// ── stav ─────────────────────────────────────────────────────────────────
let seznam = null;          // data země
const indexy = {};          // skupina → seřazené klíče (staví se při prvním použití)
let casto = {};             // taxon → kolikrát zapsáno za posledních 30 dní
let psani = null;           // rozepsaný zápis

async function nactiZemi(zeme) {
  seznam = zeme ? await nacti('seznamy', zeme) : null;
  for (const k in indexy) delete indexy[k];
  $('#zemeNazev').textContent = seznam ? (seznam.nazev || seznam.zeme) : 'vyber zemi';
  // Indexy se staví na pozadí po jedné skupině: rostliny Ekvádoru (12 tisíc
  // druhů) trvají na Macu 190 ms, na telefonu víc — první klepnutí nemá čekat.
  const fronta = seznam ? [...seznam.skupiny] : [];
  const dalsi = () => {
    const s = fronta.shift(); if (!s) return;
    indexy[s.id] = indexy[s.id] || postavIndex(s);
    setTimeout(dalsi, 30);
  };
  setTimeout(dalsi, 300);
}
async function spocitejCasto() {
  const od = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  casto = {};
  for (const z of await vse('zapisy'))
    if (!z.smazano && z.taxon && z.cas >= od) casto[z.taxon] = (casto[z.taxon] || 0) + 1;
}

// ── obrazovky ────────────────────────────────────────────────────────────
function ukaz(id, titul, zpet) {
  for (const o of document.querySelectorAll('.obrazovka')) o.hidden = o.id !== id;
  $('#titul').textContent = titul;
  $('#zpet').hidden = !zpet;
  $('#zpet').onclick = zpet || null;
  window.scrollTo(0, 0);
}

async function obrSkupiny() {
  psani = null;
  ukaz('obrSkupiny', 'Zápisník');
  const el = $('#skupiny');
  if (!seznam) {
    el.innerHTML = '<p class="tlum" style="grid-column:1/-1">Nejdřív stáhni seznam druhů země (⚙︎).</p>';
  } else {
    el.innerHTML = seznam.skupiny.map(s => `<button class="skupina" data-s="${s.id}"${s.druhy.length ? '' : ' disabled'}>
      <span class="ik">${IKONY[s.id] || '•'}</span><span class="jm">${esc(s.nazev)}</span></button>`).join('');
  }
  const dnes = casTed().slice(0, 10);
  $('#dnesPocet').textContent = (await vse('zapisy')).filter(z => !z.smazano && z.cas.startsWith(dnes)).length;
}
$('#skupiny').onclick = e => {
  const b = e.target.closest('.skupina');
  if (b && !b.disabled) zacniPsat(b.dataset.s);
};

function zacniPsat(sid) {
  const skupina = seznam.skupiny.find(s => s.id === sid);
  indexy[sid] = indexy[sid] || postavIndex(skupina);
  // Poloha se začne zjišťovat hned: než druh najdeš, bývá hotová.
  psani = {skupina, klice: indexy[sid], pre: '', doplneno: '', historie: [], stisku: 0,
    t0: performance.now(), poloha: zjistiPolohu(), vsechny: false};
  ukaz('obrKlavesnice', skupina.nazev, obrSkupiny);
  vykresliPsani();
}

function stiskni(znak) {
  const p = psani;
  p.historie.push(p.pre);
  p.stisku++;
  p.vsechny = false;
  p.pre += znak;
  // Doplň, dokud může následovat jen jeden znak a druhů je pořád moc.
  let doplnek = '';
  while (kandidati(p.klice, p.pre).size > LIMIT) {
    const {znaky, konec} = dalsiZnaky(p.klice, p.pre);
    if (znaky.size !== 1 || konec) break;
    const z = [...znaky][0];
    p.pre += z; doplnek += z;
  }
  p.doplneno = doplnek;
  vykresliPsani();
}
function smaz() {
  const p = psani;
  if (!p.historie.length) return obrSkupiny();
  p.stisku++;
  p.pre = p.historie.pop();     // i s tím, co se doplnilo samo
  p.doplneno = '';
  p.vsechny = false;
  vykresliPsani();
}

function jmeno(d) { return d[1] || d[2] || d[0]; }
function podnazev(d) {
  return [d[1] && d[2], d[0]].filter(Boolean).filter(x => x !== jmeno(d)).join(' · ');
}
function serazene(p, mnozina) {
  // Shoda od začátku celého názvu první, pak moje časté, pak počet pozorování v zemi.
  const cely = new Set();
  if (p.pre) {
    const [lo, hi] = rozsah(p.klice, p.pre);
    for (let j = lo; j < hi; j++) if (p.klice[j].cely) cely.add(p.klice[j].i);
  }
  const dr = p.skupina.druhy;
  return [...mnozina].sort((a, b) =>
    (cely.has(b) - cely.has(a)) || ((casto[dr[b][0]] || 0) - (casto[dr[a][0]] || 0)) || (dr[b][3] - dr[a][3]));
}

function vykresliPsani() {
  const p = psani, dr = p.skupina.druhy;
  const k = p.pre ? kandidati(p.klice, p.pre) : new Set(dr.keys());
  const napsano = p.pre.slice(0, p.pre.length - p.doplneno.length);
  $('#napsano').textContent = napsano.toUpperCase();
  $('#doplneno').textContent = p.doplneno.toUpperCase();
  $('#zbyva').textContent = k.size > LIMIT
    ? `${k.size.toLocaleString('cs')} druhů${k.size <= 300 ? ' — ukázat' : ''}` : `${k.size} ${k.size === 1 ? 'druh' : 'druhy'}`;

  const vyber = k.size <= LIMIT || p.vsechny;
  $('#vyber').hidden = !vyber;
  $('#caste').hidden = vyber;
  if (vyber) {
    $('#vyber').innerHTML = serazene(p, k).slice(0, 300).map(i => `<button class="volba" data-i="${i}">
      <b>${esc(jmeno(dr[i]))}</b><span>${esc(podnazev(dr[i]))}</span></button>`).join('')
      || '<p class="tlum">Nic — smaž písmeno, nebo zapiš jen skupinu.</p>';
  } else {
    // Nejčastější nad klávesnicí: první dvě písmena se píšou skoro na plné
    // klávesnici (simulace 27. 9.), tohle je zkratka pro běžné druhy.
    $('#caste').innerHTML = serazene(p, k).slice(0, 5).map(i =>
      `<button data-i="${i}">${esc(jmeno(dr[i]))}</button>`).join('');
  }
  const {znaky} = p.pre ? dalsiZnaky(p.klice, p.pre)
    : {znaky: new Set(p.klice.map(x => x.k[0]))};
  $('#klavesnice').innerHTML = ABECEDA.map(z =>
    `<button class="klavesa" data-z="${z}"${znaky.has(z) ? '' : ' disabled'}>${z}</button>`).join('');
  $('#mezera').disabled = !znaky.has(' ');
}
$('#klavesnice').onclick = e => { const b = e.target.closest('.klavesa'); if (b && !b.disabled) stiskni(b.dataset.z); };
$('#mezera').onclick = () => stiskni(' ');
$('#smaz').onclick = smaz;
$('#zbyva').onclick = () => { psani.vsechny = true; vykresliPsani(); };
$('#vyber').onclick = e => { const b = e.target.closest('.volba'); if (b) zapisDruh(+b.dataset.i); };
$('#caste').onclick = e => { const b = e.target.closest('button'); if (b) zapisDruh(+b.dataset.i); };
$('#jenSkupina').onclick = () => zapisSkupinu();

// ── zápis ────────────────────────────────────────────────────────────────
async function novyZapis(typ, taxon, jm) {
  const p = psani;
  const z = {id: crypto.randomUUID(), typ, cas: casTed(), lat: null, lon: null, presnost_m: null,
    zeme: seznam.zeme, skupina: p.skupina.id, taxon, jmeno: jm, pocet: 1, poznamka: '', mam_fotku: false,
    stisku: p.stisku, trvani_ms: Math.round(performance.now() - p.t0),
    upraveno: new Date().toISOString(), smazano: null, exportovano: null, verze: VERZE};
  const poloha = await Promise.race([p.poloha, pockej(CEKAT_NA_GPS_MS)]);
  if (poloha) Object.assign(z, poloha);
  await uloz('zapisy', z);
  if (!poloha) {
    // Poloha přišla pozdě: doplní se do už uloženého zápisu.
    p.poloha.then(async q => {
      if (!q) return;
      const x = await nacti('zapisy', z.id);
      if (x && x.lat == null) await uloz('zapisy', {...x, ...q, upraveno: new Date().toISOString()});
    });
  }
  if (taxon) casto[taxon] = (casto[taxon] || 0) + 1;
  return z;
}
async function zapisDruh(i) {
  const d = psani.skupina.druhy[i];
  const z = await novyZapis('druh', d[0], jmeno(d));
  await obrSkupiny();
  hlaska(`uloženo: ${z.jmeno}`, 'upravit', () => otevriList(z.id));
}
async function zapisSkupinu() {
  const p = psani;
  const z = await novyZapis('skupina', null, p.skupina.nazev + (p.pre ? ` (${p.pre}…)` : ''));
  await obrSkupiny();
  otevriList(z.id, true);
}

let _hlaskaCas;
function hlaska(text, akce, fn) {
  const h = $('#hlaska');
  h.innerHTML = `<span>${esc(text)}</span>${akce ? `<button>${esc(akce)}</button>` : ''}`;
  if (akce) h.querySelector('button').onclick = () => { h.hidden = true; fn(); };
  h.hidden = false;
  clearTimeout(_hlaskaCas);
  _hlaskaCas = setTimeout(() => h.hidden = true, 5000);
}

// ── úprava zápisu (počet, poznámka, mám fotku, smazat) ───────────────────
let upravovany = null;
async function otevriList(id, poznamkaHned) {
  upravovany = await nacti('zapisy', id);
  const z = upravovany;
  $('#listTitul').textContent = z.jmeno;
  $('#listPodtitul').textContent = z.cas.slice(11, 16) + (z.lat != null ? ` · ±${z.presnost_m} m` : ' · bez polohy');
  $('#pocet').textContent = z.pocet;
  $('#mamFotku').checked = !!z.mam_fotku;
  $('#poznamka').value = z.poznamka || '';
  $('#list').hidden = false;
  if (poznamkaHned) $('#poznamka').focus();
}
$('#minus').onclick = () => { $('#pocet').textContent = Math.max(1, +$('#pocet').textContent - 1); };
$('#plus').onclick = () => { $('#pocet').textContent = +$('#pocet').textContent + 1; };
async function zavriList(smazat) {
  const z = upravovany;
  Object.assign(z, {pocet: +$('#pocet').textContent, mam_fotku: $('#mamFotku').checked,
    poznamka: $('#poznamka').value.trim(), upraveno: new Date().toISOString()});
  if (smazat) z.smazano = z.upraveno;      // měkké smazání: v datech zůstává
  await uloz('zapisy', z);
  $('#list').hidden = true;
  upravovany = null;
  if (!$('#obrDnes').hidden) obrDnes(); else obrSkupiny();
}
$('#listUlozit').onclick = () => zavriList(false);
$('#listSmazat').onclick = () => zavriList(true);
$('#list').onclick = e => { if (e.target.id === 'list') zavriList(false); };

// ── dnes a export ────────────────────────────────────────────────────────
let denVybrany = null;
async function obrDnes() {
  ukaz('obrDnes', 'Zápisy', obrSkupiny);
  const zapisy = (await vse('zapisy')).filter(z => !z.smazano).sort((a, b) => a.cas < b.cas ? 1 : -1);
  const dny = [...new Set(zapisy.map(z => z.cas.slice(0, 10)))];
  denVybrany = dny.includes(denVybrany) ? denVybrany : (dny[0] || casTed().slice(0, 10));
  $('#denVyber').innerHTML = dny.map(d => `<button data-d="${d}" class="${d === denVybrany ? 'akt' : ''}">${
    +d.slice(8)}. ${+d.slice(5, 7)}.</button>`).join('');
  const den = zapisy.filter(z => z.cas.startsWith(denVybrany));
  $('#dnesSeznam').innerHTML = den.map(z => `<li data-id="${z.id}"><span class="cas">${z.cas.slice(11, 16)}</span>
    <span class="co"><b>${esc(z.jmeno)}</b><span>${esc(IKONY[z.skupina] || '')} ${esc(z.poznamka || '')}</span></span>
    <span class="zn">${z.pocet > 1 ? z.pocet + '× ' : ''}${z.mam_fotku ? '📷 ' : ''}${z.lat == null ? '⌖?' : ''}</span></li>`).join('')
    || '<li class="tlum">Ten den nic.</li>';
  const k = zapisy.filter(z => !z.exportovano || z.upraveno > z.exportovano).length
    + (await vse('zapisy')).filter(z => z.smazano && (!z.exportovano || z.upraveno > z.exportovano)).length;
  $('#exportInfo').textContent = k ? `k odeslání ${k}` : 'vše odesláno';
}
$('#dnesBtn').onclick = obrDnes;
$('#denVyber').onclick = e => { const b = e.target.closest('button'); if (b) { denVybrany = b.dataset.d; obrDnes(); } };
$('#dnesSeznam').onclick = e => { const li = e.target.closest('li[data-id]'); if (li) otevriList(li.dataset.id); };

$('#exportBtn').onclick = async () => {
  // Posílá se, co je nové nebo změněné od posledního odeslání — i smazané,
  // ať se smazání promítne na Macu. Import je idempotentní (UUID).
  const vsechny = await vse('zapisy');
  let davka = vsechny.filter(z => !z.exportovano || z.upraveno > z.exportovano);
  if (!davka.length) davka = vsechny;          // nic nového → pošli vše znovu
  if (!davka.length) return hlaska('zatím žádné zápisy');
  const ted = new Date().toISOString();
  const jmenoSouboru = `zapisnik-${casTed().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  const obsah = JSON.stringify({aplikace: 'terenni-zapisnik', verze: VERZE, exportovano: ted,
    zapisy: davka.map(({exportovano, ...z}) => z)}, null, 1);
  const soubor = new File([obsah], jmenoSouboru, {type: 'application/json'});
  try {
    if (navigator.canShare && navigator.canShare({files: [soubor]})) {
      await navigator.share({files: [soubor], title: jmenoSouboru});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(soubor); a.download = jmenoSouboru; a.click();
    }
  } catch (e) {
    if (e.name === 'AbortError') return;      // zrušené sdílení: nic se neoznačí
    return hlaska('nešlo odeslat: ' + e.message);
  }
  for (const z of davka) await uloz('zapisy', {...z, exportovano: ted});
  hlaska(`odesláno ${davka.length} zápisů`);
  obrDnes();
};

// ── nastavení: země ──────────────────────────────────────────────────────
async function obrNastaveni() {
  ukaz('obrNastaveni', 'Nastavení', obrSkupiny);
  const aktivni = await nastaveni('zeme');
  const stazene = new Map((await vse('seznamy')).map(s => [s.zeme, s]));
  let nabidka = [];
  try { nabidka = await (await fetch('data/zeme.json', {cache: 'no-store'})).json(); }
  catch (e) { /* offline: jen stažené */ }
  const zeme = new Map(nabidka.map(z => [z.zeme, z]));
  for (const [k, s] of stazene) if (!zeme.has(k)) zeme.set(k, {zeme: k, nazev: s.nazev || k});
  $('#zemeSeznam').innerHTML = [...zeme.values()].map(z => {
    const s = stazene.get(z.zeme);
    return `<li class="zeme" data-z="${z.zeme}"><span class="co"><b>${esc(z.nazev)}${z.zeme === aktivni ? ' ✓' : ''}</b>
      <span>${s ? `staženo ${esc(s.vytvoreno)} · ${s.skupiny.reduce((a, x) => a + x.druhy.length, 0).toLocaleString('cs')} druhů`
        : (z.kb ? `${z.kb} kB` : '')}</span></span>
      <button class="vedlejsi" data-akce="${s ? 'pouzit' : 'stahnout'}">${s ? (z.zeme === aktivni ? 'aktualizovat' : 'použít') : 'stáhnout'}</button></li>`;
  }).join('') || '<li class="tlum">Bez připojení a bez stažené země.</li>';
  const trvale = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
  $('#oAplikaci').textContent = `verze ${VERZE} · zápisů ${(await vse('zapisy')).length} · úložiště ${
    trvale ? 'trvalé' : 'může ho iOS uvolnit — posílej zápisy na Mac'}`;
}
$('#nastaveniBtn').onclick = obrNastaveni;
$('#zemeSeznam').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  const z = b.closest('li').dataset.z;
  if (b.dataset.akce === 'stahnout' || b.textContent === 'aktualizovat') {
    b.textContent = 'stahuji…'; b.disabled = true;
    try {
      const d = await (await fetch(`data/${z}.json`, {cache: 'no-store'})).json();
      const nazev = (await (await fetch('data/zeme.json')).json()).find(x => x.zeme === z)?.nazev;
      await uloz('seznamy', {...d, nazev: nazev || z});
    } catch (err) { hlaska('stažení se nepovedlo — je připojení?'); return obrNastaveni(); }
  }
  await nastav('zeme', z);
  await nactiZemi(z);
  hlaska('země: ' + (seznam.nazev || z));
  obrSkupiny();
};

// ── start ────────────────────────────────────────────────────────────────
(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await nactiZemi(await nastaveni('zeme'));
  await spocitejCasto();
  if (seznam) obrSkupiny(); else obrNastaveni();
})();
