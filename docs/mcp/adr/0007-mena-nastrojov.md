# 0007. Mená nástrojov: predpona pluginu a `__`

- **Stav:** Prijaté
- **Dátum:** 2026-11-24
- **Rozhodli:** Marek s Claude
- **Prepis diskusie:** `diskusie/2026-11-24-struktura-mcp-plugin.md`, časť 9

## Kontext

Do jedného registra zapisuje viac pluginov, takže dva pluginy môžu chcieť nástroj s rovnakým menom (`get_info`).
Mená musia prejsť cez MCP aj cez OpenAI-kompatibilné API, ktoré používa vstavaný chat a harness s malými modelmi.

## Zvažované možnosti

### A. Bez predpony, kolízia = chyba pri `register`

- **−** pluginy by si museli mená dohadovať medzi sebou

### B. Predpona s `:` (napr. `comments_plugin:add_comment_at`, Marekov prvý návrh)

- **+** čitateľné
- **−** MCP odporúča len písmená, číslice, `_`, `-`, `.`; `:` neprejde

### C. Predpona s `.` (`comments.add_comment_at`)

- **−** OpenAI-kompatibilné API berie len `[a-zA-Z0-9_-]`, max 64 znakov

### D. Predpona s `__` (`comments__add_comment_at`) (vybrané)

- **+** prejde všade, oddeľovač je viditeľný
- **−** dlhšie mená, treba strážiť limit 64 znakov

## Rozhodnutie

**D.** Meno nástroja je `idPluginu__nazov`, len `[a-zA-Z0-9_-]`, najviac 64 znakov. Predponu dopĺňa `register` sám
z id pluginu, aby ju nikto nezabudol.

## Dôsledky

- Kolízia mien medzi pluginmi nenastane; v rámci jedného pluginu `register` hodí chybu.
- `register` musí poznať id volajúceho pluginu (parameter alebo väzba registra na plugin).

## Otvorené otázky

- Ako presne `register` zistí id pluginu (explicitný parameter vs. podregister pre plugin).
- Predpona pre nástroje samotného `mcp-plugin` (`run_script`, `get_scripting_api`) a serverové nástroje bridgu.

## Súvisiace

- [0005](0005-rozdelenie-tried-mcp-plugin.md), [0006](0006-registracia-nastrojov-z-pluginov.md)
