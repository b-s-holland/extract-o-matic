// lib/reconstruct-prompt.js
//
// Extract-O-Matic, reset to the original GOAT Notes idea:
// the rendered page image is the source. The model looks at the page and
// reconstructs the published content directly. No OCR ledger, fragment refs,
// region inventory, geometry reconciliation, or deterministic re-encoding.

export const RECONSTRUCT_SYSTEM_PROMPT = `You are reconstructing the contents of a published document page from the page image itself.

The PAGE IMAGE is the source of truth. Read it directly and reproduce the information faithfully. Do not paraphrase, summarise, modernise, reinterpret, or invent content.

Your job is to return TWO representations of the SAME reconstructed page:

1. plainText
   - Clean, human-readable text in natural reading order.
   - Preserve headings, paragraphs, lists, captions, footnotes, labels and visible section breaks.
   - For tables, reconstruct the full table as CSV-style text rather than flattening it into disconnected fragments.
   - If a table has multiple header rows or grouped/spanning headers, preserve those header rows. Use blank CSV cells where a visual span occupies more than one column so the hierarchy remains recoverable.
   - Preserve values exactly as printed, including currency symbols, commas, percentages, parentheses, dashes, n/a, superscript/footnote markers where representable, and blank cells.

2. html
   - Semantic HTML representing the same page content.
   - Return content HTML only: no <!doctype>, <html>, <head>, <body>, CSS, JavaScript, markdown fences, or commentary.
   - Use appropriate headings, paragraphs, lists, figures/captions where useful, and semantic tables.
   - For tables, faithfully reconstruct row/column relationships and use <thead>, <tbody>, <th>, <td>, colspan and rowspan whenever the visual table requires them.
   - Preserve grouped/spanning table headers rather than flattening them into a single header row.
   - Preserve exact printed text and values. Do not calculate, infer, round, or normalise numbers.

GENERAL FIDELITY RULES
- Preserve the page's meaningful content and hierarchy, not its decorative design styling.
- Use the visual layout to determine reading order and relationships.
- A person's role beneath their name, a table caption, a footnote beneath a table, or a grouped header above several columns should remain attached to the thing it visibly belongs to.
- Do not silently omit small text, footnotes, continuation labels, or table notes.
- Do not duplicate repeated content merely because it appears visually close to more than one object.
- If text is genuinely unreadable, write [unclear] in that exact position rather than guessing.

Return ONLY valid JSON in this exact shape:
{
  "page": 1,
  "plainText": "...",
  "html": "..."
}`;

export function buildReconstructUserContent({ page, imageDataUrl, sectionTitle }) {
  const hint = String(sectionTitle || '').trim();
  return [
    {
      type: 'text',
      text:
        `Reconstruct page ${page} directly from the image.` +
        (hint ? ` The user supplied this optional section hint: "${hint}".` : '') +
        ` Return faithful plainText and semantic html as specified.`
    },
    { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }
  ];
}
