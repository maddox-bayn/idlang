#!/usr/bin/env python3
"""Emit the Go backend's dictionary from the scraped idomaland.org corpus.

Why this exists
---------------
`backend/idoma_dictionary_v2.json` is fabricated: 109 of its 218 entries are the
placeholder `ụụ`, and among the rest a single form ("òdò") is given for black, day,
evening, morning, night and red alike. Serving those ahead of the model is worse than
serving nothing.

The scraped corpus is the real thing -- 1,251 pairs from idomaland.org, each with a
source URL. Shaped into the format `backend/main.go` already reads, an exact hit is
answered exactly and the model only handles what the dictionary misses. That matters
because the fine-tune is dictionary-level: on held-out words it guesses (it returns
"onyilo", *man*, for water), while a lookup for a covered word is correct by
construction.

Output shape, matching `WordEntry` in backend/main.go:

    {"<category>": {"<english>": {"idoma": "...", "pos": "", "example": "..."}}}

Categories come from the scrape's own tags, so a hit can say where it came from.

Ambiguity
---------
The corpus is many-to-many in both directions, and the Go lookup returns the first
match it finds. Two rules keep that deterministic:

  * One English key wins per category -- the first row in corpus order. Alternates go
    into `example` so the information is not lost from the response.
  * Dialect is recorded in `example` too ("central Idoma: Ennkpo"), since idomaland.org
    gives different forms for central and western Idoma and neither is more correct.

Reverse lookups (Idoma -> English) are handled by main.go scanning the Idoma side, so
no separate index is needed. Note `Le` maps to Marry, Own, Have *and* eat in the source
data; whichever category is scanned first answers. That is a property of the source, not
a bug here.

Provenance stays local
----------------------
This writes only English/Idoma/dialect. The `url` and `definition` fields of the scrape
stay in data_pipeline/out/, which is gitignored -- the corpus is not published, only
the lookups the app needs, with attribution to idomaland.org in the app and model card.

This is step 1 of 2
-------------------
The output is a *staging* file, not the dictionary the backend serves. It writes to
data_pipeline/out/corpus_dictionary.json and the served file is built from it by:

    python data_pipeline/build_dictionary.py
    python data_pipeline/merge_dictionary.py \
        --source data_pipeline/out/corpus_dictionary.json --tie target

The merge step exists because the corpus is almost entirely untoned ("Ole") while the
226 curated entries are marked ("Olé"), and tone is meaning-bearing. Writing straight
to backend/idoma_dictionary_v3.json -- which this script used to default to -- would
silently replace every marked form with a bare one.
"""

import argparse
import json
import pathlib
import re
import sys
import unicodedata
from collections import OrderedDict, defaultdict

PLACEHOLDER = "ụụ"  # must match idomaPlaceholder in backend/main.go
DEFAULT_IN = pathlib.Path("data_pipeline/out/idomaland_raw.jsonl")
# A staging path, deliberately NOT backend/idoma_dictionary_v3.json. See "This is
# step 1 of 2" above: the served file is the merge of this output with the curated
# tone-marked entries, so writing here directly would discard the tone marks.
DEFAULT_OUT = pathlib.Path("data_pipeline/out/corpus_dictionary.json")
UNTAGGED = "General"


def norm(text):
    """NFC-normalise and collapse whitespace, without changing case."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(text))).strip()


def load(path):
    rows = []
    with open(path, encoding="utf-8") as handle:
        for lineno, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                print(f"  skipping {path}:{lineno}: {exc}", file=sys.stderr)
    return rows


def build(rows):
    """Group rows into category -> english -> WordEntry, recording alternates."""
    # english -> list of (idoma, dialect, category), in corpus order
    grouped = defaultdict(list)
    skipped = {"placeholder": 0, "empty": 0, "identical": 0}

    for row in rows:
        english = norm(row.get("english", ""))
        idoma = norm(row.get("idoma", ""))
        dialect = norm(row.get("dialect", ""))
        tags = row.get("tags") or []
        category = norm(tags[0]) if tags else UNTAGGED

        if not english or not idoma:
            skipped["empty"] += 1
            continue
        if PLACEHOLDER in idoma:
            skipped["placeholder"] += 1
            continue
        if english.casefold() == idoma.casefold():
            # An entry that translates to itself teaches nothing and would let the
            # dictionary answer a request with its own input -- the original bug.
            skipped["identical"] += 1
            continue

        grouped[english].append((idoma, dialect, category))

    out = OrderedDict()
    entries = alternates = 0
    for english in sorted(grouped, key=lambda s: (s.casefold(), s)):
        variants = grouped[english]
        idoma, dialect, category = variants[0]

        notes = []
        if dialect:
            notes.append(f"{dialect} Idoma: {idoma}")
        for alt_idoma, alt_dialect, _ in variants[1:]:
            if alt_idoma.casefold() == idoma.casefold():
                continue
            notes.append(f"{alt_dialect} Idoma: {alt_idoma}" if alt_dialect
                         else f"also: {alt_idoma}")
            alternates += 1

        out.setdefault(category, OrderedDict())[english] = OrderedDict(
            [("idoma", idoma)]
            + ([("example", "; ".join(notes))] if notes else [])
        )
        entries += 1

    return out, entries, alternates, skipped


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="infile", type=pathlib.Path, default=DEFAULT_IN)
    ap.add_argument("--out", dest="outfile", type=pathlib.Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    if not args.infile.is_file():
        print(f"error: {args.infile} not found. Run scrape_idomaland.py first.",
              file=sys.stderr)
        return 1

    rows = load(args.infile)
    print(f"read {len(rows)} rows from {args.infile}")

    dictionary, entries, alternates, skipped = build(rows)

    args.outfile.parent.mkdir(parents=True, exist_ok=True)
    with open(args.outfile, "w", encoding="utf-8") as handle:
        json.dump(dictionary, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"wrote {args.outfile}")
    print(f"  categories        {len(dictionary)}")
    print(f"  entries           {entries}")
    print(f"  alternate forms   {alternates} (recorded in `example`)")
    for reason, count in skipped.items():
        if count:
            print(f"  skipped {reason:12} {count}")

    # A placeholder reaching the output would defeat the point of replacing v2.
    blob = json.dumps(dictionary, ensure_ascii=False)
    assert PLACEHOLDER not in blob, f"{PLACEHOLDER!r} leaked into the output"
    print(f"  verified: no {PLACEHOLDER!r} placeholder in the output")

    top = sorted(dictionary.items(), key=lambda kv: -len(kv[1]))[:6]
    print("\nlargest categories:")
    for name, words in top:
        print(f"  {len(words):5}  {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
