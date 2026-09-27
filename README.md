# Terénní zápisník

Soukromý zápis pozorování mimo ptáky (ptáci jdou do eBirdu). Webová aplikace
na ploše iPhonu, funguje offline. Nic nesdílí: zápisy leží v telefonu a na Mac
se posílají souborem přes AirDrop.

**Zadávání jako v navigaci v autě:** skupina → klávesnice, na které jsou
aktivní jen písmena, jimiž může některý název pokračovat (jediné možné se
doplní samo) → když zbude 10 druhů a méně, výběr. Hledá se česky, anglicky
i latinsky od začátku kteréhokoli slova; diakritika se nerozlišuje.

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
