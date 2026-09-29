# Favo CFO — Roadmap

Live: [cfo.favo.team](https://cfo.favo.team) · Pilot tenant: TorresBee (Round Rock, TX)

Source of truth for what's next. Grouped **Recently Shipped / Now / Next / Later / Horizon**.

Effort tags: `XS` < 2h · `S` half-day · `M` 1-2 days · `L` 3-5 days · `XL` 1+ week.

---

## RECENTLY SHIPPED

### 2026-08-21 · Ingestão automática dos extratos de aggregator `S`

- **`api/ingest-aggregator-email.js`** — webhook que recebe o e-mail de payout do DoorDash / UberEats / GrubHub / Wix e grava direto em `r7_aggregator_payouts`. Some o passo manual de baixar o PDF e arrastar na tela de Reconciliation. Transport-agnóstico: SendGrid Inbound Parse, Mailgun Routes, Cloudflare Email Worker ou Zapier/Make em cima de um label do Gmail — o contrato é um JSON só. Dedupe por `message_id`.
- **Não lança no razão sozinho.** IA leu documento de dinheiro, então humano confirma: os payouts entram como `source='email_inbox'` e a Reconciliation mostra "N payouts not posted" com botão de postar. "Postado" é derivado (existe `agg_<payout_id>_*` no ledger), sem migração.
- **`api/_aggregator.js`** — extração compartilhada entre o upload manual e o webhook, para os dois lerem extrato do mesmo jeito.
- **Bug corrigido:** `saveAggregatorPayouts` referenciava `payoutKey` fora de escopo — `ReferenceError` engolido por promise sem catch. Efeito: o upload manual salvava os payouts mas **nunca criava as despesas de comissão/marketing**, sem nenhum erro visível. Comissão de delivery estava fora do P&L desde que a tela subiu.
- **Fase 1 da fixture (mesmo dia)** — deixou de ser um hack de um tenant só. `r7_ingest_addresses` dá a cada tenant um `<token>@payouts.favo.team`; o onboarding vira "cola esse endereço no portal do DoorDash como destinatário de notificação", sem infra por restaurante. Transporte é `infra/worker/` (projeto Wrangler, worker favo-payout-ingest) — `favo.team` já é zona Cloudflare com Email Routing ligado, então basta adicionar o subdomínio `payouts` (o apex já roteia e-mail de verdade, catch-all nele engoliria tudo). Como o endereço é semi-público, o portão real é o remetente: allowlist de domínio + rejeição em SPF/DMARC fail. `r7_ingest_events` registra todo e-mail recebido com o desfecho.
- **Não fechado:** DoorDash tem Reporting API (Payout Summary + Transaction Details) aberta a merchant via formulário de acesso — vale pedir e trocar o e-mail por API. Uber Eats exige NDA + partner manager, não compensa para uma loja.

### 2026-07-30 · Country packs (Brasil Fase 0)

- **`src/lib/country/`** — pacote por país com formatação, parsing de extrato, linhas de relatório do plano de contas, meios de pagamento e capacidades. `us.js` é extração pura do que estava hardcoded (mesmos identificadores do Schedule C), então nenhum tenant existente precisou de migração de dados.
- **`country` / `currency` / `locale` / `tax_regime` em `r7_tenants`** — dimensão do ecossistema, lida por todos os módulos Favo, não só o CFO. Aplicada como `country_as_tenant_dimension`.
- **Dois bugs de corrupção silenciosa nos parsers**, que valiam independente do Brasil: `new Date("03/04/2025")` sempre lia March 4, e o cleaner `/[$,\s()]/` virava `1.234,56` em `1.234` (erro de 1000x) e `(123.45)` em positivo.
- **NAV filtrado por capacidade** — 21 telas no US, 15 no BR.
- **Alk Lancheteria** marcada como BR / BRL / pt-BR / Lucro Presumido / America/Sao_Paulo.

### 2026-05-23/24 · Square labor stack + theme parity

- **Square Labor sync** (`r7_labor_shifts`) — hours, wage, fully-loaded cost (+15% employer tax burden, configurable per tenant). Labor screen with hours / wage / loaded cost / labor% KPIs + payroll variance card (projected vs ledger Wages) + by-employee table.
- **Tips** (`r7_labor_tips_daily`) — card tips per employee from Square **Orders** API (not Payments — fixes attribution to the server, not the card processor). Plus **auto-gratuity** captured from `order.service_charges[]`. Opt-in pool day with equal split (card + auto-grat base).
- **Payroll** (`r7_payroll_runs`) — prep + Paychex CSV export. Pulls hours from Square, computes FLSA overtime per ISO week, tips pre-populated from the Tips screen, bonus/tips editable inline. Submit creates a shadow ledger transaction for bank reconciliation. **Bank vs calculated** on every run: Favo estimate (Square hours + burden) · processor number (paystub PDF today, Paychex API when it lands) · Paychex/ADP/Gusto debits nearest the pay date, with Δ, status tag and a burden-rate calibration line. Does NOT move money — Paychex stays the regulated processor.
- **Sync Sales** (`api/sync-square-sales`) — daily gross sales + processing fees from Square Orders as the canonical revenue source. Re-tags bank-side Square deposits to `source='square_settlement'` so they don't double-count. Centralized `NON_REVENUE_SOURCES` / `isRevenueRelevant()` controls every income rollup.
- **Sidebar hierarchy** — Payroll + Tips nested under Labor.
- **Theme + font parity with Favo Purchase** — Day theme uses Purchase's slate surfaces + indigo `#6366F1`; all typography switched to native system fonts (dropped 4 Google web fonts). Dark mode keeps Favo gold.

### 2026-05-13 · Bookkeeper agent + ecosystem bridges hardening

- **Bookkeeper screen** — 8 rules-based IRS Schedule C checks (1099 >$600, duplicate charges, sales-tax gap, Section 179, Meals 50%, docs >$75, stale uncategorized, personal-mix). Compliance score, next-deadline countdown, period-close checklist, per-issue "Fix all" + "Dismiss", `tags[]` column. 1099 contractor table + CSV export on Tax Summary. Post-import $600-threshold toast.
- **Review-first Transactions** — defaults to Uncategorized tab + Categorized tab, inline Kitchen-invoice match button.
- **Bridges fixed** — Marketing (tenant→slug→restaurant), Bookings Forecast (Book reservations + no-show rate).
- **CSV parser** — multi-cardholder BoA format (CardHolder + last-4), credit-card sign flip, dedup on import.
- **Prior-period flag** — accrual basis for P&L / Tax / Dashboard / Insights; cash basis for Cash Flow / balances.
- **Bug hunt round 2 (partial)** — removed broken `fetchKitchenSnapshots` / `fetchKitchenStaff` (selected non-existent columns); Sync Kitchen is purchases-only now, revenue via Sync Sales.

### Earlier

- Multi-account Phase 1 + 2, Recurring Phase 1 + 2, initial bug hunt + branding, NOW activation (migrations, replication, service role key, UNCATEGORIZED fix).

---

## NOW — ongoing dogfood

TorresBee living in the app surfaces the bugs no sweep finds. Flag anything off in the live app; fix inline before piling on features.

**Pending operator actions:**
- Re-sync Tips/Sales/Labor after each deploy to refresh Square data.
- Compare Payroll run vs Paychex stub at period close (15th) to calibrate the 15% employer-burden rate and spot salaried/off-system gaps.
- Apply `supabase_cleanup_kitchen_shadow_dupes.sql` (Kitchen shadows with a paid bill, Jul–Sep 2026, ~$17k) and re-run Sync Kitchen so existing invoices get their line-item split.

---

## NEXT — features that unblock real decisions

### 0. Brasil — Alk Lancheteria · `XL` (multi-fase)

**Piloto:** Alk Lancheteria (`slug: alk`, Lucro Presumido, `America/Sao_Paulo`). Vive hoje no projeto Supabase compartilhado (us-east), com 0 transações.

**Posicionamento — o que NÃO construir.** No Brasil o contador é obrigatório e já faz escrituração e apuração. Reconstruir Bookkeeper/TaxSummary/Folha é gastar meses para entregar o que o cliente já paga R$ 300/mês para ter. O produto BR vende **gestão**: DRE gerencial, CMV, custo de mão de obra, margem por canal. Isso o contador não entrega.

#### Fase 0 — country packs ✅ `feat(i18n)` c434c18

Formatação, parsing de extrato e capacidades por país; `country`/`currency`/`locale`/`tax_regime` em `r7_tenants`. 6 telas US-only somem do NAV quando o pacote não declara a capacidade.

#### Fase 1 — DRE gerencial · `L`

**Bloqueado por:** plano de contas + DRE dos últimos 12 meses + confirmação do regime, tudo vindo do contador do Alk. As 28 contas em `br.js` são esqueleto; enquanto o piloto não lançar transação nelas, mudar os identificadores é barato.

- DRE gerencial substituindo Tax Summary (`capabilities.tax`)
- Semear o plano de contas do Alk **depois** da confirmação, não antes

#### Fase 2 — Agente contador BR · `M`

É a tela `Bookkeeper` com regras brasileiras, não um app novo — quando as regras existirem, `capabilities.bookkeeper: true` no `br.js` e ela reaparece no NAV.

- **Limites são dados versionados, não números no código.** Teto do Simples já subiu de R$ 3,6M para R$ 4,8M e há discussão de subir de novo. Guardar como tabela com `from:` (vigência), nunca sobrescrever a linha antiga — relatório de período fechado tem que ser reprocessável com a regra da época.
- Base de cálculo é **RBT12** (receita bruta dos 12 meses anteriores), não ano-calendário.
- **O alerta que vale é o projetivo,** não o de cruzamento: "no ritmo dos últimos 3 meses, cruza R$ 4,8M em ~5 meses". Quando já cruzou, o contador sabe e o estrago está feito. O run rate já existe na tela de Trends.
- Alerta inverso vale mais que o direto: tenant em Presumido que pagaria menos no Simples é dinheiro encontrado, não risco evitado.
- **Limite de responsabilidade:** o agente sinaliza, o contador decide. Mesmo comportamento do Bookkeeper americano, que aponta e manda consultar um CPA. App que recomenda troca de regime está dando parecer fiscal.

**Pergunta aberta para o contador do Alk:** lanchonete em Lucro Presumido é incomum — a maioria do food service pequeno fica no Simples. Saber *por quê* define o que o agente vigia: escolha deliberada é uma coisa, herança que ninguém revisou é outra.

#### Fase 3 — ingestão · `XL`

Nenhuma integração atual sobrevive: Plaid é `country_codes:["US"]` e não opera aqui, Square saiu do Brasil, Unit é US-only.

- OFX dos bancos BR — o parser já é genérico (`DTPOSTED` é posicional), deve funcionar quase sem mexer
- Pluggy ou Belvo (Open Finance) no lugar do Plaid
- iFood / Rappi no lugar de DoorDash / UberEats
- Stone / Cielo no lugar do Square

#### Fase 4 — folha CLT · `XL`

**Recomendação: integrar, não reimplementar** (Omie, Conta Azul, Contabilizei). O burden de 15% dos EUA vira ~70-80% no Brasil com INSS patronal, FGTS, 13º, férias + 1/3, DSR. Não é parâmetro, é outro modelo.

#### Decisão em aberto — onde os tenants BR vivem

`favo-brasil` (sa-east-1) existe com o schema completo replicado e **zero linhas**. O Alk está no projeto us-east.

| | us-east (atual) | favo-brasil (sa-east-1) |
|---|---|---|
| Switcher de loja | cruza BR e US | não cruza instâncias |
| Deploy do CFO | um só | separado, `VITE_SUPABASE_URL` própria |
| Migrations | uma vez | duas vezes, sempre |
| Residência de dados | via salvaguarda contratual | no Brasil |

**A janela é agora.** Alk tem 0 transações, 0 categorias, 0 contas bancárias — mover custa um `INSERT`. Depois que o piloto importar extrato, custa migração com IDs referenciados em seis tabelas.

> O CFO não vai sozinho: receita vem do POS, CMV vem do Kitchen. O caminho crítico do ecossistema BR é **NFC-e no POS** — obrigação legal, SEFAZ por estado, certificado A1, contingência offline. Semanas de trabalho regulatório, e não dá para entregar 80%. O CFO BR não depende disso e por isso vai primeiro.

### 0.5 Ingest por e-mail — Fases 2 e 3 · `S` cada

- **Fase 2** — UI do endereço: card (provavelmente uma tela **Settings**, que não existe) com o endereço + botão copiar, últimos e-mails recebidos com desfecho lido de `r7_ingest_events`, e botão de rotacionar (revoga o token e emite outro). Sem isso o tenant não tem como saber se o extrato dele foi lido.
- **Fase 2, obrigatório junto com o mint:** o Email Routing do Cloudflare **não tem catch-all por subdomínio** (o form de rota só aceita `a-z 0-9 _ - . +`), então cada endereço precisa da sua rota explícita `<token>@payouts.favo.team → favo-payout-ingest`. Para o TorresBee foi feita à mão no dashboard; quando o mint virar botão, criar a rota via API do Cloudflare (`POST /zones/{zone}/email/routing/rules`) no mesmo fluxo — sem isso o endereço mintado não recebe nada.
- **Fase 3** — plataformas para o country pack. Hoje `PLATFORM_HINTS` + `SENDER_DOMAINS` em `api/_aggregator.js` e o `CHECK` de `r7_aggregator_payouts.platform` fixam DoorDash/Uber/GrubHub/Wix. Vira `aggregators: [{ id, label, senders, hints }]` no pack, e o BR ganha iFood/Rappi sem tocar no endpoint. Enquanto isso, é uma violação declarada da regra de country pack.
- **Reuso previsto:** `r7_ingest_addresses.kind` já existe para o Kitchen fazer o mesmo com nota de fornecedor.

### 1. Multi-tenant + proper Auth · `L`

**Unblocks:** moving from "TorresBee's app" to a sellable SaaS product.

Today the tenant is `VITE_TENANT_ID` env var → one tenant per deploy. Target: Supabase Auth + `clv_tenant_members` + tenant-aware RLS (the pattern POS/Marketing/Book already use). Also fixes the four hardcoded "TorresBee" strings.

**Prerequisite:** dedicated design session — RLS migration from `USING (true)` permissive policies to tenant-aware ones without losing pilot data is fragile. Worth planning before touching.

### 2. Finish Bug hunt round 2 · `S`

- Posting workflow + Reconciliation screen end-to-end against real data.
- Bill payment workflow (Kitchen purchase → bill → payment transaction).
- Per-account reconciliation (the screen is global today).

### 3. Marketing bridge Phase 2 · `S`

**Prerequisite:** Marketing needs a daily `date_preset='today'` cron. Then: daily granularity + per-campaign breakdown + planned-vs-actual variance card.

### 4. Health · `S`

- **Bundle code-splitting** — single chunk now ~540KB, Vite warns every build. Lazy-load screens behind the nav.
- Consolidate migration files into one `supabase_migration.sql` for fresh setups.

---

## LATER — 2-3 months out

### Ecosystem expansion

| Item | Triggers when | Why |
|---|---|---|
| **Bridge Purchase → Bills** | `clariva-purchase` (in `dev`) ships | POs become the source of truth for Bills |
| **Bridge POS → CFO** | `pos.clariva.cloud` ships | Canonical revenue + real avg_ticket for Bookings Forecast |
| **Stack migration: TS + Tailwind** | Before second customer | Aligns with POS/Purchase (now that Day theme + fonts already match) |

### Product features

| Item | Unblocks |
|---|---|
| **Payroll Level 2 — pay 1099 contractors** | Pay musicians directly via ACH (Modern Treasury / Increase) — lower liability than W-2 |
| **Recurring missing alerts (weekly/biweekly)** | Payroll that didn't land on biweekly cadence |
| **Weekly email reports** | "P&L weekly digest" Monday 8AM to owner |
| **Plaid integration** | When manual imports stop scaling |
| **Receipt photo upload** | Photo → AI extract → link to transaction |
| **What-if scenarios** | "cut marketing 20%, what's runway?" |
| **Persist internal transfer pairings** | Detection runs client-side every render today |
| **Sales tax module** | Texas 8.25% — collected vs filed reconciliation (Bookkeeper flags the gap but can't compute liability yet) |

### Tech health

- Real-time stress test (multiple concurrent sessions)
- Virtualize Transactions table (renders everything; fine at 100, bad at 5k)
- Backup + recovery drill
- Error tracking (Sentry?) + product telemetry

---

## HORIZON — 6+ months out

- **AI Assistant** — natural questions ("why did food cost jump last month?")
- **Anomaly detection** — vendor charges outside pattern, category jumps
- **Investor reports** — investor-ready PDF P&L + cash flow + KPIs
- **Tax automation** — Schedule C export, 1099 generation, TurboTax/CPA pipelines
- **ML forecasting** — demand projection beyond recurring rules
- **Cross-tenant benchmarking** — anonymized network medians

---

## Cross-app dependencies

| Waiting on | Blocks here |
|---|---|
| `purchase` shipping | Bridge Purchase → Bills |
| `pos` shipping | Bridge POS → CFO (revenue + avg_ticket) |
| `marketing` daily cron | Marketing bridge Phase 2 |
| `admin` shipping | Centralized multi-tenant management |
| `clv_apps` registry | Auto-discovery of modules from inside CFO |

---

_Last updated: 2026-05-24 · Maintained alongside `CLAUDE.md` (which is now stale — see Bug hunt round 2). Update when scope changes._
