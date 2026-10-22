#!/usr/bin/env python3
"""Align bilingual JSON and export audited, leakage-safe JSONL splits (Python 3.10+)."""
import argparse
from collections import Counter, defaultdict
import hashlib
import html
import json
import math
from pathlib import Path
import random
import re
import statistics
import unicodedata

IDS = ('reference', 'verse_id', 'id', 'chapter_verse')
PLACEHOLDERS = {'', 'null', 'none', 'n/a', 'na', 'undefined', '[missing]', '[placeholder]', 'todo', 'tbd', '...'}


def load_json(path):
    raw = Path(path).read_bytes()
    encoding = 'utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
    try:
        def unique_object(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError(f'Duplicate JSON object key: {key!r}')
                result[key] = value
            return result
        return json.loads(raw.decode(encoding), object_pairs_hook=unique_object)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f'{path}: invalid {encoding} JSON: {exc}') from exc


def clean(value):
    if not isinstance(value, str):
        return None
    # Remove dangerous markup contents, then tags; keep ordinary bracketed prose.
    value = re.sub(r'<(script|style)\b[^>]*>.*?</\1\s*>', ' ', value, flags=re.I | re.S)
    value = html.unescape(value)
    value = re.sub(r'<[^>]+>', ' ', value)
    value = re.sub(r'\\(?:id|c|v)\s+\S+|\\[a-z][a-z0-9-]*\*?', ' ', value, flags=re.I)
    value = re.sub(r'\[(?:missing|placeholder|corrupt)\]', ' ', value, flags=re.I)
    value = ''.join(' ' if unicodedata.category(c) == 'Cc' else c for c in value)
    value = unicodedata.normalize('NFC', ' '.join(value.split()))
    if value.casefold() in PLACEHOLDERS or '\ufffd' in value or 'ụụ' in value:
        return None
    return value if any(c.isalpha() for c in value) else None


def key(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    value = str(value).strip()
    return value if value and value.casefold() not in PLACEHOLDERS else None


def index_data(data, language, id_field=None, text_field=None):
    if not isinstance(data, (list, dict)):
        raise ValueError('Root must be a list or an identifier-to-record object. Flatten nested book/chapter structures first.')
    positional = isinstance(data, list) and all(v is None or isinstance(v, str) for v in data)
    fields = (text_field,) if text_field else ((language, 'eng_Latn', 'en', 'text', 'content') if language == 'english' else (language, 'idu_Latn', 'idu', 'text', 'content'))
    indexed, blocked, counts = {}, set(), Counter()
    for outer, record in (enumerate(data) if isinstance(data, list) else data.items()):
        if positional:
            ident, value = str(outer), record
        elif isinstance(record, dict):
            markers = (id_field,) if id_field else IDS
            ident = next((key(record[f]) for f in markers if key(record.get(f)) is not None), None)
            if not isinstance(data, list):
                outer_key = key(outer)
                if ident is not None and ident != outer_key:
                    raise ValueError(f'Outer key {outer_key!r} conflicts with record identifier {ident!r}')
                ident = outer_key
            if ident is None and all(f in record for f in ('book_code', 'chapter', 'verse')):
                ident = '.'.join(str(record[f]).strip() for f in ('book_code', 'chapter', 'verse'))
            # Reject malformed or internally inconsistent scripture indices.
            if 'reference' in record:
                ref = record['reference']
                match = re.fullmatch(r'([A-Za-z0-9]+)\.([1-9][0-9]*)\.([1-9][0-9]*)', ref) if isinstance(ref, str) else None
                if not match or any(str(record[f]) != expected for f, expected in zip(('book_code', 'chapter', 'verse'), match.groups()) if f in record):
                    counts['corrupt_identifier_rows'] += 1
                    if ident is not None:
                        blocked.add(ident)
                        indexed.pop(ident, None)
                    continue
            value = next((record[f] for f in fields if f in record), None)
        elif isinstance(data, dict):
            ident, value = key(outer), record
        else:
            ident, value = None, None
        if ident is None:
            counts['missing_identifier_rows'] += 1
            continue
        if ident in indexed or ident in blocked:
            blocked.add(ident)
            indexed.pop(ident, None)
            counts['duplicate_identifier_extra_rows'] += 1
            continue
        indexed[ident] = clean(value)
        if indexed[ident] is None:
            counts['invalid_text_rows'] += 1
    counts['raw_items'] = len(data)
    counts['blocked_duplicate_ids'] = len(blocked)
    return indexed, blocked, positional, dict(counts)


def aligned(english, idoma):
    en, eb, _, _ = english
    idu, ib, _, _ = idoma
    rows, dropped = [], Counter()
    for ident in sorted(set(en) | set(idu) | eb | ib):
        if ident in eb or ident in ib:
            dropped['duplicate_identifier'] += 1
        elif ident not in en or ident not in idu:
            dropped['missing_counterpart'] += 1
        elif en[ident] is None or idu[ident] is None:
            dropped['invalid_text'] += 1
        elif en[ident].casefold() == idu[ident].casefold():
            dropped['identical_languages'] += 1
        else:
            rows.append({'reference': ident, 'eng_Latn': en[ident], 'idu_Latn': idu[ident]})
    matched = len(rows)
    unique, seen = [], set()
    for row in rows:
        pair = (row['eng_Latn'].casefold(), row['idu_Latn'].casefold())
        if pair in seen:
            dropped['duplicate_text_pair'] += 1
        else:
            seen.add(pair)
            unique.append(row)
    return unique, matched, dict(dropped)


def split_rows(rows, seed=42):
    # Union-find groups ANY repeated source OR target, including transitive links.
    parent = list(range(len(rows)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    seen = {}
    for i, row in enumerate(rows):
        for lang in ('eng_Latn', 'idu_Latn'):
            marker = (lang, row[lang].casefold())
            if marker in seen:
                parent[root(i)] = root(seen[marker])
            seen[marker] = i
    groups = defaultdict(list)
    for i, row in enumerate(rows):
        groups[root(i)].append(row)
    # Stratify on the longest language's word-count band, not a fake class label.
    bins = defaultdict(list)
    for group in groups.values():
        length = max(len(r[lang].split()) for r in group for lang in ('eng_Latn', 'idu_Latn'))
        band = next((n for n in (16, 32, 64, 96) if length <= n), 97)
        bins[band].append(group)
    rng, splits, telemetry = random.Random(seed), [[], [], []], {}
    ratios = (.85, .10, .05)
    for band, bucket in sorted(bins.items()):
        rng.shuffle(bucket)
        # Allocate whole groups using largest remainder rounding.
        counts = [math.floor(len(bucket) * r) for r in ratios]
        for j in sorted(range(3), key=lambda j: (-(len(bucket)*ratios[j]-counts[j]), j))[:len(bucket)-sum(counts)]:
            counts[j] += 1
        offset = 0
        for j, count in enumerate(counts):
            splits[j].extend(r for group in bucket[offset:offset+count] for r in group)
            offset += count
        telemetry[str(band)] = {'groups': len(bucket), 'allocated_groups': counts}
    for split in splits:
        rng.shuffle(split)
    if any(not s for s in splits):
        raise ValueError('Insufficient independent groups for three nonempty splits; add data.')
    for lang in ('eng_Latn', 'idu_Latn'):
        sets = [{r[lang].casefold() for r in s} for s in splits]
        assert not any(sets[i] & sets[j] for i in range(3) for j in range(i))
    return splits, telemetry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--english', default='training/english_kjv_complete.json')
    parser.add_argument('--idoma', default='training/idoma_complete.json')
    parser.add_argument('--output-dir', default='training/prepared')
    parser.add_argument('--id-field')
    parser.add_argument('--english-text-field')
    parser.add_argument('--idoma-text-field')
    parser.add_argument('--confirm-positional-alignment', action='store_true')
    parser.add_argument('--schema', choices=('codes', 'notebook'), default='codes')
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--tokenizer', help='Optional local or Hugging Face NLLB tokenizer for exact length checks; requires transformers and sentencepiece')
    parser.add_argument('--max-length', type=int, default=96)
    parser.add_argument('--drop-overlength', action='store_true', help='Requires --tokenizer; drop entire aligned pairs exceeding token limit')
    args = parser.parse_args()
    if args.max_length < 2:
        parser.error('--max-length must be at least 2')
    if args.drop_overlength and not args.tokenizer:
        parser.error('--drop-overlength requires --tokenizer; words are not model tokens')
    en = index_data(load_json(args.english), 'english', args.id_field, args.english_text_field)
    idu = index_data(load_json(args.idoma), 'idoma', args.id_field, args.idoma_text_field)
    if en[2] != idu[2]:
        raise ValueError('Cannot align positional and identifier-based data.')
    if en[2] and (not args.confirm_positional_alignment or en[3]['raw_items'] != idu[3]['raw_items']):
        raise ValueError('Positional inputs require equal lengths and --confirm-positional-alignment. Missing interior records cannot be detected.')
    rows, matched, discarded = aligned(en, idu)
    if not rows:
        raise ValueError('No valid aligned pairs. Verify identifiers and text-field names.')
    report = {'seed': args.seed, 'alignment': 'position' if en[2] else 'identifier',
              'english': en[3], 'idoma': idu[3], 'unified_before_deduplication': matched,
              'discarded_by_reason': discarded, 'max_sequence_tokens': args.max_length,
              'input_sha256': {name: hashlib.sha256(Path(path).read_bytes()).hexdigest() for name, path in [('english', args.english), ('idoma', args.idoma)]}}
    report['words_before_token_filter'] = {lang: {'max': max(v), 'average': statistics.mean(v), 'above_96_words': sum(n>96 for n in v)} for lang in ('eng_Latn', 'idu_Latn') for v in [[len(r[lang].split()) for r in rows]]}
    if args.tokenizer:
        from transformers import AutoTokenizer
        tok = AutoTokenizer.from_pretrained(args.tokenizer)
        if tok.convert_tokens_to_ids('idu_Latn') == tok.unk_token_id:
            tok.add_special_tokens({'additional_special_tokens': list(tok.additional_special_tokens) + ['idu_Latn']})
        lengths = {}
        for lang in ('eng_Latn', 'idu_Latn'):
            tok.src_lang = lang
            lengths[lang] = []
            for start in range(0, len(rows), 256):
                batch = tok([r[lang] for r in rows[start:start+256]], truncation=False, add_special_tokens=True)
                lengths[lang].extend(map(len, batch['input_ids']))
        report['tokens'] = {lang: {'max': max(v), 'average': statistics.mean(v), 'over_limit': sum(n > args.max_length for n in v)} for lang, v in lengths.items()}
        over = {i for v in lengths.values() for i, n in enumerate(v) if n > args.max_length}
        report['overlength_pairs'] = len(over)
        if args.drop_overlength:
            rows = [r for i, r in enumerate(rows) if i not in over]
    else:
        report['token_check'] = 'NOT RUN. Word counts cannot verify a 96-subword-token constraint.'
    splits, strata = split_rows(rows, args.seed)
    report['length_strata_upper_bounds'] = strata
    report['final_pairs'] = len(rows)
    report['splits'] = {name: {'rows': len(s), 'percent': round(100*len(s)/len(rows), 3)} for name, s in zip(('train', 'dev', 'test'), splits)}
    out = Path(args.output_dir)
    if out.resolve() in (Path(args.english).resolve(), Path(args.idoma).resolve()):
        raise ValueError('Output directory conflicts with an input file')
    out.mkdir(parents=True, exist_ok=True)
    for name, split in zip(('train', 'dev', 'test'), splits):
        with (out/f'{name}.jsonl').open('w', encoding='utf-8') as handle:
            for row in split:
                value = {k: row[k] for k in ('eng_Latn', 'idu_Latn')} if args.schema == 'codes' else {'en': row['eng_Latn'], 'idu': row['idu_Latn']}
                handle.write(json.dumps(value, ensure_ascii=False)+'\n')
    # Sidecar preserves reference provenance without changing training row schema.
    (out/'alignment.json').write_text(json.dumps({n: [r['reference'] for r in s] for n,s in zip(('train','dev','test'),splits)}, ensure_ascii=False, indent=2), encoding='utf-8')
    (out/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as exc:
        raise SystemExit(f'Preprocessing failed: {exc}')
