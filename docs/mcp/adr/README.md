# Architektonické rozhodnutia (ADR)

Každé architektonické rozhodnutie pri návrhu MCP pre xOpat má vlastný záznam (Architecture Decision Record):
kontext, zvažované možnosti s plusmi a mínusmi, rozhodnutie, dôsledky a otvorené otázky. Záznamy sú podklad
pre kapitolu o návrhu v bakalárskej práci: popisujú nielen *čo* sme vybrali, ale aj *prečo* a *čo sme zamietli*.

Doslovné prepisy diskusií nie sú v repe. Sú v projektových súboroch v priečinku `diskusie/` (`YYYY-MM-DD-tema.md`)
a každý ADR odkazuje na svoj prepis názvom súboru.

## Zoznam

| # | Rozhodnutie | Stav | Dátum |
|---|---|---|---|
| [0001](0001-nastroje-v-prehliadaci-server-ako-relay.md) | Nástroje viewera žijú v prehliadači, server (`mcp-bridge`) je len relay | Prijaté, čaká na vedúceho | 2026-11-13 |
| [0002](0002-hybrid-pevne-nastroje-a-run-script.md) | Hybrid: pevné nástroje plus vždy `run_script` a `get_scripting_api` | Prijaté, čaká na vedúceho | 2026-11-20 |
| [0003](0003-vstavany-chat-ako-mcp-klient.md) | Vstavaný chat ako MCP klient v prehliadači | Prijaté, čaká na vedúceho | 2026-11-13 |
| [0004](0004-jeden-mcp-plugin-bez-light-verzie.md) | Jeden `mcp-plugin` budovaný postupne, bez light verzie | Prijaté | 2026-11-24 |
| [0005](0005-rozdelenie-tried-mcp-plugin.md) | Rozdelenie na `ToolRegistry`, `McpServer`, `McpPlugin` | Prijaté (presun do core čaká) | 2026-11-24 |
| [0006](0006-registracia-nastrojov-z-pluginov.md) | Pluginy registrujú nástroje odkazom na metódu, zmeny cez `tools/list_changed` | Prijaté | 2026-11-24 |
| [0007](0007-mena-nastrojov.md) | Mená nástrojov `plugin__nazov` | Prijaté | 2026-11-24 |
| [0008](0008-spracovanie-chyb.md) | Chyby nástrojov ako `isError` s orezanou hláškou | Prijaté | 2026-11-24 |
| [0009](0009-subeznost-a-prijimanie-sprav.md) | Všetko v hlavnom vlákne cez event loop, správy cez callbacky | Prijaté | 2026-11-24 |
| [0010](0010-parovanie-ai-klienta.md) | Párovanie AI klienta tlačidlom a overovacím kódom | Prijaté (oznámenie Deny otvorené) | 2026-11-24 |

ADR 0001–0003 boli doplnené spätne z návrhových dokumentov, prepis diskusie k nim nie je.

## Ako pridať nový záznam

1. Skopíruj [sablona.md](sablona.md) ako `NNNN-kratky-nazov.md` s ďalším číslom v poradí.
2. Vyplň všetky časti; zamietnuté možnosti a dôvod zamietnutia sú rovnako dôležité ako vybraná.
3. Prepis diskusie ulož do projektových súborov `diskusie/YYYY-MM-DD-tema.md` a odkáž naň.
4. Pridaj riadok do tabuľky vyššie.
5. Prijatý záznam sa neprepisuje. Keď sa rozhodnutie zmení, vznikne nový ADR a starý dostane stav
   „Nahradené ADR NNNN“.
