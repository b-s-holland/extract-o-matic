# Extract-O-Matic

The current build deliberately removes the mandatory page-map stage.

```text
PDF
  -> canonical page images (PDFium)
  -> Google Vision OCR
       - exact OCR text
       - paragraph geometry
       - retained Vision block hierarchy
  -> GPT-5.6 Sol, one page at a time
       - sees original page image + OCR evidence
       - decides grouping, reading order and semantic block type
       - returns fragment references only; never source text
  -> deterministic ENCODE
       - resolves references back to exact OCR strings
       - preserves unplaced fragments as flagged fallback paragraphs
       - records invalid/duplicate refs and intentional omissions
  -> checks
```

## Why there is no page map

The rendered page image already contains the visual layout and Google Vision already returns text geometry and block/paragraph hierarchy. A second model-authored description of that same layout was adding another representation that could fail before OCR even ran.

This build tests the simpler hypothesis directly: **OCR + original image -> Sol arranges existing OCR evidence**.

If later testing identifies a specific class of pages where a separate wireframe materially improves interpretation, it can be added as optional, inspectable evidence rather than becoming a prerequisite for every page.

## One lever, inspectable stages

The UI still keeps PDF upload, page range and optional section context. EXTRACT runs the pipeline, then exposes:

- **Evidence** — original rendered page with Google Vision block outlines and OCR paragraph boxes/IDs.
- **OCR** — the retained OCR text, geometry, hierarchy and confidence values.
- **Sol Arrangement** — the raw reference-only structural answer for each page plus per-page diagnostics. If one page's model call fails, OCR remains visible and deterministic fallback still preserves its source fragments.
- **Structured** — exact-text encoded output, provenance, encoding issues and explicit omissions.
- **Rendered** — human-readable preview. Fallback paragraphs are marked with a wrench.

The model call is deliberately **per page**. That keeps output naturally bounded, isolates failures and prevents a dense page from invalidating neighbouring pages.

## Fidelity rules

- The rendered page is authoritative for visual interpretation.
- Google Vision OCR strings are authoritative lexical evidence.
- Sol references OCR ids; it does not retype source language.
- A fragment is counted as handled only after its OCR string is actually emitted.
- Invalid or duplicate references are surfaced as encoding issues.
- Any fragment Sol fails to arrange becomes a `fallback: true` paragraph rather than disappearing.
- Sol may explicitly omit an OCR fragment only through `omittedRefs`, with a reason; those omissions stay visible in Structured output.

## Model configuration

`.env.local` and `.env.example` now default to:

```text
OPENAI_VISION_MODEL=gpt-5.6-sol
OPENAI_API_MODE=chat_completions
OPENAI_REASONING_EFFORT=low
```

`OPENAI_TEMPERATURE` is unset. Google Vision remains the OCR engine.

Production/Vercel still uses its own environment-variable values; `.env.local` only controls local runs.

## Run locally

1. Node 18+
2. `npm install`
3. Put `OPENAI_API_KEY` and `GOOGLE_VISION_API_KEY` in `.env.local`
4. `node local-server.mjs`
5. Open `http://localhost:3000`

`.env.local` is gitignored.

## Current scope / still not built

- direct image upload (PDF is still the current source adapter)
- editable OCR/correction UI
- document chunking beyond 20 pages per request
- dedicated figure/paraphrase/visual QC passes
- formal Retrieval Indexing Audit

### QC behaviour (v3)

QC is deterministic and intentionally narrow. A hard flag means source accounting/reference integrity/encoder fidelity or a Sol page call failed. Low-confidence OCR and deterministic fallback are review notes rather than automatic extraction failures. Evidence highlights lexical OCR below 0.90 confidence; structural marker-only glyphs such as bullets are excluded from that warning count.

List bullets are treated as structure rather than language once Sol has identified a list. ENCODE removes OCR-only leading bullet/dot markers deterministically, retains their source refs, and records the normalisation in Structured output.

Run the dependency-free encoder regression suite with:

```bash
npm test
```
