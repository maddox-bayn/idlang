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
    classify_note,
    dialect_from_tags,
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

    def test_bare_form_field(self):
        """Many pages hold only the Idoma form, with no sentence around it."""
        forms, pattern = parse_forms("Onowa")
        self.assertEqual(forms, [("Onowa", "")])
        self.assertEqual(pattern, "bare")

    def test_bare_form_with_variants(self):
        forms, pattern = parse_forms("Kum or Ekum")
        self.assertEqual(forms, [("Kum", ""), ("Ekum", "")])
        self.assertEqual(pattern, "bare")

    def test_bare_form_with_spaced_dialect_parentheses(self):
        forms, pattern = parse_forms(
            "Kpemm ( central Idoma ) or Odudu ( western Idoma )")
        self.assertEqual(forms, [("Kpemm", "central"), ("Odudu", "western")])
        self.assertEqual(pattern, "bare")

    def test_bare_form_keeps_apostrophes(self):
        """A leading vowel + apostrophe must not read as the English article 'a'."""
        forms, pattern = parse_forms("A'oche")
        self.assertEqual(forms, [("A'oche", "")])
        self.assertEqual(pattern, "bare")

    def test_bare_field_rejects_english_prose(self):
        """A short English note is not a headword, even with no verb in it."""
        for prose in ("Contributions welcome", "pending review", "not yet known"):
            with self.subTest(prose=prose):
                forms, pattern = parse_forms(prose)
                self.assertEqual(forms, [])
                self.assertEqual(pattern, "none")

    def test_reverse_with_comma_after_is(self):
        forms, pattern = parse_forms(
            "The Idoma word for Extinguish or Switch off is, "
            "Mi (central Idoma) or Nyi (western Idoma)")
        self.assertEqual(forms, [("Mi", "central"), ("Nyi", "western")])
        self.assertEqual(pattern, "reverse")

    def test_reverse_with_either(self):
        forms, pattern = parse_forms(
            "How to pronounce the Idoma word for the number eight (8), "
            "which is either Ahata or Alata")
        self.assertEqual(forms, [("Ahata", ""), ("Alata", "")])
        self.assertEqual(pattern, "reverse")

    def test_island_is_not_read_as_the_verb_is(self):
        """`is` must need a separator, or 'island' splits into 'is' + 'land'."""
        forms, _ = parse_forms("The Idoma word for a small island in the river")
        self.assertEqual(forms, [])

    def test_forward_accepts_quote_instead_of_space_before_is(self):
        """The site sometimes drops the space: '"Odokum"is the Idoma phrase ...'.

        A closing quote is a real word boundary, so the page should parse — while
        an unquoted 'island' must still not split (see the test above).
        """
        forms, pattern = parse_forms(
            '"Ihotu Kum" or "Odokum"is the Idoma phrase for "My Heart"')
        self.assertEqual(pattern, "forward")
        self.assertEqual(forms, [("Ihotu Kum", ""), ("Odokum", "")])

    def test_reverse_accepts_word_or_phrase_framing(self):
        """"The Idoma word or phrase for X is Y" must not parse as forward.

        Without the or-alternation, _FORWARD_RE wins and yields the framing
        itself: [("The Idoma word", ""), ("phrase for letter", "")].
        """
        forms, pattern = parse_forms(
            "The Idoma word or phrase for letter is Okpa .")
        self.assertEqual(pattern, "reverse")
        self.assertEqual(forms, [("Okpa", "")])

    def test_in_idoma_shape(self):
        """"<English> in Idoma is <forms>" puts the forms after the verb."""
        forms, pattern = parse_forms(
            "Chicken Egg in Idoma is either Ahi'ugwu (central Idoma) "
            "or Aj'ugwu (western Idoma).")
        self.assertEqual(pattern, "in-idoma")
        self.assertEqual(forms, [("Ahi'ugwu", "central"), ("Aj'ugwu", "western")])

    def test_in_idoma_shape_with_quoted_headword(self):
        forms, pattern = parse_forms('"Dig a Hole" in Idoma is B\'ogo.')
        self.assertEqual(pattern, "in-idoma")
        self.assertEqual(forms, [("B'ogo", "")])

    def test_comma_inside_dialect_note_does_not_split_the_form(self):
        """A multi-dialect note contains a comma; splitting on it breaks the form.

        "Ochanya (Central, Western & Northern Idoma)" must stay one chunk, or the
        corpus gains "Ochanya (Central" and "Western & Northern Idoma)" as
        Idoma headwords. No single tag describes three dialects, so the dialect
        field is left empty rather than guessed.
        """
        forms, pattern = parse_forms(
            "Ochanya (Central, Western & Northern Idoma) or "
            "Otsanya (Southern Idoma) is the Idoma word for Queen.")
        self.assertEqual(pattern, "forward")
        self.assertEqual(forms, [("Ochanya", ""), ("Otsanya", "southern")])

    def test_top_level_commas_still_split(self):
        """Depth tracking must not disable ordinary comma separation."""
        forms, _ = parse_forms("Ape, Ipu, Odu is the Idoma word for hand")
        self.assertEqual(forms, [("Ape", ""), ("Ipu", ""), ("Odu", "")])

    def test_verb_in_trailing_english_gloss_is_not_the_reverse_verb(self):
        """'... Idoma phrase for "How are you"' must parse forward, not reverse.

        An unanchored reverse search consumed the 'are' inside the English gloss
        and returned 'you' as the Idoma form. This corrupted 23 real rows.
        """
        forms, pattern = parse_forms(
            'Abo le? is the Idoma phrase for "How are you".')
        self.assertEqual(pattern, "forward")
        self.assertEqual(forms, [("Abo le?", "")])

    def test_quoted_phrase_with_verb_in_gloss(self):
        forms, pattern = parse_forms(
            '" Enem Gbee Hii " is the Idoma phrase for "my mother is fine".')
        self.assertEqual(pattern, "forward")
        self.assertEqual(forms, [("Enem Gbee Hii", "")])

    def test_reverse_still_wins_when_framing_comes_first(self):
        """The guard must not break genuine reverse sentences."""
        forms, pattern = parse_forms("The Idoma word for water is Ennkpo.")
        self.assertEqual(pattern, "reverse")
        self.assertEqual(forms, [("Ennkpo", "")])

    def test_pronunciation_note_is_not_a_dialect(self):
        """"Chɛ (che)" is a respelling, not a dialect marker."""
        forms, _ = parse_forms("Chɛ (che) is the Idoma word for agree")
        self.assertEqual(forms, [("Chɛ", "")])

    def test_misspelt_dialect_marker_still_maps(self):
        """The site writes 'nothern idoma'; it must not become its own dialect."""
        forms, _ = parse_forms("Amgbe (nothern idoma) is Idoma word for lie")
        self.assertEqual(forms, [("Amgbe", "northern")])

    def test_known_dialect_marker_survives_spacing(self):
        forms, _ = parse_forms("Kpemm (  Central  Idoma  ) is Idoma word for all")
        self.assertEqual(forms, [("Kpemm", "central")])


class TestDialectTagging(unittest.TestCase):
    def test_multi_dialect_note_is_unspecified(self):
        """A note naming three dialects describes none of them exclusively.

        The fuzzy matcher exists for the site's typos, not for collapsing
        "Central, Western & Northern Idoma" down to whichever single tag it
        happens to score highest.
        """
        self.assertEqual(classify_note("Central, Western & Northern Idoma"), "")
        self.assertEqual(classify_note("Central & Western Idoma"), "")

    def test_typo_tolerance_survives_the_multi_dialect_guard(self):
        self.assertEqual(classify_note("nothern idoma"), "northern")
        self.assertEqual(classify_note("Southern Idoma"), "southern")

    def test_pronunciation_respelling_is_not_a_dialect(self):
        self.assertEqual(classify_note("che"), "")

    def test_single_page_dialect_tag_is_used_as_fallback(self):
        self.assertEqual(dialect_from_tags(["Nature", "Central Idoma"]), "central")

    def test_several_page_dialect_tags_give_no_fallback(self):
        """/dictionary/queen is tagged with all four dialects at once.

        Returning the first match labelled Ochanya — a central/western/northern
        form — as plain "central". Several tags say nothing about which form
        belongs to which dialect, so no fallback is the honest answer.
        """
        self.assertEqual(
            dialect_from_tags(["Humans", "Central Idoma", "Western Idoma",
                               "Southern Idoma", "Northern Idoma"]),
            "")

    def test_repeated_tag_still_counts_once(self):
        self.assertEqual(dialect_from_tags(["Central Idoma", "central idoma"]),
                         "central")


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

    def test_queen_page_shape_keeps_dialects_honest(self):
        """The real /dictionary/queen markup: a multi-dialect note plus four tags.

        This is the end-to-end version of the two guards — neither the note nor
        the page tags may narrow Ochanya to a single dialect, while Otsanya keeps
        the one its own note gives it.
        """
        page = make_page(
            "Queen",
            "Ochanya (Central, Western &amp; Northern Idoma) or "
            "Otsanya (Southern Idoma) is the Idoma word for Queen.",
            tags=["Humans", "Central Idoma", "Western Idoma",
                  "Southern Idoma", "Northern Idoma"])
        entries, reason = parse_page("https://x/dictionary/queen", page)
        self.assertEqual(reason, "")
        self.assertEqual([e.idoma for e in entries], ["Ochanya", "Otsanya"])
        self.assertEqual([e.dialect for e in entries], ["", "southern"])
        self.assertEqual(entries[0].tags, ["Humans"])

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
