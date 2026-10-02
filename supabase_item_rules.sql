-- ─────────────────────────────────────────────────────────────────────────────
-- Regras de conta por item de nota (lado do CFO)
-- ─────────────────────────────────────────────────────────────────────────────
-- O rateio da nota do Kitchen resolve a conta de cada linha pelo caminho
--   item → r7_items.catId → r7_ledger_kitchen_category_map → conta do ledger.
-- Quando o scanner do Kitchen não mapeia o item para o estoque (uma pimenta
-- avulsa da Walmart, um kit de costura), não há catId e a linha cai num filho
-- "Uncategorized". Em set/2026 foram 7 notas assim no TorresBee.
--
-- Esta tabela é a resposta do CFO para isso, sem escrever no Kitchen: o
-- operador escolhe a conta no painel da transação e a escolha vira uma regra
-- por NOME normalizado do item (caixa alta, espaços colapsados, só letras,
-- dígitos e espaço). A regra entra ANTES do mapa do Kitchen na resolução, e
-- vale para toda nota futura com o mesmo nome -- a decisão é tomada uma vez.
--
-- vendor_key = '' é regra global; preenchido, vale só para aquele fornecedor
-- (mesma normalização do nome). Específica vence a global. Não é nullable de
-- propósito: NULL não participa de PRIMARY KEY e permitiria duplicatas.
--
-- Não é fuzzy. "BLACK PEPPER" e "BLACK PEPPER 16OZ" são regras diferentes;
-- quando não casa, o item volta a Uncategorized e o operador clica de novo.
-- Preferível a uma regra que acerta errado em silêncio.
--
-- O estoque do Kitchen continua sem o item. Esta tabela decide contabilidade,
-- não inventário -- são responsabilidades diferentes.
--
-- Aditiva e inerte: nada quebra se o código rodar antes dela (a leitura falha
-- com log e o rateio segue só pelo mapa do Kitchen, como hoje).
--
-- APLICADO EM PRODUÇÃO em 02/10/2026 via Supabase MCP, em partes: a migration
-- inteira num statement só estourava o timeout de 60s do conector (a FK pede
-- lock em r7_ledger_accounts). Tabela, FK, RLS+policy e índice entraram em
-- chamadas separadas com lock_timeout = 8s. O arquivo abaixo é o estado final.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists r7_ledger_item_rules (
  tenant_id         uuid not null,
  item_key          text not null,
  vendor_key        text not null default '',
  ledger_account_id uuid not null references r7_ledger_accounts(id) on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (tenant_id, item_key, vendor_key)
);

create index if not exists idx_item_rules_tenant on r7_ledger_item_rules(tenant_id);

alter table r7_ledger_item_rules enable row level security;
-- Tabela exclusiva do CFO -- mesmo portão de owner/admin do mapa de categorias.
drop policy if exists r7_item_rules_admin_rw on r7_ledger_item_rules;
create policy r7_item_rules_admin_rw on r7_ledger_item_rules
  for all to authenticated
  using      (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin())
  with check (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());
