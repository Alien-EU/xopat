# MCP pre xOpat: návrhové dokumenty

Tento priečinok zbiera návrh, ako xOpat sprístupniť cez [Model Context Protocol](https://modelcontextprotocol.io)
(MCP), aby viewer mohli ovládať jazykové modely: vstavaný chat aj externí klienti (Claude Code, Codex,
vlastný harness s malými lokálnymi modelmi). Ide o pracovné návrhy k bakalárskej práci, nie o hotovú
dokumentáciu. Implementácia vzniká postupne v plugine `plugins/mcp-plugin`.

## Dokumenty

| Dokument | Obsah |
|---|---|
| [mcp-nacrt.md](mcp-nacrt.md) | Krátky náčrt architektúry: `mcp-plugin` v prehliadači, relay `mcp-bridge` na serveri, MCP klienti. |
| [mcp-architektura-navrh.md](mcp-architektura-navrh.md) | Detailný návrh: vrstvy, ako komponenty pridávajú vlastné nástroje, serverové nástroje, scripting vs. MCP, bezpečnosť, poradie implementácie. |
| [mcp-plugin-triedy.md](mcp-plugin-triedy.md) | Triedy `ToolRegistry`, `McpServer` a `McpPlugin`, konvencie názvov a chýb, tok jedného volania `tools/call`. |

Obrázky sú v [assets/](assets/).

## Odporúčané poradie čítania

1. `mcp-nacrt.md` na rýchly prehľad.
2. `mcp-architektura-navrh.md`, ak chceš celý návrh a otvorené otázky.
3. `mcp-plugin-triedy.md` pred písaním kódu pluginu.

## Názvoslovie

- **mcp-plugin**: plugin xOpatu v prehliadači, ktorý drží register nástrojov a MCP server(y).
- **mcp-bridge**: modul na xOpat serveri, tenký relay medzi externými klientmi a záložkou viewera.
- **Nástroj (tool)**: pomenovaná funkcia `{ name, description, inputSchema, run }`, názov v tvare `pluginId__nazov`.

Dokumenty sú zámerne mimo Docusaurus webu v `docs/site/` (nie sú v jeho manifeste), keďže ide o
návrhy v slovenčine, ktoré sa ešte menia.
