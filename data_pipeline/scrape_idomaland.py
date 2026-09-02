#!/usr/bin/env python3
"""Scrape English -> Idoma word/phrase pairs from idomaland.org.

idomaland.org is the only substantial openly-readable Idoma lexical source: the
sitemap exposes ~1,100 `/dictionary/<slug>` pages, each a Drupal node with an
English title and an Idoma gloss, often split by dialect.

Page structure (verified live against /dictionary/water):

    <span class="field field--name-title ...">Water</span>
    ...
    <div class="field field--name-body ... field--label-above">
      <div class="field__label">Idoma Word or Phrase</div>
      <div class="field__item">
        Ennkpo (central Idoma) or Enyi (western Idoma) is Idoma word for water.
      </div>
    </div>
    <div class="field field--name-field-tags ...">
      <a href="/tags/edibles">Edibles</a>
      <a href="/tags/central-idoma">Central Idoma</a>
      <a href="/tags/western-idoma">Western Idoma</a>
    </div>

Politeness: robots.txt is consulted, requests are serialised with a delay, and
every response is cached on disk so re-runs cost nothing.

LICENSING: the scraped text stays local. `data_pipeline/out/` and
`data_pipeline/cache/` are gitignored and must not be published. Only the trained
model is distributed, with attribution to idomaland.org in its model card.

Usage:
    python data_pipeline/scrape_idomaland.py                 # full crawl
    python data_pipeline/scrape_idomaland.py --limit 20      # smoke test
"""

from __future__ import annotations

import argparse
import difflib
import gzip
import hashlib
import html
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Iterable, Iterator, Optional

BASE = "https://www.idomaland.org"
SITEMAP = f"{BASE}/sitemap.xml"
# The site's openresty front-end serves a "One moment, please..." spinner page to
# clients it is rate-limiting. It carries no cookie or token to solve — the only
# remedy is to slow down — so the crawler detects it and backs off.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36 idlang-corpus-builder/1.0"
)
INTERSTITIAL_MARKERS = ("One moment, please", "window.location.reload")

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE / "cache"
OUT_DIR = HERE / "out"

# The fabricated placeholder that fills half of backend/idoma_dictionary_v2.json.
# It is not an Idoma word; any row containing it is dropped.
PLACEHOLDER = "ụụ"

DIALECT_TAGS = {
    "central idoma": "central",
    "western idoma": "western",
    "eastern idoma": "eastern",
    "northern idoma": "northern",
    "southern idoma": "southern",
}


# ---------------------------------------------------------------------------
# HTTP with on-disk cache
# ---------------------------------------------------------------------------


def is_interstitial(text: str) -> bool:
    """True for the rate-limit spinner page rather than real content."""
    head = text[:4000]
    return any(marker in head for marker in INTERSTITIAL_MARKERS)


class Fetcher:
    def __init__(self, cache_dir: Path, delay: float = 2.5, timeout: int = 60,
                 retries: int = 5, ignore_robots: bool = False, use_cache: bool = True,
                 challenge_wait: float = 30.0):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.use_cache = use_cache
        self.challenge_wait = challenge_wait
        self._last_request = 0.0
        self.robots = self._load_robots(ignore_robots)

    def _load_robots(self, ignore: bool):
        if ignore:
            return None
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(f"{BASE}/robots.txt")
        try:
            rp.read()
        except Exception as exc:  # network blip: fail closed on nothing, warn loudly
            print(f"warning: could not read robots.txt ({exc}); proceeding politely",
                  file=sys.stderr)
            return None
        return rp

    def allowed(self, url: str) -> bool:
        if self.robots is None:
            return True
        return self.robots.can_fetch(USER_AGENT, url)

    def _cache_path(self, url: str) -> Path:
        digest = hashlib.sha1(url.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{digest}.html"

    def get(self, url: str, use_cache: Optional[bool] = None) -> Optional[str]:
        if use_cache is None:
            use_cache = self.use_cache
        path = self._cache_path(url)
        if use_cache and path.exists():
            cached = path.read_text(encoding="utf-8")
            # A previously-cached interstitial is not content; refetch it.
            if not is_interstitial(cached):
                return cached
            path.unlink(missing_ok=True)

        if not self.allowed(url):
            print(f"robots.txt disallows {url}", file=sys.stderr)
            return None

        for attempt in range(1, self.retries + 1):
            # Serialise requests: one every `delay` seconds, no bursts.
            wait = self.delay - (time.monotonic() - self._last_request)
            if wait > 0:
                time.sleep(wait)
            self._last_request = time.monotonic()

            req = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip",
            })
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    data = resp.read()
                if data[:2] == b"\x1f\x8b":
                    data = gzip.decompress(data)
                text = data.decode("utf-8", "replace")

                if is_interstitial(text):
                    # Rate-limited. Wait progressively longer and permanently
                    # slow the crawl so we stop provoking it.
                    pause = self.challenge_wait * attempt
                    self.delay = min(15.0, self.delay * 1.5)
                    print(f"  rate-limited on {url}; waiting {pause:.0f}s "
                          f"(delay now {self.delay:.1f}s)", file=sys.stderr)
                    time.sleep(pause)
                    continue

                path.write_text(text, encoding="utf-8")
                return text
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                backoff = min(60, 2 ** attempt)
                print(f"  fetch {url} attempt {attempt}/{self.retries} failed: {exc}"
                      f"{'' if attempt == self.retries else f'; retrying in {backoff}s'}",
                      file=sys.stderr)
                if attempt < self.retries:
                    time.sleep(backoff)
        return None


# ---------------------------------------------------------------------------
# URL discovery
# ---------------------------------------------------------------------------


def _locs(xml: str) -> list[str]:
    return [html.unescape(m) for m in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", xml)]


def discover_dictionary_urls(fetcher: Fetcher) -> list[str]:
    """Walk sitemap.xml (following sitemap indexes) for /dictionary/ pages."""
    xml = fetcher.get(SITEMAP)
    if not xml:
        print("sitemap.xml unavailable; falling back to the /dictionary index",
              file=sys.stderr)
        return discover_via_index(fetcher)

    queue = [SITEMAP]
    seen_sitemaps = {SITEMAP}
    pages: list[str] = []
    documents = {SITEMAP: xml}

    while queue:
        current = queue.pop(0)
        doc = documents.get(current) or fetcher.get(current)
        if not doc:
            continue
        is_index = "<sitemapindex" in doc
        for loc in _locs(doc):
            if is_index or loc.endswith(".xml"):
                if loc not in seen_sitemaps:
                    seen_sitemaps.add(loc)
                    queue.append(loc)
            else:
                pages.append(loc)

    wanted = _filter_dictionary(pages)
    if not wanted:
        print("sitemap.xml contained no /dictionary/ pages; falling back to the index",
              file=sys.stderr)
        return discover_via_index(fetcher)
    return wanted


_DICT_HREF_RE = re.compile(r'href="(/dictionary/[^"#?\s]+)"')


def discover_via_index(fetcher: Fetcher, max_pages: int = 200) -> list[str]:
    """Fallback: page through the Drupal /dictionary view collecting entry links.

    Used when sitemap.xml is unreachable. Stops as soon as a page yields no new
    links, so it costs one extra request beyond the real last page.
    """
    found: list[str] = []
    seen: set[str] = set()
    for page in range(max_pages):
        url = f"{BASE}/dictionary" if page == 0 else f"{BASE}/dictionary?page={page}"
        doc = fetcher.get(url)
        if not doc:
            break
        new = 0
        for href in _DICT_HREF_RE.findall(doc):
            absolute = urllib.parse.urljoin(BASE, html.unescape(href))
            if absolute not in seen:
                seen.add(absolute)
                found.append(absolute)
                new += 1
        print(f"  index page {page}: +{new} links (total {len(found)})", file=sys.stderr)
        if new == 0:
            break
    return _filter_dictionary(found)


def _filter_dictionary(urls: Iterable[str]) -> list[str]:
    """Keep dictionary entry pages, not the index page itself."""
    wanted = []
    for url in dict.fromkeys(urls):
        path = urllib.parse.urlparse(url).path.rstrip("/")
        if path.startswith("/dictionary/") and path != "/dictionary":
            wanted.append(url)
    return sorted(wanted)


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

_TAG_RE = re.compile(r"<[^>]+>")
_TITLE_FIELD_RE = re.compile(
    r'class="[^"]*field--name-title[^"]*"[^>]*>(?P<title>.*?)</', re.I | re.S)
_HTML_TITLE_RE = re.compile(r"<title[^>]*>(?P<title>.*?)</title>", re.I | re.S)
_TAG_LINK_RE = re.compile(r'href="/tags/[^"]*"[^>]*>\s*(?P<name>[^<]+?)\s*<', re.I)
_ANCHOR = "idoma word or phrase"


def strip_html(fragment: str) -> str:
    fragment = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", fragment)
    fragment = re.sub(r"(?i)<br\s*/?>", "\n", fragment)
    fragment = re.sub(r"(?i)</(p|div|li|h[1-6]|td|tr|section|article|span)>", "\n", fragment)
    fragment = _TAG_RE.sub(" ", fragment)
    return html.unescape(fragment)


def text_lines(page: str) -> list[str]:
    lines = (re.sub(r"\s+", " ", line).strip() for line in strip_html(page).split("\n"))
    return [line for line in lines if line]


def normalise(text: str) -> str:
    """NFC-normalise and collapse whitespace; Idoma orthography is diacritic-heavy."""
    text = unicodedata.normalize("NFC", text)
    text = text.replace("’", "'").replace("‘", "'")
    text = text.replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip()


def extract_english(page: str, url: str) -> str:
    match = _TITLE_FIELD_RE.search(page)
    if match:
        candidate = normalise(strip_html(match.group("title")))
        if candidate:
            return candidate

    match = _HTML_TITLE_RE.search(page)
    if match:
        candidate = normalise(html.unescape(match.group("title")))
        candidate = re.sub(r"\s*\|\s*IdomaLand\s*$", "", candidate, flags=re.I)
        if candidate:
            return candidate

    # Last resort: humanise the slug.
    slug = urllib.parse.urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
    return urllib.parse.unquote(slug).replace("-", " ").strip()


def extract_definition(page: str) -> Optional[str]:
    """Return the sentence following the 'Idoma Word or Phrase' label."""
    lines = text_lines(page)
    for index, line in enumerate(lines):
        if line.lower().rstrip(":").strip() == _ANCHOR:
            for candidate in lines[index + 1:index + 4]:
                if candidate.lower().rstrip(":").strip() == _ANCHOR:
                    continue
                if len(candidate) < 2:
                    continue
                return normalise(candidate)
            return None
    return None


def extract_tags(page: str) -> list[str]:
    return list(dict.fromkeys(normalise(name) for name in _TAG_LINK_RE.findall(page)))


# "Ennkpo (central Idoma) or Enyi (western Idoma) is Idoma word for water."
# "Nyo gw'ije is the idoma phrase for \"I am singing\"."
_FORWARD_RE = re.compile(
    # A closing quote is as good a word boundary as a space: the site sometimes
    # omits the space entirely — '"Ihotu Kum" or "Odokum"is the Idoma phrase for
    # "My Heart"'. Requiring \s+ alone throws that page away. The quote lookbehind
    # is what keeps this safe: without it, allowing an optional space would let
    # "island" split into "is" + "land".
    r"^(?P<forms>.{1,120}?)(?:\s+|(?<=[\"'’”])\s*)(?:is|are)\s+(?:the\s+|an?\s+)?"
    r"(?:idoma|igala)?\s*(?:word|phrase|name|term|expression|translation|equivalent)?",
    re.I,
)
# "The Idoma word for water is Ennkpo."
# "The Idoma word for Extinguish or Switch off is, Mi (central Idoma) or Nyi (western Idoma)"
# "How to pronounce the Idoma word for the number eight (8), which is either Ahata or Alata"
# The comma after "is" and the "either" are both common on the live site; without
# them this pattern misses and the page is thrown away.
_REVERSE_RE = re.compile(
    # The leading tempered dot is load-bearing. Without it, .search() happily
    # finds the framing in a *forward* sentence and then consumes an "is"/"are"
    # belonging to the trailing English gloss:
    #
    #   'Abo le? is the Idoma phrase for "How are you".'
    #                                        ^^^ matched as the verb
    #   -> forms = 'you'      (English, recorded as the Idoma headword)
    #
    # 23 rows were corrupted this way. What separates the two shapes is position:
    # in a real reverse sentence the framing comes first, so no verb precedes it
    # ("The Idoma word for water is Ennkpo", "How to pronounce the Idoma word for
    # eight, which is either Ahata or Alata"). In a forward sentence the verb
    # always does. Refusing to skip over is/are encodes exactly that, and leaves
    # the forward pattern to handle the rest.
    r"^(?:(?!\b(?:is|are)\b).)*?"
    # "word or phrase for" is as common on the site as a bare "word for", and
    # without the alternation this pattern misses — then _FORWARD_RE matches
    # instead and records the framing itself ("The Idoma word") as a headword.
    r"(?:idoma)\s+(?:word|phrase|name|term|expression)"
    r"(?:\s*(?:or|/)\s*(?:word|phrase|name|term|expression))?\s+for\s+.{1,80}?"
    r"\s+(?:is|are)(?:\s*,)?\s+(?:either\s+)?"
    r"(?P<forms>.{1,120}?)\s*[.;]?\s*$",
    re.I,
)
# A third shape puts the English headword first and the language after it:
# "Chicken Egg in Idoma is either Ahi'ugwu (central Idoma) or Aj'ugwu ...",
# '"Dig a Hole" in Idoma is B'ogo.' The forms follow "is", so _FORWARD_RE reads
# it backwards and yields the English side as the Idoma form.
_IN_IDOMA_RE = re.compile(
    r"^.{1,80}?\bin\s+idoma\s+(?:is|are)(?:\s*,)?\s+(?:either\s+)?"
    r"(?P<forms>.{1,120}?)\s*[.;]?\s*$",
    re.I,
)
_PAREN_RE = re.compile(r"^(?P<form>[^()]+?)\s*\((?P<note>[^)]*)\)\s*$")
_SPLIT_RE = re.compile(r"\s+or\s+|\s*/\s*|\s*,\s*|\s*;\s*", re.I)


def _split_top_level(blob: str) -> list[str]:
    """Split on separators that sit outside brackets.

    A plain regex split cuts inside the dialect note as well: "Ochanya (Central,
    Western & Northern Idoma) or Otsanya (Southern Idoma)" splits on the comma
    *within* the bracket and yields "Ochanya (Central" as an Idoma headword,
    plus the stray fragment "Western & Northern Idoma)". Tracking depth keeps
    multi-dialect notes intact.
    """
    parts: list[str] = []
    depth = start = index = 0
    while index < len(blob):
        char = blob[index]
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth = max(0, depth - 1)
        elif depth == 0:
            separator = _SPLIT_RE.match(blob, index)
            if separator:
                parts.append(blob[start:index])
                index = start = separator.end()
                continue
        index += 1
    parts.append(blob[start:])
    return parts

# Many pages skip the sentence entirely and put the bare form straight in the
# field: "Onowa", "Kum or Ekum", "Kpemm ( central Idoma ) or Odudu ( western
# Idoma )". Those are real entries, so they are worth recovering — but only when
# the text carries no sentence machinery at all, otherwise English prose gets
# recorded as an Idoma headword.
_SENTENCE_RE = re.compile(
    r"\b(?:is|are|was|were|mean|means|meaning|word|phrase|pronounce|pronounced|"
    r"translate|translates|translation|refer|refers|used|the|which)\b", re.I)
# Unreviewed pages leave English notes in the field ("Contributions welcome for
# this entry"). These are function words no short Idoma form contains, so they
# are a reliable tell that the field is English prose, not a headword.
_ENGLISH_PROSE_RE = re.compile(
    r"\b(?:and|for|from|with|this|that|these|those|not|yet|none|please|"
    r"help|welcome|contribution|contributions|entry|entries|unknown|missing|"
    r"pending|review|reviewed|todo|tbd|n/a)\b", re.I)


def classify_note(note: str) -> str:
    """Map a parenthetical note to a dialect tag, or "" when it is not one.

    Not every parenthetical is a dialect. The site also uses them for ASCII
    pronunciation respellings — "Chɛ (che)", "Ɔ́hi (ohi)" — and recording those
    as dialects pollutes the field with values that are neither dialects nor
    comparable across rows. Only genuine markers are kept, with tolerance for the
    site's own typos ("nothern idoma").
    """
    note = re.sub(r"\s+", " ", note.strip().lower())
    if not note:
        return ""
    if note in DIALECT_TAGS:
        return DIALECT_TAGS[note]
    # A note naming several dialects at once — "Central, Western & Northern
    # Idoma" — describes all of them, so no single tag is honest. Leave it
    # unspecified rather than letting the fuzzy match below pick whichever one it
    # scores highest; that silently narrowed a three-dialect form to "central".
    if len(re.findall(r"\b(?:central|western|eastern|northern|southern)\b", note)) > 1:
        return ""
    # "<compass point> idoma" is a dialect marker; accept near-misses so a
    # single misspelt page does not invent a new dialect.
    if note.endswith("idoma"):
        close = difflib.get_close_matches(note, DIALECT_TAGS.keys(), n=1, cutoff=0.8)
        if close:
            return DIALECT_TAGS[close[0]]
    return ""


def _split_forms(blob: str, max_words: int = 8, max_chars: int = 80,
                 strict: bool = False) -> list[tuple[str, str]]:
    """Split a blob of Idoma forms into (form, dialect) pairs.

    `strict` is for the bare-field case, where there is no sentence to confirm
    the text is lexical: one prose-looking chunk discredits the whole field
    rather than being quietly dropped.
    """
    pairs: list[tuple[str, str]] = []
    for chunk in _split_top_level(blob):
        chunk = chunk.strip(" .;:\"'")
        if not chunk:
            continue
        dialect = ""
        paren = _PAREN_RE.match(chunk)
        if paren:
            chunk = paren.group("form").strip()
            dialect = classify_note(paren.group("note"))
        # A "form" that is really prose is not a lexical entry.
        if len(chunk.split()) > max_words or len(chunk) > max_chars:
            if strict:
                return []
            continue
        pairs.append((normalise(chunk), dialect))
    return pairs


def parse_forms(definition: str) -> tuple[list[tuple[str, str]], str]:
    """Split a definition sentence into (idoma_form, dialect) pairs.

    Returns (pairs, pattern_name). `pattern_name` is recorded in the output so
    parse-rate regressions are auditable rather than silent.

    Order matters. Both `reverse` and `in-idoma` put the forms *after* "is", so
    they must be tried before `forward` — otherwise forward matches the English
    framing and records it as the Idoma headword. All three are anchored at the
    start of the field, so a match is decided by shape rather than by whichever
    "is" happens to appear first.
    """
    for name, regex in (("reverse", _REVERSE_RE),
                        ("in-idoma", _IN_IDOMA_RE),
                        ("forward", _FORWARD_RE)):
        match = regex.match(definition)
        if not match:
            continue
        blob = match.group("forms").strip(" .;:\"'")
        if not blob:
            continue
        pairs = _split_forms(blob)
        if pairs:
            return pairs, name

    # No sentence matched. If the field holds nothing but a short form (no verb,
    # no "word for" framing, no English function words), take it as the entry.
    if (len(definition) <= 120
            and not _SENTENCE_RE.search(definition)
            and not _ENGLISH_PROSE_RE.search(definition)):
        pairs = _split_forms(definition, max_words=4, max_chars=40, strict=True)
        if pairs:
            return pairs, "bare"

    return [], "none"


@dataclass
class Entry:
    english: str
    idoma: str
    dialect: str
    url: str
    definition: str
    pattern: str
    source: str = "idomaland.org"
    tags: list[str] = field(default_factory=list)


def dialect_from_tags(tags: Iterable[str]) -> str:
    """The page's dialect, but only when the page names exactly one.

    Pages are tagged with every dialect their entry covers. On /dictionary/queen
    that is all four — "Central Idoma", "Western Idoma", "Southern Idoma",
    "Northern Idoma" — and returning the first match labelled the form Ochanya
    (whose own note reads "Central, Western & Northern Idoma") as plain "central",
    dropping two thirds of what the page actually said. Several tags carry no
    information about which form belongs to which dialect, so the honest answer is
    none: leave the field unspecified and let the note-level tag, when there is
    one, be the only thing that sets it.
    """
    mapped = {classify_note(tag) for tag in tags}
    mapped.discard("")
    return mapped.pop() if len(mapped) == 1 else ""


def parse_page(url: str, page: str) -> tuple[list[Entry], str]:
    """Return (entries, reason_if_empty)."""
    english = extract_english(page, url)
    if not english:
        return [], "no-english-title"

    definition = extract_definition(page)
    if not definition:
        return [], "no-definition-field"

    forms, pattern = parse_forms(definition)
    if not forms:
        return [], "unparsed-definition"

    tags = extract_tags(page)
    fallback_dialect = dialect_from_tags(tags)
    # Category tags are everything that is not a dialect marker.
    categories = [t for t in tags if t.strip().lower() not in DIALECT_TAGS]

    entries: list[Entry] = []
    for form, dialect in forms:
        if not form:
            continue
        if PLACEHOLDER in form:
            continue
        # An "Idoma" form identical to the English headword is a data error, and
        # exactly the kind of row that teaches a model to echo its input.
        if form.strip().lower() == english.strip().lower():
            continue
        entries.append(Entry(
            english=english,
            idoma=form,
            dialect=dialect or fallback_dialect,
            url=url,
            definition=definition,
            pattern=pattern,
            tags=categories,
        ))

    if not entries:
        return [], "all-forms-rejected"
    return entries, ""


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def iter_pages(fetcher: Fetcher, urls: list[str]) -> Iterator[tuple[str, Optional[str]]]:
    total = len(urls)
    for index, url in enumerate(urls, start=1):
        if index % 25 == 0 or index == total:
            print(f"  [{index}/{total}] {url}", file=sys.stderr)
        yield url, fetcher.get(url)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=0,
                        help="only crawl the first N dictionary pages (smoke test)")
    parser.add_argument("--delay", type=float, default=2.5,
                        help="seconds between requests (default: 2.5; the site "
                             "rate-limits aggressively)")
    parser.add_argument("--challenge-wait", type=float, default=30.0,
                        help="base seconds to wait after hitting the rate-limit page")
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--out", type=Path, default=OUT_DIR / "idomaland_raw.jsonl")
    parser.add_argument("--urls-out", type=Path, default=OUT_DIR / "idomaland_urls.txt")
    parser.add_argument("--no-cache", action="store_true",
                        help="refetch pages even when cached")
    parser.add_argument("--ignore-robots", action="store_true",
                        help="skip the robots.txt check (not recommended)")
    args = parser.parse_args(argv)

    fetcher = Fetcher(CACHE_DIR, delay=args.delay, timeout=args.timeout,
                      ignore_robots=args.ignore_robots, use_cache=not args.no_cache,
                      challenge_wait=args.challenge_wait)

    print("Discovering dictionary URLs from sitemap.xml ...", file=sys.stderr)
    urls = discover_dictionary_urls(fetcher)
    print(f"Found {len(urls)} /dictionary/ pages", file=sys.stderr)

    args.urls_out.parent.mkdir(parents=True, exist_ok=True)
    args.urls_out.write_text("\n".join(urls) + "\n", encoding="utf-8")

    if args.limit:
        urls = urls[:args.limit]
        print(f"Limiting to {len(urls)} pages", file=sys.stderr)

    entries: list[Entry] = []
    failures: dict[str, int] = {}
    fetch_failures: list[str] = []

    for url, page in iter_pages(fetcher, urls):
        if page is None:
            fetch_failures.append(url)
            failures["fetch-failed"] = failures.get("fetch-failed", 0) + 1
            continue
        parsed, reason = parse_page(url, page)
        if reason:
            failures[reason] = failures.get(reason, 0) + 1
            continue
        entries.extend(parsed)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as handle:
        for entry in entries:
            handle.write(json.dumps(asdict(entry), ensure_ascii=False) + "\n")

    pages_ok = len(urls) - sum(failures.values())
    print("\n=== scrape summary ===", file=sys.stderr)
    print(f"pages crawled     : {len(urls)}", file=sys.stderr)
    print(f"pages parsed       : {pages_ok}", file=sys.stderr)
    print(f"pairs extracted    : {len(entries)}", file=sys.stderr)
    print(f"distinct english   : {len({e.english.lower() for e in entries})}", file=sys.stderr)
    print(f"distinct idoma     : {len({e.idoma.lower() for e in entries})}", file=sys.stderr)
    if failures:
        print("skipped:", file=sys.stderr)
        for reason, count in sorted(failures.items(), key=lambda kv: -kv[1]):
            print(f"  {reason}: {count}", file=sys.stderr)
    if fetch_failures:
        print(f"  (first fetch failure: {fetch_failures[0]})", file=sys.stderr)
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
