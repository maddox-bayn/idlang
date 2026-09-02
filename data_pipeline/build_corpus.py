#!/usr/bin/env python3
"""Merge, clean, and split Idoma parallel data into train/dev/test.

Inputs (all optional; whatever exists is used):
  out/idomaland_raw.jsonl       from scrape_idomaland.py
  --extra FILE.jsonl            any additional {"english","idoma",...} rows
  --hf-dataset REPO_ID          a Hugging Face dataset (needs `datasets` + HF_TOKEN
                                for gated repos such as mrheartng/adah-idoma)
  --legacy-dictionary FILE      backend/idoma_dictionary_v2.json — OFF by default,
                                see the note below

Outputs:
  out/train.jsonl  out/dev.jsonl  out/test.jsonl   {"en","idu","dialect","source","url"}
  out/corpus_stats.json

Why the legacy dictionary is excluded by default
------------------------------------------------
backend/idoma_dictionary_v2.json is not usable training data: 109 of its 218
entries map to the single placeholder "ụụ" and 173 of its example sentences reuse
one template. Pass --legacy-dictionary to include the residue anyway; every row is
still run through the same filters and counted separately so you can see how much
survives.

Splitting
---------
Splits are keyed on a hash of the *English* side, so all dialect variants of one
headword land in the same split. Splitting per-row would leak "water/Ennkpo" into
train while "water/Enyi" sat in test, inflating scores.

LICENSING: outputs stay local (data_pipeline/out/ is gitignored). Only the trained
model is published, crediting idomaland.org.

Usage:
    python data_pipeline/build_corpus.py
    python data_pipeline/build_corpus.py --hf-dataset mrheartng/adah-idoma
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable, Iterator, Optional

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"
REPO_ROOT = HERE.parent

PLACEHOLDER = "ụụ"

# Text that means the parse leaked the surrounding English prose into the Idoma
# side. Any row containing one of these is dropped rather than "cleaned", because
# a half-cleaned row is worse than a missing one.
PROSE_MARKERS = (
    "idoma word",
    "idoma phrase",
    "is idoma for",
    "translation",
    "click here",
    "contribut",
    "coming soon",
    "not available",
    "n/a",
)

# English keys that are navigation or site chrome rather than vocabulary.
# Split in two because the risk is not symmetric. The first set is furniture that
# is never a dictionary headword. The second set is ordinary English words that
# merely *also* label a nav link — "home" is both, and rejecting it outright threw
# away the real entry Home -> Ole. Those are only chrome when nothing vouches for
# them, i.e. when no scraper pattern matched a definition sentence on the page.
ENGLISH_STOPLIST = {
    "dictionary", "idomaland", "add a name", "suggest an icon",
    "page not found", "access denied", "log in", "about idoma", "learn idoma",
}
AMBIGUOUS_STOPLIST = {"home", "search", "translate", "books", "comments"}


@dataclass
class Row:
    en: str
    idu: str
    dialect: str = ""
    source: str = ""
    url: str = ""
    # Which scraper pattern produced the row ("forward", "reverse", "bare", or ""
    # for non-scraped sources). "bare" pages carried no explanatory sentence, only
    # the form itself, so they rest on a heuristic — keeping the label here means a
    # noisy pattern can be measured and excluded without re-crawling.
    pattern: str = ""


# ---------------------------------------------------------------------------
# Normalisation and filtering
# ---------------------------------------------------------------------------


def normalise(text: str) -> str:
    """NFC-normalise, straighten quotes, collapse whitespace.

    Idoma orthography is diacritic-heavy (àkpà 'bridge' vs ákpá 'cloud'), so the
    same word can arrive as precomposed or decomposed codepoints. Without NFC the
    tokenizer treats them as different strings and dedupe misses them.
    """
    text = unicodedata.normalize("NFC", str(text))
    text = text.replace("’", "'").replace("‘", "'")
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("–", "-").replace("—", "-")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


_EDGE_CHARS = " \t\r\n.,;:!\"'·•-–—"


def strip_edges(text: str) -> str:
    """Trim stray edge punctuation without breaking balanced brackets.

    Stripping brackets blindly turns the real headword "Rattle (Musical
    Instrument)" into "Rattle (Musical Instrument", which is then malformed for
    every downstream consumer. Only unmatched brackets are removed.
    """
    text = text.strip(_EDGE_CHARS)
    changed = True
    while changed and text:
        changed = False
        for opener, closer in ("()", "[]", "{}"):
            if text.startswith(opener) and closer not in text:
                text = text[1:].strip(_EDGE_CHARS)
                changed = True
            if text.endswith(closer) and opener not in text:
                text = text[:-1].strip(_EDGE_CHARS)
                changed = True
    return text


def reject_reason(row: Row) -> Optional[str]:
    """Return why a row must be dropped, or None to keep it."""
    if not row.en or not row.idu:
        return "empty-side"
    if PLACEHOLDER in row.idu or PLACEHOLDER in row.en:
        return "placeholder"
    if row.en.lower() in ENGLISH_STOPLIST:
        return "site-chrome"
    if row.en.lower() in AMBIGUOUS_STOPLIST and not row.pattern:
        return "site-chrome"
    if row.en.strip().lower() == row.idu.strip().lower():
        # This is the exact pattern that teaches a model to echo its input.
        return "identical-sides"
    lowered = row.idu.lower()
    if any(marker in lowered for marker in PROSE_MARKERS):
        return "prose-leak"
    if len(row.idu) > 200 or len(row.en) > 200:
        return "too-long"
    if not re.search(r"[A-Za-zÀ-ɏḀ-ỿ]", row.idu):
        return "no-letters"
    if len(row.idu) < 2:
        return "too-short"
    return None


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def load_jsonl(path: Path, default_source: str) -> Iterator[Row]:
    if not path.exists():
        print(f"  (skip: {path} not found)", file=sys.stderr)
        return
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            # NB: "source" is deliberately not an English-side fallback. Rows
            # written by scrape_idomaland.py carry source="idomaland.org" as
            # provenance, so accepting it here would silently yield the row
            # en="idomaland.org" instead of dropping a malformed row.
            english = obj.get("english") or obj.get("en") or obj.get("src") or ""
            idoma = obj.get("idoma") or obj.get("idu") or obj.get("tgt") or ""
            yield Row(
                en=normalise(english),
                idu=normalise(idoma),
                dialect=str(obj.get("dialect") or ""),
                source=str(obj.get("source") or default_source),
                url=str(obj.get("url") or ""),
                pattern=str(obj.get("pattern") or ""),
            )


def load_legacy_dictionary(path: Path) -> Iterator[Row]:
    """Read backend/idoma_dictionary_v2.json (both v1 and v2 schemas)."""
    if not path.exists():
        print(f"  (skip: {path} not found)", file=sys.stderr)
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    for category, words in data.items():
        if not isinstance(words, dict):
            continue
        for english, entry in words.items():
            idoma = entry if isinstance(entry, str) else (entry or {}).get("idoma", "")
            yield Row(
                en=normalise(english),
                idu=normalise(idoma),
                source=f"legacy:{category}",
            )


def load_hf_dataset(repo_id: str) -> Iterator[Row]:
    """Load a Hugging Face dataset, guessing the English/Idoma column names."""
    try:
        from datasets import load_dataset
    except ImportError:
        print(f"  (skip {repo_id}: pip install datasets)", file=sys.stderr)
        return

    token = os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
    try:
        dataset = load_dataset(repo_id, token=token)
    except Exception as exc:
        print(f"  (skip {repo_id}: {exc})", file=sys.stderr)
        return

    en_names = ("en", "english", "eng", "source", "src", "text_en", "eng_Latn")
    idu_names = ("idu", "idoma", "target", "tgt", "text_idu", "idu_Latn", "translation")

    for split in dataset:
        for record in dataset[split]:
            english = next((record[k] for k in en_names if k in record and record[k]), "")
            idoma = next((record[k] for k in idu_names if k in record and record[k]), "")
            # Some corpora nest {"translation": {"en": ..., "idu": ...}}.
            if isinstance(idoma, dict):
                english = english or idoma.get("en") or idoma.get("english") or ""
                idoma = idoma.get("idu") or idoma.get("idoma") or ""
            if not english or not idoma:
                continue
            yield Row(en=normalise(english), idu=normalise(idoma),
                      source=f"hf:{repo_id}", url=f"https://huggingface.co/datasets/{repo_id}")


def load_eval_seed(path: Path) -> tuple[list[Row], set[str]]:
    """Read the hand-verified TSV eval seed: english<TAB>idoma[<TAB>dialect]."""
    rows: list[Row] = []
    keys: set[str] = set()
    if not path.exists():
        return rows, keys
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            continue
        parts = [p.strip() for p in raw.split("\t")]
        if len(parts) < 2 or not parts[0] or not parts[1]:
            continue
        row = Row(en=normalise(parts[0]), idu=normalise(parts[1]),
                  dialect=parts[2] if len(parts) > 2 else "",
                  source="eval-seed:hand-verified")
        if reject_reason(row):
            continue
        rows.append(row)
        keys.add(row.en.lower())
    return rows, keys


# ---------------------------------------------------------------------------
# Splitting
# ---------------------------------------------------------------------------


def split_for(english: str, dev_pct: int, test_pct: int, salt: str = "idlang") -> str:
    """Deterministic split assignment keyed on the English side.

    Keying on English (not the row) keeps every dialect variant of a headword in
    one split, so the model can never see "water -> Ennkpo" in train and be scored
    on "water -> Enyi" in test.
    """
    digest = hashlib.sha256(f"{salt}:{english.lower()}".encode("utf-8")).hexdigest()
    bucket = int(digest[:8], 16) % 100
    if bucket < test_pct:
        return "test"
    if bucket < test_pct + dev_pct:
        return "dev"
    return "train"


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw", type=Path, default=OUT_DIR / "idomaland_raw.jsonl")
    parser.add_argument("--extra", type=Path, action="append", default=[],
                        help="additional JSONL files of pairs (repeatable)")
    parser.add_argument("--hf-dataset", action="append", default=[],
                        help="Hugging Face dataset repo id (repeatable)")
    parser.add_argument("--legacy-dictionary", type=Path, nargs="?",
                        const=REPO_ROOT / "backend" / "idoma_dictionary_v2.json",
                        help="include the legacy dictionary (off by default; see docstring)")
    parser.add_argument("--eval-seed", type=Path, default=HERE / "eval_seed.tsv",
                        help="hand-verified TSV pairs, forced into the test split")
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--dev-pct", type=int, default=10)
    parser.add_argument("--test-pct", type=int, default=10)
    parser.add_argument("--min-rows", type=int, default=0,
                        help="exit non-zero if fewer than this many rows survive")
    args = parser.parse_args(argv)

    sources: list[Iterable[Row]] = []
    print("Loading sources:", file=sys.stderr)
    print(f"  {args.raw}", file=sys.stderr)
    sources.append(load_jsonl(args.raw, "idomaland.org"))
    for extra in args.extra:
        print(f"  {extra}", file=sys.stderr)
        sources.append(load_jsonl(extra, str(extra.name)))
    for repo in args.hf_dataset:
        print(f"  hf:{repo}", file=sys.stderr)
        sources.append(load_hf_dataset(repo))
    if args.legacy_dictionary:
        print(f"  {args.legacy_dictionary} (legacy, explicitly requested)", file=sys.stderr)
        sources.append(load_legacy_dictionary(args.legacy_dictionary))

    seed_rows, seed_keys = load_eval_seed(args.eval_seed)
    if seed_rows:
        print(f"  {args.eval_seed}: {len(seed_rows)} hand-verified pairs (held out)",
              file=sys.stderr)

    kept: dict[tuple[str, str], Row] = {}
    rejected: Counter[str] = Counter()
    per_source_in: Counter[str] = Counter()
    per_source_kept: Counter[str] = Counter()
    duplicates = 0

    for stream in sources:
        for row in stream:
            row.en = strip_edges(row.en)
            row.idu = strip_edges(row.idu)
            per_source_in[row.source.split(":")[0]] += 1
            reason = reject_reason(row)
            if reason:
                rejected[reason] += 1
                continue
            key = (row.en.lower(), row.idu.lower())
            if key in kept:
                duplicates += 1
                continue
            kept[key] = row
            per_source_kept[row.source.split(":")[0]] += 1

    # Hand-verified seed pairs are the clean test set: never train on them.
    splits: dict[str, list[Row]] = {"train": [], "dev": [], "test": []}
    forced_out = 0
    for row in kept.values():
        if row.en.lower() in seed_keys:
            forced_out += 1
            continue
        splits[split_for(row.en, args.dev_pct, args.test_pct)].append(row)

    for row in seed_rows:
        splits["test"].append(row)

    for name in splits:
        splits[name].sort(key=lambda r: (r.en.lower(), r.idu.lower()))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for name, rows in splits.items():
        path = args.out_dir / f"{name}.jsonl"
        with path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(asdict(row), ensure_ascii=False) + "\n")

    total = sum(len(r) for r in splits.values())
    stats = {
        "rows_total": total,
        "rows_train": len(splits["train"]),
        "rows_dev": len(splits["dev"]),
        "rows_test": len(splits["test"]),
        "distinct_english": len({r.en.lower() for rows in splits.values() for r in rows}),
        "distinct_idoma": len({r.idu.lower() for rows in splits.values() for r in rows}),
        "duplicates_dropped": duplicates,
        "rejected": dict(rejected),
        "rows_in_per_source": dict(per_source_in),
        "rows_kept_per_source": dict(per_source_kept),
        "eval_seed_pairs": len(seed_rows),
        "overlaps_removed_for_seed": forced_out,
        "dialects": dict(Counter(r.dialect or "unspecified"
                                 for rows in splits.values() for r in rows)),
        "patterns": dict(Counter(r.pattern or "unspecified"
                                 for rows in splits.values() for r in rows)),
    }
    (args.out_dir / "corpus_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== corpus summary ===", file=sys.stderr)
    print(json.dumps(stats, ensure_ascii=False, indent=2), file=sys.stderr)

    # A placeholder or echoed row reaching the output is a hard failure: those are
    # exactly the defects that produced the original untranslated-output bug.
    for name, rows in splits.items():
        for row in rows:
            assert PLACEHOLDER not in row.idu, f"placeholder leaked into {name}: {row}"
            assert row.en.lower() != row.idu.lower(), f"identical pair in {name}: {row}"
    print("assertions passed: no placeholder rows, no identical pairs", file=sys.stderr)

    if total < args.min_rows:
        print(f"ERROR: only {total} rows, expected at least {args.min_rows}",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
