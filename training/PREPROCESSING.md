# English–Idoma Bible data preparation

Run from the repository root with Python 3.10+ (no dependencies for default preprocessing):

```bash
python training/prepare_parallel.py
python -m unittest discover -s training -p test_prepare_parallel.py -v
```

Outputs: training/prepared/{train,dev,test}.jsonl, report.json, alignment.json.
Each JSONL record has exactly eng_Latn and idu_Latn. Use --schema notebook for the original notebook's en/idu format, or use the included train_bible_colab.ipynb which accepts both.

[Open the bidirectional notebook in Google Colab](https://colab.research.google.com/github/maddox-bayn/idlang/blob/main/training/train_bible_colab.ipynb).

Select a T4 GPU, install dependencies, restart the session, then follow steps 2–13. The notebook uses batch size 1, gradient accumulation, Adafactor, gradient checkpointing, and Google Drive checkpoints. Validation includes both directions, with separate generation scores for English→Idoma and Idoma→English. Start with three epochs and choose settings using development results; reserve test data for final evaluation. Automatic Hub upload is off.

For the upload at notebook step 4, create a ZIP from the repository root:

```bash
python -m zipfile -c Idlang_Colab_Data_Prep.zip training/prepared
```

Select that ZIP in Colab. It is copied to Drive for subsequent sessions. The notebook accepts a prepared/ directory anywhere in the ZIP, audits token lengths at step 5, and filters whole pairs within their original splits. The starting MAX_LENGTH is 256; inspect coverage before training. Checkpoints and final model are stored under MyDrive/Idlang/<RUN_NAME>/. Reuse RUN_NAME only when resuming identical data and settings; use a new name for a new experiment. The model card describes the Bible corpus and the limits of its evaluation.

## Token limit: required decision before training

Word counts are telemetry, not subword lengths. No token check was performed in the bundled run. Run this in Colab after installing transformers and sentencepiece (paths assume an uploaded or cloned repository):

```bash
python training/prepare_parallel.py --tokenizer facebook/nllb-200-distilled-600M --max-length 96 --drop-overlength --output-dir training/prepared_96tokens
```

This registers idu_Latn in the tokenizer, measures both language sequences including special tokens WITHOUT truncation, and drops whole pairs when either exceeds 96 tokens. It downloads tokenizer files, not model weights. Omit --drop-overlength to audit only; choose a larger notebook MAX_LENGTH if too many verses would be lost. After filtering, split sizes change. Do not split verses independently into sentences: English and Idoma sentence boundaries are not necessarily aligned.

## Alignment and filtering

Actual inputs are lists of objects: 31,101 English and 31,075 Idoma records. Join by reference (GEN.1.1), never zip these files. Validate reference syntax, positive chapter/verse indices and supplied metadata consistency. Duplicate identifiers quarantine all records with that ID. Missing IDs, invalid text, empty/placeholder/replacement-character values, exact echoes, and duplicate bilingual pairs are excluded. Script/style contents, HTML tags, recognized USFM markers and known placeholder codes are removed. NFC normalization preserves tone marks; no ASCII conversion or lowercasing of exported text occurs.

Other supported inputs: identifier-to-string objects, identifier-to-record objects, record arrays with reference/verse_id/id/chapter_verse, or book_code+chapter+verse. Override text fields with --english-text-field/--idoma-text-field and marker with --id-field. Nested book/chapter trees are rejected rather than guessed. String arrays require equal lengths and --confirm-positional-alignment; missing interior records cannot be detected from plain strings. UTF-8 (with/without BOM) and BOM-marked UTF-16 are supported. Malformed JSON and duplicate JSON object keys fail with an error rather than silently corrupting alignment. Full files are loaded into memory, appropriate to these approximately 20 MB inputs; this is not a streaming parser for multi-gigabyte files.

## Splits and interpretation

Seed 42; stratify independent text groups by longest word-count bands <=16, <=32, <=64, <=96, >96. Any repeated English OR Idoma text, including transitive connections, stays in one split; identical bilingual pairs are deduplicated first. Largest-remainder rounding targets 85/10/5 GROUPS within each band. Row percentages are approximate because groups remain intact. No English or Idoma exact case-insensitive text overlaps across splits. This does not eliminate near-duplicate passages or adjacent-verse thematic leakage; use a book/chapter holdout for a stronger domain-generalization evaluation.

report.json records input hashes, counts, exclusions, word statistics, optional token statistics and split percentages. Discard counts use distinct identifiers, except duplicate_text_pair which counts removed aligned pairs; missing-identifier and duplicate raw row telemetry is separately recorded per input. alignment.json references correspond to JSONL row order, retaining provenance without changing the training schema.

Bible text is domain-specific. Add human-reviewed conversational examples for the deployed app and evaluate Idoma-to-English as well as English-to-Idoma. The updated notebook reports generation metrics separately for both directions. No model training or upload has been performed by preprocessing.
