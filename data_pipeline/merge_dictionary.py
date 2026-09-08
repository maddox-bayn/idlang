#!/usr/bin/env python3
"""Merge another dictionary into backend/idoma_dictionary_v3.json, tone marks winning.

Why this exists
---------------
The served dictionary is a merge of three sources of different size and quality, and
the merge order encodes which one to believe:

  1. idoma_dictionary.json -- 26 hand-checked entries in the v1 bare-string schema.
     Tiny, but the most consistently tone-marked, so it wins ties.
  2. the 218 curated entries idoma_dictionary_v3.json started as -- tone-marked,
     no placeholders, but only ~5% of the vocabulary the app is asked for.
  3. data_pipeline/out/corpus_dictionary.json -- 1,117 entries built by
     build_dictionary.py from the idomaland.org scrape. Twenty times the coverage
     and each pair has a source URL, but almost entirely *untoned*.

  idoma_dictionary_v2.json is not in that list. It is fabricated: 109 of its 218
  entries are the "ụụ" placeholder and one form ("òdò") is given for black, day,
  evening, morning, night and red alike. Deleted, not merged.

Sources 1 and 2 are already merged. To rebuild from the corpus:

    python data_pipeline/build_dictionary.py
    python data_pipeline/merge_dictionary.py \
        --source data_pipeline/out/corpus_dictionary.json --tie target

Conflict policy: the tone-marked form wins
------------------------------------------
Tone is meaning-bearing in Idoma -- "àkpà" is bridge and "ákpá" is cloud -- so a
marked form carries strictly more information than a bare one. Each candidate is
scored by the fraction of its letters carrying a tone diacritic and the denser one
wins. This is what makes the corpus merge safe: it adds the ~1,000 words the curated
file never had without overwriting a single marked form with a bare one.

`--tie` decides equal scores, which is the whole of the source-precedence question:

    --tie source  (default)  the incoming file wins -- used for idoma_dictionary.json
    --tie target             the file on disk wins  -- used for the corpus

Nothing is discarded: the losing form is appended to the entry's `example` field as
"also: X", which main.go already surfaces in the response explanation. The merge is
idempotent -- a note that is already present is not added twice, and a form that is
already the winner is left alone.

Where new entries land
----------------------
A word the target lacks keeps its own source grouping rather than being re-slotted by
guesswork. CATEGORY_ALIAS folds the source's names onto the target's where they mean
the same thing, so a rebuild does not leave the app showing both "Animals" and
"animals"; everything else is snake_cased and kept as its own category.
"""

import argparse
import json
import pathlib
import re
import sys
import unicodedata
from collections import OrderedDict

PLACEHOLDER = "ụụ"  # must match idomaPlaceholder in backend/main.go
DEFAULT_TARGET = pathlib.Path("backend/idoma_dictionary_v3.json")
DEFAULT_SOURCE = pathlib.Path("backend/idoma_dictionary.json")

# Source section -> the target category its unmatched entries belong in. Only for
# names that do not simply snake_case onto an existing one: the two v1 sections,
# and the idomaland.org tags that are the scrape's word for a category the curated
# file already has ("Edibles" is "food", "Colour" is "colors").
CATEGORY_ALIAS = {
    "core_vocabulary": "core_vocabulary",
    "demo_sentences": "key_phrases",
    "Time Periods": "time",
    "Edibles": "food",
    "Transportation": "transport",
    "Object": "objects",
    "Colour": "colors",
    "Body": "body_parts",
    "Place": "places",
}


def norm(text):
    """NFC-normalise so 'e' + combining macron compares equal to precomposed 'ē'."""
    return unicodedata.normalize("NFC", str(text)).strip()


def category_of(section):
    """Map a source section name to a target category name.

    Unaliased names are snake_cased ("Social Interaction" -> "social_interaction") so
    the corpus's Title Case tags sit alongside the curated file's existing categories
    instead of duplicating them by capitalisation alone.
    """
    if section in CATEGORY_ALIAS:
        return CATEGORY_ALIAS[section]
    return re.sub(r"[^a-z0-9]+", "_", norm(section).casefold()).strip("_") or "general"


def tone_density(text):
    """Fraction of letters carrying a tone diacritic, in [0.0, 1.0].

    Counting over the NFD decomposition rather than over characters is load-bearing.
    "ē" has a precomposed form (U+0113) but "ɛ̄" does not -- U+025B has no composed
    macron -- so it stays as ɛ + U+0304 through NFC, and `isalpha()` is False for a
    combining mark. Testing characters for alphabetic-ness therefore threw the mark
    away and scored "omɛ̄hɛ̄" and "ɛ̄wɔ̄" as 0.00, unmarked, which is exactly wrong for
    the ɛ/ɔ vowels Idoma orthography leans on hardest.

    So: walk the decomposition, count base letters, and attribute each combining mark
    to the letter it follows. Comparing a fraction rather than a raw count keeps a
    long bare phrase from outscoring a short marked word.
    """
    letters = marked = 0
    for ch in unicodedata.normalize("NFD", norm(text)):
        if unicodedata.combining(ch):
            marked += 1
        elif ch.isalpha():
            letters += 1
    if not letters:
        return 0.0
    return min(marked / letters, 1.0)  # a doubly-marked letter must not exceed 1.0


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
    """Append 'also: X' to `example`, unless it is already there.

    Case-insensitively -- the curated files and the scrape disagree about
    capitalising Idoma nouns, so a case-sensitive check let a second merge append
    "also: Ole" to an entry that already said "also: ole".
    """
    existing = entry.get("example", "")
    if note.casefold() in existing.casefold():
        return False
    entry["example"] = f"{existing}; {note}" if existing else note
    return True


def dedupe(target):
    """Collapse an English key that appears in more than one category.

    This is a correctness fix, not tidiness. main.go iterates the categories to find a
    match and Go randomises map order, so a key in two categories answers from one or
    the other between restarts -- and the two copies need not agree. The curated file
    shipped one: "goat" was in both fauna_elements ("Èwü", with an "also: Ewu"
    alternate) and animals ("èwü", without it).

    The richer entry wins -- most fields, then longest `example` -- and the loser's
    Idoma form is folded in as a note rather than dropped, so collapsing cannot lose a
    variant. The category kept is whichever the winner was already in; re-slot by hand
    if the other reads better.
    """
    locations = {}
    for category, words in target.items():
        for english in words:
            locations.setdefault(norm(english).casefold(), []).append((category, english))

    removed = []
    for duplicates in locations.values():
        if len(duplicates) < 2:
            continue

        def richness(loc):
            entry = target[loc[0]][loc[1]]
            return (len(entry), len(entry.get("example", ""))) if isinstance(entry, dict) else (0, 0)

        winner, *losers = sorted(duplicates, key=richness, reverse=True)
        keep = target[winner[0]][winner[1]]
        for category, english in losers:
            lost = norm(idoma_of(target[category][english]))
            if isinstance(keep, dict) and lost.casefold() != norm(idoma_of(keep)).casefold():
                add_note(keep, f"also: {lost}")
            del target[category][english]
            removed.append((english, category, winner[0]))

    return removed


def merge(target, source, tie="source"):
    index = index_by_english(target)
    report = {"same": [], "new": [], "kept_source": [], "kept_target": []}

    for section, words in source.items():
        fallback_category = category_of(section)

        for english, raw in words.items():
            incoming_entry = raw if isinstance(raw, dict) else {"idoma": raw}
            incoming = norm(idoma_of(incoming_entry))
            if not incoming or PLACEHOLDER in incoming:
                continue

            hit = index.get(norm(english).casefold())

            if hit is None:
                category = fallback_category
                fresh = OrderedDict([("idoma", incoming)])
                # Dialect and alternate forms build_dictionary.py recorded ("central
                # Idoma: Ennkpo") are part of the entry, not commentary -- carry them.
                if incoming_entry.get("example"):
                    fresh["example"] = norm(incoming_entry["example"])
                target.setdefault(category, OrderedDict())[english] = fresh
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
            if current_score > incoming_score or (
                current_score == incoming_score and tie == "target"
            ):
                add_note(entry, f"also: {incoming}")
                report["kept_target"].append(
                    (english, current, incoming, current_score, incoming_score, category)
                )
            else:
                entry["idoma"] = incoming
                add_note(entry, f"also: {current}")
                report["kept_source"].append(
                    (english, incoming, current, incoming_score, current_score, category)
                )

    return target, report


def show(heading, rows, limit):
    """Print a conflict list, truncated -- a corpus merge produces ~1,000 rows."""
    if not rows:
        return
    print(f"\n{heading} ({len(rows)}):")
    for row in rows[:limit]:
        if len(row) == 3:
            english, idoma, category = row
            print(f"    {english:22} {idoma:20} [{category}]")
        else:
            english, won, lost, ws, ls, category = row
            print(
                f"    {english:22} {won:20} ({ws:.2f}) beat {lost:20} ({ls:.2f})"
                f"  [{category}]"
            )
    if len(rows) > limit:
        print(f"    ... and {len(rows) - limit} more")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--target", type=pathlib.Path, default=DEFAULT_TARGET)
    ap.add_argument("--source", type=pathlib.Path, default=DEFAULT_SOURCE)
    ap.add_argument(
        "--tie",
        choices=("source", "target"),
        default="source",
        help="which side wins when both forms are equally tone-marked",
    )
    ap.add_argument("--limit", type=int, default=25, help="rows to print per section")
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
    categories_before = len(target)

    collapsed = dedupe(target)
    if collapsed:
        print(f"collapsed {len(collapsed)} duplicate key(s) -- Go map order made these "
              f"nondeterministic:")
        for english, dropped_from, kept_in in collapsed:
            print(f"    {english:22} dropped from [{dropped_from}], kept in [{kept_in}]")
        print()

    merged, report = merge(target, source, tie=args.tie)
    after = sum(len(w) for w in merged.values())

    print(f"merging {args.source} -> {args.target}   (ties go to the {args.tie})")
    show("unchanged -- both sources agree", report["same"], args.limit)
    show("added -- absent from the target", report["new"], args.limit)
    show(
        "replaced -- the incoming form is more tone-marked",
        report["kept_source"],
        args.limit,
    )
    show(
        "kept -- the existing form is more tone-marked",
        report["kept_target"],
        args.limit,
    )

    blob = json.dumps(merged, ensure_ascii=False)
    assert PLACEHOLDER not in blob, f"{PLACEHOLDER!r} leaked into the merged output"

    print(f"\nentries {before} -> {after}   categories {categories_before} -> {len(merged)}")
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
