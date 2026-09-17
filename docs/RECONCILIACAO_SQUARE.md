# Conciliação: Favo × Square Sales Summary

Este documento existe porque a receita do Favo **não bate** com o "Net sales"
do dashboard da Square — e não deve bater. Antes de tratar a diferença como
erro, confira contra a tabela abaixo.

Referência: TorresBee, agosto/2026, conta `LGCHF94N728X6`, janela 01–31/08 CT.

## As duas fórmulas

```
Square:  items + service charges − devoluções − descontos
Favo:    items                   − devoluções − descontos
```

A única diferença estrutural é **service charge**.

## A ponte, linha a linha

| Linha | Square | Favo | Δ |
|---|---:|---:|---:|
| Items | 95.958,32 | 96.300,32 | +342,00 |
| Service charges | +3.656,79 | 0 (passthrough) | −3.656,79 |
| Devoluções | −65,00 | −65,00 | 0 |
| Descontos e comps | −2.387,65 | −2.407,65 | −20,00 |
| **Total** | **97.162,46** | **93.827,67** | **−3.334,79** |

## Por que cada diferença existe

### Service charge — $3.656,79, proposital

Service charge não é receita no Favo. A auto-gratuity é obrigatória, a casa
coleta e repassa ao time via folha de pagamento. O lado da despesa sempre
tratou assim: `paystub_tips_*` cai em conta `type='transfer'` e
`true_labor_cost` exclui `tips_charged`. Contar como receita de um lado e
passthrough do outro inflava o resultado sem despesa correspondente.

Onde o dinheiro está: linhas `sq_svc_<data>`, source `square_service_charges`,
conta **Tip Pass-Through**. Fora do P&L pelo filtro de categoria transfer.

Para reconciliar contra o dashboard da Square, some `totals.service_charges`
de volta.

### Resíduo — $322,00 (0,34%), conhecido e não explicado

Composto de **+342,00 de itens** e **−20,00 de desconto**.

O que já foi descartado como causa:

- **Não é pedido faltando.** O Favo varre 1.733 pedidos (1.643 COMPLETED +
  90 OPEN pagos); o Square reporta 1.644.
- **Não é dia faltando.** As segundas zeradas são fechamento normal da casa.
- **Não é borda de mês.** A hipótese era o Square agrupar por data do
  pagamento e a API por data do pedido. Medido contra `pos_payments`: só 4
  pedidos cruzam o limite jul/ago/set, somando $115,30, e **no sentido
  contrário** — deixariam o Square maior, não menor.
- **Não é `gross_sales_money` incompleto.** No pull cru de agosto, nenhuma
  das 6.738 linhas vem sem o campo, e `variation_total_price + modifiers`
  bate com `gross_sales_money` ao centavo.

Nenhuma combinação de estados reproduz os 95.958,32 do Square:

| Conjunto | Items |
|---|---:|
| COMPLETED | 91.725,32 |
| COMPLETED + OPEN pago *(o que o Favo usa)* | 96.300,32 |
| COMPLETED + OPEN | 96.363,32 |
| Todos com tender | 96.603,32 |

Para fechar seria preciso cruzar os 1.733 pedidos um a um contra o relatório
por item do Square Dashboard. Não feito: 0,34%.

## O que JÁ bate ao centavo

Três números independentes conferem exatamente com o Sales Summary, o que dá
confiança no resto:

| | Square | Favo |
|---|---:|---:|
| Service charges | 3.656,79 | 3.656,79 |
| Auto gratuity | 3.389,90 | 3.389,90 |
| Gorjetas | 10.279,61 | 10.279,61 |
| Devoluções | 65,00 | 65,00 |
| Taxa de processamento | 2.250,59 | 2.250,59 |

## Armadilhas que já custaram caro

- **`sc.amount_money` é nulo em service charge percentual.** A referência da
  Square chama o campo de "the amount of a non-percentage-based service
  charge". Auto-gratuity é percentual. Ler só esse campo contabilizava $21,80
  de $3.656,79. Use `applied_money`.
- **`total_money` NÃO desconta devolução.** É "the total amount of money to
  collect" — o lado da venda. O líquido está em `net_amounts`. Subtraia
  `gross_return_money` explicitamente.
- **`state=COMPLETED` não é "virou venda".** O Square Online nunca fecha o
  pedido: fica `OPEN` com fulfillment `PREPARED` para sempre, mesmo pago e
  entregue. Filtrar por COMPLETED escondia o canal inteiro. A regra é ter
  tender — `sqIsSale()` no Kitchen, as duas passadas de busca aqui.
- **Junho/2026 para trás está fechado** (`r7_ledger_locks.closed_through =
  2026-06-30`, DRE do contador via `pl_import`). O trigger
  `trg_block_closed_period` é BEFORE INSERT e descarta a linha **em
  silêncio**: o sync responde 200 com `rows_written` preenchido e não grava
  nada.
