-- ─────────────────────────────────────────────────────────────────────────────
-- Mapa categoria do Kitchen → conta do CFO
-- ─────────────────────────────────────────────────────────────────────────────
-- Uma nota do Restaurant Depot traz comida e produto de limpeza na mesma linha
-- do banco. Hoje toda compra vinda do Kitchen cai numa categoria só: desde
-- jul/2026 são 88 transações, US$ 27.221, tudo em "Food & Beverage" / COGS --
-- inclusive limpeza, uniforme e despesa de carro.
--
-- A divisão já existe: cada item em r7_purchases.items carrega _mappedItemId →
-- r7_items.catId → r7_categories. 42% das notas desde julho são mistas.
--
-- Esta migration cria só o MAPA. Nada o consome ainda -- é aditiva e inerte:
-- 3 contas novas no plano e uma tabela de-para. O rateio que gera os filhos de
-- split entra depois, no fluxo de match da fatura.
--
-- BASE DO RATEIO (para quem for implementar o próximo passo): use
-- `qty * _landedUnitCost`, NÃO `extendedPrice`. O extendedPrice tem nulos e em
-- vários itens traz o preço unitário em vez do estendido -- num Restaurant
-- Depot de US$ 215,59 a soma dava US$ 95,84. Já o landed cost embute imposto e
-- frete rateados pelo Kitchen: testado nas últimas 120 notas, 120 fecham no
-- total da nota com erro máximo de 1 centavo. Isso importa porque o modal de
-- split do CFO exige que os filhos somem exatamente o pai.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Contas novas ─────────────────────────────────────────────────────────
-- Beverage sai de dentro de Food & Beverage: continua em COGS (o total do P&L
-- não muda), mas food cost e beverage cost viram KPIs separados -- margens
-- muito diferentes, media junta não diz nada.
--
-- Cleaning Supplies não podia ir para "Cleaning Services": aquilo é serviço
-- contratado em Other Expenses; isto é material comprado, tax_line Supplies.
--
-- Packaging separado porque embalagem cresce com o volume de marketplace, e
-- custo por pedido de delivery é ilegível se ela estiver diluída em Supplies.
insert into r7_ledger_accounts (tenant_id, name, type, tax_line, color)
select '5dc58fa8-0a0a-4d24-8906-e32755e36e93'::uuid, v.name, 'expense', v.tax_line, v.color
from (values
  ('Beverage',         'COGS',     '#A594E8'),
  ('Cleaning Supplies','Supplies', '#4E9FB4'),
  ('Packaging',        'Supplies', '#E8A93C')
) as v(name, tax_line, color)
where not exists (
  select 1 from r7_ledger_accounts a
  where a.tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'::uuid
    and a.name = v.name
);

-- ── 2. Tabela de-para ───────────────────────────────────────────────────────
-- Chaveada pelo ID da categoria do Kitchen, não pelo nome: os nomes têm espaço
-- sobrando ("Beer ") e são editáveis pelo operador no Kitchen.
create table if not exists r7_ledger_kitchen_category_map (
  tenant_id           uuid not null,
  kitchen_category_id text not null,
  ledger_account_id   uuid not null references r7_ledger_accounts(id) on delete cascade,
  created_at          timestamptz not null default now(),
  primary key (tenant_id, kitchen_category_id)
);

create index if not exists idx_kcm_tenant on r7_ledger_kitchen_category_map(tenant_id);

alter table r7_ledger_kitchen_category_map enable row level security;

-- Tabela exclusiva do CFO -- mesmo portão de owner/admin das demais.
drop policy if exists r7_kcm_admin_rw on r7_ledger_kitchen_category_map;
create policy r7_kcm_admin_rw on r7_ledger_kitchen_category_map
  for all to authenticated
  using      (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin())
  with check (tenant_id::text in (select r7_get_my_cfo_tenant_ids()) or r7_is_super_admin());

-- ── 3. Seed do TorresBee ────────────────────────────────────────────────────
-- 22 das 23 categorias do Kitchen. Resolve a conta por NOME em vez de UUID
-- fixo para a migration ser re-executável e não depender de ids gerados acima.
--
-- "Meals & Entertainment" fica DE FORA de propósito: não existe conta
-- equivalente no plano ("Entertainment - Music" é música ao vivo, não refeição)
-- e um mapeamento errado é pior que nenhum -- sem mapa o valor cai no filho
-- "Uncategorized", que é visível e cobra decisão. Tem 0 itens hoje.
insert into r7_ledger_kitchen_category_map (tenant_id, kitchen_category_id, ledger_account_id)
select '5dc58fa8-0a0a-4d24-8906-e32755e36e93'::uuid, m.kcat, a.id
from (values
  -- COGS · comida
  ('1774499785868', 'Food & Beverage'),    -- Walk in
  ('1774499785871', 'Food & Beverage'),    -- Grocery and Dry Goods
  ('1774965555238', 'Food & Beverage'),    -- Frozen
  ('1774965555243', 'Food & Beverage'),    -- Catering items
  -- COGS · bebida
  ('1774499785874', 'Beverage'),           -- NA Beverages
  ('1774499785878', 'Beverage'),           -- Liquor
  ('1774499785883', 'Beverage'),           -- Beer  (nome tem espaço no fim)
  ('1774499785881', 'Beverage'),           -- Wine
  -- Supplies
  ('1774499785864', 'Restaurant Supplies'),-- Restaurant Supplies
  ('1774965555226', 'Restaurant Supplies'),-- Kitchen Supplies
  ('1774965555242', 'Restaurant Supplies'),-- Tableware
  ('1774965555245', 'Restaurant Supplies'),-- Event Supply
  ('1774965555222', 'Restaurant Supplies'),-- Decoration / Decor
  ('1774499785870', 'Cleaning Supplies'),  -- Cleaning Supplies
  ('1774965555239', 'Packaging'),          -- Embalagens Personalizadas
  ('1774965555244', 'Packaging'),          -- Shipping items
  -- Demais linhas
  ('1774499785865', 'Office & Supplies'),  -- Office Supplies
  ('1774499785867', 'Repairs & Maint.'),   -- Repairs and Maintenance
  ('1774965555246', 'Uniform'),            -- Uniformes
  ('1774965555241', 'Uniform'),            -- Employe items
  ('1774965555236', 'Marketing'),          -- Advertising / Marketing
  -- Mapeamento mais fraco do conjunto: "Auto Expenses" pode ser combustível ou
  -- peça. Fuel e "Car Kia" caem na MESMA tax_line (Car and Truck Expenses),
  -- então o P&L fica certo dos dois jeitos. US$ 93 desde julho.
  ('1774965555231', 'Fuel')                -- Auto Expenses
) as m(kcat, conta)
join r7_ledger_accounts a
  on a.tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'::uuid
 and a.name = m.conta
 and a.type = 'expense'
on conflict (tenant_id, kitchen_category_id) do update
  set ledger_account_id = excluded.ledger_account_id;
