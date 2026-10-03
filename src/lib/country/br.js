// ─── BRASIL ──────────────────────────────────────────────────────────────────
//
// Plano de contas gerencial, não fiscal. No Brasil a escrituração e a apuração
// são do contador — o produto não compete com ele. O que este pacote modela é a
// DRE gerencial que o contador NÃO entrega: CMV, custo de mão de obra com
// encargos, comissão de aplicativo e taxa de adquirência separadas, margem por
// canal.
//
// As linhas abaixo são identificadores estáveis (gravadas em
// r7_ledger_accounts.tax_line). Acrescente, nunca renomeie.
//
// As linhas do DRE foram confirmadas contra o fechamento real da ALK
// Lancheteria (mai–jun 2026, planilha do escritório contábil). defaultCategories
// abaixo continua sendo só um esqueleto de partida para um tenant novo — a ALK
// usa o plano de contas do próprio contador, importado junto com o fechamento.

import { UNCATEGORIZED } from "../constants.js";

export const BR = {
  code: "BR",
  label: "Brasil",
  currency: "BRL",
  symbol: "R$",
  locale: "pt-BR",
  decimalSep: ",",
  dateOrder: "DMY",
  hour12: false,
  timezone: "America/Sao_Paulo",
  taxRegimeLabel: "Regime tributário",
  taxRegimes: ["Simples Nacional", "Lucro Presumido", "Lucro Real", "MEI"],

  compactMoney: (k) => "R$ " + k + " mil",

  reportingLineLabel: "Conta do DRE",
  cogsLine: "CMV",
  // No Brasil o custo de pessoal é muito maior que a folha: encargos
  // (INSS, FGTS, rescisões), benefícios (VT, convênio, refeição),
  // adiantamentos e pró-labore. Na ALK o salário puro é 41% do custo real
  // de mão de obra — olhar só ele erra por R$ 68 mil no mês. A composição
  // abaixo reproduz o bloco "4.1 - Pessoal" da DRE do escritório contábil.
  laborLines: [
    "Salários e Ordenados",
    "Encargos Sociais",
    "Benefícios",
    "Pró-labore",
    "Treinamento e Recrutamento",
  ],
  rentLine: "Aluguel",
  reportingLines: {
    incomeLabel: "Receitas",
    expenseLabel: "Custos e Despesas",
    income: [
      "Receita de Vendas",
      "Deduções da Receita",
      "Outras Receitas",
    ],
    expense: [
      "CMV",
      "Embalagens e Descartáveis",
      "Custos de Entrega",
      "Salários e Ordenados",
      "Encargos Sociais",
      "Benefícios",
      "Pró-labore",
      "Treinamento e Recrutamento",
      "Distribuição de Lucros",
      "Serviços de Terceiros",
      "Aluguel",
      "Condomínio e IPTU",
      "Energia Elétrica",
      "Água e Esgoto",
      "Gás",
      "Telefone e Internet",
      "Marketing e Publicidade",
      "Comissões de Aplicativos",
      "Taxas de Cartão",
      "Manutenção e Conservação",
      "Material de Limpeza",
      "Material de Escritório",
      "Uniformes e Utensílios",
      "Software e Sistemas",
      "Despesas com Veículos",
      "Serviços Contábeis",
      "Seguros",
      "Impostos e Taxas",
      "Parcelamentos de Impostos",
      "Depreciação",
      "Investimentos - Ativo Imobilizado",
      "Despesas Financeiras",
      "Outras Despesas",
    ],
  },

  defaultCategories: [
    { id: "1", name: "Insumos e Mercadorias", type: "expense", color: "#f05e5e", taxLine: "CMV" },
    { id: "2", name: "Folha de Pagamento", type: "expense", color: "#f0c84a", taxLine: "Salários e Ordenados" },
    { id: "3", name: "Aluguel e Utilidades", type: "expense", color: "#4a9ff0", taxLine: "Aluguel" },
    { id: "4", name: "Marketing", type: "expense", color: "#a47ff0", taxLine: "Marketing e Publicidade" },
    { id: "5", name: "Equipamentos", type: "expense", color: "#f0904a", taxLine: "Depreciação" },
    { id: "6", name: "Embalagens", type: "expense", color: "#4af0d0", taxLine: "Embalagens e Descartáveis" },
    { id: "7", name: "Taxas de Cartão", type: "expense", color: "#90a0b0", taxLine: "Taxas de Cartão" },
    { id: "11", name: "Comissão iFood/Rappi", type: "expense", color: "#e06090", taxLine: "Comissões de Aplicativos" },
    { id: "8", name: "Receita - Salão", type: "income", color: "#00d4a0", taxLine: "Receita de Vendas" },
    { id: "9", name: "Receita - Delivery", type: "income", color: "#00b890", taxLine: "Receita de Vendas" },
    { id: UNCATEGORIZED, name: "Sem Categoria", type: "expense", color: "#555b6b", taxLine: "" },
  ],

  // Pix primeiro: é o trilho dominante, não uma alternativa.
  paymentMethods: ["Pix", "Boleto", "TED", "Débito Automático", "Cartão de Crédito", "Cartão de Débito", "Dinheiro"],
  defaultPaymentMethod: "Pix",
  // Linha do extrato que diz o trilho mas não o favorecido: só o valor serve
  // de evidência para casar com uma nota.
  anonymousDebitRe: /\bpix\b|\bted\b|\bdoc\b|boleto|transfer[êe]ncia|\bdeb\.?\s*aut/i,

  importedAccountLabel: "Importado",

  // Telas desligadas por ora. Todas dependem de um motor que ainda não existe
  // para o Brasil:
  //   bookkeeper/tax — regras do IRS (1099, Section 179, Schedule C)
  //   payroll/labor/tips — modelo FICA/FUTA/SUTA e turnos do Square
  //   favobank — Unit BaaS, que só opera nos EUA
  capabilities: {
    bookkeeper: false,
    tax: false,
    payroll: false,
    labor: false,
    tips: false,
    favobank: false,
  },
};
