# 0005. Rozdelenie na `ToolRegistry`, `McpServer` a `McpPlugin`

- **Stav:** Prijaté. Presun `ToolRegistry` do core xOpatu čaká na súhlas vedúceho.
- **Dátum:** 2026-11-24
- **Rozhodli:** Marek s Claude
- **Prepis diskusie:** `diskusie/2026-11-24-struktura-mcp-plugin.md`, časti 4 až 7

## Kontext

Marek sa pýtal, či má MCP server byť samostatná trieda, alebo môže všetko žiť v triede pluginu. Jeho tri argumenty
za oddelenie: (A) viac inštancií, (B) rôzne typy servera podľa parametrov konštruktora, (C) plugin má navyše vlastné
povinnosti. Zároveň treba umožniť ostatným pluginom pridať vlastné nástroje.

## Zvažované možnosti

### A. Všetko v jednej triede `McpPlugin`

- **+** najmenej kódu
- **−** nedá sa mať viac klientov naraz s vlastnou session (`initialize`, verzia protokolu)
- **−** protokol, nástroje a xOpat lepidlo sa zlejú dokopy, ťažko sa testuje

### B. Rôzne typy serverov podľa parametrov

- **−** rozdiely medzi klientmi rieši transport, nie typ servera; zbytočné

### C. Mini MCP server v každom plugine, `mcp-plugin` ich routuje (Marekov nápad)

Každý plugin si vytvorí vlastnú inštanciu malého servera so svojimi nástrojmi a `mcp-plugin` smeruje požiadavky.

- **+** plugin má nástroje pokope so sebou
- **−** klient vždy vidí jeden server, takže `mcp-plugin` by aj tak musel zlučovať `tools/list` a riešiť kolízie mien
- **−** každý mini server by opakoval protokol (`initialize`, verzie)
- **−** pluginy by záviseli od MCP

### D. Tri triedy s oddelenými zodpovednosťami (vybrané)

- **`ToolRegistry`**: jeden spoločný `Map` nástrojov `{ name, description, inputSchema, run }`, metódy `register`, `get`,
  `list`, `onChange`. Nevie nič o MCP, je to len „zoznam funkcií s popisom a JSON Schemou“.
- **`McpServer`**: jedna inštancia na pripojeného klienta; `handleMessage`, `initialize`, `tools/list`, `tools/call`.
  Dostane **odkaz na register**, nie na plugin.
- **`McpPlugin`**: lepidlo pre xOpat (životný cyklus, nastavenia, UI), vytvára transporty a servery.

Pri D sa ešte riešilo, čo dostane server v konštruktore:

- celý plugin (`new McpServer(this)`): **−** server vidí nastavenia, UI, viewer a „prilepí sa“ na plugin;
  pri presune registra do core by sa musel prepisovať
- len register (`new McpServer(this.tools)`): **+** server sa dá otestovať v konzole bez pluginu,
  presun registra do core ho nezmení (vybrané)

## Rozhodnutie

**D, server dostane len register.** `ToolRegistry` zatiaľ žije v `mcp-plugin`, cieľovo patrí do core xOpatu vedľa
`ScriptingManager`. Závislosť ide jedným smerom: core nepozná MCP, pluginy zapisujú do core, `mcp-plugin` z core číta
a prekladá na MCP.

## Dôsledky

- Vstavaný chat aj `mcp-bridge` majú každý vlastný `McpServer` nad tým istým registrom.
- Register by mohol čítať aj iný konzument (napr. chat priamo, OpenAI function calling), lebo tvar nástroja je všeobecný.
- Tvar nástroja sa popíše v JSDoc (`@typedef`), JS statické typy nemá.

## Otvorené otázky

- Súhlas Jiřího s presunom `ToolRegistry` do core xOpatu.

## Súvisiace

- [0006](0006-registracia-nastrojov-z-pluginov.md), [0007](0007-mena-nastrojov.md), [0008](0008-spracovanie-chyb.md)
- [mcp-plugin-triedy.md](../mcp-plugin-triedy.md) (diagram tried)
