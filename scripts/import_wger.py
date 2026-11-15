#!/usr/bin/env python3
"""Import the wger exercise library (English) into Reforvia, with attribution.

  python3 -I scripts/import_wger.py dry-run     # fetch and report counts, licences and media sizes; writes nothing
  python3 -I scripts/import_wger.py sql         # write numbered migration files into supabase/migrations
  python3 -I scripts/import_wger.py upload      # copy images/videos into Supabase Storage (bucket: exercise-media)
  python3 -I scripts/import_wger.py upload --force .mov   # re-upload files with the given extensions even if present

`upload` needs SUPABASE_URL and SUPABASE_SECRET_KEY, from the environment or from scripts/.env (git-ignored). Run it
locally only; the key never goes in the repo or the web app. API pages are cached in scripts/.wger-cache.json so the three modes share one download.
"""
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path

API = "https://wger.de/api/v2/exerciseinfo/?language=2&limit=100"
ENGLISH = 2
BUCKET = "exercise-media"
MAX_IMAGES = 2
MAX_VIDEO_BYTES = 8 * 1024 * 1024
ROWS_PER_FILE = 250
FIRST_MIGRATION = 9  # 0008 is the hand-written media table / bucket migration
CACHE = Path(__file__).with_name(".wger-cache.json")
UA = {"User-Agent": "reforvia-importer"}


def get(url, method="GET", headers=None, data=None, tries=4):
    """One request, retried with a growing pause on network errors, timeouts and 429/5xx. Other HTTP errors raise at once."""
    for attempt in range(tries):
        req = urllib.request.Request(url, method=method, headers={**UA, **(headers or {})}, data=data)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read() if method == "GET" else r.headers
        except urllib.error.HTTPError as exc:
            if (exc.code < 500 and exc.code != 429) or attempt == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == tries - 1:
                raise
        time.sleep(2 ** attempt)


def fetch_all():
    if CACHE.exists():
        return json.loads(CACHE.read_text())
    items, url = [], API
    while url:
        page = json.loads(get(url))
        items += page["results"]
        url = page.get("next")
        print(f"  fetched {len(items)}/{page['count']}", file=sys.stderr)
        time.sleep(0.3)
    CACHE.write_text(json.dumps(items))
    return items


class _Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out = []

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "br", "li", "ul", "ol"):
            self.out.append("\n")
        if tag == "li":
            self.out.append("- ")

    def handle_data(self, data):
        self.out.append(data)


def html_to_text(raw):
    p = _Text()
    p.feed(html.unescape(raw or ""))
    text = re.sub(r"[ \t]+", " ", "".join(p.out))
    return re.sub(r"\s*\n\s*", "\n", text).strip()


LICENSES = {}


def load_licenses():
    page = json.loads(get("https://wger.de/api/v2/license/?limit=100"))
    LICENSES.update({l["id"]: l["short_name"] for l in page["results"]})


def licence_name(license_id):
    return LICENSES.get(license_id)


def media_of(ex):
    out = []
    images = [i for i in ex.get("images", []) if i.get("image") and licence_name(i.get("license")) and not i.get("is_ai_generated")]
    images.sort(key=lambda i: not i.get("is_main"))
    for i in images[:MAX_IMAGES]:
        out.append(("image", i))
    videos = [v for v in ex.get("videos", []) if v.get("video") and licence_name(v.get("license"))]
    videos.sort(key=lambda v: not v.get("is_main"))
    for v in videos[:1]:
        if not v.get("size") or v["size"] <= MAX_VIDEO_BYTES:
            out.append(("video", v))
    media = []
    for n, (kind, m) in enumerate(out):
        url = m["image"] if kind == "image" else m["video"]
        ext = os.path.splitext(url.split("?")[0])[1].lower() or (".jpg" if kind == "image" else ".mp4")
        media.append(
            dict(kind=kind, url=url, path=f"wger/{ex['uuid']}/{m['uuid']}{ext}", license=licence_name(m["license"]),
                 author=m.get("license_author") or None, source_url=m.get("license_object_url") or None, is_main=n == 0, sort=n)
        )
    return media


def build(ex, drops):
    tr = next((t for t in ex.get("translations", []) if t.get("language") == ENGLISH), None)
    name = " ".join((tr or {}).get("name", "").split())
    if not tr or not name:
        drops["no english name"] += 1
        return None
    lic = licence_name(tr.get("license")) or (ex.get("license") or {}).get("short_name")
    if not lic:
        drops["no licence"] += 1
        return None
    return dict(
        id=ex["uuid"],
        name=name,
        muscles=", ".join(m.get("name_en") or m["name"] for m in ex.get("muscles", [])) or None,
        equipment=", ".join(e["name"] for e in ex.get("equipment", [])) or None,
        description=html_to_text(tr.get("description")) or None,
        license=lic,
        author=tr.get("license_author") or ex.get("license_author") or None,
        source_url=tr.get("license_object_url") or f"https://wger.de/en/exercise/{ex['id']}/view/",
        media=media_of(ex),
    )


def select(items):
    drops = {"no english name": 0, "no licence": 0, "duplicate name": 0}
    best = {}
    for ex in items:
        rec = build(ex, drops)
        if not rec:
            continue
        key, score = rec["name"].lower(), (bool(rec["description"]), len(rec["media"]))
        if key in best:
            drops["duplicate name"] += 1
            if score <= best[key][0]:
                continue
        best[key] = (score, rec)
    return sorted((r for _, r in best.values()), key=lambda r: r["name"].lower()), drops


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def head_size(url):
    try:
        return int(get(url, method="HEAD").get("Content-Length") or 0)
    except Exception:
        return 0


def dry_run(recs, drops, raw_count):
    media = [m for r in recs for m in r["media"]]
    imgs = [m for m in media if m["kind"] == "image"]
    vids = [m for m in media if m["kind"] == "video"]
    with ThreadPoolExecutor(8) as pool:
        img_bytes = sum(pool.map(lambda m: head_size(m["url"]), imgs))
        vid_bytes = sum(pool.map(lambda m: head_size(m["url"]), vids))
    lic = {}
    for r in recs:
        lic[r["license"]] = lic.get(r["license"], 0) + 1
    mb = lambda n: f"{n / 1048576:.1f} MB"
    print(f"fetched {raw_count} exercises; keeping {len(recs)}; dropped {drops}")
    print(f"exercise licences: {lic}")
    print(f"with description: {sum(1 for r in recs if r['description'])}, with author: {sum(1 for r in recs if r['author'])}")
    print(f"images: {len(imgs)} ({mb(img_bytes)}), videos: {len(vids)} ({mb(vid_bytes)}); total {mb(img_bytes + vid_bytes)}")
    print(f"media licences: { {l: sum(1 for m in media if m['license'] == l) for l in {m['license'] for m in media}} }")


def write_sql(recs):
    out = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
    files = []
    for n, start in enumerate(range(0, len(recs), ROWS_PER_FILE)):
        chunk = recs[start : start + ROWS_PER_FILE]
        ex_rows = ",\n".join(
            f"  ({q(r['id'])}, {q(r['name'])}, {q(r['muscles'])}, {q(r['description'])}, {q(r['equipment'])}, "
            f"'wger', {q(r['license'])}, {q(r['author'])}, {q(r['source_url'])})"
            for r in chunk
        )
        media = [(r["id"], m) for r in chunk for m in r["media"]]
        media_sql = ""
        if media:
            rows = ",\n".join(
                f"  ({q(eid)}::uuid, {q(m['kind'])}, {q(m['path'])}, {q(m['license'])}, {q(m['author'])}, {q(m['source_url'])}, "
                f"{'true' if m['is_main'] else 'false'}, {m['sort']})"
                for eid, m in media
            )
            media_sql = (
                "\n-- Media rows only for exercises that were actually inserted (a name clash skips the exercise).\n"
                "insert into public.exercise_media (exercise_id, kind, storage_path, license, author, source_url, is_main, sort_order)\n"
                f"select v.* from (values\n{rows}\n) as v(exercise_id, kind, storage_path, license, author, source_url, is_main, sort_order)\n"
                "where exists (select 1 from public.exercises e where e.id = v.exercise_id and e.source = 'wger')\n"
                "on conflict (exercise_id, storage_path) do nothing;\n"
            )
        path = out / f"{FIRST_MIGRATION + n:04d}_wger_exercises_{n + 1}.sql"
        path.write_text(
            f"-- wger exercises, part {n + 1} (generated by scripts/import_wger.py; CC licences, author per row).\n"
            "-- Existing exercises win: a clashing name or id is skipped.\n"
            "insert into public.exercises (id, name, main_muscles, form_instructions, equipment, source, license, author, source_url)\n"
            f"values\n{ex_rows}\non conflict do nothing;\n{media_sql}"
        )
        files.append((path.name, path.stat().st_size))
    for name, size in files:
        print(f"wrote {name} ({size / 1024:.0f} KB)")


def load_env():
    """Reads KEY=value lines from scripts/.env (git-ignored) so the key never has to be pasted into a terminal."""
    path = Path(__file__).with_name(".env")
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def clean_key(raw):
    """Trims paste leftovers (spaces, quotes, terminal paste markers) and refuses anything that isn't a secret key."""
    key = re.sub(r"\x1b?\[20[01]~", "", re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", raw)).strip().strip("'\"").strip()
    if not key:
        return ""
    if key.startswith("sb_publishable_"):
        sys.exit("That is the publishable key. Use the secret key (starts with sb_secret_) from Project Settings > API Keys.")
    if not (key.startswith("sb_secret_") or (key.startswith("eyJ") and key.count(".") == 2)):
        sys.exit(
            "SUPABASE_SECRET_KEY doesn't look like a secret key: expected sb_secret_... or a legacy service_role key (eyJ...).\n"
            f"Got {len(key)} characters starting with {key[:3]!r}. Check you copied the key itself, not another value."
        )
    return key


CONTENT_TYPES = {
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm",
    ".mov": "video/mp4",  # QuickTime files from wger are H.264, which browsers play when served as mp4 (the bucket allows mp4)
}


def content_type(path):
    return CONTENT_TYPES.get(os.path.splitext(path)[1].lower(), "image/jpeg")


def upload(recs, force=()):
    load_env()
    base, key = os.environ.get("SUPABASE_URL", "").strip().rstrip("/"), clean_key(os.environ.get("SUPABASE_SECRET_KEY", ""))
    if not base or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SECRET_KEY in the environment first.")
    auth = {"apikey": key} if key.startswith("sb_") else {"apikey": key, "Authorization": f"Bearer {key}"}
    media = [m for r in recs for m in r["media"]]
    done = skipped = failed = 0
    for m in media:
        public = f"{base}/storage/v1/object/public/{BUCKET}/{m['path']}"
        try:
            if os.path.splitext(m["path"])[1].lower() in force:
                raise LookupError("re-upload requested")
            get(public, method="HEAD")
            skipped += 1
            continue
        except Exception:  # not there yet (Supabase answers 400 for a missing file) or a network blip: upload it
            pass
        stage = "download from wger"
        try:
            body = get(m["url"])
            stage = "upload to Supabase"
            ctype = content_type(m["path"])
            get(f"{base}/storage/v1/object/{BUCKET}/{m['path']}", method="POST", data=body,
                headers={**auth, "Content-Type": ctype, "x-upsert": "true"})
            done += 1
        except urllib.error.HTTPError as exc:  # keep going; rerun to retry the failures
            failed += 1
            detail = exc.read().decode("utf-8", "replace")[:200]
            print(f"failed {m['path']} ({stage}): HTTP {exc.code} {detail}", file=sys.stderr)
        except Exception as exc:
            failed += 1
            print(f"failed {m['path']} ({stage}): {type(exc).__name__} {exc}", file=sys.stderr)
        time.sleep(0.1)
    print(f"uploaded {done}, already there {skipped}, failed {failed}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode not in ("dry-run", "sql", "upload"):
        sys.exit(__doc__)
    load_licenses()
    items = fetch_all()
    recs, drops = select(items)
    {"dry-run": lambda: dry_run(recs, drops, len(items)), "sql": lambda: write_sql(recs), "upload": lambda: upload(recs, tuple(a.lower() for a in sys.argv[3:] if a.startswith(".")))}[mode]()


if __name__ == "__main__":
    main()
