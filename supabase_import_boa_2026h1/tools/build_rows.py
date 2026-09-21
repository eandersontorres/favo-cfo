# -*- coding: utf-8 -*-
"""Transforma o extraido dos PDFs em linhas do razao e gera o SQL em pedacos.

Convencoes (as mesmas do api/plaid-sync.js, pra jan-jun nao virar um dialeto):
  - valor positivo = dinheiro entrando na conta. No cartao isso significa
    inverter o sinal da fatura: compra vira negativo (divida sobe), pagamento
    vira positivo (divida cai).
  - transferencia entre contas proprias fica com source='internal_transfer'
    nas DUAS pernas, que e o que impede a fatura paga de virar despesa.
  - cartao de portador (0319, 5982, 8349, 9489, 5634) NAO e conta: tudo vai
    pra conta de fatura (7042 / 3935) com o portador guardado em notes.
"""
import io, os, re, json, hashlib
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
TENANT = "5dc58fa8-0a0a-4d24-8906-e32755e36e93"
START, END = "2026-01-01", "2026-06-30"

ACCOUNT = {   # ultimos 4 -> (account_id, nome em r7_ledger_bank_accounts, tipo)
    "6577": ("plaid_acct_LNRJNdamAohmzAEnzmbrsb6RgwBwrbHJv4mXg", "Main 6577 ••6577", "cash"),
    "6551": ("plaid_acct_DpRYpvNQ1oTJM1OxMJjefrY4V5R56rUXy3VKL", "Payroll 6551 ••6551", "cash"),
    "6909": ("plaid_acct_zbdLbjponATPNX3BNPexFB4oA6O65BIM13db9", "Sales Tax Account 6909 ••6909", "cash"),
    "6564": ("plaid_acct_1XJ1XNezYET6LVKyL64qHBbD9aXaJBIYO8jxx", "Savings 6564 ••6564", "cash"),
    "7042": ("plaid_acct_mNp4NrngJdhRYmv0YRX7FvQJAPMPbvH8Ay31V",
             "CORP Account - Business Adv Unlimited Cash Rewards - 7042 ••7042", "card"),
    "3935": ("plaid_acct_PpRbpD9ZroTMdrnXdM15u5xpM7A735uOd31qE",
             "CORP Account - Business Adv Customized Cash Rewards - 3935 ••3935", "card"),
}
CARDHOLDER_OF = {"0319": "7042", "5982": "7042", "8349": "7042", "9489": "7042", "5634": "3935"}

# Movimento entre contas do proprio tenant. As duas pernas existem no conjunto
# importado, entao elas se anulam por construcao — desde que ambas sejam
# marcadas. Uma perna solta viraria receita ou despesa fantasma.
TRANSFER_RES = [
    re.compile(r'^Online Banking transfer (to|from) (CHK|SAV)', re.I),
    re.compile(r'^Online Banking payment to CRD', re.I),
    re.compile(r'^Online payment from CHK', re.I),
    re.compile(r'^Online Banking Transfer Conf', re.I),
]


# O descritor ACH do BoA carrega quatro campos de rastreio que nao dizem nada
# pro operador e ocupam 3/4 da linha:
#   SHIFT4 DES:PYMT PROC ID:068880022009520 INDN:TORRESBEE CO ID:1731435739 CCD
#   -> SHIFT4 PYMT PROC
# O que some e recuperavel no PDF por data+valor, e notes aponta o arquivo.
NOISE_RES = [
    re.compile(r'\s+PMT INFO:.*$', re.I),
    re.compile(r'\s+INDN:.*$', re.I),
    re.compile(r'\s+CO\s+ID:\S+', re.I),
    re.compile(r'\s+ID:\S+', re.I),
    re.compile(r'\s+(CCD|PPD|WEB|ARC|TEL)\b', re.I),
    re.compile(r'\s+Conf(irmation)?#\s*\S+', re.I),
    re.compile(r'\s+\d{15,}\b'),
    # Descritor de cartao de debito do BoA: "CKCD 5399 XXXXXXXXXXXX3305 XXXX
    # XXXX XXXX 3305" e o numero mascarado repetido duas vezes.
    re.compile(r'\s+CKCD\s+\d+.*$', re.I),
    # Rodape da secao que o layout cola no fim da ultima transacao da pagina.
    re.compile(r'\s+Subtotal for card accou.*$', re.I),
    re.compile(r'\s+Card account\s*#.*$', re.I),
]


def clean(desc):
    desc = re.sub(r'\s+', ' ', desc).strip()
    desc = desc.replace("DES:", "")
    for r in NOISE_RES:
        desc = r.sub('', desc)
    desc = re.sub(r'\s+', ' ', desc).strip(' -;')
    return desc[:120]


def rid(acct, iso, desc, amount, seen):
    h = hashlib.md5(("%s|%s|%.2f" % (iso, desc, amount)).encode("utf-8")).hexdigest()[:8]
    base = "bstmt_%s_%s_%s" % (acct, iso.replace("-", ""), h)
    n = seen[base] = seen.get(base, 0) + 1
    return base if n == 1 else "%s_%d" % (base, n)


def build():
    cash = json.load(io.open(os.path.join(HERE, "cash_txns.json"), encoding="utf-8"))
    card = json.load(io.open(os.path.join(HERE, "card_txns.json"), encoding="utf-8"))
    rows, seen = [], {}

    for st in cash:
        acct = st["acct"]
        for t in st["txns"]:
            mm, dd, yy = t["date"].split("/")
            iso = "20%s-%s-%s" % (yy, mm, dd)
            desc = clean(t["desc"])
            amount = round(t["amount"], 2)          # ja vem com o sinal certo
            src = "internal_transfer" if any(r.match(desc) for r in TRANSFER_RES) else "boa_statement"
            rows.append({"id": rid(acct, iso, desc, amount, seen), "date": iso, "desc": desc,
                         "amount": amount, "acct": acct, "source": src,
                         "notes": "BoA %s %s" % (acct, st["file"])})

    for st in card:
        bill = st["bill"]
        for t in st["txns"]:
            iso = t["date"]
            desc = clean(t["desc"])
            # Fatura: compra positiva, pagamento negativo. No razao e o oposto.
            amount = round(-t["amount"], 2)
            src = "internal_transfer" if any(r.match(desc) for r in TRANSFER_RES) else "boa_statement"
            holder = t["card"]
            note = "BoA cartao %s" % bill
            if holder and holder != bill:
                note += " / portador %s" % holder
            note += " / %s" % st["file"]
            rows.append({"id": rid(bill, iso, desc, amount, seen), "date": iso, "desc": desc,
                         "amount": amount, "acct": bill, "source": src, "notes": note})

    rows = [r for r in rows if START <= r["date"] <= END]
    rows.sort(key=lambda r: (r["date"], r["acct"], r["id"]))
    return rows


def check(rows):
    """O teste que importa: as linhas tem que reproduzir o saldo do extrato."""
    opening = {"6577": 3502.66, "6551": 550.36, "6909": 500.30, "6564": 75.46}
    closing = {"6577": 15645.25, "6551": 422.27, "6909": 83.24, "6564": 2.66}
    ok = True
    print("%-6s %6s %14s %14s %14s  %s" % ("CONTA", "N", "ABERTURA", "MOVIMENTO", "FECHAMENTO", "vs EXTRATO"))
    for acct in ("6577", "6551", "6909", "6564"):
        mv = round(sum(r["amount"] for r in rows if r["acct"] == acct), 2)
        end = round(opening[acct] + mv, 2)
        good = abs(end - closing[acct]) < 0.005
        ok = ok and good
        print("%-6s %6d %14.2f %14.2f %14.2f  %s" % (
            acct, sum(1 for r in rows if r["acct"] == acct), opening[acct], mv, end,
            "ok" if good else "FAIL (extrato %.2f)" % closing[acct]))
    for acct in ("7042", "3935"):
        mv = round(sum(r["amount"] for r in rows if r["acct"] == acct), 2)
        print("%-6s %6d %14s %14.2f %14s  %s" % (
            acct, sum(1 for r in rows if r["acct"] == acct), "-", mv, "-",
            "ciclo nao fecha em 30/jun (esperado)"))
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        print("FAIL: ids duplicados")
        ok = False
    return ok


def sql_lit(s):
    return "'" + s.replace("'", "''") + "'"


def write_sql(rows, chunk=250):
    files = []
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        vals = ",\n".join(
            "(%s,'%s',%s,%.2f,'%s','%s',%s)" % (
                sql_lit(r["id"]), r["date"], sql_lit(r["desc"]), r["amount"],
                r["acct"], r["source"], sql_lit(r["notes"]))
            for r in part)
        sql = (
            "insert into r7_ledger_transactions "
            "(id,tenant_id,date,description,amount,account_id,account,source,notes,reconciled,tags)\n"
            "select v.id, '%s'::uuid, v.d::date, v.descr, v.amt, a.id, a.name, v.src, v.notes, true, '{}'\n"
            "from (values\n%s\n) as v(id,d,descr,amt,acct,src,notes)\n"
            "join r7_ledger_bank_accounts a on a.tenant_id='%s'::uuid and right(a.name,4)=v.acct\n"
            "on conflict (id) do nothing;" % (TENANT, vals, TENANT))
        p = os.path.join(HERE, "load_%02d.sql" % (i // chunk + 1))
        io.open(p, "w", encoding="utf-8", newline="\n").write(sql)
        files.append(p)
    return files


if __name__ == "__main__":
    rows = build()
    print("%d linhas entre %s e %s\n" % (len(rows), START, END))
    ok = check(rows)
    files = write_sql(rows)
    total = sum(os.path.getsize(f) for f in files)
    print("\n%d arquivos SQL, %.0f KB no total" % (len(files), total / 1024.0))
    print("por source:", dict((s, sum(1 for r in rows if r["source"] == s))
                              for s in set(r["source"] for r in rows)))
    if not ok:
        raise SystemExit("NAO carregue: a checagem de saldo falhou")
