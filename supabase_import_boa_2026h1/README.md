# Importação BoA — jan a jun/2026

Substitui os 157 resumos mensais (`source='pl_import'`) de 2026 H1 por **1.819
transações reais** extraídas dos extratos PDF do Bank of America.

Antes disto, o razão do TorresBee tinha duas bases incompatíveis: resumo mensal
até jun/26 e extrato granular do Plaid a partir de jul/26. O Cash Flow não
funcionava antes de julho, e a P&L de 2026 H1 não era auditável linha a linha.

## O que entra

| Origem | Contas | Linhas |
|---|---|---|
| `eStmt_*.pdf` | 6577 Main · 6551 Payroll · 6909 Sales Tax · 6564 Savings | 846 |
| `*_Statement_*.pdf` | faturas CORP 7042 e 3935 | 1.162 |

Filtrado para `2026-01-01 .. 2026-06-30` → **1.819 linhas**. As 189 restantes
caem fora da janela porque os ciclos de fatura fecham nos dias 7 e 14.

## Cartão de portador não é conta

A fatura do BoA é organizada por portador. Os cartões **0319, 5982, 8349 e
9489** são portadores da fatura **7042**; o **5634** é portador da **3935**.
Não são dívidas separadas — são a mesma dívida vista por cartão.

Por isso toda transação de portador é lançada na **conta de fatura**, com o
portador guardado em `notes`. O CFO hoje trata os cinco como contas próprias em
`r7_ledger_bank_accounts`, o que infla a dívida de cartão; isso é um conserto
separado, que depende dos extratos de jul–set.

## Convenções (as mesmas de `api/plaid-sync.js`)

- **Sinal**: positivo = dinheiro entrando. No cartão isso inverte o sinal da
  fatura — compra vira negativa (dívida sobe), pagamento vira positivo.
- **Transferência entre contas próprias** leva `source='internal_transfer'` nas
  **duas** pernas. É o que impede a fatura paga de virar despesa por cima das
  compras que já são despesa. São 173 linhas.
- **`source='boa_statement'`** no resto. Não é `plaid`: não veio de lá, e
  distinguir permite refazer só esta importação depois.
- **Descrição limpa**: o descritor ACH do BoA carrega quatro campos de rastreio
  (`DES:`, `ID:`, `INDN:`, `CCD`) que ocupam 3/4 da linha e não dizem nada.
  `SHIFT4 DES:PYMT PROC ID:0688... INDN:TORRESBEE CO ID:1731... CCD` vira
  `SHIFT4 PYMT PROC`. O que sumiu é recuperável no PDF por data + valor.
- **`id` determinístico**: `bstmt_<conta>_<AAAAMMDD>_<md5 de data|descrição|valor>`.
  Rodar a importação duas vezes não duplica nada.

## A prova de que está certo

Cada extrato foi validado contra os totais impressos nele próprio (total por
seção **e** a identidade saldo inicial + créditos + débitos + cheques + tarifas
= saldo final). 24/24 extratos e 13/13 faturas passaram.

E o conjunto reproduz o saldo de fechamento partindo do de abertura:

| Conta | Abertura 01/jan | Movimento | Fechamento calculado | Extrato 30/jun |
|---|---:|---:|---:|---:|
| 6577 Main | 3.502,66 | 12.142,59 | 15.645,25 | 15.645,25 |
| 6551 Payroll | 550,36 | −128,09 | 422,27 | 422,27 |
| 6909 Sales Tax | 500,30 | −417,06 | 83,24 | 83,24 |
| 6564 Savings | 75,46 | −72,80 | 2,66 | 2,66 |

Na casa do centavo, nas quatro contas.

## Como rodar

Migração é manual neste projeto — um merge não roda SQL.

1. **`load_tudo.sql`** no SQL editor do Supabase (ou `01_load.sql` .. `08_load.sql`
   em ordem, se preferir em pedaços). É idempotente.
2. Conferir: as quatro contas de caixa têm que fechar na tabela acima.
3. Só então apagar os resumos: as linhas `source='pl_import'` de jan–jun.
   Backup já feito em **`r7_ledger_txns_backup_plimport_2026h1`**
   (157 linhas, soma +5.151,39).
4. Categorizar. Nada entra categorizado de propósito — ver abaixo.

## Por que nada vem categorizado

O modelo de negócio mudou no meio do ano. Em 2026 H1 a maquininha era a
**SHIFT4** (a Square só aparece em junho), e os depósitos de DoorDash / Uber /
Grubhub eram **receita**, não repasse — não existe bruto da Square lançado antes
de jul/26 para eles liquidarem.

Herdar a categorização de jul–set jogaria esses depósitos em
`Marketplace Settlement` (tipo `transfer`, fora da P&L) e **apagaria a receita
de entrega do primeiro semestre**. Por isso a categorização de entradas é feita
com regras próprias de 2026 H1, e a de saídas herda o histórico de jul–set, onde
fornecedor → categoria é estável.

## Reproduzir do zero

`tools/` tem os quatro scripts, nesta ordem:

```bash
python tools/extract_cash.py   # eStmt -> cash_txns.json  (valida 24 extratos)
python tools/extract_card.py   # faturas -> card_txns.json (valida 13 faturas)
python tools/build_rows.py     # junta, confere saldo, gera o SQL
```

Precisam de `pymupdf` e dos PDFs em `statement/` (fora do git — são extratos
bancários).
