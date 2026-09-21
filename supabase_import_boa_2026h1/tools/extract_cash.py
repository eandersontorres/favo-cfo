# -*- coding: utf-8 -*-
"""Extrai as transacoes dos eStmt do BoA (contas correntes/poupanca).

Regra de ouro: nada sai daqui sem bater com o proprio extrato. Cada secao
tem um total impresso e o cabecalho tem a identidade saldo inicial + creditos
+ debitos + cheques + tarifas = saldo final. Se qualquer uma falhar, o arquivo
entra em FAIL e nao e importado.
"""
import io, os, re, sys, json, glob, hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lines import doc_lines

STMT_DIR = r"C:\Dev\Clariva\favo-cfo\statement"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cash_txns.json")

ACCT_NAME = {"6577": "Main 6577", "6551": "Payroll 6551",
             "6909": "Sales Tax Account 6909", "6564": "Savings 6564"}

HEADERS = {
    "Deposits and other credits": "dep",
    "Withdrawals and other debits": "wdr",
    "Checks": "chk",
    "Service fees": "fee",
}
TXN = re.compile(r'^(\d{2}/\d{2}/\d{2})\s+(.+?)\s+(-?[\d,]+\.\d{2})$')
CHECK = re.compile(r'(\d{2}/\d{2}/\d{2})\s+(\d+)\*?\s+(-[\d,]+\.\d{2})')
NOISE = re.compile(
    r'^(Date\s+(Description|Transaction description)\s+Amount|Date\s+Check.*|Page \d+ of \d+|'
    r'TORRESBEE BRAZIL CORP.*|Your (checking|savings) account.*|'
    r'continued on the next page.*|\* There is a gap.*|Total # of checks.*|'
    r'Daily ledger balances|Date Balance.*)$', re.I)


def money(s):
    return float(s.replace('$', '').replace(',', ''))


def parse_summary(lines):
    """Cabecalho: pega os 6 numeros da identidade do extrato."""
    out = {}
    for i, l in enumerate(lines[:40]):
        for lbl, key in [("Beginning balance on", "beg"), ("Deposits and other credits", "dep"),
                         ("Withdrawals and other debits", "wdr"), ("Checks", "chk"),
                         ("Service fees", "fee"), ("Ending balance on", "end")]:
            if key in out or not l.startswith(lbl):
                continue
            # A linha de saldo final carrega texto depois do valor ("?Includes
            # checks paid..."), entao pegamos o PRIMEIRO valor apos o rotulo e
            # nao o ultimo da linha. A data no meio nao casa com o regex de
            # dinheiro porque nao tem centavos.
            m = re.search(r'(-?\$?-?[\d,]+\.\d{2})', l[len(lbl):])
            if m:
                out[key] = money(m.group(1))
    return out


def parse_file(path):
    lines = doc_lines(path)
    acct = "?"
    period = "?"
    for l in lines[:40]:
        m = re.search(r'Account number:\s*([\d ]{4,})', l)
        if m:
            acct = m.group(1).strip().replace(" ", "")[-4:]
        m = re.search(r'for (\w+ \d{1,2}, \d{4}) to (\w+ \d{1,2}, \d{4})', l)
        if m:
            period = m.group(0)

    summary = parse_summary(lines)
    txns = []
    sec = None
    last = None          # ultima transacao da secao corrente, para continuacao
    totals_seen = {}

    for l in lines:
        l = l.strip()
        if not l:
            continue
        base = l[:-len(" - continued")] if l.endswith(" - continued") else l
        if base in HEADERS:
            sec, last = HEADERS[base], None
            continue
        # So o total DA SECAO fecha a secao. A secao de tarifas tem um bloco
        # "Total Overdraft fees" antes das linhas de tarifa; fechar ali perdia
        # as duas transacoes de overdraft.
        closed = False
        for lbl, key in HEADERS.items():
            if l.lower().startswith("total " + lbl.lower()):
                m = re.search(r'(-?\$?-?[\d,]+\.\d{2})\s*$', l)
                if m:
                    totals_seen[key] = money(m.group(1))
                closed = True
        if closed or l.startswith("Daily ledger balances"):
            sec, last = None, None
            continue
        if sec is None or NOISE.match(l):
            continue

        if sec == "chk":
            for d, num, amt in CHECK.findall(l):
                txns.append({"sec": sec, "date": d, "desc": "CHECK " + num, "amount": money(amt)})
            continue

        m = TXN.match(l)
        if m:
            d, desc, amt = m.groups()
            amount = money(amt)
            # Debitos e tarifas vem com sinal no extrato; deposito vem positivo.
            last = {"sec": sec, "date": d, "desc": desc.strip(), "amount": amount}
            txns.append(last)
        elif last is not None and not l[0].isdigit():
            # linha de continuacao da descricao (ID:..., CCD, PMT INFO:...)
            last["desc"] += " " + l

    # ── validacao ────────────────────────────────────────────────────────────
    sums = {}
    for k in ("dep", "wdr", "chk", "fee"):
        sums[k] = round(sum(t["amount"] for t in txns if t["sec"] == k), 2)

    problems = []
    for k in ("dep", "wdr", "chk", "fee"):
        want = summary.get(k, 0.0)
        if abs(sums[k] - want) > 0.005:
            problems.append("%s: extraido %.2f, extrato %.2f" % (k, sums[k], want))
        if k in totals_seen and abs(sums[k] - totals_seen[k]) > 0.005:
            problems.append("%s: extraido %.2f, total da secao %.2f" % (k, sums[k], totals_seen[k]))
    beg, end = summary.get("beg"), summary.get("end")
    if beg is None or end is None:
        problems.append("cabecalho sem saldo inicial/final")
    elif abs(beg + sum(sums.values()) - end) > 0.02:
        problems.append("identidade: %.2f + %.2f != %.2f" % (beg, sum(sums.values()), end))

    return {"file": os.path.basename(path), "acct": acct, "period": period,
            "summary": summary, "sums": sums, "txns": txns, "problems": problems}


def main():
    results = [parse_file(p) for p in sorted(glob.glob(os.path.join(STMT_DIR, "eStmt_*.pdf")))]
    ok = [r for r in results if not r["problems"]]
    bad = [r for r in results if r["problems"]]

    print("%-9s %-6s %-34s %6s %12s %12s %12s %12s  %s" %
          ("ACCT", "N", "PERIODO", "", "DEP", "WDR", "CHK", "FEE", "STATUS"))
    for r in sorted(results, key=lambda r: (r["acct"], r["period"][-13:])):
        print("%-9s %-6d %-34s %6s %12.2f %12.2f %12.2f %12.2f  %s" % (
            ACCT_NAME.get(r["acct"], r["acct"]), len(r["txns"]), r["period"], "",
            r["sums"]["dep"], r["sums"]["wdr"], r["sums"]["chk"], r["sums"]["fee"],
            "ok" if not r["problems"] else "FAIL"))
        for p in r["problems"]:
            print("            ! " + p)

    print("\n%d/%d extratos validados, %d transacoes" %
          (len(ok), len(results), sum(len(r["txns"]) for r in ok)))
    if bad:
        print("NAO gerei o JSON: %d extrato(s) com problema." % len(bad))
        return 1
    json.dump(results, io.open(OUT, "w", encoding="utf-8"), indent=1)
    print("JSON em", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
