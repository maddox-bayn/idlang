#!/usr/bin/env python3
"""Offline tests for build_corpus.py — no network, no cache needed.

These cover the data-integrity guardrails: the filters that keep fabricated,
echoed, and prose-contaminated rows out of the training set, and the split
function that must keep dialect variants of one headword together.

Run:  python3 data_pipeline/test_build_corpus.py
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_corpus import (  # noqa: E402
    PLACEHOLDER,
    Row,
    load_jsonl,
    main,
    normalise,
    reject_reason,
    split_for,
    strip_edges,
)


class TestStripEdges(unittest.TestCase):
    def test_balanced_parentheses_survive(self):
        """The real headword "Rattle (Musical Instrument)" must stay intact."""
        self.assertEqual(strip_edges("Rattle (Musical Instrument)"),
                         "Rattle (Musical Instrument)")

    def test_unmatched_trailing_bracket_is_dropped(self):
        self.assertEqual(strip_edges("Water)"), "Water")

    def test_unmatched_leading_bracket_is_dropped(self):
        self.assertEqual(strip_edges("(Water"), "Water")

    def test_ordinary_punctuation_is_trimmed(self):
        self.assertEqual(strip_edges("  water.  "), "water")
        self.assertEqual(strip_edges("- water ;"), "water")

    def test_interior_punctuation_is_kept(self):
        self.assertEqual(strip_edges("Oj'ee k'ahap'otu"), "Oj'ee k'ahap'otu")


class TestRejectReason(unittest.TestCase):
    def test_placeholder_is_rejected(self):
        """The fabricated filler that fills half the legacy dictionary."""
        self.assertEqual(reject_reason(Row(en="bird", idu=PLACEHOLDER)), "placeholder")

    def test_identical_sides_are_rejected(self):
        """Identical pairs are what taught the model to echo its input."""
        self.assertEqual(reject_reason(Row(en="water", idu="Water")), "identical-sides")

    def test_prose_leak_is_rejected(self):
        self.assertEqual(
            reject_reason(Row(en="water", idu="Ennkpo is Idoma word for water")),
            "prose-leak")

    def test_site_chrome_is_rejected(self):
        self.assertEqual(reject_reason(Row(en="Dictionary", idu="Ennkpo")),
                         "site-chrome")

    def test_ambiguous_chrome_word_survives_when_a_pattern_vouches_for_it(self):
        """"Home" is a nav label AND a headword; Home -> Ole is a real entry.

        A parse pattern means a definition sentence on a dictionary page produced
        the row, which is enough evidence that it is vocabulary and not chrome.
        """
        self.assertIsNone(
            reject_reason(Row(en="Home", idu="Ole", pattern="forward")))

    def test_ambiguous_chrome_word_is_rejected_without_a_pattern(self):
        """With nothing vouching for it, "Home" is treated as navigation."""
        self.assertEqual(reject_reason(Row(en="Home", idu="Ole")), "site-chrome")

    def test_unambiguous_chrome_is_rejected_even_with_a_pattern(self):
        """"Access denied" is never vocabulary, whatever produced the row."""
        self.assertEqual(
            reject_reason(Row(en="Access denied", idu="Ennkpo", pattern="forward")),
            "site-chrome")

    def test_empty_side_is_rejected(self):
        self.assertEqual(reject_reason(Row(en="", idu="Ennkpo")), "empty-side")
        self.assertEqual(reject_reason(Row(en="water", idu="")), "empty-side")

    def test_digits_only_idoma_is_rejected(self):
        self.assertEqual(reject_reason(Row(en="seven", idu="7")), "no-letters")

    def test_good_row_is_kept(self):
        self.assertIsNone(reject_reason(Row(en="Water", idu="Ennkpo")))

    def test_diacritics_are_letters(self):
        """Idoma orthography is diacritic-heavy; those must not read as 'no letters'."""
        self.assertIsNone(reject_reason(Row(en="beauty", idu="Ɔ́hi")))
        self.assertIsNone(reject_reason(Row(en="bridge", idu="àkpà")))


class TestSplit(unittest.TestCase):
    def test_dialect_variants_share_a_split(self):
        """Both forms of one headword must land together or scores inflate."""
        self.assertEqual(split_for("water", 10, 10), split_for("Water", 10, 10))

    def test_split_is_deterministic(self):
        self.assertEqual(split_for("water", 10, 10), split_for("water", 10, 10))

    def test_all_three_splits_are_reachable(self):
        seen = {split_for(f"word{i}", 10, 10) for i in range(400)}
        self.assertEqual(seen, {"train", "dev", "test"})


class TestNormalise(unittest.TestCase):
    def test_nfc_and_whitespace(self):
        self.assertEqual(normalise("àkpà"), "àkpà")
        self.assertEqual(normalise("  two   words "), "two words")

    def test_curly_quotes_straightened(self):
        self.assertEqual(normalise("Oj’ee"), "Oj'ee")


class TestLoadJsonl(unittest.TestCase):
    def test_provenance_source_is_not_read_as_english(self):
        """A row missing its English side must be dropped, not given en="idomaland.org"."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "raw.jsonl"
            path.write_text(
                json.dumps({"idoma": "Ennkpo", "source": "idomaland.org"}) + "\n",
                encoding="utf-8")
            rows = list(load_jsonl(path, "fallback"))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].en, "")
        self.assertEqual(reject_reason(rows[0]), "empty-side")


class TestEndToEnd(unittest.TestCase):
    def test_build_drops_bad_rows_and_writes_splits(self):
        raw = [
            {"english": "Water", "idoma": "Ennkpo", "dialect": "central",
             "pattern": "forward", "source": "idomaland.org"},
            {"english": "Water", "idoma": "Enyi", "dialect": "western",
             "pattern": "forward", "source": "idomaland.org"},
            {"english": "Bird", "idoma": PLACEHOLDER, "source": "legacy"},
            {"english": "Echo", "idoma": "Echo", "source": "idomaland.org"},
            {"english": "Jaw", "idoma": "àgbà", "pattern": "bare",
             "source": "idomaland.org"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            raw_path = tmp / "raw.jsonl"
            raw_path.write_text(
                "\n".join(json.dumps(r, ensure_ascii=False) for r in raw) + "\n",
                encoding="utf-8")
            out = tmp / "out"
            code = main(["--raw", str(raw_path), "--out-dir", str(out),
                         "--eval-seed", str(tmp / "absent.tsv")])
            self.assertEqual(code, 0)

            rows = []
            for name in ("train", "dev", "test"):
                for line in (out / f"{name}.jsonl").read_text(encoding="utf-8").splitlines():
                    rows.append(json.loads(line))
            stats = json.loads((out / "corpus_stats.json").read_text(encoding="utf-8"))

        self.assertEqual(len(rows), 3, "placeholder and echoed rows must be dropped")
        self.assertNotIn(PLACEHOLDER, json.dumps(rows, ensure_ascii=False))
        for row in rows:
            self.assertNotEqual(row["en"].lower(), row["idu"].lower())
        self.assertEqual(stats["rejected"].get("placeholder"), 1)
        self.assertEqual(stats["rejected"].get("identical-sides"), 1)
        # Both dialect forms of "Water" share a split.
        water = {r["idu"] for r in rows if r["en"] == "Water"}
        self.assertEqual(water, {"Ennkpo", "Enyi"})
        self.assertEqual(stats["patterns"].get("bare"), 1)

    def test_min_rows_gate_fails_loudly(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            raw_path = tmp / "raw.jsonl"
            raw_path.write_text(
                json.dumps({"english": "Water", "idoma": "Ennkpo"}) + "\n",
                encoding="utf-8")
            code = main(["--raw", str(raw_path), "--out-dir", str(tmp / "out"),
                         "--eval-seed", str(tmp / "absent.tsv"), "--min-rows", "500"])
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
