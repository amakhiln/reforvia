# Reforvia

Personal workout tracker (built from the owner's Excel plan), designed to become multi-user. Mobile-first PWA, kilograms everywhere.

## Layout
- `web/` Next.js 16 PWA (App Router, Tailwind v4 with CSS-variable tokens for dark/light, `@supabase/ssr`). Next 16 differs from older versions: read `web/node_modules/next/dist/docs/` before using unfamiliar APIs. Auth gating lives in `src/proxy.ts` (not middleware). Client components that call `new Date()` or `useParams` during render must sit under `<Suspense>` in a server `page.tsx`.
- `agent/` Python service (FastAPI + LangGraph) on Render. `coach/graph.py` is the chat Coach (read-only tools, streams SSE), `coach/analyst.py` is the weekly Analyst (no tools, numbers come from SQL). Agents call Supabase over REST with the user's own JWT so RLS applies. Only the weekly job uses the server-side secret key.
- `supabase/migrations/` numbered SQL, applied in order in the Supabase SQL editor.
- `scripts/generate_seed.py` rebuilds `0002_seed_default_program.sql` from the Excel plan.
- `scripts/import_wger.py` builds migrations 0009+ (wger exercises) and uploads their media to Supabase Storage. Run locally only; it needs the secret key for the upload step.
- `render.yaml` Render blueprint for the agent service.

## Commands
- Web (in `web/`): `npm run dev`, `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`
- Agent (in `agent/`, with a venv): `pip install -r requirements-dev.txt`, `pytest` (no network or API key needed)
- Run all four checks (test, tsc, lint, pytest) before calling work done. Look at UI changes in a browser in both dark and light themes.

## Rules
- Never edit an applied migration. Add the next numbered file. Every table gets RLS with `user_id = (select auth.uid())`.
- The Coach never changes plan or log data. It may only create proposals (`agent_proposals`); the user approves on a card and SQL applies them as that user. Do not add write tools without asking.
- `SUPABASE_SECRET_KEY` is server-only: never in `web/`, never in `NEXT_PUBLIC_*`, never logged.
- Progression: double progression (hold load until all sets hit the top of the rep range, then +1 kg under 10 kg, +2.5 kg under 50, else +5). Estimated 1RM is Epley, reps 1 to 12 only.
- Charts follow one accent colour, thin marks, tooltips, a table view, and keyboard support.
- Keep UI polished: this is a product the owner presents as his own.

## Status
Phases 1 to 4 done: logging, progress and PRs, Coach chat, weekly reviews with push. Not yet verified against real services: live model calls through OpenRouter, real Supabase PostgREST queries, Docker build on Render, push delivery to phones.

## Next (Phase 5)
Offline logging (queue sets locally and sync). Done: plan editor, wger exercise library import (provenance columns kept: source, license, author, source_url; media in `exercise_media` and the `exercise-media` bucket).
