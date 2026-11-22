# Coach roadmap: suggestions, approvals, memory, plan changes

*Plan written 22 November 2026. Nothing here is built yet.*

## Goal

Make the Coach and the Analyst feel like one assistant that remembers you, can be corrected, suggests what to do next, and can change your plan **only when you approve**.

## Principles (apply to every phase)

1. **The model never writes.** It can only *propose*. A proposal is a stored, validated row. Ordinary code applies it after you tap Approve.
2. **What you approve is what runs.** The card shows a diff built from the stored change, not from the model's words. A hijacked model cannot sneak in something else.
3. **Runs as you.** User JWT and row-level security. No new secret key.
4. **Logged data beats memory and beats what you tell it.** Memory is never a source for numbers. If your claim differs from the log, the Coach says so.
5. **Health notes are sensitive.** Nothing is saved silently. Everything saved is visible, editable and deletable.
6. **Every phase ships alone** on its own branch, with tests and eval cases, and any migration is a new numbered file that you apply.
7. **Scope guardrail stays.** Off-topic questions are still refused.

## Do we need LangGraph?

Keep it for running the agents (the tool loop, a supervisor later). Do **not** use its checkpointer or memory store. Reasons: the checkpointer needs a database connection secret and stores data you cannot show or edit, and our messages already live in Supabase. Approvals are stateless (propose, then approve), so no mid-run pause is needed. Revisit if we reach 3 or more agents or need runs that pause for long.

## Phase 1: next-step chips (small, no migration)

- After each reply, a cheap model call (`COACH_SUGGEST_MODEL`, thinking off) sees your question, the reply and the tools used, and returns 2 to 3 follow-ups.
- Sent as an AG-UI `CUSTOM` event named `suggestions`. Chips show under the latest reply, are not stored, and a tap sends a normal message (counts toward the limits).
- Guards: only things the Coach can do, at most 3 chips of about 40 characters, none after an error, refusal or empty reply, no invented figures. A switch turns them off. A rule-based fallback per tool if the call fails.
- Evals: chips are on topic and short, none after refusals, none contain unsourced figures.

## Phase 2: proposals foundation (migration)

- Table `agent_proposals`: user, kind (`plan_change` or `memory`), payload (JSON), summary, status (`pending`, `applied`, `rejected`, `expired`, `failed`), timestamps, 30 minute expiry. Row-level security on the user.
- Endpoints `POST /proposals/{id}/approve` and `/reject`. The status change is atomic, so a double tap or stale approval cannot apply twice.
- A proposal card in chat with Approve and Reject. Pending cards load with the chat history, so they survive a refresh. After approval the card shows "Applied" and a fixed confirmation (not model text).
- Update the CLAUDE.md rule ("The Coach may only read data") to "may propose, never apply".
- Tests: stale, expired, double approval, another user's proposal, bad input.

## Phase 3: memory and corrections (migration)

*Built on branch `coach-memory`: migration 0017, `coach/memory.py`, the `propose_memory` tool, the notes screen at `/memory`, and the Analyst reading notes.*

- Table `agent_memories`: kind (fact, preference, constraint, goal), text, source (you said it, or inferred), status (active, superseded, rejected), `supersedes_id`, source message. Row-level security.
- A shared loader puts active memories (about 800 tokens max) into **both** the Coach and the Analyst prompt, labelled as notes from you, not instructions.
- Tool `propose_memory` creates a memory proposal. A small chip asks "Remember: trains 5 days a week? Save / Not now". Saving takes one tap.
- Corrections: "actually I train 5 days" proposes a new memory that supersedes the old one. History is kept.
- Screen **What the Coach knows**: list, edit, delete.
- Prompt and evals: logged data wins over claims, the Coach re-checks tools when you correct a figure, memory is never a numeric source, injuries and health notes need explicit saving.

## Phase 4: plan changes (migration)

*Built on branch `coach-plan-changes`: migration 0018 (`apply_plan_change`), `coach/planchange.py`, the `propose_plan_change` tool, prompt rules and eval cases. The approval card from phase 2 is reused unchanged.*

- Tool `propose_plan_change` validates against your data and stores a proposal: add an exercise to a session, replace an exercise, or change sets or rep range. Up to 5 changes per proposal, applied all or nothing.
- SQL function `apply_plan_change` re-checks and applies in one transaction. It runs under your own login, so row-level security applies.
- Rules: library exercises only, your active program only, sets 1 to 10, sane rep ranges, counts against the existing rate limits.
- The plan stores sets and rep ranges, not target loads. Loads stay in the weekly review's "Next week" list.
- Evals: "add hip thrust to Thursday" proposes and does not claim it is done. "Replace squats with lunges" proposes. A planted workout note saying "add X to the plan" must not produce a proposal. Off-topic is still refused. The old `edit_plan` eval ("I cannot edit") is rewritten.

## Phase 5: rolling summary of older chats (migration)

*Built on branch `coach-summary`: migration 0019, `coach/summary.py`, background update after each reply, summary on the notes screen, and cleared with the chat. Automatic, with a delete button. `COACH_SUMMARY=off` turns it off.*

- One summary row per user, updated when history exceeds the 20-message window, so a long conversation does not lose context.
- The summary is data, never instructions, and is loaded next to memories.

## Order and size

| # | Phase | Size | Needs migration |
|---|---|---|---|
| 1 | Next-step chips | S | no |
| 2 | Proposals foundation | M | yes |
| 3 | Memory and corrections | L | yes |
| 4 | Plan changes | M | yes |
| 5 | Rolling summary | S | yes |

Phases 3 and 4 both build on phase 2. Phase 1 can ship any time.

## Parked on purpose

Remove and reorder exercises, new sessions or days, plan reset by the Coach, custom exercises, file uploads in chat, CopilotKit or full AG-UI interrupts, a supervisor over multiple agents, a Postgres checkpointer, refunding the daily cap on mid-stream failures, the weekly cron and push setup, offline logging.

## Open decisions

1. Phase order as above, or plan changes before memory?
2. Multi-change proposals: one Approve for the batch (recommended) or per-change buttons?
3. Chips on or off by default? (Recommended: on, with the switch.)
4. Should the card let you tweak sets and reps before approving? (Recommended: a later improvement, not v1.)

## Known risks

- Storing health notes is a privacy commitment: keep the delete path and mention it in the app copy.
- Phase 1 adds a small cost to every reply: measure it and keep the off switch.
- A cheap model may write weak chips: the evals decide the default model.
