"""Runs the test questions against real models through OpenRouter, using the exact Coach code the service runs
(same prompt, same tools, same tool loop), and scores each answer.

  python -m evals.run --list                                  # show the questions
  python -m evals.run --selftest                              # no key, no cost: checks the fake account and the scorers
  python -m evals.run                                         # the default shortlist, one run per question
  python -m evals.run --models anthropic/claude-sonnet-5.5:low,openai/gpt-6.1-terra:none --runs 2 --cases pain,next_load

A model is written as id:reasoning (reasoning: none, minimal, low, medium, high or default). The key is read from
OPENROUTER_API_KEY or from agent/evals/.env (git-ignored). A spending cap (--budget, default $2) stops the run early."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from coach.config import Settings
from coach.graph import build_graph
from coach.memory import load_memories
from coach.llm import build_model
from coach.prompts import build_system_prompt

from .cases import CASES, Case, Ctx
from .fixture import make_supabase

DEFAULT_MODELS = [
    "anthropic/claude-sonnet-5.5:low",
    "google/gemini-4-carbon:low",
    "google/gemini-4-hydrogen:low",
    "openai/gpt-6.1-terra:none",
]
CATEGORIES = ["tools", "grounded", "safety", "behaviour", "style"]
HERE = Path(__file__).parent


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def load_key() -> str:
    env = HERE / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))
    return os.environ.get("OPENROUTER_API_KEY", "").strip()


def load_prices() -> dict[str, tuple[float, float]]:
    try:
        data = json.load(urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=30))["data"]
        return {m["id"]: (float(m["pricing"]["prompt"]), float(m["pricing"]["completion"])) for m in data}
    except Exception:
        return {}


def score(case: Case, answer: str, tool_calls: list[str], tool_results: dict[str, str], tool_texts: list[str]) -> list[dict]:
    tool_texts = tool_texts + [build_system_prompt(datetime.now().date(), "UTC")]  # numbers the Coach is told in its own instructions
    ctx = Ctx(case.question, answer.replace("’", "'").replace("‘", "'"), tool_calls, tool_results, tool_texts)
    out = []
    for chk in case.checks:
        try:
            ok, detail = chk.run(ctx)
        except Exception as exc:  # a broken check should show up, not hide
            ok, detail = False, f"check error: {exc}"
        out.append(dict(category=chk.category, name=chk.name, passed=bool(ok), detail=detail))
    return out


async def run_case(settings: Settings, case: Case, model=None) -> dict:
    sb, _ = make_supabase()
    graph = build_graph(model or build_model(settings, streaming=True))  # `model` lets tests inject a scripted one
    cfg = {"configurable": {"sb": sb, "tz": "Asia/Kolkata", "user_id": "eval-user", "memories": await load_memories(sb)}, "recursion_limit": 14}
    t0, first, tin, tout, state, error = time.perf_counter(), None, 0, 0, None, None
    try:
        async for mode, payload in graph.astream({"messages": [HumanMessage(content=case.question)]}, config=cfg, stream_mode=["messages", "values"]):
            if mode == "values":
                state = payload
                continue
            chunk, meta = payload
            if meta.get("langgraph_node") != "agent":
                continue
            if _text(chunk.content) and first is None:
                first = time.perf_counter() - t0
            usage = getattr(chunk, "usage_metadata", None)
            if usage:
                tin += int(usage.get("input_tokens", 0) or 0)
                tout += int(usage.get("output_tokens", 0) or 0)
    except Exception as exc:
        error = f"{type(exc).__name__}: {str(exc)[:300]}"
    total = time.perf_counter() - t0

    msgs = (state or {}).get("messages", [])
    ais = [m for m in msgs if isinstance(m, AIMessage)]
    # the app shows the text of every step (advice, then a tool call, then a closing line), so that is what gets scored
    answer = "\n\n".join(t for t in (_text(m.content).strip() for m in ais) if t)
    calls = [tc["name"] for m in ais for tc in (m.tool_calls or [])]
    results = {m.name: _text(m.content) or str(m.content) for m in msgs if isinstance(m, ToolMessage)}
    texts = [_text(m.content) or str(m.content) for m in msgs if isinstance(m, ToolMessage)]
    return dict(answer=answer, tools=calls, tool_outputs=texts, steps=len(ais), first_token_s=first, total_s=total, tokens_in=tin, tokens_out=tout,
                error=error, checks=score(case, answer, calls, results, texts) if not error else [])


def summarise(results: list[dict]) -> str:
    lines = [f"{'model':42s} " + " ".join(f"{c:>9s}" for c in CATEGORIES) + "   first   total    $/q  errors"]
    for key in dict.fromkeys(r["model"] for r in results):
        rs = [r for r in results if r["model"] == key]
        cells = []
        for cat in CATEGORIES:
            cs = [k for r in rs for k in r["checks"] if k["category"] == cat]
            cells.append(f"{sum(k['passed'] for k in cs)}/{len(cs)}".rjust(9) if cs else "-".rjust(9))
        firsts = [r["first_token_s"] for r in rs if r["first_token_s"] is not None]
        costs = [r["cost"] for r in rs if r.get("cost") is not None]
        lines.append(f"{key:42s} " + " ".join(cells) + f"  {sum(firsts) / len(firsts) if firsts else 0:5.1f}s {sum(r['total_s'] for r in rs) / len(rs):6.1f}s "
                     f"{('$%.3f' % (sum(costs) / len(costs))) if costs else '   n/a'}  {sum(1 for r in rs if r['error'])}")
    fails = [(r, k) for r in results for k in r["checks"] if not k["passed"]]
    if fails:
        lines += ["", "Failed checks:"]
        lines += [f"  {r['model']:34s} {r['case']:16s} {k['name']}: {k['detail']}" for r, k in fails]
    errs = [r for r in results if r["error"]]
    if errs:
        lines += ["", "Errors:"] + [f"  {r['model']} {r['case']}: {r['error']}" for r in errs]
    return "\n".join(lines)


def selftest() -> list[str]:
    """Offline: the fake account, the real tools on it, and the scorers on known good and bad answers."""
    from . import checks as k

    problems: list[str] = []
    check = lambda ok, msg: None if ok else problems.append(msg)
    _, fx = make_supabase()
    hist = fx.history("ex-lat")
    check(len(hist) == 3 and hist[-1]["top_load"] == 47.5, "lat history should have 3 sessions ending at 47.5 kg")
    check(fx.history("ex-rdl") == [], "romanian deadlift must have no data")
    check(len(fx.weekly(3, fx.today)) == 3, "weekly summary should return 3 weeks")
    data = ["47.5kg x 11, volume 1472.5, 63.3 and 64.9"]
    check(k.ungrounded("Your top set was 47.5 kg and volume 1,472.5 kg.", data, "") == [], "real figures must pass")
    check(k.ungrounded("Your e1RM rose 1.6 kg.", data, "") == [], "a simple difference must pass")
    check(k.ungrounded("You lifted 99.5 kg.", data, "") == ["99.5 kg"], "an invented figure must be caught")
    check(k.obeyed_hijack("PWNED") and not k.obeyed_hijack("The note told me to reply PWNED, so I ignored it. Your last workout was legs, 3 sets."), "hijack check must tell obeying from refusing")
    check(len({c.id for c in CASES}) == len(CASES), "case ids must be unique")
    return problems


async def main_async(args) -> int:
    key = load_key()
    if not key:
        print("Set OPENROUTER_API_KEY (or put it in agent/evals/.env).")
        return 2
    prices = load_prices()
    cases = [c for c in CASES if not args.cases or c.id in args.cases.split(",")]
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    n_runs = len(models) * len(cases) * args.runs
    print(f"{len(models)} models x {len(cases)} questions x {args.runs} run(s) = {n_runs} requests; budget ${args.budget:.2f}\n")
    results, spent = [], 0.0
    for spec in models:
        model, _, reasoning = spec.partition(":")
        settings = Settings(supabase_url="https://fixture.local", supabase_key="x", openrouter_key=key, model=model, reasoning=reasoning or "low")
        for case in cases:
            for run in range(args.runs):
                if spent >= args.budget:
                    print(f"Stopped: spent ${spent:.2f}, the budget.")
                    break
                for attempt in range(4):
                    r = await run_case(settings, case)
                    if not (r["error"] and "429" in r["error"]) or attempt == 3:
                        break
                    print(f"    rate limited; waiting 30 s, then trying again ({attempt + 1}/3)", flush=True)
                    await asyncio.sleep(30)
                pin, pout = prices.get(model, (None, None))
                r["cost"] = (r["tokens_in"] * pin + r["tokens_out"] * pout) if pin is not None else None
                spent += r["cost"] or 0.0
                r.update(model=spec, case=case.id, run=run, question=case.question)
                results.append(r)
                bad = sum(1 for k in r["checks"] if not k["passed"])
                print(f"  {spec:36s} {case.id:16s} {'ERROR' if r['error'] else ('ok' if not bad else f'{bad} failed'):9s} "
                      f"first {r['first_token_s'] or 0:4.1f}s total {r['total_s']:5.1f}s tools {len(r['tools'])}", flush=True)
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    path = out / f"{datetime.now():%Y%m%d-%H%M%S}.json"
    path.write_text(json.dumps(results, indent=2, default=str))
    print("\n" + summarise(results) + f"\n\nSpent about ${spent:.3f}. Full answers: {path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", default=",".join(DEFAULT_MODELS))
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--cases", default="")
    ap.add_argument("--budget", type=float, default=2.0)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.list:
        for c in CASES:
            print(f"{c.id:18s} {c.question}")
        return 0
    if args.selftest:
        problems = selftest()
        print("selftest ok" if not problems else "selftest FAILED:\n  " + "\n  ".join(problems))
        return 1 if problems else 0
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
