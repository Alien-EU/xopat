# 0003. Vstavaný chat ako MCP klient v prehliadači

- **Stav:** Prijaté (Marek, 13. 11. 2026), čaká na potvrdenie vedúcim
- **Dátum:** 2026-11-13
- **Rozhodli:** Marek s Claude
- **Prepis diskusie:** bez prepisu. Zdroj: `overview/mcp-nacrt.md`, `overview/mcp-architektura-navrh.md`;
  prototyp v archivovanej vetve `archive/chat-mcp`.

## Kontext

Vstavaný chat xOpatu dnes nechá model generovať Scripting API kód a spúšťa ho. Externí klienti budú používať MCP
nástroje. Ak by chat zostal na kóde, existovali by dve rôzne rozhrania nad tým istým viewerom a nedali by sa
porovnávať na rovnakých úlohách.

## Zvažované možnosti

### A. Chat ostane pri generovaní kódu

- **+** žiadna práca navyše
- **−** iné rozhranie ako pre externých klientov, horšie pre malé modely ([0002](0002-hybrid-pevne-nastroje-a-run-script.md))

### B. Chat číta register nástrojov priamo, bez MCP

- **+** najmenej vrstiev
- **−** chat by mal vlastnú logiku volaní a chýb, ktorá by sa rozišla s MCP serverom

### C. Chat je rovnocenný MCP klient cez in-memory transport (vybrané)

- **+** všetci klienti (chat, Claude Code, Codex, harness) vidia rovnakú sadu nástrojov a rovnaké chyby
- **+** chat je zároveň testovací klient pre `mcp-plugin` bez servera
- **−** vlastná agent loop v prehliadači (existuje v prototype `archive/chat-mcp`)

## Rozhodnutie

**C.** Vstavaný chat sa pripojí na `McpServer` v tej istej záložke cez in-memory transport, ako ktorýkoľvek iný klient.

## Dôsledky

- `McpServer` musí byť nezávislý od transportu, jedna inštancia na klienta ([0005](0005-rozdelenie-tried-mcp-plugin.md)).
- Chat a externí klienti môžu meniť stav viewera súčasne ([0009](0009-subeznost-a-prijimanie-sprav.md)).

## Otvorené otázky

- Potvrdenie vedúcim, keďže ide o zmenu správania existujúceho chatu.

## Súvisiace

- [0001](0001-nastroje-v-prehliadaci-server-ako-relay.md), [0002](0002-hybrid-pevne-nastroje-a-run-script.md)
