# 0008. Chyby nástrojov ako `isError` s orezanou hláškou

- **Stav:** Prijaté
- **Dátum:** 2026-11-24
- **Rozhodli:** Marek s Claude
- **Prepis diskusie:** `diskusie/2026-11-24-struktura-mcp-plugin.md`, časť 9

## Kontext

Funkcia `run` ľubovoľného nástroja môže hodiť výnimku (zlý argument, snímka nie je otvorená). MCP má dva spôsoby, ako
neúspech vrátiť: JSON-RPC `error`, alebo normálny `result` s `isError: true`. Bakalárka skúma feedback loop malých
modelov, teda či sa model z chybovej hlášky opraví.

## Zvažované možnosti

### A. JSON-RPC `error` pre každú chybu

- **−** v klientskom SDK `callTool()` hodí výnimku; či sa hláška dostane k modelu, záleží od klienta
  (Claude Code ukáže len všeobecnú hlášku)

### B. `isError: true` v result, celá chyba so stack trace

- **+** model chybu vidí
- **−** stack trace a vnútornosti (cesty, interné URL, tokeny v chybe z `fetch`) nepatria modelu
- **−** dlhá chyba žerie kontext malého modelu

### C. `isError: true` s orezanou `err.message` (vybrané)

- **+** model chybu vidí a môže sa opraviť
- **+** krátke, bez vnútorností

### Kde chytať výnimku

- v každom nástroji zvlášť: **−** opakovaný kód, ľahko sa zabudne
- **jeden `try/catch` v `McpServer` pri `tools/call` (vybrané)**

## Rozhodnutie

**C s centrálnym `try/catch` v `McpServer`.** Chyba vo vnútri `run` sa vráti ako
`{ content: [{ type: "text", text: <err.message orezaná na ~500 znakov> }], isError: true }`, celý objekt chyby ide do
`console.error`. JSON-RPC `error` sa používa len pre chyby protokolu: neznáma metóda, neznámy nástroj, zlý JSON.

Marek poznamenal, že xOpat je open source a celá chyba je aj tak viditeľná v prehliadači. Orezanie má zmysel hlavne
preto, že pri externých klientoch (Claude Code, Codex) chyba odchádza aj k poskytovateľovi modelu.

## Dôsledky

- Autori nástrojov majú písať užitočné hlášky („Snímka nie je otvorená, najprv zavolaj `viewer__open_slide`“), nie
  „Cannot read properties of undefined“.
- Kvalita chybových hlášok je merateľný faktor v experimentoch (feedback loop).

## Otvorené otázky

- Presná dĺžka orezania (500 znakov je odhad).

## Súvisiace

- [0005](0005-rozdelenie-tried-mcp-plugin.md), [0009](0009-subeznost-a-prijimanie-sprav.md)
