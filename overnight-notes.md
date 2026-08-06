# Overnight refactor notes — Calculated Chaos

Session goal: break `src/main.js` (5536 lines, one giant IIFE) into real ES
modules by domain, with **zero behavior changes**. Small commits, each one
pushed, each one `node --check`-clean. No deploys. Real bugs found along the
way go in the "Bugs found (not fixed)" section below, not into a code fix.

## Map of `src/main.js` as of session start (line numbers, pre-refactor)

Everything below lives inside a single `export const app = (function(){ ... })()`
IIFE (line 8 to ~5535). Line numbers will shift as extraction happens — treat
this as the "before" snapshot.

| Lines | Section | Contents |
|---|---|---|
| 1-7 | imports | imports from `./config/firebase.js` and `./ebay-api.js` |
| 15-37 | state | mutable closure vars: `items`, `draftItems`, `currentEditId`, filters, current photo/measurement/status/prep state, etc. |
| 40-166 | constants | `PLATFORM_FEES/LABEL/NAME/COLOR/FAVICON`, `CONDITION_FACTOR/LABEL`, `LISTING_CONDITION_LABEL`, `POSHMARK_STYLE_TAGS`, `PREP_LABEL`, `BASE_CATEGORY_VALUE`, `DAILY_QUOTES` — pure data |
| 75-98 | platform management | `getAllPlatforms/getPlatformLabel/getPlatformColor` — reads `appSettings` (custom platforms + fee overrides) |
| 201-272 | daily quote / insights | `getDailyQuote`, `computePerformanceInsights` (reads `items`), `getTodaysHeaderMessage`, `renderDailyQuote` (touches DOM) |
| 274-333 | Firestore storage | `loadItems`, `saveItem`, `deleteItemFromDb` — read/write `items` collection |
| 335 | `uid()` — pure id generator |
| 337-369 | photo session drafts | `loadDrafts`, `saveDraftToDb`, `deleteDraftFromDb` — own Firestore collection |
| 370-413 | photo hosting at save time | `ensurePhotosHostedForSave`, `setSaveProgress` — Storage upload + progress UI |
| 416-427 | currency input formatting | `attachCurrencyFormatting` — DOM |
| 429-467 | product code / storage box helpers | `nextProductCode`, `fillNextProductCode`, `getAllStorageBoxes` |
| 474-639 | field autocomplete/lookup helpers | sizes, sources, categories, colors, clothing types, autocomplete wiring, shipping defaults |
| 642-669 | image compression | `compressImage` — canvas-based, pure-ish (takes a File) |
| 670-799 | **pricing engine** | `getCategoryPriceHistory`, `estimateMintValue`, `recencyWeight`, `weightedMedianMintValue`, `getPriceReference`, `suggestPrice`, `estimateShipping`, `platformFee` — all read `items`/`appSettings` via closure |
| 800-833 | projected profit / completeness | `projectedProfit`, `isIncomplete`, `missingFields`, `daysSince` |
| 834-1027 | render: stats + filter panel | `renderStats`, `renderFilterPanel`, `filtersActiveCount`, `applyFilters` |
| 1027-1400 | render: catalog | `statusLabel`, `renderCatalog` (huge), `wireCatalogControls` (huge), `escapeHtml`, `toTitleCase` |
| 1401-1446 | render: finance | `renderFinance` |
| 1447-1637 | render: reports + CSV export | `renderReports`, `daysToSell`, `csvEscape`, `downloadCsv` |
| 1637-1840 | report buttons + version badge + renderAll | `wireReportButtons` (huge — wires CSV export buttons), `renderVersionBadge`, `renderAll` |
| 1841-1855 | tabs | `switchToTab` |
| 1856-2070 | eBay category search (curated cache + live) | `slugifyEbayQuery`, `setChosenEbayCategory`, `loadEbayAspectsForCategory`, `renderEbayAspectsFields`, `fetchEbayValidConditions`, `searchEbayCategory`, `renderEbayCategoryResults`, `pickEbayCategoryResult` |
| 2070-2263 | item modal | `openModal` (huge), `closeModal`, `showSavedToast` |
| 2264-2607 | thermal label printing | label/marker canvas drawing, print modal, calibration modal (`window.openMarkerPrintModal`, `window.openCalibInstructionsModal` are global) |
| 2608-2817 | photo session | grid render, reset, commit group, open draft for cataloging |
| 2817-3371 | measure tool | huge — pinch/zoom canvas measuring tool, calibration flow |
| 3372-3446 | status/prep/listed-platform pill UI | `setStatusUI`, `setPrepUI`, `setListedPlatformsUI`, `renderSoldFields` |
| 3447-3644 | photos + lightbox | `renderPhotoPreviews`, lightbox open/close/render/download |
| 3644-3975 | AI photo analysis | Claude vision call + response parsing/rendering |
| 3975-4301 | listing generator | title/description builders, AI listing generator, output rendering |
| 4301-4517 | save / delete | main item-modal save+delete flow (huge, references almost everything above) |
| 4517-5384 | **settings** | huge domain: load/save settings, AI usage counters, `renderSettings` (huge), eBay connection panel, platform settings, all the `window.save*Settings` / `window.add*` handlers |
| 5384-5397 | init | `waitForFirebaseThenLoad` |
| 5397-5520 | auth gate | show/hide auth screens, sign-in/sign-up form wiring, `onAuthStateChanged` |
| 5520-5535 | bridge to ebay-api.js | `return { get items(), get currentEditId(), saveItem, renderAll, escapeHtml, CONDITION_LABEL, bulkSelectedIds, suggestPrice, platformFee, showSavedToast, openModal, renderEbayConnectionStatus, openModalFromBulkReview }` — this is the `app` object `ebay-api.js` imports |

## Why this is high-risk to fully modularize in one night

Almost everything after line ~800 is a closure over the same dozen mutable
`let` variables (`items`, `currentEditId`, `currentPhotos`, `activeFilters`,
etc.) plus heavy, order-dependent DOM wiring (`wireCatalogControls`,
`wireReportButtons`, the measure tool, the modal) that all assume they run
inside the same closure at page load, in the exact order they run today.
Splitting those into separate files means either:
- passing a big shared mutable-state object between every module (a real
  redesign, more the "shared state module" idea from the request), or
- accepting several rounds of careful, one-function-at-a-time extraction
  with manual re-verification of every call site.

Given "no real-time supervision" + "must not break behavior," I'm
prioritizing **safe, mechanical extractions first**: modules that are pure
functions/data with no dependency on the mutable closure state, or whose
only dependency is passed in as a parameter. These carry near-zero risk and
still meaningfully shrink `main.js` and give real domain boundaries. The
deeper "DOM-wiring" sections (catalog rendering, settings, measure tool,
modal save/delete) are much higher risk to split blind overnight — see
"Left for later" below for the reasoning per section.

## Approach taken

1. Extract pure/leaf modules one at a time, each its own commit:
   - `src/modules/constants.js` — platform/condition/style-tag/quote data
   - `src/modules/format-utils.js` — escapeHtml, toTitleCase, daysSince,
     daysToSell, uid, csvEscape, downloadCsv
   - `src/modules/pricing.js` — pricing/profit engine (parameterized on
     `items`/`appSettings` rather than closing over main.js's private vars)
2. After each extraction: `node --check` on every touched file, re-read the
   diff to confirm every call site still resolves, commit, push.
3. Do **not** touch the ebay-api.js↔main.js `app` bridge in this session —
   redesigning that shared-state bridge safely requires the same state
   consolidation as the bigger main.js split, and I'd rather leave one clean
   working bridge than two half-migrated ones with no one awake to catch a
   regression. Noted as a follow-up for daytime work.

## Progress — commits made this session

1. `Add overnight-notes.md with main.js structure map and refactor plan`
2. `Extract platform/condition/style/quote data constants into modules/constants.js`
   — pure data, zero logic risk.
3. `Extract escapeHtml/toTitleCase/daysSince/daysToSell/uid/csvEscape into modules/format-utils.js`
   — pure functions, no closure dependency. Left `downloadCsv` in `main.js`
   since it reads `APP_VERSION`/`APP_VERSION_DATE`, which I deliberately did
   NOT move (see "Decisions" below).
4. `Extract pricing/profit engine into modules/pricing.js (params instead of closure)`
   — moved `getCategoryPriceHistory`, `estimateMintValue`, `recencyWeight`,
   `weightedMedianMintValue`, `getPriceReference`, `suggestPrice`,
   `estimateShipping`, `platformFee`, `projectedProfit`. The module takes
   `items`/`appSettings` as explicit parameters instead of closing over
   them. `main.js` keeps thin wrapper functions with the **original names
   and signatures** (e.g. `function suggestPrice(item){ return
   _suggestPrice(items, item); }`) so every one of the ~15 existing call
   sites elsewhere in `main.js` (catalog rendering, reports, listing
   generator, photo-session draft cataloging, etc.) needed zero changes.
   Verified via `grep` that `estimateMintValue`/`recencyWeight`/
   `weightedMedianMintValue`/`getCategoryPriceHistory` had no other call
   sites before removing their local definitions.
5. `Sync 'Listed on' pill UI live when eBay publish succeeds while item modal is open`
   — **this one is a real feature/bug fix, requested directly by you
   mid-session** (not part of the refactor plan), so it's called out
   separately below.

## Feature fix: eBay publish now live-updates the "Listed on" pills

You asked: when publishing an item to eBay, auto-check the "ebay" tag
under "Listed on" in the item modal.

Turns out the *data* side of this already existed — `publishItemToEbayCore`
in `ebay-api.js` already tagged `'ebay'` onto `item.listedPlatforms` and
saved it to Firestore on every successful publish. What was missing: if the
item's modal was still open (which it usually is — that's where the
"Publish on eBay" button/status area lives), the **pill UI** showing
"Listed on: Poshmark / eBay / …" was rendered once when the modal opened
and never refreshed after a successful publish — so she'd see success but
the eBay pill wouldn't visually light up until she closed and reopened
that item.

Fix: added `setListedPlatformsUI` to the `app` bridge object `ebay-api.js`
already uses, and after a successful publish, if the currently-open modal
is for this exact item (`app.currentEditId === item.id`), call
`app.setListedPlatformsUI([...freshItem.listedPlatforms])` using the
already-persisted item (not a hand-rebuilt duplicate of the tagging logic)
so the pill reflects the real saved state immediately. No change to the
bulk-publish flow — that flow operates on a list of items with no modal
open per item, so there's no pill UI to sync there.

## Decisions made without waiting for approval (and why)

- **Left `APP_VERSION`/`APP_VERSION_DATE` in `main.js`**, did not move them
  to `modules/constants.js` alongside the other constants. The existing
  comment on them ("bump this with every meaningful update") is a workflow
  instruction for future you, and moving them to a separate file adds a
  jump for zero benefit. Conservative/reversible: trivial to move later if
  you disagree.
- **Kept `downloadCsv` in `main.js`** instead of moving it into
  `format-utils.js` with the rest of the CSV helpers, purely because it
  reads `APP_VERSION`/`APP_VERSION_DATE` (see above) — moving it would've
  meant either passing the version string in as a parameter (touching
  every one of its several call sites in `wireReportButtons`) or importing
  version constants into a "pure formatting" module. Not worth the risk
  tonight; `csvEscape` (the part that's actually reusable) is extracted.
- **Did not touch the `ebay-api.js` ↔ `main.js` bridge** (the `app` object
  `main.js`'s IIFE returns). You mentioned a cleaner shared-state module as
  an optional idea — I agree it's the right end state, but doing it safely
  means the same closure-to-module state migration as the rest of
  `main.js`'s harder sections (see below), and I'd rather hand you one
  clean bridge than a half-migrated one with no one awake to catch a
  regression. I only added one new key to it (`setListedPlatformsUI`, for
  the eBay pill fix above) — same pattern as everything else already there.
- **Stopped extraction after the pricing engine** rather than pushing into
  the field-autocomplete/storage-box helpers section next. Those functions
  (`getAllSizes`, `setupSourceAutocomplete`, `getAllStorageBoxes`, etc.)
  read `items`/`lastUsedBox`/`lastUsedSource`/`appSettings` AND wire DOM
  event listeners directly (not just pure data in/out), so extracting them
  safely needs the same "wrapper + parameterize" treatment as pricing.js
  but with more call sites and more DOM coupling to verify by hand. Given
  no one's awake to catch a live-app regression, I'd rather stop at a
  clean, verified point than rush a riskier section.

## Verification done on every commit

- `node --check` on every file touched (no syntax errors).
- `grep` for every function/const name removed from `main.js` to confirm
  zero leftover duplicate declarations and zero dangling call sites.
- Traced every call site of each extracted pricing function by hand before
  changing its signature, to confirm none were called from outside the
  cluster with an incompatible signature.
- Tried to smoke-test in a real browser (`npx vite` + a headless Chromium
  via Playwright) — the dev server itself starts fine (`npm install` was
  needed first; `node_modules` wasn't present in this container). Couldn't
  get a real functional smoke test past that: the Playwright package isn't
  installed in this repo/environment and I didn't want to add a new
  dependency to `package.json` just for one-off overnight verification.
  **This means tonight's changes are verified by static analysis
  (syntax + call-site tracing) only, not by actually clicking through the
  app.** Please click through Catalog / Reports / Finance / an item's
  price-suggestion once you're up, before trusting this branch further.

## What's left (real work, not done tonight)

- The bulk of `main.js` is still one IIFE: catalog rendering, the item
  modal (open/save/delete), settings, the measure tool, thermal label
  printing, photo session, AI photo analysis, and the listing generator —
  roughly 4,700 of the original ~5,300 lines. These are where the real
  domain boundaries you asked about (catalog/items, item form/modal,
  settings, reports, photos, CSV export) would actually live, but they're
  also where the shared mutable state (`items`, `currentEditId`,
  `currentPhotos`, `activeFilters`, etc.) and DOM wiring order matter most
  — the riskiest part to split without anyone awake to catch a mistake.
- The `ebay-api.js` ↔ `main.js` bridge redesign (shared state module) you
  floated as optional — still just the one-directional `app` getter
  object. Worth doing once the bigger split above happens, not before.
- No real functional smoke test of tonight's changes — see "Verification"
  above. Recommend clicking through the app once before doing more
  extraction on top of this branch.

## Backlog — mudanças de UX pedidas (publicação eBay + modal do item)

Levantadas em 2026-08-06, todas observadas no fluxo de **multi-seleção →
publicar no eBay em massa** (bulk preflight). Detalhes completos abaixo,
como o usuário descreveu. Discutindo uma por uma antes de mexer em código.

1. **Inverter ordem "bloqueado bloqueia tudo"** — hoje, ao selecionar N
   itens pra publicar (ex: 30, sendo 20 prontos e 10 precisando de
   revisão — sem categoria eBay escolhida), o fluxo não publica os 20
   prontos enquanto os 10 não forem corrigidos. Quer inverter: publicar os
   prontos primeiro, os que precisam de revisão ficam pendentes à parte.
2. **Botão de editar + texto muito pequenos** na lista de itens
   bloqueados/precisando de revisão dentro do preflight de publicação em
   massa — tanto o texto da lista quanto o botão "Edit" ao lado de cada
   item.
3. **Edição em massa da descrição via IA** — criar uma ferramenta que
   roda a geração de descrição (API já conectada) em lote pros itens
   selecionados que estão com essa pendência, sem precisar abrir item por
   item.
4. **Salvar automático ao gerar a descrição** — hoje, depois de clicar em
   "gerar descrição", é preciso clicar em Salvar manualmente pra habilitar
   "Publicar no eBay". Quer que o salvamento aconteça automaticamente
   assim que a API entrega a descrição (o gatilho do save é a resposta da
   API chegando, não um clique separado).
5. **Manter a descrição visível no painel do item depois de salva** — ao
   gerar a descrição, o texto aparece, ela salva, o "Publicar no eBay"
   habilita — mas o texto some da tela do item (mesmo estando salvo e
   sendo usado corretamente na publicação/cópia). Quer que o texto
   continue visível no painel depois de salvo, sem precisar gerar de novo
   pra ver.
6. **Não voltar pro topo da tela ao recarregar/salvar** — junto com o
   autosave do item 4, o recarregamento da view não deve jogar o scroll de
   volta pro topo do modal.
7. **Botão de fechar o modal do item fixo no topo** — hoje aparentemente
   rola junto com o conteúdo; quer fixo (sticky) no topo do modal.
8. **Marcar a tag "ebay" em "Listed on" ao publicar** — já existia no dado
   (publishItemToEbayCore já tagueava) e o pill do modal já foi
   sincronizado ao vivo mais cedo nesta sessão (commit
   "Sync 'Listed on' pill UI live..."). Registrado aqui como confirmação —
   aguardando o usuário dizer se ainda vê o problema em algum fluxo
   específico (item único vs. publicação em massa) antes de mexer de novo.

### Decisões tomadas na discussão (2026-08-06, sessão ao vivo)

- **Item 1**: mantém a exigência de categoria eBay escolhida manualmente
  antes de publicar em massa (decisão proposital antiga, evita repetir uma
  leva de listagens com categoria adivinhada errada). Só melhorar a
  clareza da tela pra ficar óbvio quais itens estão prontos vs. quais só
  precisam da categoria escolhida.
- **Item 3**: mesmo padrão visual do preflight de publicação em massa do
  eBay — lista de progresso item a item, sequencial, relatório de
  sucesso/erro no final.
- **Item 4**: se o item ainda não foi salvo nenhuma vez (sem id), gerar a
  descrição por IA deve salvar o item inteiro naquele momento (mesmo save
  completo que o botão Save faria).
- Ordem de implementação: itens 2, 5, 6, 7 (e a versão "só clareza" do
  item 1) primeiro — mecânicos, sem ambiguidade. Itens 3 e 4 depois.

### Status (2026-08-06, sessão ao vivo)

- ✅ Item 7 — botão fechar/voltar ao topo do modal movidos pra fora do
  scroll interno (`.modal-overlay` em vez de `.modal`) — bug clássico de
  iOS Safari com `position:fixed` dentro de contêiner com scroll próprio.
- ✅ Item 2 — texto e botão "Edit" maiores no preflight/relatório de
  publicação em massa (12px/11px → 13-14px, botão com padding maior).
- ✅ Item 1 (lite) — preflight agora deixa explícito quantos vão publicar
  agora vs. quantos não vão nesta rodada (e por quê), sem mudar a regra de
  exigir categoria eBay manual.
- ✅ Itens 5+6 — `openModal()` agora repopula o painel de descrição a
  partir do `item.listingDescription` salvo (em vez de sempre limpar), e
  ganhou um modo `{ keepScroll: true }` usado só no reabrir pós-save, pra
  não jogar o scroll de volta pro topo.
- ✅ Botão de voltar ao topo da página inteira (pedido à parte, mesma
  sessão) — mesmo padrão do botão do modal, mas rolando o documento.
- ⏳ Item 3 (edição em massa de descrição via IA) — ainda não iniciado.
- ⏳ Item 4 (autosave ao gerar descrição) — ainda não iniciado.
- ❓ Item 8 (tag "ebay" em Listed on) — aguardando o usuário confirmar se
  ainda vê o problema em algum fluxo específico, já que a base disso foi
  implementada mais cedo nesta mesma sessão.

## Bugs found (not fixed) — none

No behavioral bugs turned up while reading through this code tonight. The
one item that looked like a UI bug (eBay pill not live-updating) was your
direct request, so I fixed it rather than just noting it — see above.

