#!/usr/bin/env python3
"""Import the Indian Food Composition Tables 2017 (IFCT, National Institute of Nutrition, Hyderabad) into Reforvia.

  python3 -I scripts/import_ifct.py dry-run          # download, verify, parse and report; writes nothing
  python3 -I scripts/import_ifct.py sql              # write supabase/migrations/0021_ifct_foods.sql
  python3 -I scripts/import_ifct.py sql --force      # overwrite that file (only before it has been applied)

The data comes from the npm package @ifct2017/compositions, pinned to one version and checked against the registry's
SHA-512 before anything is read. Only the CSV inside the tarball is read, in memory: nothing is extracted to disk and no
package code is run. The raw download is cached in scripts/.ifct-cache.tgz (git-ignored).

Units: the CSV gives energy in kJ and minerals, cholesterol and vitamin C in grams per 100 g; they are converted to kcal
and milligrams here. IFCT lists raw ingredients, not cooked dishes. Check the data's terms of use before shipping it:
the package is MIT-licensed, but the underlying tables are the National Institute of Nutrition's.
"""
import base64
import csv
import hashlib
import io
import sys
import tarfile
import urllib.request
from pathlib import Path

VERSION = "2.0.9"
URL = f"https://registry.npmjs.org/@ifct2017/compositions/-/compositions-{VERSION}.tgz"
INTEGRITY = "sha512-ir8tb2r9k8OWAOWBDiljLuB5MD6dy4/ct+kLuNgyRGqH0PVpI+totq+NCkvP7+gX12O3qp0uPPbuHGzwgN2uLA=="
EXPECTED_ROWS = 542
CACHE = Path(__file__).with_name(".ifct-cache.tgz")
OUT = Path(__file__).resolve().parent.parent / "supabase" / "migrations" / "0021_ifct_foods.sql"
SOURCE = "ifct2017"
NOTE = (
    "Indian Food Composition Tables 2017, National Institute of Nutrition, Hyderabad (ifct2017.com). Values per 100 g edible "
    f"portion, converted to kcal and mg. Loaded from the npm package @ifct2017/compositions {VERSION} (MIT)."
)
KCAL_PER_KJ = 1 / 4.184

# column in the CSV -> (column in our table, factor). Grams per 100 g become milligrams with a factor of 1000.
NUMERIC = {
    "protcnt": ("protein_g", 1), "fatce": ("fat_g", 1), "choavldf": ("carbs_g", 1), "fibtg": ("fibre_g", 1), "water": ("water_g", 1),
    "fsugar": ("sugars_g", 1), "fasat": ("sat_fat_g", 1), "cholc": ("cholesterol_mg", 1000), "ca": ("calcium_mg", 1000),
    "fe": ("iron_mg", 1000), "mg": ("magnesium_mg", 1000), "p": ("phosphorus_mg", 1000), "k": ("potassium_mg", 1000),
    "na": ("sodium_mg", 1000), "zn": ("zinc_mg", 1000), "vitc": ("vitamin_c_mg", 1000),
}
COLUMNS = ["source", "code", "name", "scientific_name", "local_names", "food_group", "tags", "energy_kcal", "energy_derived",
           *[v[0] for v in NUMERIC.values()], "source_note"]


def download() -> bytes:
    data = CACHE.read_bytes() if CACHE.exists() else urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "reforvia-importer"}), timeout=60).read()
    digest = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
    if digest != INTEGRITY:
        CACHE.unlink(missing_ok=True)
        sys.exit(f"The downloaded package does not match the pinned checksum.\n  expected {INTEGRITY}\n  got      {digest}")
    CACHE.write_bytes(data)
    return data


def read_csv(tarball: bytes) -> str:
    """Only the one fixed member is read, in memory."""
    with tarfile.open(fileobj=io.BytesIO(tarball), mode="r:gz") as tar:
        member = tar.extractfile("package/index.csv")
        if member is None:
            sys.exit("package/index.csv is missing from the download.")
        return member.read().decode("utf-8")


def parse(text: str) -> tuple[list[dict], list[str]]:
    """(foods, warnings). Raises ValueError on anything that cannot be a food row, so bad data never reaches a migration."""
    reader = csv.reader(io.StringIO(text))
    header = next(reader)
    col = {h.split("; ")[1]: i for i, h in enumerate(header) if "; " in h and not h.endswith("_e")}
    need = {"code", "name", "scie", "lang", "grup", "tags", "enerc", *NUMERIC}
    if need - col.keys():
        raise ValueError(f"missing columns: {sorted(need - col.keys())}")
    foods, warnings, seen = [], [], set()
    for line, row in enumerate(reader, start=2):
        if not row:
            continue
        code = row[col["code"]].strip()
        if not code or code in seen:
            raise ValueError(f"line {line}: missing or repeated food code {code!r}")
        seen.add(code)
        try:
            vals = {name: float(row[col[k]]) * factor for k, (name, factor) in NUMERIC.items()}
            kj = float(row[col["enerc"]])
        except ValueError as exc:
            raise ValueError(f"line {line} ({code}): not a number: {exc}") from exc
        if kj < 0 or any(v < 0 for v in vals.values()):
            raise ValueError(f"line {line} ({code}): negative value")
        atwater = 4 * vals["protein_g"] + 4 * vals["carbs_g"] + 9 * vals["fat_g"]
        derived = kj == 0 and atwater > 0  # IFCT leaves energy at 0 for oils and a few fat-only foods
        kcal = round(atwater if derived else kj * KCAL_PER_KJ, 1)
        if not derived and atwater > 0 and abs(kcal - atwater) / max(kcal, 1) > 0.35:
            warnings.append(f"{code} {row[col['name']][:40]}: reported {kcal:.0f} kcal but its macros add up to {atwater:.0f}")
        total = vals["water_g"] + vals["protein_g"] + vals["fat_g"] + vals["carbs_g"] + vals["fibre_g"]
        if total > 105:
            warnings.append(f"{code} {row[col['name']][:40]}: water and macros add up to {total:.0f} g per 100 g")
        foods.append(
            {
                "source": SOURCE, "code": code, "name": row[col["name"]].strip(), "scientific_name": row[col["scie"]].strip() or None,
                "local_names": row[col["lang"]].strip() or None, "food_group": row[col["grup"]].strip(),
                "tags": sorted(set(row[col["tags"]].split())), "energy_kcal": kcal, "energy_derived": derived,
                **{k: round(v, 2) for k, v in vals.items()}, "source_note": NOTE,
            }
        )
    return foods, warnings


def lit(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, list):
        return "array[" + ", ".join(lit(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"


def to_sql(foods: list[dict]) -> str:
    head = (
        "-- Generated by scripts/import_ifct.py. Do not edit by hand; regenerate before it is applied, never after.\n"
        f"-- {NOTE}\n"
        f"-- {len(foods)} foods. Energy is kcal; minerals, cholesterol and vitamin C are mg; the rest is g, all per 100 g.\n\n"
    )
    rows = ",\n".join("  (" + ", ".join(lit(f[c]) for c in COLUMNS) + ")" for f in foods)
    return f"{head}insert into public.foods ({', '.join(COLUMNS)}) values\n{rows};\n"


def main(argv: list[str]) -> None:
    mode = argv[1] if len(argv) > 1 else ""
    if mode not in ("dry-run", "sql"):
        sys.exit(__doc__)
    foods, warnings = parse(read_csv(download()))
    if len(foods) != EXPECTED_ROWS:
        sys.exit(f"Expected {EXPECTED_ROWS} foods, found {len(foods)}.")
    groups: dict[str, int] = {}
    for f in foods:
        groups[f["food_group"]] = groups.get(f["food_group"], 0) + 1
    print(f"{len(foods)} foods in {len(groups)} groups; {sum(f['energy_derived'] for f in foods)} with energy worked out from macros.")
    print("  " + "; ".join(f"{k} {v}" for k, v in sorted(groups.items(), key=lambda kv: -kv[1])))
    for w in warnings:
        print("  note:", w)
    if mode == "dry-run":
        return
    if OUT.exists() and "--force" not in argv:
        sys.exit(f"{OUT} exists. Pass --force to overwrite it (only if it has not been applied).")
    OUT.write_text(to_sql(foods), encoding="utf-8")
    print(f"wrote {OUT.relative_to(OUT.parent.parent.parent)}")


if __name__ == "__main__":
    main(sys.argv)
