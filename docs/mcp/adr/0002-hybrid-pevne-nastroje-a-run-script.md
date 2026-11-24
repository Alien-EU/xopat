# 0002. Hybrid: pevné nástroje plus vždy `run_script` a `get_scripting_api`

- **Stav:** Prijaté (Marek, 20. 11. 2026), čaká na potvrdenie vedúcim
- **Dátum:** 2026-11-20
- **Rozhodli:** Marek s Claude, reakcia na pripomienku Jiřího Horáka
- **Prepis diskusie:** bez prepisu. Zdroj: `overview/plan-implementacie-mcp.md`, časť „Scripting vs. MCP“,
  a `overview/mcp-architektura-navrh.md`, časť 5.

## Kontext

xOpat má Scripting API, cez ktoré dnešný vstavaný chat generuje a spúšťa JS kód. Jiří 20. 11. namietol, že scripting
vie reťaziť volania (cyklus, podmienka, výsledok jedného ako vstup ďalšieho) na jedno kolo modelu, takže môže byť
lepší ako klasické MCP nástroje. Rovnaký záver majú Anthropic („code execution with MCP“) a Cloudflare („Code Mode“).
Bakalárka sa ale zameriava na malé lokálne modely, ktoré kód píšu výrazne horšie, než volajú nástroj so schémou.

## Zvažované možnosti

### A. Len scripting (model píše kód)

- **+** reťazenie, menej kôl modelu, menej tokenov pri dlhých úlohách
- **−** model musí poznať API a písať správny kód; malé modely v tom zlyhávajú
- **−** chyby sa ťažšie hľadajú a validujú

### B. Len pevné MCP nástroje

- **+** jednoduché volanie so schémou, ľahko sa validuje a vracajú sa zrozumiteľné chyby
- **−** každý krok je jedno kolo modelu, medzivýsledky idú cez kontext
- **−** čo nástroj nepokrýva, model neurobí

### C. Hybrid (vybrané)

Pevné nástroje a k nim vždy dva generické: `get_scripting_api` (popis API z `describeScriptingApi()`) a `run_script`
(spustí skript cez existujúci sandbox Scripting API).

- **+** MCP nič neberie, len k scriptingu pridáva pevné nástroje a externých klientov
- **+** priamo merateľná otázka do bakalárky
- **−** `run_script` je najsilnejší nástroj, treba ho vedieť vypnúť

## Rozhodnutie

**C.** `run_script` a `get_scripting_api` sú vystavené vždy, popri pevných nástrojoch. `run_script` ide cez sandbox
Scripting API (Web Worker, súhlas), takže nemá viac práv ako vstavaný chat, a dá sa vypnúť konfiguráciou nasadenia (ENV).
Oba nástroje registruje sám `mcp-plugin` ako obyčajné nástroje v registri ([0005](0005-rozdelenie-tried-mcp-plugin.md)).

## Dôsledky

- Experimentálna os bakalárky: **pevné nástroje vs. `run_script` vs. oboje**, na malých modeloch aj na Claude/Codexe.
  Hypotéza: veľké modely vyťažia viac zo skriptu, malé z pevných nástrojov.
- Zapnutie `run_script` sa číta z konfigurácie nasadenia, nie z URL parametrov.

## Otvorené otázky

- Potvrdenie vedúcim.
- `get_scripting_api` ako nástroj, alebo ako MCP resource?

## Súvisiace

- [0001](0001-nastroje-v-prehliadaci-server-ako-relay.md)
- [mcp-architektura-navrh.md](../mcp-architektura-navrh.md)
