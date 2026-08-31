# Refactor notes — direct OCR + visual arrangement

## Architectural change

Removed the mandatory Page Map -> geometric assembly -> reconciliation chain.

Current flow:

`PDF -> PDFium page image -> Google Vision OCR -> GPT-5.6 Sol per-page arrangement -> deterministic exact-text ENCODE -> checks`

The Sol call receives the original page plus OCR fragment ids, exact OCR strings, bboxes and retained Vision block membership. It returns references only.

## Removed active files

- `lib/page-map-prompt.js`
- `lib/assemble.js`
- `lib/reconcile-prompt.js`

Replaced by `lib/structure-prompt.js`.

## OCR changes

`lib/ocr.js` now retains:

- Vision block ids and bboxes
- paragraph -> block membership
- paragraph bboxes
- confidence where supplied
- full OCR text for inspection

Normal prose geometry is therefore not thrown away and re-invented by a second model stage.

## Model-call changes

- No Page Map model call.
- Structural interpretation runs once per page, not once for the entire selected range.
- Default local/example reasoning effort changed from `medium` to `low`.
- Output budget is page-local and scales with OCR fragment count.
- A failed page-level model call is recorded in `structure.diagnostics`; OCR is preserved and deterministic fallback still emits the page's OCR strings.

## Encoder/completeness changes

The old encoder could mark a valid fragment as "touched" before discovering that another reference in the same block was invalid, allowing valid OCR text to disappear while completeness still passed.

The new encoder tracks actual emission instead:

- valid refs are marked emitted only after their OCR string is written
- invalid refs are recorded as `encodingIssues`
- duplicate refs are recorded rather than silently double-emitted
- unplaced OCR fragments become `fallback: true` paragraphs
- explicit model omissions require `omittedRefs` with a reason and remain visible

A regression test was run against the mixed valid/invalid-reference case and confirmed the valid heading survives, the invalid ref is surfaced, and an untouched source fragment falls back rather than disappearing.

## UI changes

Tabs are now:

- Evidence — original image + Vision block and paragraph overlays
- OCR — raw retained OCR evidence
- Sol Arrangement — raw per-page model arrangement + diagnostics
- Structured — deterministic exact-text output
- Rendered — human-readable result

Existing PDF upload, page-range controls, section context and single EXTRACT lever are preserved.

## Validation performed

- Node syntax check across all `lib/*.js`, `api/*.js`, and `local-server.mjs`
- Browser inline script syntax check
- local server startup + UI GET smoke test
- deterministic encoder regression test

A real end-to-end OCR/OpenAI run was not possible from this review copy because API keys were intentionally removed before upload.

## v3 edge-hardening — 31 Aug 2026

The direct architecture is unchanged. This pass deliberately avoids adding any new AI stage.

Changes:
- deterministic list-marker normalisation now removes OCR-only bullet/dot glyphs once list semantics are known, while retaining every source ref and recording each normalisation
- Sol no longer spends output tokens deciding `trimLeadingMarker`; list marker handling belongs to ENCODE
- source-text fidelity is now checked deterministically for source-controlled fields
- QC only advertises checks that actually run; the old pending figure/paraphrase/visual placeholders are gone
- low-confidence lexical OCR (<0.90) is a review note, not a failure; marker-only glyphs are excluded from the warning count
- Evidence highlights low-confidence lexical OCR regions and exposes ref/confidence/text via SVG tooltip
- status supports hard flags separately from review notes
- pipeline provenance bumped to `ocr-direct-visual-structure-encode-v3`
- added dependency-free encoder regression tests (`npm test`)

Regression-tested against the successful 31 Aug CV OCR + Sol Arrangement outputs. The rebuild reproduced the document with zero reference/completeness/source-text failures, no fallback content, and only two low-confidence lexical evidence notes: the spurious page-number OCR (`༠༠`) and the decorative `Bridget Holland` graphic text.

## v4 — grouped figure labels

- Figure structure now uses `groups: [{ role, refs: [...] }]` instead of one OCR ref per label.
- Multiple Vision OCR fragments that form one visual label can therefore remain one logical object.
- Figure `description` and `extractedFacts` were removed from the structural arrangement call; this pass now only arranges existing OCR evidence.
- ENCODE resolves grouped refs back to exact OCR strings and QC audits those grouped source strings.
- Added a regression case based on the CV Venn diagram (`UX, Information` + `Architecture` + `& Process Design`).

## v5 — figure label/member hierarchy

- Figure groups now distinguish `labelRefs` from optional subordinate `items[].refs`.
- This preserves the v4 grouped-label fix while adding one internal relationship for category-style graphics such as the CV skills diagram.
- ENCODE resolves label/member strings from OCR refs only; Sol still never writes source text.
- The renderer separates a category label from its subordinate content instead of flattening the entire group into one string.
- v4 `groups[].refs` and v3 one-ref figure labels remain readable through a compatibility adapter.


## v6
- Added exact OCR-derived child line refs beneath paragraph fragments. Ordinary prose can still use compact parent refs; Sol can use child line refs only when a paragraph contains several visually distinct logical objects.
- Completeness is now tracked at the child-line evidence level, with parent/child overlap detection.
- Added machine-shell edge styling inspired by the supplied pure-CSS cassette player: layered bevels, side rails/protrusions and recessed display framing, without changing the app's existing palette/layout.
