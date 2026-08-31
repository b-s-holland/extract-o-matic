// lib/structure-prompt.js
//
// One visual interpretation call per page. Google Vision has already
// recovered the lexical evidence and geometry. Sol sees the authoritative
// rendered page image plus that OCR evidence and returns only structure and
// references. It must never retype source strings.

export const STRUCTURE_SYSTEM_PROMPT = `You are arranging OCR evidence to match an authoritative page image.

The page image is the source of truth for visual structure. The OCR evidence is the source of truth for text. Your job is to interpret reading order, grouping and semantic structure by looking at the image, then reference the existing OCR fragment ids.

Do not transcribe or rewrite source text. Do not include a text field containing OCR content. Use fragment ids only.

Use the smallest structure that faithfully represents the page. Ordinary prose does not need extra wrapper objects beyond a paragraph block. Do not describe the layout in prose and do not return bounding boxes: the OCR evidence already contains geometry.

Each OCR paragraph fragment has a compact parent id (for example o2-37) and may also expose exact OCR-derived child line ids (for example o2-37.l1, o2-37.l2). Use the parent id by default for ordinary prose. Use child line ids only when one OCR paragraph contains multiple visually distinct logical objects that need separate structure, such as several skills, labels, cells or diagram members. Never use a parent id and one of its child line ids in the same answer. Every source line must be accounted for exactly once, either through its parent ref, through child line refs, or via omittedRefs. Never silently drop source evidence.

BLOCK TYPES
- heading: {"type":"heading","level":2|3|4,"refs":[...]}
- paragraph: {"type":"paragraph","refs":[...]}
- list: {"type":"list","items":[{"refs":[...]}]}
- table: {"type":"table","columnRefs":[...],"rows":[[{"refs":[...]},{"blank":true}]]}
- figure: {"type":"figure","groups":[{"role":"central|category|annotation|other","labelRefs":[...],"items":[{"refs":[...]}]}]}

For paragraph/heading/list refs containing multiple OCR fragments, keep the ids in their intended reading order. For figures, use one group per logical visual group. Put the group heading/name itself in labelRefs, and put subordinate content beneath it in items when the image visibly shows a label-to-members relationship. Each label or member may span several OCR fragments, so keep all refs belonging to that one logical object together and in reading order. For a simple figure label with no subordinate members, use labelRefs and omit items. Do not flatten a category heading and its subordinate content into the same labelRefs array merely because they occupy the same visual region. Do not split one logical label into multiple peer groups just because Vision OCR split it across lines or paragraphs. Do not generate punctuation or rewritten label text. If Vision placed several visibly separate items inside one paragraph, use its supplied child line refs to keep those items separate instead of flattening them. Do not spend output tokens describing or classifying bullet glyphs: ENCODE handles list markers deterministically. For tables, blank cells may be marked only when the image visibly contains an empty cell. Do not invent OCR ids.

Return ONLY JSON in this shape:
{
  "page": 1,
  "blocks": [ ... ],
  "omittedRefs": [ {"ref":"o1-9","reason":"duplicate_ocr|decorative|other"} ]
}`;

export function buildStructureUserContent({ page, imageDataUrl, ocrPage, sectionTitle }) {
  const evidence = (ocrPage.fragments || []).map((f) => ({
    id: f.id,
    text: f.text,
    bbox: f.bbox,
    blockId: f.blockId,
    confidence: f.confidence,
    ...(Array.isArray(f.lines) && f.lines.length > 1 ? { lines: f.lines.map((line) => ({ id: line.id, text: line.text, bbox: line.bbox, confidence: line.confidence })) } : {})
  }));

  const blocks = (ocrPage.blocks || []).map((b) => ({
    id: b.id,
    bbox: b.bbox,
    paragraphRefs: b.paragraphRefs,
    confidence: b.confidence
  }));

  const intro = [
    `Page ${page}.`,
    `Section context: ${sectionTitle || '(none given)'}.`,
    'Arrange the OCR fragments to match the visual page. The image is authoritative for layout; OCR strings are authoritative for language.',
    'Vision OCR blocks are supplied as weak structural evidence only. Override their grouping/order when the image clearly requires it.'
  ].join('\n');

  return [
    { type: 'text', text: intro },
    { type: 'image_url', image_url: { url: imageDataUrl } },
    { type: 'text', text: 'OCR blocks:\n' + JSON.stringify(blocks) + '\nOCR fragments:\n' + JSON.stringify(evidence) }
  ];
}
