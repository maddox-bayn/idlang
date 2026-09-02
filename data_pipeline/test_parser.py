"""Offline tests for the idomaland.org parser.

The fixtures mirror the real Drupal markup verified against
https://www.idomaland.org/dictionary/water so the parser can be checked without
hitting the (rate-limited) live site.

Run:  python3 data_pipeline/test_parser.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from scrape_idomaland import (  # noqa: E402
    PLACEHOLDER,
    extract_definition,
    extract_english,
    extract_tags,
    is_interstitial,
    normalise,
    parse_forms,
    parse_page,
)

PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="en"><head><title>{title} | IdomaLand</title></head>
<body>
<nav><a href="/dictionary">Dictionary</a><a href="/translate">Translate</a></nav>
<div class="breadcrumb"><a href="/">Home</a><a href="/dictionary">dictionary</a></div>
<span class="field field--name-title field--type-string field--label-hidden">{title}</span>
<div class="clearfix text-formatted field field--name-body field--type-text-with-summary field--label-above">
  <div class="field__label">Idoma Word or Phrase</div>
  <div class="field__item"><p>{definition}</p></div>
</div>
<div class="field field--name-field-written-by field--label-inline">
  <div class="field__label inline">By</div>
  <div class="field__items"><div class="field__item">Linda Ene Iji</div></div>
</div>
<div class="field field--name-field-tags field--label-hidden field__items">
{tags}
</div>
<section class="comment-wrapper"><h2>Add new comment</h2></section>
<footer><a href="/about-us">About Us</a></footer>
</body></html>
"""

INTERSTITIAL = """<!DOCTYPE html><html><head>
<script>(function(){setTimeout(function(){window.location.reload();}, 5000);}())</script>
<title>One moment, please...</title></head><body><div class="throbber"></div></body></html>
"""


def make_page(title: str, definition: str, tags: list[str] | None = None) -> str:
    tags = tags if tags is not None else ["Edibles", "Central Idoma", "Western Idoma"]
    rendered = "\n".join(
        f'  <div class="field__item"><a href="/tags/{t.lower().replace(" ", "-")}">{t}</a></div>'
        for t in tags
    )
    return PAGE_TEMPLATE.format(title=title, definition=definition, tags=rendered)


class TestFieldExtraction(unittest.TestCase):
    def test_english_from_title_field(self):
        page = make_page("Water", "Ennkpo is Idoma word for water.")
        self.assertEqual(extract_english(page, "https://x/dictionary/water"), "Water")

    def test_english_falls_back_to_html_title(self):
        page = "<html><head><title>Moon | IdomaLand</title></head><body></body></html>"
        self.assertEqual(extract_english(page, "https://x/dictionary/moon"), "Moon")

    def test_english_falls_back_to_slug(self):
        page = "<html><body>nothing useful</body></html>"
        self.assertEqual(
            extract_english(page, "https://x/dictionary/good-morning"), "good morning"
        )

    def test_definition_uses_the_label_anchor(self):
        page = make_page("Water", "Ennkpo (central Idoma) is Idoma word for water.")
        self.assertEqual(
            extract_definition(page), "Ennkpo (central Idoma) is Idoma word for water."
        )

    def test_missing_definition_returns_none(self):
        self.assertIsNone(extract_definition("<html><body><p>hi</p></body></html>"))

    def test_tags_are_extracted_in_order(self):
        page = make_page("Water", "Ennkpo is Idoma word for water.")
        self.assertEqual(extract_tags(page), ["Edibles", "Central Idoma", "Western Idoma"])

    def test_interstitial_detection(self):
        self.assertTrue(is_interstitial(INTERSTITIAL))
        self.assertFalse(is_interstitial(make_page("Water", "Ennkpo is Idoma for water.")))


class TestFormParsing(unittest.TestCase):
    def test_two_dialect_variants(self):
        forms, pattern = parse_forms(
            "Ennkpo (central Idoma) or Enyi (western Idoma) is Idoma word for water."
        )
        self.assertEqual(pattern, "forward")
        self.assertEqual(forms, [("Ennkpo", "central"), ("Enyi", "western")])

    def test_no_trailing_period(self):
        forms, _ = parse_forms(
            "Le (central Idoma) or Re (western Idoma) is Idoma word for eat"
        )
        self.assertEqual(forms, [("Le", "central"), ("Re", "western")])

    def test_phrase_with_apostrophe_and_quoted_english(self):
        forms, _ = parse_forms('Nyo gw\'ije is the idoma phrase for "I am singing".')
        self.assertEqual(forms, [("Nyo gw'ije", "")])

    def test_reverse_word_order(self):
        forms, pattern = parse_forms("The Idoma word for water is Ennkpo.")
        self.assertEqual(pattern, "reverse")
        self.assertEqual(forms, [("Ennkpo", "")])

    def test_slash_separated_variants(self):
        forms, _ = parse_forms("Ojima / Ojima is Idoma word for good.")
        self.assertEqual(forms, [("Ojima", ""), ("Ojima", "")])

    def test_unparseable_prose_returns_nothing(self):
        forms, pattern = parse_forms("Please help us translate this entry.")
        self.assertEqual(forms, [])
        self.assertEqual(pattern, "none")

    def test_long_prose_chunk_is_rejected(self):
        forms, _ = parse_forms(
            "This entry has not yet been reviewed by any of our contributors and "
            "is Idoma word for something"
        )
        self.assertEqual(forms, [])


class TestPageIntegration(unittest.TestCase):
    def test_dialect_split_produces_two_rows(self):
        page = make_page(
            "Water", "Ennkpo (central Idoma) or Enyi (western Idoma) is Idoma word for water."
        )
        entries, reason = parse_page("https://x/dictionary/water", page)
        self.assertEqual(reason, "")
        self.assertEqual(len(entries), 2)
        self.assertEqual([e.idoma for e in entries], ["Ennkpo", "Enyi"])
        self.assertEqual([e.dialect for e in entries], ["central", "western"])
        # Dialect markers are not categories.
        self.assertEqual(entries[0].tags, ["Edibles"])

    def test_dialect_falls_back_to_page_tag(self):
        page = make_page("Moon", "Ochi is Idoma word for moon.", tags=["Nature", "Central Idoma"])
        entries, _ = parse_page("https://x/dictionary/moon", page)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].dialect, "central")
        self.assertEqual(entries[0].tags, ["Nature"])

    def test_placeholder_rows_are_dropped(self):
        page = make_page("Monkey", f"{PLACEHOLDER} is Idoma word for monkey.")
        entries, reason = parse_page("https://x/dictionary/monkey", page)
        self.assertEqual(entries, [])
        self.assertEqual(reason, "all-forms-rejected")

    def test_echoed_english_is_dropped(self):
        """An 'Idoma' form equal to the English headword teaches echoing."""
        page = make_page("Table", "Table is Idoma word for table.")
        entries, reason = parse_page("https://x/dictionary/table", page)
        self.assertEqual(entries, [])
        self.assertEqual(reason, "all-forms-rejected")

    def test_unparsed_definition_is_reported(self):
        page = make_page("Zebra", "Contributions welcome for this entry.")
        entries, reason = parse_page("https://x/dictionary/zebra", page)
        self.assertEqual(entries, [])
        self.assertEqual(reason, "unparsed-definition")

    def test_provenance_is_recorded(self):
        page = make_page("Water", "Ennkpo is Idoma word for water.")
        entries, _ = parse_page("https://x/dictionary/water", page)
        entry = entries[0]
        self.assertEqual(entry.source, "idomaland.org")
        self.assertEqual(entry.url, "https://x/dictionary/water")
        self.assertEqual(entry.pattern, "forward")
        self.assertIn("Ennkpo", entry.definition)


class TestNormalise(unittest.TestCase):
    def test_nfc_composition(self):
        # 'ọ' as o + U+0323 combining dot below must compose to a single codepoint.
        decomposed = "ọ"
        self.assertEqual(len(normalise(decomposed)), 1)

    def test_curly_quotes_become_straight(self):
        self.assertEqual(normalise("gw’ije"), "gw'ije")

    def test_whitespace_collapses(self):
        self.assertEqual(normalise("  a   b \n c "), "a b c")


if __name__ == "__main__":
    unittest.main(verbosity=2)
