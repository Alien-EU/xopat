# 0010. Párovanie AI klienta so záložkou bez používateľských účtov

- **Stav:** Prijaté. Oznámenie Deny (`await_pairing`) je navrhnuté, nepotvrdené.
- **Dátum:** 2026-11-24
- **Rozhodli:** Marek s Claude (výsledný spôsob navrhol Marek)
- **Prepis diskusie:** `diskusie/2026-11-24-parovanie-ai-klienta.md`

## Kontext

Externý klient (Claude Code, Codex) sa pripája na `mcp-bridge` na xOpat Node serveri, ale nástroje viewera sú v záložke
([0001](0001-nastroje-v-prehliadaci-server-ako-relay.md)). Bridge musí vedieť, ku ktorej záložke klienta pripojiť.
Nasadenie nemusí mať prihlasovanie (Marekov Docker ho nemá) a jeden server môže používať viac ľudí v inštitúcii,
takže si nesmú navzájom ovládať záložky.

## Zvažované možnosti

### A. Statický token záložky v konfigurácii klienta (`/mcp?pair=x7k2`)

- **+** jednoznačné, zároveň autorizácia
- **−** token sa mení s každou session, prepisovať konfiguráciu je zdĺhavé

### B. Serverové nástroje `list_tabs` / `select_tab`, záložku vyberie model

- **−** bez identity by model videl a vybral aj cudzie záložky

### C. Automatické pripojenie, keď je otvorená jediná záložka

- **+** pohodlné
- **−** nebezpečné na zdieľanom serveri; nanajvýš ako doplnok

### D. Nástroj `connect(sessionId, token)`, používateľ skopíruje ID a token do chatu (Marekov prvý návrh)

- **+** žiadna konfigurácia, funguje bez účtov
- **±** dlhý náhodný token by stačil sám, `sessionId` bezpečnosť nepridá
- **−** token v chate odchádza aj k poskytovateľovi modelu; záložka je vystavená, kým existuje token

### E. OAuth (podľa MCP špecifikácie)

- **+** bez kopírovania, token viazaný na používateľa, dá sa zrušiť
- **−** vyžaduje identitu používateľa; bez účtov by stránku „Povoliť“ vedel otvoriť ktokoľvek, takže bezpečnosť by aj
  tak stála na potvrdení v záložke
- **−** veľká implementácia (OAuth endpointy na bridgi)

### F. Párovanie tlačidlom a overovacím kódom (Marekov druhý návrh, vybrané)

1. Používateľ klikne v záložke „+ Connect AI client“, záložka sa pripojí na bridge a dostane krátke jednorazové
   `connectionId` (napr. `K7Q-29F`, platí ~5 minút). Záložka ho ukáže spolu so šablónou promptu.
2. Používateľ ho vloží agentovi, agent zavolá `connect(connectionId)`.
3. Bridge vygeneruje náhodný overovací kód (napr. `4821`), vráti ho agentovi a pošle záložke.
4. Záložka ukáže „`clientInfo.name` sa chce pripojiť, kód 4821. Povoliť?“, používateľ porovná kódy a klikne Allow.
5. Bridge prepojí MCP session klienta so záložkou a pošle `tools/list_changed` (bez nového `initialize`).

- **+** bezpečné aj bez účtov, poslednú bránu drží človek v záložke (ako párovanie Bluetooth)
- **+** záložka nie je vystavená, kým používateľ neklikne
- **+** kód odhalí súbežný pokus s uhádnutým ID (používateľ vidí dve žiadosti)

Pri F sa zvažovali dva varianty potvrdenia: Allow v záložke (vybrané) alebo prepísanie PIN do záložky (o krok otravnejšie).
Marek pôvodne chcel, aby druhý kód (meno, PIN, „Ahoj“) vymyslel klient. Zamietnuté: text od klienta sa dá podvrhnúť,
náhodný kód z bridgu pozná len agent, ktorý naozaj zavolal `connect`.

## Rozhodnutie

**F.** Šablóna promptu sa dá aj do `description` nástroja `connect`, aby agent vedel, čo si má od používateľa vypýtať.
OAuth je budúca práca pre nasadenia s účtami (OIDC); párovanie kódmi ostáva pre nasadenia bez účtov.

## Dôsledky

- Bridge drží mapu `connectionId → WebSocket záložky` a stav párovania; nevidí prehliadače, len spojenia, takže dve
  inštancie Chrome alebo dva klienti naraz nevadia.
- Pred spárovaním klient vidí len serverové nástroje bridgu (vrátane `connect`).

## Otvorené otázky

- **Oznámenie Deny/vypršania agentovi.** Návrh z 24. 11.: druhý nástroj `await_pairing(connectionId)`, ktorý čaká na
  klik alebo timeout (~2 min) a vráti `connected`, `denied` alebo `expired`. Notifikácia zo servera (`notifications/message`)
  sa na to nehodí, model ju väčšinou nevidí; elicitation/sampling nepodporuje každý klient. Marek zatiaľ nepotvrdil.
- **Refresh záložky (F5)** zavrie spojenie: uložiť stav do `sessionStorage` a obnoviť, alebo párovať znova?
- Transport záložka ↔ bridge (WebSocket vs. streamované NDJSON RPC), pozri [0001](0001-nastroje-v-prehliadaci-server-ako-relay.md).

## Súvisiace

- [mcp-parovanie.md](../mcp-parovanie.md) (sekvenčný diagram)
- [0006](0006-registracia-nastrojov-z-pluginov.md) (`tools/list_changed`)
