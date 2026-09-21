# -*- coding: utf-8 -*-
"""Extrai as transacoes das faturas de cartao BoA (7042 e 3935).

A fatura e organizada POR PORTADOR: cada cartao (0319, 5982, 8349, 9489, 5634)
tem seu proprio bloco de transacoes dentro da conta de fatura. Os cartoes de
portador nao sao contas separadas — sao views da mesma divida. Por isso tudo
aqui e lancado na CONTA DE FATURA, com o portador guardado na descricao.

Mesma regra do extrato de conta corrente: nada sai daqui sem bater com os
totais impressos na propria fatura.
"""
import io, os, re, sys, json, glob
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lines import doc_lines

STMT_DIR = r"C:\Dev\Clariva\favo-cfo\statement"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "card_txns.json")

MONTHS = {m: i + 1 for i, m in enumerate(
    "January February March April May June July August September October November December".split())}

SEC_START = {
    "Payments and Other Credits": "pay",
    "Purchases and Other Charges": "buy",
    "Finance Charge": "int",
    "Fees Charged": "fee",
}
TOTAL = re.compile(r'^TOTAL (PAYMENTS AND OTHER CREDITS|PURCHASES AND OTHER CHARGES|'
                   r'FINANCE CHARGE|FEES CHARGED) FOR THIS PERIOD\s+(-?\$-?[\d,]+\.\d{2})$', re.I)
TOTAL_KEY = {"PAYMENTS AND OTHER CREDITS": "pay", "PURCHASES AND OTHER CHARGES": "buy",
             "FINANCE CHARGE": "int", "FEES CHARGED": "fee"}
# MM/DD  MM/DD  descricao  [ref]  [- ]valor
TXN = re.compile(r'^(\d{2}/\d{2})\s+(\d{2}/\d{2})\s+(.+?)\s+(-\s?)?([\d,]+\.\d{2})$')
CARDHOLDER = re.compile(r'^Account Number:\s*(\d{4})$')


def money(s):
    return float(s.replace('$', '').replace(',', '').replace(' ', ''))


def parse_period(lines):
    for l in lines[:80]:
        m = re.search(r'(\w+) (\d{1,2}), (\d{4}) - (\w+) (\d{1,2}), (\d{4})', l)
        if m and m.group(1) in MONTHS:
            a = date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
            b = date(int(m.group(6)), MONTHS[m.group(4)], int(m.group(5)))
            return a, b
    return None, None


def resolve(mmdd, start, end):
    """A fatura imprime MM/DD sem ano. O ano e o que cai dentro do ciclo."""
    mm, dd = (int(x) for x in mmdd.split("/"))
    for y in (start.year, end.year):
        try:
            d = date(y, mm, dd)
        except ValueError:
            continue
        if start <= d <= end:
            return d
    return None


def parse_file(path):
    lines = doc_lines(path)
    start, end = parse_period(lines)
    bill = None
    for l in lines[:80]:
        m = re.search(r'Account Number:\s*([\d ]{4,})', l)
        if m:
            bill = m.group(1).strip().replace(" ", "")[-4:]
            break

    # O resumo da pagina 1 vive numa coluna a direita; a reconstrucao por
    # coordenada junta as tres colunas na mesma linha, entao o rotulo nao fica
    # no inicio da linha. Procuramos em qualquer posicao.
    summary = {"bt": 0.0, "ca": 0.0}
    for l in lines[:80]:
        for lbl, key in [("Previous Balance", "prev"), ("Payments and Other Credits", "pay"),
                         ("Balance Transfer Activity", "bt"), ("Cash Advance Activity", "ca"),
                         ("Purchases and Other Charges", "buy"), ("Fees Charged", "fee"),
                         ("Finance Charge", "int"), ("New Balance Total", "new")]:
            if key in summary and key not in ("bt", "ca"):
                continue
            m = re.search(re.escape(lbl) + r'[ .]*(-?\$-?[\d,]+\.\d{2})', l)
            if m:
                summary[key] = money(m.group(1))

    txns, problems = [], []
    sec, holder, unresolved = None, bill, 0
    sub_totals = {}

    for l in lines:
        l = l.strip()
        if not l:
            continue
        m = CARDHOLDER.match(l)
        if m:
            holder, sec = m.group(1), None
            continue
        if l in SEC_START:
            sec = SEC_START[l]
            continue
        m = TOTAL.match(l)
        if m:
            key = TOTAL_KEY[m.group(1).upper()]
            sub_totals[key] = round(sub_totals.get(key, 0.0) + money(m.group(2)), 2)
            sec = None
            continue
        if sec is None:
            continue
        m = TXN.match(l)
        if not m:
            continue
        post, tran, desc, neg, amt = m.groups()
        d = resolve(post, start, end)
        if d is None:
            unresolved += 1
            continue
        value = money(amt) * (-1 if neg else 1)
        txns.append({"sec": sec, "date": d.isoformat(), "card": holder,
                     "desc": re.sub(r'\s+\d{15,}$', '', desc).strip(),
                     "trandate": tran, "amount": value})

    sums = {k: round(sum(t["amount"] for t in txns if t["sec"] == k), 2)
            for k in ("pay", "buy", "int", "fee")}
    if unresolved:
        problems.append("%d linha(s) com data fora do ciclo" % unresolved)
    for k in ("pay", "buy", "int", "fee"):
        want = summary.get(k, 0.0)
        if abs(sums[k] - want) > 0.005:
            problems.append("%s: extraido %.2f, fatura %.2f" % (k, sums[k], want))
        if k in sub_totals and abs(sums[k] - sub_totals[k]) > 0.005:
            problems.append("%s: extraido %.2f, soma dos blocos %.2f" % (k, sums[k], sub_totals[k]))
    prev, new = summary.get("prev"), summary.get("new")
    if prev is None or new is None:
        problems.append("cabecalho sem saldo anterior/novo")
    else:
        moved = sum(sums.values()) + summary.get("bt", 0.0) + summary.get("ca", 0.0)
        if abs(prev + moved - new) > 0.02:
            problems.append("identidade: %.2f + %.2f != %.2f" % (prev, moved, new))

    return {"file": os.path.basename(path), "bill": bill,
            "period": "%s -> %s" % (start, end), "summary": summary,
            "sums": sums, "txns": txns, "problems": problems}


def main():
    results = [parse_file(p) for p in sorted(glob.glob(os.path.join(STMT_DIR, "*_Statement_*.pdf")))]
    bad = [r for r in results if r["problems"]]

    print("%-6s %-26s %5s %12s %12s %9s %8s  %s" %
          ("FATURA", "CICLO", "N", "PAGAMENTOS", "COMPRAS", "JUROS", "TARIFA", "STATUS"))
    for r in sorted(results, key=lambda r: (r["bill"], r["period"])):
        print("%-6s %-26s %5d %12.2f %12.2f %9.2f %8.2f  %s" % (
            r["bill"], r["period"], len(r["txns"]), r["sums"]["pay"], r["sums"]["buy"],
            r["sums"]["int"], r["sums"]["fee"], "ok" if not r["problems"] else "FAIL"))
        for p in r["problems"]:
            print("        ! " + p)

    print("\n%d/%d faturas validadas, %d transacoes" %
          (len(results) - len(bad), len(results), sum(len(r["txns"]) for r in results if not r["problems"])))
    if bad:
        print("NAO gerei o JSON: %d fatura(s) com problema." % len(bad))
        return 1
    json.dump(results, io.open(OUT, "w", encoding="utf-8"), indent=1)
    print("JSON em", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
