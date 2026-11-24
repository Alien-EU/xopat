# 0009. Súbežnosť: všetko v hlavnom vlákne cez event loop, správy cez callbacky

- **Stav:** Prijaté. Zámok a timeout sú odložené na neskôr.
- **Dátum:** 2026-11-24
- **Rozhodli:** Marek s Claude
- **Prepis diskusie:** `diskusie/2026-11-24-struktura-mcp-plugin.md` časť 11,
  `diskusie/2026-11-24-parovanie-ai-klienta.md` časť 1

## Kontext

Marek sa pýtal, či má `tool.run` bežať v tom istom vlákne ako MCP server, či vadí, že server počas behu nástroja
neodpovie na `tools/list`, či nemať dedikované vlákno s frontou, a či má prijímanie správ byť slučka s blokujúcim
`read` (ako v C cez `select`/`poll`).

## Zvažované možnosti

### Kde beží `run`

- **Dedikovaný Web Worker s frontou skriptov (Marekov nápad):** **−** viewer, DOM a OpenSeadragon sú dostupné len
  z hlavného vlákna, worker na ne nedosiahne; Scripting API už skripty spúšťa vo Workeri a stav viewera aj tak menia
  v hlavnom vlákne.
- **Hlavné vlákno, `async` (vybrané):** **+** kým nástroj čaká na `await` (dlaždice, fetch), event loop vybavuje iné
  správy vrátane `tools/list`; odpovede sa párujú cez JSON-RPC `id`, takže jeden server zvládne viac požiadaviek naraz.
  **−** dlhý synchrónny výpočet zablokuje záložku.

### Prekrývanie nástrojov z viacerých klientov

Fronta nie je potrebná kvôli vláknam, ale kvôli **stavu viewera**: keď chat a Claude Code naraz hýbu snímkou, výsledok
je chaos.

- **Fronta v každom `McpServer`:** **−** nechráni pred prekryvom medzi klientmi.
- **Zdieľaný zámok v registri (reťaz Promise) len pre nástroje meniace stav** (napr. `mutates: true` alebo MCP
  anotácia `readOnlyHint`): **+** čítacie nástroje bežia paralelne. Odložené, kým to experimenty neukážu.

### Prijímanie správ

- **Slučka s blokujúcim `read`:** **−** v prehliadači neexistuje, zamrzla by celá záložka.
- **Callback `ws.onmessage` (vybrané):** prehliadač robí `select`/`poll` za nás vo svojom event loope a zavolá
  handler, ten zavolá `server.handleMessage` a odpoveď pošle späť.

## Rozhodnutie

Všetko (`McpServer`, `run`, viewer) beží v hlavnom vlákne cez event loop a `async`. Správy sa prijímajú callbackom
transportu. `handleMessage` sa neserializuje. Žiadny dedikovaný worker ani fronta teraz.

## Dôsledky

- `run` musí byť `async` a nesmie robiť dlhé synchrónne výpočty.
- `try/catch` ([0008](0008-spracovanie-chyb.md)) nechytí zaseknutý nástroj.

## Otvorené otázky

- Zdieľaný zámok pre mutujúce nástroje, ak experimenty ukážu konflikty.
- Timeout nástroja cez `Promise.race`.

## Súvisiace

- [0005](0005-rozdelenie-tried-mcp-plugin.md), [0003](0003-vstavany-chat-ako-mcp-klient.md)
