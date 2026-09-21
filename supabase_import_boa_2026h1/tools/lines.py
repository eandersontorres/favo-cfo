# -*- coding: utf-8 -*-
"""Extrai um PDF do BoA como linhas reconstruidas por coordenada (y)."""
import fitz, sys

def page_lines(page, ytol=2.5):
    words = page.get_text("words")
    rows = []
    for x0, y0, x1, y1, w, *_ in words:
        for r in rows:
            if abs(r["y"] - y0) <= ytol:
                r["w"].append((x0, w)); break
        else:
            rows.append({"y": y0, "w": [(x0, w)]})
    rows.sort(key=lambda r: r["y"])
    return [" ".join(w for _, w in sorted(r["w"])) for r in rows]

def doc_lines(path):
    doc = fitz.open(path)
    out = []
    for p in doc:
        out.extend(page_lines(p))
    return out

if __name__ == "__main__":
    for l in doc_lines(sys.argv[1]):
        print(l.encode('ascii', 'replace').decode())
