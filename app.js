// Terénní zápisník — soukromý zápis pozorování mimo ptáky.
// PRD: PersonalSkills/10-Projects/foto-ai-wf/outputs/2026-09-27-terenni-zapisnik-prd.md
//
// Zadávání jako v navigaci v autě: skupina → klávesnice, na které svítí jen
// písmena, jimiž může některý název pokračovat → když zbude ≤ 10 druhů, výběr.
// Hledá se česky, anglicky i latinsky, od začátku kteréhokoli slova; diakritika
// se nerozlišuje. Vše běží offline, zápisy leží v IndexedDB telefonu.
'use strict';

const VERZE = '0.3.0';
const LIMIT = 10;                // tolik druhů a méně → rovnou výběr
const CEKAT_NA_GPS_MS = 3000;    // uložení nečeká na polohu déle (PRD P0-2)
const NECINNOST_MS = 2 * 3600e3; // po dvou hodinách bez zápisu se zeptá na uzavření vycházky
// Rozložení klávesnice (nastavení). Řady se kreslí nad sebou jako na telefonu;
// QWERTY je výchozí (Zdeněk 28. 9.), QWERTZ odpovídá české klávesnici iPhonu.
const ROZLOZENI = {
  qwerty: {nazev: 'QWERTY', rady: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']},
  qwertz: {nazev: 'QWERTZ (česká)', rady: ['qwertzuiop', 'asdfghjkl', 'yxcvbnm']},
  abc: {nazev: 'abecedně', rady: ['abcdefg', 'hijklmn', 'opqrstu', 'vwxyz']},
};
let rozlozeni = 'qwerty';
const IKONY = {savec: '🦊', motyl: '🦋', vazka: '🪽', brouk: '🐞', hmyz: '🦗', pavouk: '🕷️',
  jesterka: '🦎', had: '🐍', zaba: '🐸', rostlina: '🌿', houba: '🍄', jine: '🐌'};

const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

// ── úložiště (IndexedDB bez knihovny — čtyři tabulky, víc netřeba) ───────
let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((ok, chyba) => {
    const r = indexedDB.open('zapisnik', 2);
    r.onupgradeneeded = e => {
      const d = r.result;
      if (e.oldVersion < 1) {
        d.createObjectStore('zapisy', {keyPath: 'id'}).createIndex('cas', 'cas');
        d.createObjectStore('seznamy', {keyPath: 'zeme'});
        d.createObjectStore('nastaveni', {keyPath: 'k'});
      }
      // 0.3.0: vycházka jako eBird checklist — zápisy pod ní (Zdeněk 28. 9.)
      if (e.oldVersion < 2) d.createObjectStore('vychazky', {keyPath: 'id'}).createIndex('zacatek', 'zacatek');
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

// ── vycházky ─────────────────────────────────────────────────────────────
// Vycházka = eBird checklist: začátek s časem a místem, zápisy pod ní, konec.
// Konec je čas POSLEDNÍHO zápisu, ne klepnutí na „ukončit“ — zapomenutý
// checklist by jinak „trval“ šest hodin. Každý zápis má dál svou polohu.
const ted = () => new Date().toISOString();
const hhmm = c => c ? c.slice(11, 16) : '';
const nazevVychazky = v => v.nazev || `vycházka ${hhmm(v.zacatek)}`;
async function aktualniVychazka() {
  const otevrene = (await vse('vychazky')).filter(v => !v.konec && !v.smazano);
  return otevrene.sort((a, b) => a.zacatek < b.zacatek ? 1 : -1)[0] || null;
}
async function zapisyVychazky(id) {
  return (await vse('zapisy')).filter(z => z.vychazka_id === id && !z.smazano)
    .sort((a, b) => a.cas < b.cas ? 1 : -1);
}
async function posledniCas(v) {
  const z = await zapisyVychazky(v.id);
  return z.length ? z[0].cas : v.zacatek;
}
async function ukonciVychazku(v) {
  await uloz('vychazky', {...v, konec: await posledniCas(v), upraveno: ted()});
}
async function novaVychazka(polohaSlib) {
  const stara = await aktualniVychazka();
  if (stara) await ukonciVychazku(stara);
  const v = {id: crypto.randomUUID(), nazev: '', zacatek: casTed(), konec: null, lat: null, lon: null,
    presnost_m: null, zeme: seznam?.zeme || null, poznamka: '', upraveno: ted(), smazano: null,
    exportovano: null, verze: VERZE};
  await uloz('vychazky', v);
  // Místo začátku se doplní, až ho GPS dá — založení na něj nečeká.
  (polohaSlib || zjistiPolohu()).then(async q => {
    if (!q) return;
    const x = await nacti('vychazky', v.id);
    if (x && x.lat == null) await uloz('vychazky', {...x, ...q, upraveno: ted()});
  });
  return v;
}
async function zkontrolujNecinnost() {
  const v = await aktualniVychazka();
  if (!v) return;
  const posl = await posledniCas(v);
  if (Date.now() - Date.parse(posl) < NECINNOST_MS) return;
  hlaska(`Uzavřít ${nazevVychazky(v)} (poslední zápis ${hhmm(posl)})?`, 'uzavřít',
    async () => { await ukonciVychazku(v); obrSkupiny(); }, 'pokračovat');
}

// ── obrazovky ────────────────────────────────────────────────────────────
function ukaz(id, titul, zpet) {
  for (const o of document.querySelectorAll('.obrazovka')) o.hidden = o.id !== id;
  $('#titul').textContent = titul;
  $('#zpet').hidden = !zpet;
  $('#zpet').onclick = zpet || null;
  window.scrollTo(0, 0);
}
function radekZapisu(z) {
  return `<li data-id="${z.id}"><span class="cas">${hhmm(z.cas)}</span>
    <span class="co"><b>${esc(z.jmeno)}</b><span>${esc(IKONY[z.skupina] || '')} ${esc(z.poznamka || '')}</span></span>
    <span class="zn">${z.pocet > 1 ? z.pocet + '× ' : ''}${z.mam_fotku ? '📷 ' : ''}${z.dodatecne ? '↩︎ ' : ''}${
      z.lat == null && !z.dodatecne ? '⌖?' : ''}</span></li>`;
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
  const v = await aktualniVychazka();
  if (v) {
    const z = await zapisyVychazky(v.id);
    $('#vychazkaPruh').innerHTML = `<div class="vychazka"><span class="co"><b>${esc(nazevVychazky(v))}</b>
      <span>od ${hhmm(v.zacatek)} · ${z.length} ${z.length === 1 ? 'zápis' : z.length < 5 && z.length ? 'zápisy' : 'zápisů'}${
        z.length ? ' · poslední ' + hhmm(z[0].cas) : ''}</span></span>
      <button id="ukoncit" class="vedlejsi">ukončit</button></div>`;
    $('#ukoncit').onclick = async () => {
      await ukonciVychazku(v);
      hlaska(`${nazevVychazky(v)} uzavřena`);
      obrSkupiny();
    };
    $('#vychazkaZapisy').innerHTML = z.slice(0, 8).map(radekZapisu).join('');
  } else {
    $('#vychazkaPruh').innerHTML = `<button id="novaVychazka" class="hlavni siroke">nová vycházka</button>
      <p class="tlum mala">nebo rovnou klepni na skupinu — vycházka se založí sama</p>`;
    $('#novaVychazka').onclick = async () => { await novaVychazka(); obrSkupiny(); };
    $('#vychazkaZapisy').innerHTML = '';
  }
}
$('#skupiny').onclick = e => {
  const b = e.target.closest('.skupina');
  if (b && !b.disabled) zacniPsat(b.dataset.s);
};
$('#vychazkaZapisy').onclick = e => { const li = e.target.closest('li[data-id]'); if (li) otevriList(li.dataset.id); };

// `doplnit` = uzavřená vycházka, do které se zápis dopisuje dodatečně: dostane
// čas jejího konce a žádnou polohu (teď už stojíš jinde).
function zacniPsat(sid, doplnit = null) {
  const skupina = seznam.skupiny.find(s => s.id === sid);
  indexy[sid] = indexy[sid] || postavIndex(skupina);
  // Poloha se začne zjišťovat hned: než druh najdeš, bývá hotová.
  psani = {skupina, klice: indexy[sid], pre: '', doplneno: '', historie: [], stisku: 0,
    t0: performance.now(), poloha: doplnit ? Promise.resolve(null) : zjistiPolohu(), vsechny: false, doplnit};
  ukaz('obrKlavesnice', (doplnit ? 'doplnit: ' : '') + skupina.nazev,
    doplnit ? () => obrVychazka(doplnit.id) : obrSkupiny);
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
  const {rady} = ROZLOZENI[rozlozeni] || ROZLOZENI.qwerty;
  const sloupcu = Math.max(...rady.map(r => r.length));
  $('#klavesnice').style.setProperty('--sloupcu', sloupcu);
  $('#klavesnice').innerHTML = rady.map(r => `<div class="rada">${[...r].map(z =>
    `<button class="klavesa" data-z="${z}"${znaky.has(z) ? '' : ' disabled'}>${z}</button>`).join('')}</div>`).join('');
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
  let v = p.doplnit;
  if (!v) v = (await aktualniVychazka()) || await novaVychazka(p.poloha);   // založí se sama
  const z = {id: crypto.randomUUID(), vychazka_id: v.id, typ,
    cas: p.doplnit ? (v.konec || v.zacatek) : casTed(), dodatecne: !!p.doplnit,
    lat: null, lon: null, presnost_m: null,
    zeme: seznam.zeme, skupina: p.skupina.id, taxon, jmeno: jm, pocet: 1, poznamka: '', mam_fotku: false,
    stisku: p.stisku, trvani_ms: Math.round(performance.now() - p.t0),
    upraveno: ted(), smazano: null, exportovano: null, verze: VERZE};
  const poloha = await Promise.race([p.poloha, pockej(CEKAT_NA_GPS_MS)]);
  if (poloha) Object.assign(z, poloha);
  await uloz('zapisy', z);
  if (!poloha && !p.doplnit) {
    // Poloha přišla pozdě: doplní se do už uloženého zápisu.
    p.poloha.then(async q => {
      if (!q) return;
      const x = await nacti('zapisy', z.id);
      if (x && x.lat == null) await uloz('zapisy', {...x, ...q, upraveno: ted()});
    });
  }
  if (taxon) casto[taxon] = (casto[taxon] || 0) + 1;
  return z;
}
async function poZapisu(z, poznamkaHned) {
  const doplnit = psani.doplnit;
  if (doplnit) await obrVychazka(doplnit.id); else await obrSkupiny();
  if (poznamkaHned) otevriList(z.id, true);
  else hlaska(`uloženo: ${z.jmeno}`, 'upravit', () => otevriList(z.id));
}
async function zapisDruh(i) {
  const d = psani.skupina.druhy[i];
  poZapisu(await novyZapis('druh', d[0], jmeno(d)));
}
async function zapisSkupinu() {
  const p = psani;
  poZapisu(await novyZapis('skupina', null, p.skupina.nazev + (p.pre ? ` (${p.pre}…)` : '')), true);
}

let _hlaskaCas;
// Druhá akce (`zrusit`) = otázka: hláška pak sama nezmizí, čeká na odpověď.
function hlaska(text, akce, fn, zrusit) {
  const h = $('#hlaska');
  h.innerHTML = `<span>${esc(text)}</span>${zrusit ? `<button class="druha">${esc(zrusit)}</button>` : ''}${
    akce ? `<button class="prvni">${esc(akce)}</button>` : ''}`;
  if (akce) h.querySelector('.prvni').onclick = () => { h.hidden = true; fn(); };
  if (zrusit) h.querySelector('.druha').onclick = () => { h.hidden = true; };
  h.hidden = false;
  clearTimeout(_hlaskaCas);
  if (!zrusit) _hlaskaCas = setTimeout(() => h.hidden = true, 5000);
}

// ── úprava zápisu (počet, poznámka, mám fotku, smazat) ───────────────────
let upravovany = null;
async function otevriList(id, poznamkaHned) {
  upravovany = await nacti('zapisy', id);
  const z = upravovany;
  $('#listTitul').textContent = z.jmeno;
  $('#listPodtitul').textContent = hhmm(z.cas) + (z.dodatecne ? ' · doplněno dodatečně'
    : z.lat != null ? ` · ±${z.presnost_m} m` : ' · bez polohy');
  $('#pocet').textContent = z.pocet;
  $('#mamFotku').checked = !!z.mam_fotku;
  $('#poznamka').value = z.poznamka || '';
  $('#list').hidden = false;
  if (poznamkaHned) $('#poznamka').focus();
}
$('#minus').onclick = () => { $('#pocet').textContent = Math.max(1, +$('#pocet').textContent - 1); };
$('#plus').onclick = () => { $('#pocet').textContent = +$('#pocet').textContent + 1; };
async function obnovAktualni() {
  if (!$('#obrVychazka').hidden) return obrVychazka(vychazkaOtevrena);
  if (!$('#obrVychazky').hidden) return obrVychazky();
  return obrSkupiny();
}
async function zavriList(smazat) {
  const z = upravovany;
  Object.assign(z, {pocet: +$('#pocet').textContent, mam_fotku: $('#mamFotku').checked,
    poznamka: $('#poznamka').value.trim(), upraveno: ted()});
  if (smazat) z.smazano = z.upraveno;      // měkké smazání: v datech zůstává
  await uloz('zapisy', z);
  $('#list').hidden = true;
  upravovany = null;
  obnovAktualni();
}
$('#listUlozit').onclick = () => zavriList(false);
$('#listSmazat').onclick = () => zavriList(true);
$('#list').onclick = e => { if (e.target.id === 'list') zavriList(false); };

// ── seznam vycházek po dnech ─────────────────────────────────────────────
async function obrVychazky() {
  ukaz('obrVychazky', 'Vycházky', obrSkupiny);
  const vychazky = (await vse('vychazky')).filter(v => !v.smazano).sort((a, b) => a.zacatek < b.zacatek ? 1 : -1);
  const zapisy = (await vse('zapisy')).filter(z => !z.smazano);
  const pocty = {};
  for (const z of zapisy) pocty[z.vychazka_id || ''] = (pocty[z.vychazka_id || ''] || 0) + 1;
  let den = null, html = '';
  for (const v of vychazky) {
    const d = v.zacatek.slice(0, 10);
    if (d !== den) { den = d; html += `<li class="den">${+d.slice(8)}. ${+d.slice(5, 7)}. ${d.slice(0, 4)}</li>`; }
    html += `<li data-v="${v.id}"><span class="cas">${hhmm(v.zacatek)}<br>${v.konec ? hhmm(v.konec) : '…'}</span>
      <span class="co"><b>${esc(nazevVychazky(v))}</b><span>${esc(v.poznamka || '')}</span></span>
      <span class="zn">${pocty[v.id] || 0} ${v.konec ? '' : '● běží'}</span></li>`;
  }
  if (pocty['']) html += `<li class="den">bez vycházky (zápisy z verze 0.2)</li><li data-v=""><span class="cas"></span>
    <span class="co"><b>${pocty['']} zápisů</b></span></li>`;
  $('#vychazkySeznam').innerHTML = html || '<li class="tlum">Zatím žádná vycházka.</li>';
  const vsechnyZ = await vse('zapisy'), vsechnyV = await vse('vychazky');
  const k = [...vsechnyZ, ...vsechnyV].filter(x => !x.exportovano || x.upraveno > x.exportovano).length;
  $('#exportInfo').textContent = k ? `k odeslání ${k}` : 'vše odesláno';
}
$('#vychazkyBtn').onclick = obrVychazky;
$('#vychazkySeznam').onclick = e => { const li = e.target.closest('li[data-v]'); if (li) obrVychazka(li.dataset.v); };

// ── detail vycházky ──────────────────────────────────────────────────────
let vychazkaOtevrena = null;
function zmenCas(iso, hm) {
  // Mění se jen hodina a minuta; datum a pásmo zůstávají z původního času.
  return iso.slice(0, 11) + hm + ':00' + iso.slice(19);
}
async function obrVychazka(id) {
  vychazkaOtevrena = id;
  if (!id) {           // starší zápisy bez vycházky: jen přehled
    ukaz('obrVychazka', 'Bez vycházky', obrVychazky);
    $('#vychazkaDetail').innerHTML = '';
    const z = (await vse('zapisy')).filter(x => !x.vychazka_id && !x.smazano).sort((a, b) => a.cas < b.cas ? 1 : -1);
    $('#vychazkaDetailZapisy').innerHTML = z.map(radekZapisu).join('');
    return;
  }
  const v = await nacti('vychazky', id);
  const z = await zapisyVychazky(id);
  ukaz('obrVychazka', nazevVychazky(v), obrVychazky);
  $('#vychazkaDetail').innerHTML = `
    <label class="pole">název <input id="vNazev" value="${esc(v.nazev)}" placeholder="${esc(nazevVychazky(v))}"></label>
    <div class="casy"><label class="pole">od <input type="time" id="vOd" value="${hhmm(v.zacatek)}"></label>
      <label class="pole">do <input type="time" id="vDo" value="${hhmm(v.konec)}"${v.konec ? '' : ' disabled'}></label></div>
    <p class="tlum mala">${v.zacatek.slice(8, 10)}. ${v.zacatek.slice(5, 7)}. · ${v.lat != null
      ? `${v.lat.toFixed(4)}, ${v.lon.toFixed(4)} ±${v.presnost_m} m` : 'místo začátku neznámé'}</p>
    <textarea id="vPoznamka" rows="2" placeholder="poznámka k vycházce">${esc(v.poznamka)}</textarea>
    <div class="radek-akci">${v.konec
      ? `<button id="vDoplnit" class="hlavni">doplnit zápis</button><button id="vPokracovat" class="vedlejsi">pokračovat ve vycházce</button>`
      : `<button id="vUkoncit" class="hlavni">ukončit</button>`}
      ${z.length ? '' : '<button id="vSmazat" class="vedlejsi nebezpecne">smazat</button>'}</div>
    <div id="vSkupiny" class="skupiny mala-skupiny" hidden></div>`;
  $('#vychazkaDetailZapisy').innerHTML = z.map(radekZapisu).join('') || '<li class="tlum">Bez zápisů.</li>';

  const ulozV = async zmena => {
    const x = await nacti('vychazky', id);
    await uloz('vychazky', {...x, ...zmena, upraveno: ted()});
  };
  $('#vNazev').onchange = async e => { await ulozV({nazev: e.target.value.trim()}); $('#titul').textContent = e.target.value.trim() || nazevVychazky(v); };
  $('#vPoznamka').onchange = e => ulozV({poznamka: e.target.value.trim()});
  $('#vOd').onchange = e => { if (e.target.value) ulozV({zacatek: zmenCas(v.zacatek, e.target.value)}); };
  $('#vDo').onchange = e => { if (e.target.value && v.konec) ulozV({konec: zmenCas(v.konec, e.target.value)}); };
  if ($('#vUkoncit')) $('#vUkoncit').onclick = async () => { await ukonciVychazku(await nacti('vychazky', id)); obrVychazka(id); };
  if ($('#vPokracovat')) $('#vPokracovat').onclick = async () => {
    // Znovu otevřít: zápisy odteď mají skutečný čas. Jiná běžící vycházka se uzavře.
    const jina = await aktualniVychazka();
    if (jina && jina.id !== id) await ukonciVychazku(jina);
    await ulozV({konec: null});
    obrSkupiny();
  };
  if ($('#vDoplnit')) $('#vDoplnit').onclick = () => {
    const sk = $('#vSkupiny');
    sk.innerHTML = seznam ? seznam.skupiny.map(s => `<button class="skupina" data-s="${s.id}"${s.druhy.length ? '' : ' disabled'}>
      <span class="ik">${IKONY[s.id] || '•'}</span><span class="jm">${esc(s.nazev)}</span></button>`).join('') : '';
    sk.hidden = !sk.hidden;
    sk.onclick = async e2 => {
      const b = e2.target.closest('.skupina');
      if (b && !b.disabled) zacniPsat(b.dataset.s, await nacti('vychazky', id));
    };
  };
  if ($('#vSmazat')) $('#vSmazat').onclick = async () => { await ulozV({smazano: ted()}); obrVychazky(); };
}
$('#vychazkaDetailZapisy').onclick = e => { const li = e.target.closest('li[data-id]'); if (li) otevriList(li.dataset.id); };

// ── export ───────────────────────────────────────────────────────────────
$('#exportBtn').onclick = async () => {
  // Posílá se, co je nové nebo změněné od posledního odeslání — i smazané,
  // ať se smazání promítne na Macu. Import je idempotentní (UUID).
  const nove = x => !x.exportovano || x.upraveno > x.exportovano;
  const vz = await vse('zapisy'), vv = await vse('vychazky');
  let zapisy = vz.filter(nove), vychazky = vv.filter(nove);
  if (!zapisy.length && !vychazky.length) { zapisy = vz; vychazky = vv; }   // nic nového → vše znovu
  if (!zapisy.length && !vychazky.length) return hlaska('zatím žádné zápisy');
  const t = ted();
  const jmenoSouboru = `zapisnik-${casTed().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  const bez = ({exportovano, ...x}) => x;
  const obsah = JSON.stringify({aplikace: 'terenni-zapisnik', verze: VERZE, exportovano: t,
    vychazky: vychazky.map(bez), zapisy: zapisy.map(bez)}, null, 1);
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
  for (const x of zapisy) await uloz('zapisy', {...x, exportovano: t});
  for (const x of vychazky) await uloz('vychazky', {...x, exportovano: t});
  hlaska(`odesláno: ${vychazky.length} vycházek, ${zapisy.length} zápisů`);
  obrVychazky();
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
  $('#rozlozeni').innerHTML = Object.entries(ROZLOZENI).map(([k, r]) =>
    `<button data-r="${k}" class="${k === rozlozeni ? 'akt' : ''}">${esc(r.nazev)}</button>`).join('');
  const trvale = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
  $('#oAplikaci').textContent = `verze ${VERZE} · zápisů ${(await vse('zapisy')).length} · úložiště ${
    trvale ? 'trvalé' : 'může ho iOS uvolnit — posílej zápisy na Mac'}`;
}
$('#nastaveniBtn').onclick = obrNastaveni;
$('#rozlozeni').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  rozlozeni = b.dataset.r;
  await nastav('rozlozeni', rozlozeni);
  obrNastaveni();
};
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
  rozlozeni = (await nastaveni('rozlozeni')) || 'qwerty';
  await nactiZemi(await nastaveni('zeme'));
  await spocitejCasto();
  if (seznam) obrSkupiny(); else obrNastaveni();
  zkontrolujNecinnost();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') zkontrolujNecinnost();
  });
})();
