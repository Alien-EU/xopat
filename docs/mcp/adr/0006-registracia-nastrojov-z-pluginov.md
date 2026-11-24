# 0006. Pluginy registrujú nástroje odkazom na vlastnú metódu, zmeny cez `tools/list_changed`

- **Stav:** Prijaté
- **Dátum:** 2026-11-24
- **Rozhodli:** Marek s Claude
- **Prepis diskusie:** `diskusie/2026-11-24-struktura-mcp-plugin.md`, časti 6 a 8

## Kontext

Plugin (napr. komentáre) chce vystaviť nástroj `add_comment_at(x, y)`, ktorého logika je jeho metóda. Marek sa pýtal,
ako ju zavolá `mcp-plugin`, kde prichádzajú správy, či register nemá byť na slide serveri a čo sa stane, keď sa plugin
načíta až po pripojení klienta.

## Zvažované možnosti

### Kde je register a ako sa volá metóda

- **Register na serveri (slide server / Node server):** **−** server o pluginoch nič nevie a nevie zavolať ich kód
  v prehliadači.
- **Register v prehliadači, nástroj ako text/skript:** **−** zbytočný preklad, keď všetky pluginy bežia v tej istej
  stránke.
- **Register v prehliadači, `run` ako odkaz na funkciu (vybrané):** všetky pluginy zdieľajú jedno JS prostredie,
  takže plugin uloží arrow funkciu `run: (args) => this.addCommentAt(args.x, args.y, args.text)` a `McpServer` ju
  priamo zavolá. Arrow funkcia zachová `this` pluginu.

### Ako sa klient dozvie o novom nástroji

- **Spoliehať sa, že klient zavolá `tools/list` znova:** **−** Claude Code a väčšina klientov načíta zoznam raz po
  `initialize`.
- **Nový `initialize`:** **−** robí sa raz na spojenie, protokol to nepredpokladá.
- **`notifications/tools/list_changed` (vybrané):** server ohlási `capabilities.tools.listChanged: true`, register pri
  zmene vyvolá udalosť a každý `McpServer` pošle klientovi notifikáciu; klient si sám zavolá `tools/list`.

## Rozhodnutie

Plugin v `pluginReady` zavolá `registry.register({ name, description, inputSchema, run })` s `run` ako arrow funkciou
na vlastnú metódu. `ToolRegistry.onChange` počúvajú všetky `McpServer` a posielajú `tools/list_changed`.
Plugin nerobí nič iné a o MCP nevie.

## Dôsledky

- `mcp-plugin` nepozná konkrétne pluginy.
- Udalosť zmeny môže použiť xOpat mechanizmus `raiseEvent` / `addHandler` namiesto vlastného poľa listenerov.
- Rovnaká notifikácia sa použije aj pri spárovaní externého klienta so záložkou ([0010](0010-parovanie-ai-klienta.md)).

## Otvorené otázky

- Odregistrovanie nástroja (napr. pri vypnutí pluginu) zatiaľ nie je navrhnuté.

## Súvisiace

- [0005](0005-rozdelenie-tried-mcp-plugin.md), [0007](0007-mena-nastrojov.md)
