"""Finds figures in a Coach reply that are not in the data it was given. Pure functions, no model and no network.
Used live (to log suspicious replies) and by the model tests in agent/evals."""
from __future__ import annotations

import re

NUM = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s*(?:kg|%|reps?)\b)?", re.I)
DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")


def _val(text: str) -> float:
    return float(text.replace(",", ""))


def numbers_in(text: str) -> list[float]:
    return [_val(m.group(1)) for m in NUM.finditer(DATE.sub(" ", text))]


def allowed_numbers(tool_texts: list[str], question: str) -> set[float]:
    """Numbers the Coach may state: anything in the tool results or the question, plus simple arithmetic on them
    (a difference, a sum, a percentage change), because explaining a trend needs that."""
    base = sorted({n for t in tool_texts for n in numbers_in(t)})[:300]
    allowed = set(base) | set(numbers_in(question))
    small = [n for n in base if n <= 60][:80]  # reps in a few sets add up ("12 + 11 + 10 = 33 reps")
    for i, a in enumerate(small):
        for j in range(i + 1, len(small)):
            for b in small[j + 1 :]:
                allowed.add(round(a + small[j] + b, 2))
    sums3 = {round(x, 2) for x in allowed if x <= 200}  # reps added up, times a load: 110 kg x 33 reps = 3,630 kg
    for a in base:
        for s in sums3:
            allowed.add(round(a * s, 1))
    for i, a in enumerate(base):
        for b in base[i + 1 :]:
            allowed.add(round(abs(a - b), 2))
            allowed.add(round(a + b, 2))
            for x, y in ((a, b), (b, a)):
                if y:
                    allowed.add(float(round(abs(x - y) / y * 100)))
    return allowed


def ungrounded(answer: str, tool_texts: list[str], question: str) -> list[str]:
    """Figures in the answer that are not in the data. Only numbers that carry weight are checked: ones with kg, % or reps,
    decimals, and anything of 32 or more (small counts, days and dates are ignored)."""
    allowed = allowed_numbers(tool_texts, question)
    bad = []
    for m in NUM.finditer(DATE.sub(" ", answer)):
        raw, unit = m.group(1), (m.group(2) or "").strip().lower()
        v = _val(raw)
        if not (unit or "." in raw or v >= 32) or (1900 <= v <= 2100 and not unit and "." not in raw):  # small counts and years
            continue
        tol = 1.0 if unit == "%" else 0.06 if "." in raw else 0.5
        if not any(abs(v - a) <= tol for a in allowed):
            bad.append(m.group(0).strip())
    return bad
