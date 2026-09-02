# Idoma corpus pipeline

Builds an English↔Idoma parallel corpus for fine-tuning NLLB-200.

```
scrape_idomaland.py   crawl idomaland.org/dictionary -> out/idomaland_raw.jsonl
build_corpus.py       merge + clean + split          -> out/{train,dev,test}.jsonl
eval_seed.tsv         hand-verified pairs, forced into the test split
test_parser.py        offline tests for the scraper's HTML parsing
test_build_corpus.py  offline tests for the cleaning filters and splitting
```

## Quick start

```bash
# 1. Crawl (slow on purpose — see "Rate limiting" below). Resumable: every page
#    is cached, so re-running costs nothing for pages already fetched.
python3 data_pipeline/scrape_idomaland.py --delay 8

# 2. Build the splits
python3 data_pipeline/build_corpus.py

# 3. Optional: fold in a Hugging Face dataset (needs `pip install datasets`,
#    and HF_TOKEN for gated repos)
export HF_TOKEN=hf_...
python3 data_pipeline/build_corpus.py --hf-dataset mrheartng/adah-idoma

# Tests (no network needed)
python3 data_pipeline/test_parser.py
python3 data_pipeline/test_build_corpus.py
```

`out/` and `cache/` are gitignored. **Do not publish the scraped text.** Only the
trained model is distributed, crediting idomaland.org in its model card.

## Why the old dataset was thrown away

`backend/idoma_dictionary_v2.json` claims 218 entries. Running it through
`build_corpus.py --legacy-dictionary` shows what it actually contains:

| Measure | Value |
|---|---|
| Rows in | 218 |
| Dropped as the placeholder `ụụ` | **109 (50%)** |
| Rows surviving all filters | 107 |
| Distinct Idoma forms among those 107 | **79** |

The surviving half is no better than the placeholder half. Actual collisions in it:

```
òdò  -> black, day, evening, morning, night, red, waist   (7 unrelated words)
òmà  -> aunt, brother, child, daughter, mother, sister, son, uncle
òdụ  -> seven, eight, nine, ten
òhụ  -> city, house, town, village
ófé  -> "Please" AND "Thank you"
anú  -> he, she, him
```

173 of its 218 example sentences also reuse a single `<word> àma <verb>` template.
This is generated filler. `--legacy-dictionary` exists so the claim is checkable,
but it is **off by default and should stay off** — training on it would teach the
model wrong Idoma, which is worse than the current failure mode.

## Source survey

Every source named in the original request, plus the obvious alternatives, checked
directly:

| Source | What is actually there | Used? |
|---|---|---|
| **idomaland.org/dictionary** | 1,119 `/dictionary/<slug>` pages in `sitemap.xml`, all crawled. Drupal, server-rendered, `robots.txt` permits `/dictionary/`. Real tone-marked orthography, often split by dialect. | **Yes — primary source** |
| asjp.clld.org/languages/IDOMA | **29 items**, and they are ASJP *phonetic* transcriptions with no tone: `stone→Eco`, `dog→ewo`. Not the orthography the app needs. `.csv` returns HTTP 406; use `/languages/IDOMA.json`, wordlist is in the `txt` field. | No — wrong representation |
| scribd.com/document/1006452998 | ~74 real tone-marked pairs plus sentences. Behind a Radware bot wall, so not fetchable. | Manually, as eval seed |
| `mrheartng/idu-eng-translator` (the reference model) | Page returns 200, but `resolve/main/*` returns **401**. `gated: manual`. Weights are not downloadable. | No — gated |
| `mrheartng/idoma-english-parallel-corpus` | `gated: manual`, declares `10K<n<100K`. Size unverifiable without access. **Highest-value target — request access.** | Pending access |
| `mrheartng/adah-idoma` | `gated: auto` — instant with any HF token. `n<1K`. | Yes, via `--hf-dataset` |
| OPUS, Tatoeba, Glosbe, Masakhane, FLORES-200, Common Voice, eBible | Confirmed **zero** Idoma. The OPUS API returns `{"corpora":[]}` for `idu`. | No |
| jw.org/idu/ | Live and genuinely Idoma, but © all-rights-reserved. | Excluded on licensing |

**Measured yield from the open path: 1,251 pairs over 1,117 distinct English keys,
mostly word-level.** That is enough for a dictionary-augmented translator, not a
fluent sentence translator. Sentence-level quality needs the gated 10K+ corpus.

## Rate limiting

idomaland.org sits behind openresty and rate-limits hard. When it does, it serves
a "One moment, please..." spinner page (HTTP 200, no cookie, no token — nothing to
solve) and eventually resets TLS connections outright. The scraper:

- detects that page and never caches it as content,
- waits `--challenge-wait × attempt` seconds and permanently slows its own delay,
- caches every real page on disk, so an interrupted crawl resumes for free.

If a run reports `Found 0 /dictionary/ pages`, the IP is being throttled. Wait
(30–60 min is usually enough) and re-run; use `--delay 8` or higher. A full
1,119-page crawl at 8 s/page takes about 2.5 hours.

There is a fallback URL source: if `sitemap.xml` is unreachable,
`discover_via_index()` pages through `/dictionary?page=N` instead.

## What the scraper extracts

Verified against the live markup of `/dictionary/water`:

```html
<span class="field field--name-title ...">Water</span>
<div class="field field--name-body ... field--label-above">
  <div class="field__label">Idoma Word or Phrase</div>
  <div class="field__item">
    Ennkpo (central Idoma) or Enyi (western Idoma) is Idoma word for water.
  </div>
</div>
<div class="field field--name-field-tags ...">
  <a href="/tags/edibles">Edibles</a>
  <a href="/tags/central-idoma">Central Idoma</a>
</div>
```

That page becomes two rows, one per dialect:

```json
{"english":"Water","idoma":"Ennkpo","dialect":"central","tags":["Edibles"],"url":"...","pattern":"forward"}
{"english":"Water","idoma":"Enyi","dialect":"western","tags":["Edibles"],"url":"...","pattern":"forward"}
```

`pattern` records which rule matched, so a drop in parse rate is visible in the
summary instead of silently shrinking the corpus. Four shapes occur on the site:

| `pattern` | Field text | Rows |
|---|---|---|
| `forward` | `Ennkpo (central Idoma) or Enyi (western Idoma) is Idoma word for water.` | 1166 (93.2%) |
| `bare` | `Onowa` — no sentence at all, just the form | 57 (4.6%) |
| `reverse` | `The Idoma word for Extinguish is, Mi (central Idoma) or Nyi (western Idoma)` — also `The Idoma word or phrase for letter is Okpa` and `…which is either Ahata or Alata` | 25 (2.0%) |
| `in-idoma` | `Chicken Egg in Idoma is either Ahi'ugwu (central Idoma) or Aj'ugwu (western Idoma).` | 3 (0.2%) |

`reverse` and `in-idoma` both put the forms *after* the verb, so they are tried
first; otherwise `forward` matches the English framing and records **that** as the
Idoma headword. All three sentence rules are anchored at the start of the field
rather than searched for anywhere in it, and `reverse` additionally refuses to skip
over an `is`/`are` on its way to the framing. Without that refusal a forward
sentence like `Abo le? is the Idoma phrase for "How are you"` matched in reverse,
consuming the `are` inside the *English gloss* and yielding `you` as the Idoma form.
23 real rows were corrupted that way (`My children are fine → fine`,
`What is your name → your name`); the anchor plus the refusal is what distinguishes
the two shapes, since a real reverse sentence has no verb before its framing.

`bare` is the one rule that rests on a heuristic rather than a sentence match, so
it is deliberately conservative: the field must be ≤120 characters, split into
chunks of ≤4 words, and contain no verb or English function word (`is`, `the`,
`for`, `pending`, `contributions`, …). One prose-looking chunk discredits the whole
field rather than being partially kept. The `pattern` label is carried through into
`train/dev/test.jsonl`, so if `bare` rows ever prove noisy they can be filtered out
without re-crawling.

Separators are split at bracket depth zero only. A plain regex split cuts inside
the dialect note as well: `Ochanya (Central, Western & Northern Idoma) or Otsanya
(Southern Idoma)` splits on the comma *within* the bracket and yields `Ochanya
(Central` as an Idoma headword plus the stray fragment `Western & Northern Idoma)`.

### Dialect tagging is deliberately conservative

Not every parenthetical is a dialect. The site also uses them for ASCII
respellings — `Chɛ (che)`, `Ɔ́hi (ohi)` — which are dropped rather than recorded as
dialects, while its own typos (`nothern idoma`) are matched to the real tag by
fuzzy comparison.

Two cases resolve to *unspecified* rather than to a guess:

- **A note naming several dialects.** `Ochanya (Central, Western & Northern Idoma)`
  is not a central form; it is three. The fuzzy matcher exists for typos, not for
  collapsing three tags into whichever one it scores highest.
- **A page tagged with more than one dialect.** Pages carry a tag per dialect their
  entry covers — `/dictionary/queen` has all four. Using the first as a fallback
  for a form that gave no dialect of its own labelled 12 rows wrongly, including
  variant pairs like `Corn Flour → Umu k'igbamkpa` / `umu k'akamkpa` where *both*
  forms were recorded as central even though one of them is western. Several tags
  say nothing about which form belongs to which dialect, so nothing is inferred.

The page-tag fallback still applies when a page names exactly one dialect.

### Measured yield

Across the complete crawl of all 1,119 dictionary pages:

```
pages crawled     : 1119
pages parsed      : 1117  (99.82%)
pairs extracted   : 1251
distinct english  : 1117
distinct idoma    : 1068
placeholder rows  : 0
rejected by build : 0
splits            : 989 train / 125 dev / 137 test
dialects          : unspecified 1109, central 68, western 67, northern 5, southern 2
failures          : 2   (both genuinely bad pages, not parser gaps)
```

Tests: 50 parser, 24 corpus-builder, all offline.

The 2 failures are correct rejections, not parser gaps:

- `/dictionary/i-came-home-around-7-pm` lists the English text as its own Idoma
  translation (`"I came home around 7 pm" is the Idoma word or phrase for "I came
  home around 7 pm"`). That row type is exactly what teaches a model to echo its
  input.
- `/dictionary/troublemaker` uses a gendered-pair shape found on no other page
  (`Ad'Ikp'ela for a male troublemaker and En'Ikp'ela for a female troublemaker.`).
  A bespoke rule for one page in 1,119 risks more false positives than the single
  row it would recover, so it is left unparsed on purpose.


## Cleaning rules

`build_corpus.py` drops a row if it:

- contains the `ụụ` placeholder,
- has an Idoma side equal to the English side — **this is the row type that
  teaches a model to echo its input**, i.e. the original bug,
- has prose leaking into the Idoma side (`"is Idoma word for"`, `"contribute"`, …),
- is site chrome (`Dictionary`, `Access denied`, `Add a name`, …),
- is empty, letterless, under 2 characters, or over 200 characters.

The chrome list is split in two, because the risk is not symmetric. `Dictionary`
and `Access denied` are furniture that is never a headword. But `Home`, `Search`,
`Translate`, `Books` and `Comments` are ordinary English words that merely *also*
label a nav link — rejecting `Home` outright threw away the real entry
`Home → Ole`. Those are treated as chrome only when nothing vouches for them, i.e.
when no scraper `pattern` matched a definition sentence on the page.

Then it NFC-normalises (Idoma is diacritic-heavy: `àkpà` "bridge" vs `ákpá`
"cloud", so decomposed vs precomposed forms must be unified or dedupe misses them),
dedupes on `(english, idoma)`, and writes `train`/`dev`/`test`.

**Splits are keyed on a hash of the English side, not the row.** Splitting per-row
would put `water → Ennkpo` in train and `water → Enyi` in test, leaking the answer
and inflating the score.

Finally it asserts that no placeholder row and no identical pair reached any
output file, and exits non-zero if fewer than `--min-rows` rows survive.

## eval_seed.tsv

Hand-verified pairs, `english<TAB>idoma<TAB>dialect`. Every pair here is forced
into `test.jsonl`, and any matching English key is removed from train and dev.

It ships with only 5 pairs, and they are a **smoke test, not an evaluation set**.
All five were read off live idomaland.org pages, so they share a source with the
training corpus and break the independence rule at the top of the file. They are
kept because each has two dialect forms or an apostrophe, which exercises the
multi-reference and diacritic paths in the notebook's chrF++ cell. Do not read a
score on them as evidence of generalisation.

Fill the file toward ~60 genuinely independent pairs from the Scribd wordlist
(behind a bot wall — open it in a browser and copy them in) or from a speaker
before trusting any eval number.
