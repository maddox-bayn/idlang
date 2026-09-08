#!/usr/bin/env python3
"""Merge backend/idoma_dictionary.json into backend/idoma_dictionary_v3.json.

Why this exists
---------------
Three dictionaries accumulated in backend/, and only two of them are worth keeping:

  * idoma_dictionary_v3.json  -- 218 curated entries, tone-marked, no placeholders.
    The one the backend serves.
  * idoma_dictionary.json     -- 26 hand-checked entries in the v1 bare-string
    schema. Small, but the most consistently tone-marked of the three, and it
    holds 8 words v3 never had.
  * idoma_dictionary_v2.json  -- fabricated. 109 of 218 entries are the "ụụ"
    placeholder and a single form ("òdò") is given for black, day, evening,
    morning, night and red alike. Deleted, not merged.

Conflict policy: the tone-marked form wins
------------------------------------------
Tone is meaning-bearing in Idoma -- "àkpà" is bridge and "ákpá" is cloud -- so a
marked form carries strictly more information than a bare one. Each candidate is
scored by how many of its characters carry a tone diacritic, the denser one wins,
and idoma_dictionary.json breaks ties because its marking is the most consistent.

Nothing is discarded: the losing form is appended to the entry's `example` field
as "also: X", which main.go already surfaces in the response explanation. The
merge is idempotent -- a note that is already present is not added twice.

Where new entries land
----------------------
Slotting a word into a semantic category is a judgement call, so this script does
not make one. Words v3 lacks keep v1's own grouping and go to `core_vocabulary`;
sentences go to `key_phrases`, where v1's other four demo sentences already live.
Re-slot them by hand afterwards if a better category exists.

Usage
-----
    python data_pipeline/merge_dictionary.py            # writes v3 in place
    python data_pipeline/merge_dictionary.py --dry-run  # report only
"""

import argparse
import json
import pathlib
import sys
import unicodedata
from collections import OrderedDict

PLACEHOLDER = "ụụ"  # must match idomaPlaceholder in backend/main.go
DEFAULT_TARGET = pathlib.Path("backend/idoma_dictionary_v3.json")
DEFAULT_SOURCE = pathlib.Path("backend/idoma_dictionary.json")

# v1 section -> the v3 category its unmatched entries belong in.
SECTION_CATEGORY = {
    "core_vocabulary": "core_vocabulary",
    "demo_sentences": "key_phrases",
}


def norm(text):
    """NFC-normalise so 'e' + combining macron compares equal to precomposed 'ē'."""
    return unicodedata.normalize("NFC", str(text)).strip()


def tone_density(text):
    """Fraction of letters carrying a tone diacritic, in [0.0, 1.0].

    Decomposing to NFD exposes combining marks, so precomposed "ē" and an "e"
    followed by U+0304 both count. Comparing a fraction rather than a raw count
    keeps a long bare phrase from outscoring a short marked word.
    """
    letters = [c for c in norm(text) if c.isalpha()]
    if not letters:
        return 0.0
    marked = sum(
        1
        for c in letters
        if any(unicodedata.combining(d) for d in unicodedata.normalize("NFD", c))
    )
    return marked / len(letters)


def idoma_of(entry):
    """Read the Idoma form from either schema: {"idoma": "..."} or a bare string."""
    return entry["idoma"] if isinstance(entry, dict) else entry


def index_by_english(target):
    """english (casefolded) -> (category, key as written), for case-insensitive hits.

    main.go matches with strings.EqualFold, so the merge has to treat "House" and
    "house" as the same entry or it would create a duplicate the lookup can never
    reach deterministically.
    """
    index = {}
    for category, words in target.items():
        for english in words:
            index.setdefault(norm(english).casefold(), (category, english))
    return index


def add_note(entry, note):
    """Append 'also: X' to `example`, unless it is already there."""
    existing = entry.get("example", "")
    if note in existing:
        return False
    entry["example"] = f"{existing}; {note}" if existing else note
    return True


def merge(target, source):
    index = index_by_english(target)
    report = {"same": [], "new": [], "kept_v1": [], "kept_v3": []}

    for section, words in source.items():
        fallback_category = SECTION_CATEGORY.get(section, "core_vocabulary")

        for english, raw in words.items():
            incoming = norm(idoma_of(raw))
            if not incoming or PLACEHOLDER in incoming:
                continue

            hit = index.get(norm(english).casefold())

            if hit is None:
                category = fallback_category
                target.setdefault(category, OrderedDict())[english] = OrderedDict(
                    [("idoma", incoming)]
                )
                index[norm(english).casefold()] = (category, english)
                report["new"].append((english, incoming, category))
                continue

            category, key = hit
            entry = target[category][key]
            if not isinstance(entry, dict):  # normalise a bare-string target entry
                entry = OrderedDict([("idoma", norm(entry))])
                target[category][key] = entry
            current = norm(idoma_of(entry))

            if current.casefold() == incoming.casefold():
                report["same"].append((english, current, category))
                continue

            incoming_score, current_score = tone_density(incoming), tone_density(current)
            # Strictly-greater, so a tie leaves the incoming v1 form to win as the
            # more consistently marked source.
            if current_score > incoming_score:
                add_note(entry, f"also: {incoming}")
                report["kept_v3"].append(
                    (english, current, incoming, current_score, incoming_score, category)
                )
            else:
                entry["idoma"] = incoming
                add_note(entry, f"also: {current}")
                report["kept_v1"].append(
                    (english, incoming, current, incoming_score, current_score, category)
                )

    return target, report


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--target", type=pathlib.Path, default=DEFAULT_TARGET)
    ap.add_argument("--source", type=pathlib.Path, default=DEFAULT_SOURCE)
    ap.add_argument("--dry-run", action="store_true", help="report without writing")
    args = ap.parse_args()

    for path in (args.target, args.source):
        if not path.is_file():
            print(f"error: {path} not found", file=sys.stderr)
            return 1

    with open(args.target, encoding="utf-8") as handle:
        target = json.load(handle, object_pairs_hook=OrderedDict)
    with open(args.source, encoding="utf-8") as handle:
        source = json.load(handle, object_pairs_hook=OrderedDict)

    before = sum(len(w) for w in target.values())
    merged, report = merge(target, source)
    after = sum(len(w) for w in merged.values())

    if report["same"]:
        print(f"unchanged -- both sources agree ({len(report['same'])}):")
        for english, idoma, category in report["same"]:
            print(f"    {english:22} {idoma:16} [{category}]")

    if report["new"]:
        print(f"\nadded -- absent from v3 ({len(report['new'])}):")
        for english, idoma, category in report["new"]:
            print(f"    {english:22} {idoma:16} -> [{category}]")

    if report["kept_v1"]:
        print(f"\nreplaced -- v1 form is more tone-marked ({len(report['kept_v1'])}):")
        for english, won, lost, ws, ls, category in report["kept_v1"]:
            print(
                f"    {english:22} {won:16} ({ws:.2f}) beat {lost:16} ({ls:.2f})"
                f"  [{category}]"
            )

    if report["kept_v3"]:
        print(f"\nkept -- v3 form is more tone-marked ({len(report['kept_v3'])}):")
        for english, won, lost, ws, ls, category in report["kept_v3"]:
            print(
                f"    {english:22} {won:16} ({ws:.2f}) beat {lost:16} ({ls:.2f})"
                f"  [{category}]"
            )

    blob = json.dumps(merged, ensure_ascii=False)
    assert PLACEHOLDER not in blob, f"{PLACEHOLDER!r} leaked into the merged output"

    print(f"\nentries {before} -> {after}   categories {len(merged)}")
    print(f"verified: no {PLACEHOLDER!r} placeholder in the output")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    with open(args.target, "w", encoding="utf-8") as handle:
        json.dump(merged, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"wrote {args.target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
