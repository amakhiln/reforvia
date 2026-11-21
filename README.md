# Reforvia

Mobile-first workout tracker, Reforvia (Next.js PWA + Supabase). Phases 1–4: plan, logging, progression hints, rest timer, exercise guide, history, progress charts, personal bests, an AI coach and a weekly AI review with push notifications (LangGraph).

## 1. Set up Supabase (one time)

1. Create a project at supabase.com.
2. Open **SQL Editor** and run these files, in order:
   - `supabase/migrations/0001_schema.sql` – tables, row-level security, per-user program cloning
   - `supabase/migrations/0002_seed_default_program.sql` – your exercise guide and weekly plan (from the Excel file)
   - `supabase/migrations/0003_previous_sets.sql` – "last time" lookup
   - `supabase/migrations/0004_progress.sql` – weekly volume, per-exercise history, personal bests
   - `supabase/migrations/0005_coach.sql` – coach chat history and the daily message cap
   - `supabase/migrations/0006_summaries.sql` – weekly reviews and push subscriptions
   - `supabase/migrations/0007_reset_plan.sql` – "Restore default plan" (keeps your logged history)
   - `supabase/migrations/0008_exercise_media.sql` – exercise media table and the public `exercise-media` storage bucket
   - `supabase/migrations/0009`–`0012_wger_exercises_*.sql` – the wger exercise library (973 exercises, CC BY-SA / CC0, author kept per row). Run after 0008. Optional.
3. **Authentication → Providers → Email**: for quick testing you can turn off "Confirm email". Leave it on for real use and add your site URL under **Authentication → URL Configuration** (also add `http://localhost:3000/auth/callback`).
4. **Project Settings → API**: copy the Project URL and the publishable (or anon) key.
   Never use the `service_role` / secret key in this app.

## 2. Run it

```bash
cd web
cp .env.example .env.local     # paste the URL and publishable key
npm install
npm run dev                    # http://localhost:3000
```

Create an account on the login screen. Every new user automatically gets their own editable copy of the default program.

Install on a phone: open the site in Safari/Chrome → *Add to Home Screen*.

## 3. Deploy the coach (Render)

The coach is a small Python service (`agent/`, FastAPI + LangGraph). It reads each user's own data with that user's Supabase token, so row-level security still applies, and it can only read.

1. Push this repo to GitHub.
2. Render → **New → Blueprint**, pick the repo. `render.yaml` defines the service (Docker, free plan, health check `/health`).
3. When prompted, set the environment variables:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_PUBLISHABLE_KEY` | the publishable/anon key only, never the secret key |
   | `OPENROUTER_API_KEY` | from openrouter.ai/keys (usage is billed there) |
   | `ALLOWED_ORIGINS` | where the web app runs, e.g. `http://localhost:3000,https://your-app.example` |

   Optional: `OPENROUTER_PROVIDER_SORT` (off by default; `latency` makes OpenRouter prefer the provider that answers fastest), `COACH_REASONING` (`low` by default; `none` switches hidden reasoning off for models that allow it, such as `anthropic/claude-haiku-5.5`, which is the fastest option; `default` sends nothing), `COACH_MODEL` (an OpenRouter model id that supports tool calling; default `anthropic/claude-sonnet-5.5`), `DAILY_MESSAGE_LIMIT` (default 30 per user per day), `COACH_HISTORY_MESSAGES`, `COACH_MAX_OUTPUT_TOKENS`.
4. In `web/.env.local` set `NEXT_PUBLIC_COACH_URL` to the Render URL (no trailing slash) and restart the web app.

**Switching models:** the Coach and the weekly Analyst both call OpenRouter, so changing provider or model is one setting. Set `COACH_MODEL` to another id from openrouter.ai/models (filter by tool calling), for example a cheaper model for the chat. No code change or redeploy of the web app is needed.

Render's free tier sleeps when idle, so the first reply after a quiet spell can take about a minute. The Coach tab wakes the service as soon as it opens.

Run the coach locally instead:

```bash
cd agent
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
export SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... OPENROUTER_API_KEY=... ALLOWED_ORIGINS=http://localhost:3000
uvicorn coach.main:app --port 8000      # then NEXT_PUBLIC_COACH_URL=http://localhost:8000
pytest                                   # no network or API key needed
```

## 4. Weekly reviews and notifications

Every Monday morning an **Analyst** agent (a second LangGraph graph in `agent/coach/analyst.py`) writes each user a short review of the week that just ended. It has no tools: a SQL function hands it the week's numbers and it can only describe those. The review appears under **Progress → Weekly review**, and users who turned notifications on get a push.

**One-time setup**

1. Run `supabase/migrations/0006_summaries.sql`.
2. Generate push keys: `npx web-push generate-vapid-keys`.
3. On the Render service add: `SUPABASE_SECRET_KEY` (Project Settings → API; this key can read everyone's data, so it lives only on the server), `CRON_SECRET` (any long random string), `VAPID_PRIVATE_KEY` (the private key from step 2), `VAPID_SUBJECT` (e.g. `mailto:you@example.com`), and optionally `ANALYST_TZ` (default `UTC`; the blueprint sets `Asia/Kolkata`, which decides which week counts as "last week").
4. In `web/.env.local` set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the public key from step 2.
5. Schedule it. In the Supabase SQL editor (enable **pg_cron** and **pg_net** under Database → Extensions first):

```sql
select cron.schedule('weekly-review', '30 0 * * 1', $$
  select net.http_post(
    url := 'https://YOUR-SERVICE.onrender.com/internal/weekly-run',
    headers := '{"x-cron-secret": "YOUR_CRON_SECRET"}'::jsonb,
    timeout_milliseconds := 60000);
$$);
-- A second try 20 minutes later covers Render's cold start. It is harmless: anyone who already has a review is skipped.
select cron.schedule('weekly-review-retry', '50 0 * * 1', $$
  select net.http_post(
    url := 'https://YOUR-SERVICE.onrender.com/internal/weekly-run',
    headers := '{"x-cron-secret": "YOUR_CRON_SECRET"}'::jsonb,
    timeout_milliseconds := 60000);
$$);
```

`30 0 * * 1` is Monday 00:30 UTC, which is 06:00 in India. To test without waiting, open **Weekly review** in the app and tap *Create last week's review* (needs a logged workout last week).

**Notes**

- Weeks with no logged workouts get no review, so nobody is nagged.
- On iPhone, notifications only work after you add the app to your Home Screen (iOS 16.4+); the toggle explains this when it can't be enabled.
- Reviews are created once per user per week; running the job again never duplicates or re-bills.

## Exercise library (wger)

`scripts/import_wger.py` builds the library from [wger](https://wger.de) (English, openly licensed, attribution stored per row).

```bash
python3 -I scripts/import_wger.py dry-run   # counts, licences and media sizes; writes nothing
python3 -I scripts/import_wger.py sql       # regenerates migrations 0009 to 0012
python3 -I scripts/import_wger.py upload   # copies ~180 MB of images/videos into Storage; reads scripts/.env
```

`upload` reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the environment or from `scripts/.env` (two `KEY=value` lines; git-ignored, never commit it).

Order: run migration `0008`, then `upload` (run it again to retry failures; files already there are skipped), then `0009` to `0012`. The secret key is used only for this local upload: never put it in the repo or the web app. Exercises that clash by name with your own library are skipped.

## Scripts (in `web/`)

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Unit tests for progression and chart maths |

Regenerate the seed after editing the workbook:
`python3 -I scripts/generate_seed.py <workbook.xlsx> supabase/migrations/0002_seed_default_program.sql`

## How it works

- **Plan vs. log**: `programs → program_sessions → planned_exercises` is the plan; `workouts → workout_exercises → set_logs` is what you actually did.
- **Privacy**: every user-owned table has row-level security (`user_id = auth.uid()`). The shared exercise library and the default template are read-only to users.
- **Progression** (`web/src/lib/progression.ts`): stay at a load until every planned set reaches the top of the rep range, then add the smallest practical step (1 kg under 10 kg, 2.5 kg under 50 kg, else 5 kg) and restart at the bottom of the range.
- **Progress**: the Progress tab shows 12-week volume and personal bests; tapping an exercise (or *View progress* inside a workout) opens its top-set, estimated-1RM and volume trends. Estimated 1RM uses Epley and only counts sets of 1–12 reps. Every chart has a Table view and keyboard support (arrow keys).
- **Coach**: `POST /chat` streams server-sent events (`tool`, `token`, `error`, `done`). Tools: plan, recent workouts, exercise lookup and guide, exercise progress, weekly volume, personal bests. Conversation history lives in `coach_messages`; the Clear button deletes it.
- **Exercise provenance**: `exercises.source / license / author / source_url` are there so a future wger import stays properly attributed.

## Next phases

2. ~~Progress charts per exercise, PRs, weekly volume~~ (done)
3. ~~LangGraph coach service and Coach tab~~ (done; read-only, no plan editing yet)
4. ~~Analyst agent, weekly reviews, push notifications~~ (done)
5. Offline logging, wger library import, plan editor
