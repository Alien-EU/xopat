# 0004. Jeden `mcp-plugin` budovaný postupne, bez samostatnej light verzie

- **Stav:** Prijaté
- **Dátum:** 2026-11-24
- **Rozhodli:** Marek
- **Prepis diskusie:** `diskusie/2026-11-24-struktura-mcp-plugin.md`, časti 1 a 3

## Kontext

Marek písal vlastný učebný plugin `mcp-light` (kostra s `Tool`, `registerTool`, `handleMessage`), zatiaľ čo plná verzia
mala byť `mcp-plugin`. Popri tom existovali dva staršie prototypy od Claude: Playwright stdio server (PR #1) a chat
s agent loop (PR #2).

## Zvažované možnosti

### A. Dva pluginy: `mcp-light` na učenie a `mcp-plugin` ako plná verzia

- **+** učebný kód sa nemieša s finálnym
- **−** dve kódové základne, prenášanie zmien, nejasné, ktorý je „ten pravý“

### B. Jeden plugin `mcp-plugin`, ktorý rastie postupne (vybrané)

- **+** každý krok učenia je zároveň krok k finálnej implementácii
- **+** meno od začiatku sedí s dokumentáciou
- **−** prvé verzie kódu budú v histórii finálneho pluginu

### C. Pokračovať na staršom prototype

- **−** prototypy mali inú architektúru (Playwright) alebo ich písal Claude, Marek chce kód písať sám

## Rozhodnutie

**B.** `plugins/mcp-light` premenovaný na `plugins/mcp-plugin` (id, súbor `mcpPlugin.js`, výnimka v `.gitignore`).
Staré prototypy sa nemažú: PR #1 a #2 sú zatvorené a vetvy zálohované ako `archive/mcp-prototype` (na experimenty,
pozri [0001](0001-nastroje-v-prehliadaci-server-ako-relay.md)) a `archive/chat-mcp` (agent loop na inšpiráciu).

## Dôsledky

- Commit kostry: `mcp-plugin: init plugin skeleton`.
- Poradie práce: register nástrojov → `run_script`/`get_scripting_api` a prvé pevné nástroje → vstavaný chat ako klient
  → `mcp-bridge` → serverové nástroje → experimenty.

## Otvorené otázky

Žiadne.

## Súvisiace

- [0005](0005-rozdelenie-tried-mcp-plugin.md)
