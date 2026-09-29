-- Limpeza pontual: shadows de nota do Kitchen cuja fatura já foi paga pelo banco.
--
-- Sintoma: Food Cost de 34% no Insights de set/2026 do TorresBee. O número
-- real fica entre 16% e 19%.
-- Causa: a mesma nota entrava duas vezes no COGS -- como shadow
-- `kitchen_purchase_<id>` (competência, vinda do Sync Kitchen) e como débito
-- do banco (caixa, vinda do Plaid). O auto-reconcile do Bills apaga o shadow
-- quando o débito casa, mas o Sync Kitchen só deduplicava contra ids presentes
-- no ledger, então a sincronização seguinte recriava o shadow. Além disso os
-- bills criados pela ponte do Kitchen (source = purchase:bridged:<PO>) nunca
-- derrubavam o shadow ao serem pagos, porque o código só olhava
-- source = 'kitchen'.
--
-- O conserto permanente está em src/App.jsx (handleKitchenSync pula compra com
-- bill pago; kitchenShadowIdOf resolve o shadow para os dois fluxos de bill;
-- Pay Bill apaga no banco, não só no estado local). Este arquivo remove o que
-- já estava duplicado antes do conserto.
--
-- Medido antes de aplicar (shadows sem parent_id com bill pago):
--   2026-07   10 linhas   US$  3.633,40
--   2026-08   51 linhas   US$  9.646,33
--   2026-09   17 linhas   US$  3.951,95
--
-- APLICADO EM PRODUÇÃO em 29/09/2026: 78 pais (US$ 17.231,68) + 26 filhos de
-- split levados por cascade. Backup em r7_ledger_txns_backup_kitchen_shadow_dupes
-- (104 linhas); o bloco 4 desfaz. Este arquivo fica para registrar o que foi
-- feito e como reverter.

-- ── 1. Prévia: o que vai sair ───────────────────────────────────────────────
WITH paid_pids AS (
  SELECT DISTINCT pid FROM (
    SELECT replace(id, 'bill_kitchen_purchase_', '') AS pid
      FROM r7_ledger_bills
     WHERE tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'
       AND status = 'paid' AND id LIKE 'bill_kitchen_purchase_%'
    UNION ALL
    SELECT substring(notes FROM 'r7_purchases\.id=([0-9]+)')
      FROM r7_ledger_bills
     WHERE tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'
       AND status = 'paid' AND source LIKE 'purchase:bridged%'
  ) x WHERE pid IS NOT NULL
)
SELECT t.date, t.description, t.amount, t.id
  FROM r7_ledger_transactions t
 WHERE t.tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'
   AND t.source = 'kitchen_purchase'
   AND t.parent_id IS NULL
   AND replace(t.id, 'kitchen_purchase_', '') IN (SELECT pid FROM paid_pids)
 ORDER BY t.date;

-- ── 2. Backup ───────────────────────────────────────────────────────────────
-- Filhos de split entram no backup também: o DELETE do pai os leva por
-- ON DELETE CASCADE, e o desfazer precisa devolver os dois.
CREATE TABLE IF NOT EXISTS r7_ledger_txns_backup_kitchen_shadow_dupes AS
SELECT t.*, now() AS backed_up_at FROM r7_ledger_transactions t WHERE false;

WITH paid_pids AS (
  SELECT DISTINCT pid FROM (
    SELECT replace(id, 'bill_kitchen_purchase_', '') AS pid
      FROM r7_ledger_bills
     WHERE tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'
       AND status = 'paid' AND id LIKE 'bill_kitchen_purchase_%'
    UNION ALL
    SELECT substring(notes FROM 'r7_purchases\.id=([0-9]+)')
      FROM r7_ledger_bills
     WHERE tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'
       AND status = 'paid' AND source LIKE 'purchase:bridged%'
  ) x WHERE pid IS NOT NULL
),
parents AS (
  SELECT t.id
    FROM r7_ledger_transactions t
   WHERE t.tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'
     AND t.source = 'kitchen_purchase'
     AND t.parent_id IS NULL
     AND replace(t.id, 'kitchen_purchase_', '') IN (SELECT pid FROM paid_pids)
)
INSERT INTO r7_ledger_txns_backup_kitchen_shadow_dupes
SELECT t.*, now()
  FROM r7_ledger_transactions t
 WHERE t.tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'
   AND (t.id IN (SELECT id FROM parents) OR t.parent_id IN (SELECT id FROM parents));

-- ── 3. Remoção (só os pais; os filhos caem por cascade) ─────────────────────
DELETE FROM r7_ledger_transactions t
 USING r7_ledger_txns_backup_kitchen_shadow_dupes b
 WHERE t.id = b.id AND t.tenant_id = b.tenant_id AND b.parent_id IS NULL;

-- ── 4. Desfazer (se precisar) ───────────────────────────────────────────────
-- Pais primeiro por causa da FK de parent_id.
-- INSERT INTO r7_ledger_transactions
-- SELECT id, tenant_id, date, description, amount, category_id, account, reconciled, source, notes, created_at, account_id, recurring_id, prior_period, tags, parent_id
--   FROM r7_ledger_txns_backup_kitchen_shadow_dupes WHERE parent_id IS NULL
-- ON CONFLICT (id) DO NOTHING;
-- INSERT INTO r7_ledger_transactions
-- SELECT id, tenant_id, date, description, amount, category_id, account, reconciled, source, notes, created_at, account_id, recurring_id, prior_period, tags, parent_id
--   FROM r7_ledger_txns_backup_kitchen_shadow_dupes WHERE parent_id IS NOT NULL
-- ON CONFLICT (id) DO NOTHING;
-- (lista de colunas conferida contra information_schema em 29/09/2026; o
--  backup tem backed_up_at a mais, por isso o SELECT é explícito.)
