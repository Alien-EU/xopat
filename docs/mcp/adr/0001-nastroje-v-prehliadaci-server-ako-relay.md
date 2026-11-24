# 0001. Nástroje viewera žijú v prehliadači, server je len relay

- **Stav:** Prijaté (Marek, 13. 11. 2026), čaká na potvrdenie vedúcim
- **Dátum:** 2026-11-13, upresnené 2026-11-20
- **Rozhodli:** Marek s Claude, návrh poslaný Jiřímu Horákovi
- **Prepis diskusie:** bez prepisu. Doplnené spätne z `overview/xopat-and-mcp.md` (16. 10.),
  `overview/plan-implementacie-mcp.md` a `overview/mcp-architektura-navrh.md` (20. 11.) v projektových súboroch.

## Kontext

Zaujímavý stav xOpatu (otvorené snímky, viewport, vrstvy, anotácie) žije v **záložke prehliadača**. MCP server je
však proces, ku ktorému sa pripája klient (Claude Code, Codex, vlastný harness). Hlavná architektonická otázka je,
ako sa volanie nástroja dostane do záložky a kde sú nástroje definované.

## Zvažované možnosti

### A. Samostatný dátový server bez prehliadača

Node MCP server, ktorý hovorí len s image serverom a úložiskom xOpatu (zoznam snímok, metadáta, dlaždice, uložené
anotácie).

- **+** jednoduchý, bezstavový, funguje aj bez otvoreného viewera
- **−** nevidí a neovláda to, na čo sa používateľ pozerá; renderovanie so shadermi je len v prehliadači
- **−** ako hlavný prínos bakalárky slabé

### B. Bridge v xOpate: nástroje v prehliadači, server ako relay (vybrané)

Plugin `mcp-plugin` v záložke definuje a vykonáva nástroje cez Scripting API. Modul `mcp-bridge` na xOpat Node
serveri vystaví klientom MCP endpoint a volania len prepošle do správnej záložky.

- **+** platí bezpečnostný model Scripting API (sandbox, súhlas, maskovanie citlivých údajov), nevymýšľa sa nový
- **+** používateľ vidí, čo agent v jeho vieweri robí
- **+** jedno miesto, kde sú nástroje definované, pre vstavaný chat aj externých klientov
- **−** funguje len s Node serverom (nie PHP ani statické nasadenie)
- **−** treba vyriešiť párovanie klienta so záložkou (pozri [0010](0010-parovanie-ai-klienta.md))

### C. Headless prehliadač cez Playwright

Samostatný stdio server spustí Chromium, otvorí xOpat a volá Scripting API cez `page.evaluate`.

- **+** najrýchlejší prototyp, bez zmien na serveri
- **+** každý beh začína z rovnakého stavu, ideálne na reprodukovateľné experimenty
- **−** agent pracuje vo vlastnom neviditeľnom prehliadači, nie v používateľovom
- **−** ťažký runtime

### D. Server skladá skripty

Server by nástroje sám prekladal na Scripting API kód a posielal ho do záložky.

- **−** logika nástrojov by bola na dvoch miestach (server aj prehliadač)
- **−** server by musel poznať API všetkých pluginov, hoci beží oddelene od nich

## Rozhodnutie

**B ako hlavná implementácia.** Nástroje viewera sú definované len v prehliadači (`mcp-plugin`, neskôr register v core),
`mcp-bridge` na xOpat Node serveri je tenký relay, ktorý nikdy sám neskladá skripty. Bridge navyše ponúka vlastné
serverové nástroje (z možnosti A): zoznam snímok, sessions, uložené anotácie, otvorenie session. Tie fungujú aj bez
otvorenej záložky a nástroje viewera pribudnú, keď sa záložka pripojí (`tools/list_changed`).

**C ostáva** na experimenty v bakalárke (prototyp archivovaný vo vetve `archive/mcp-prototype`), lebo dáva čistý stav
pre každý beh.

## Dôsledky

- Bridge nedrží stav viewera, len spojenia a mapovanie klient ↔ záložka.
- Vznikajú dve časti kódu: `plugins/mcp-plugin` (prehliadač) a `modules/mcp-bridge` (server).
- Bridge žije na xOpat Node serveri, nie na slide serveri (wsi-service), ten len servíruje dlaždice.

## Otvorené otázky

- Potvrdenie vedúcim (Jiří Horák): patrí relay do rozsahu práce, alebo stačí plugin, `run_script` a variant C?
- Transport medzi záložkou a bridgom: Node server xOpatu podľa kontroly z 20. 11. nemá WebSocket, návrh z 20. 11.
  počítal so streamovaným NDJSON RPC. Diskusia z 24. 11. predpokladá WebSocket. Treba rozhodnúť pri písaní `mcp-bridge`.

## Súvisiace

- [0002](0002-hybrid-pevne-nastroje-a-run-script.md), [0003](0003-vstavany-chat-ako-mcp-klient.md)
- [mcp-nacrt.md](../mcp-nacrt.md), [mcp-architektura-navrh.md](../mcp-architektura-navrh.md)
