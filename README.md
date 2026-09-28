# Terénní zápisník

Soukromý zápis pozorování mimo ptáky (ptáci jdou do eBirdu). Webová aplikace
na ploše iPhonu, funguje offline. Nic nesdílí: zápisy leží v telefonu a na Mac
se posílají souborem přes AirDrop.

**Zadávání jako v navigaci v autě:** skupina → klávesnice, na které jsou
aktivní jen písmena, jimiž může některý název pokračovat (jediné možné se
doplní samo) → když zbude 10 druhů a méně, výběr. Hledá se česky, anglicky
i latinsky od začátku kteréhokoli slova; diakritika se nerozlišuje.

**Vycházky** (od 0.3.0) jsou obdoba eBird checklistu: začátek s časem a GPS,
zápisy pod ní, konec = čas posledního zápisu. Založí se sama prvním zápisem,
po dvou hodinách bez zápisu se aplikace zeptá na uzavření. Do uzavřené
vycházky jde zápis doplnit (dostane čas jejího konce, bez polohy) nebo ji
znovu otevřít.

**Klávesnice:** QWERTY (výchozí), QWERTZ nebo abecední — v nastavení.

**Co aplikace z telefonu čte:** hodiny, GPS (jednorázově při zápisu, s dotazem
na povolení) a vlastní úložiště. Nic nikam neposílá; ven jde jen soubor, který
sám odešleš.

## Instalace

1. V Safari otevřít stránku aplikace → Sdílet → Přidat na plochu.
2. ⚙︎ → stáhnout seznam země (na Wi-Fi, před cestou).

## Data

`data/<země>.json` — seznamy druhů z iNaturalist (druhy s ověřitelným
pozorováním v zemi), česky, anglicky, latinsky. Generuje je
`zapisnik.py seznam <země>` v projektu fotoarchivu; tam se také zápisy
importují (`zapisnik.py import <soubor>`).

Při změně aplikace zvýšit `VERZE` v `sw.js` (a `app.js`), jinak telefon drží
starou verzi z mezipaměti.

## Soubory

| soubor | co |
|---|---|
| `index.html`, `styly.css` | obrazovky: skupiny, klávesnice, vycházky, detail vycházky, nastavení |
| `app.js` | logika: IndexedDB (`zapisy`, `vychazky`, `seznamy`, `nastaveni`), hledání (seřazené klíče + binární hledání předpony), vycházky, export |
| `sw.js` | offline mezipaměť aplikace (ne seznamů) |
| `data/` | seznamy druhů zemí + `zeme.json` |

PRD: `PersonalSkills/10-Projects/foto-ai-wf/outputs/2026-09-27-terenni-zapisnik-prd.md`.
