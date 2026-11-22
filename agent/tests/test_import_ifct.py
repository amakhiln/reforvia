import csv
import importlib.util
import io
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("import_ifct", Path(__file__).resolve().parents[2] / "scripts" / "import_ifct.py")
ifct = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ifct)

KEYS = ["code", "name", "scie", "lang", "grup", "tags", "enerc", *ifct.NUMERIC]
HEADER = [f"{k.title()}; {k}" for k in KEYS]


def table(*foods):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(HEADER)
    for f in foods:
        w.writerow([f.get(k, "0") for k in KEYS])
    return out.getvalue()


EGG = {"code": "M001", "name": "Egg, whole", "scie": "", "lang": "H. Anda", "grup": "Egg and Egg Products", "tags": "nonveg eggetarian",
       "enerc": "564", "protcnt": "13.28", "fatce": "9.15", "choavldf": "0", "cholc": "0.366", "ca": "0.04944", "vitc": "0", "na": "0.123"}


def test_units_are_converted_kj_to_kcal_and_grams_to_milligrams():
    (food,), warnings = ifct.parse(table(EGG))
    assert food["energy_kcal"] == 134.8 and food["energy_derived"] is False
    assert food["cholesterol_mg"] == 366.0 and food["calcium_mg"] == 49.44 and food["sodium_mg"] == 123.0  # grams per 100 g became mg
    assert food["protein_g"] == 13.28 and food["fat_g"] == 9.15  # grams stay grams
    assert food["tags"] == ["eggetarian", "nonveg"] and food["scientific_name"] is None and food["local_names"] == "H. Anda"
    assert warnings == []


def test_missing_energy_on_a_fat_only_food_is_worked_out_and_marked():
    ghee = {**EGG, "code": "T013", "name": "Ghee", "enerc": "0", "protcnt": "0", "fatce": "100", "cholc": "0", "ca": "0", "na": "0"}
    (food,), _ = ifct.parse(table(ghee))
    assert food["energy_kcal"] == 900.0 and food["energy_derived"] is True
    water = {**ghee, "code": "X1", "name": "Water", "fatce": "0"}
    (food,), _ = ifct.parse(table(water))
    assert food["energy_kcal"] == 0.0 and food["energy_derived"] is False  # nothing to derive from


def test_a_reported_energy_far_from_the_macros_is_flagged_but_kept():
    odd = {**EGG, "code": "N001", "name": "Chicken leg", "enerc": "1607", "protcnt": "20", "fatce": "12", "cholc": "0"}
    (food,), warnings = ifct.parse(table(odd))
    assert food["energy_kcal"] == 384.1 and len(warnings) == 1 and "N001" in warnings[0]


@pytest.mark.parametrize(
    "bad, fragment",
    [({"protcnt": "abc"}, "not a number"), ({"fatce": "-1"}, "negative"), ({"enerc": ""}, "not a number"), ({"code": ""}, "food code")],
)
def test_bad_rows_stop_the_import_instead_of_reaching_a_migration(bad, fragment):
    with pytest.raises(ValueError, match=fragment):
        ifct.parse(table({**EGG, **bad}))


def test_repeated_codes_and_missing_columns_stop_the_import():
    with pytest.raises(ValueError, match="repeated"):
        ifct.parse(table(EGG, EGG))
    with pytest.raises(ValueError, match="missing columns"):
        ifct.parse("Food Code; code,Food Name; name\nA001,Rice\n")


def test_sql_literals_escape_quotes_and_render_lists_and_nulls():
    assert ifct.lit("O'Neil's dal") == "'O''Neil''s dal'" and ifct.lit(None) == "null" and ifct.lit(True) == "true" and ifct.lit(1.5) == "1.5"
    assert ifct.lit(["a", "b"]) == "array['a', 'b']::text[]" and ifct.lit([]) == "'{}'::text[]"


def test_generated_sql_has_one_value_row_per_food_and_all_columns():
    foods, _ = ifct.parse(table(EGG, {**EGG, "code": "M002", "name": "Egg, 'duck'"}))
    sql = ifct.to_sql(foods)
    assert sql.count("\n  ('ifct2017'") == 2 and sql.rstrip().endswith(";") and "'Egg, ''duck'''" in sql
    assert f"insert into public.foods ({', '.join(ifct.COLUMNS)}) values" in sql
    assert all(len(ifct.COLUMNS) == len(f) for f in [{c: 1 for c in ifct.COLUMNS}])


def test_a_download_that_does_not_match_the_pinned_checksum_is_refused(tmp_path, monkeypatch):
    fake = tmp_path / "tampered.tgz"
    fake.write_bytes(b"not the real package")
    monkeypatch.setattr(ifct, "CACHE", fake)
    with pytest.raises(SystemExit, match="pinned checksum"):
        ifct.download()
    assert not fake.exists()  # a bad cache is dropped, not trusted next time
