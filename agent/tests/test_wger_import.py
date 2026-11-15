"""Checks the pure parts of scripts/import_wger.py (no network)."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("import_wger", Path(__file__).resolve().parents[2] / "scripts" / "import_wger.py")
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
w.LICENSES.update({1: "CC-BY-SA 4", 3: "CC0"})


def ex(**kw):
    base = dict(id=1, uuid="u1", license={"short_name": "CC-BY-SA 4"}, license_author="a", muscles=[{"name": "Biceps", "name_en": "Biceps"}],
                equipment=[{"name": "Barbell"}], images=[], videos=[],
                translations=[{"language": 2, "name": "  Curl  ", "description": "<p>Lift.</p><ul><li>Slowly</li></ul>", "license": 1,
                               "license_author": "bob", "license_object_url": "https://wger.de/x"}])
    return {**base, **kw}


def test_html_becomes_plain_lines():
    assert w.html_to_text("<p>Lift.</p><ul><li>Slowly</li><li>Down</li></ul>") == "Lift.\n- Slowly\n- Down"


def test_exercise_is_built_with_attribution():
    drops = {"no english name": 0, "no licence": 0, "duplicate name": 0}
    r = w.build(ex(), drops)
    assert r["name"] == "Curl" and r["license"] == "CC-BY-SA 4" and r["author"] == "bob" and r["muscles"] == "Biceps"
    assert w.build(ex(translations=[{"language": 5, "name": "x"}]), drops) is None and drops["no english name"] == 1


def test_media_skips_ai_unlicensed_and_big_videos_and_caps_images():
    img = lambda n, **k: dict(image=f"https://x/{n}.jpg", uuid=f"i{n}", license=1, license_author="p", is_main=n == 2, **k)
    media = w.media_of(ex(
        images=[img(1), img(2), img(3), img(4, is_ai_generated=True), {**img(5), "license": 99}],
        videos=[dict(video="https://x/v.mp4", uuid="v1", license=3, size=w.MAX_VIDEO_BYTES + 1)],
    ))
    assert [m["path"] for m in media] == ["wger/u1/i2.jpg", "wger/u1/i1.jpg"] and media[0]["is_main"]
    small = w.media_of(ex(videos=[dict(video="https://x/v.mp4", uuid="v1", license=3, size=1000)]))
    assert small[0]["kind"] == "video" and small[0]["license"] == "CC0"


def test_duplicate_names_keep_the_richer_entry():
    plain = ex(uuid="a", translations=[{**ex()["translations"][0], "description": ""}])
    rich = ex(uuid="b")
    recs, drops = w.select([plain, rich])
    assert [r["id"] for r in recs] == ["b"] and drops["duplicate name"] == 1


def test_sql_quoting():
    assert w.q("O'Neil") == "'O''Neil'" and w.q(None) == "null"


def test_secret_key_shape_is_checked_before_uploading():
    import pytest

    assert w.clean_key("  'sb_secret_abc'\n") == "sb_secret_abc"
    assert w.clean_key("eyJhbGciOi.payload.sig") == "eyJhbGciOi.payload.sig"
    assert w.clean_key("") == ""
    for bad in ("sb_publishable_abc", "some-jwt-secret-string", "eyJonlyone"):
        with pytest.raises(SystemExit):
            w.clean_key(bad)


def test_terminal_paste_markers_are_stripped():
    assert w.clean_key("\x1b[200~sb_secret_abc\x1b[201~") == "sb_secret_abc"
    assert w.clean_key("[200~sb_secret_abc[201~") == "sb_secret_abc"


def test_network_errors_are_retried_then_succeed(monkeypatch):
    import urllib.error

    calls = []

    class Resp:
        headers = {"x": "1"}

        def read(self):
            return b"ok"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake(req, timeout):
        calls.append(1)
        if len(calls) < 3:
            raise urllib.error.URLError("handshake timed out")
        return Resp()

    monkeypatch.setattr(w.urllib.request, "urlopen", fake)
    monkeypatch.setattr(w.time, "sleep", lambda s: None)
    assert w.get("https://example.test/x") == b"ok" and len(calls) == 3


def test_client_errors_are_not_retried(monkeypatch):
    import urllib.error
    import pytest

    calls = []

    def fake(req, timeout):
        calls.append(1)
        raise urllib.error.HTTPError(req.full_url, 403, "no", {}, None)

    monkeypatch.setattr(w.urllib.request, "urlopen", fake)
    monkeypatch.setattr(w.time, "sleep", lambda s: None)
    with pytest.raises(urllib.error.HTTPError):
        w.get("https://example.test/x")
    assert len(calls) == 1


def test_content_types_cover_every_extension_wger_uses():
    assert w.content_type("a/b.mov") == "video/mp4" and w.content_type("a.MP4") == "video/mp4"
    assert w.content_type("a.png") == "image/png" and w.content_type("a.webp") == "image/webp"
    assert w.content_type("a.jfif") == "image/jpeg"
