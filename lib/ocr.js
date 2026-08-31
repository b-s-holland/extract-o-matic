// lib/ocr.js
// Google Cloud Vision is the lexical evidence layer. Keep useful Vision
// hierarchy/geometry instead of flattening it away: block -> paragraph -> line.
// Paragraph refs remain the compact default evidence units; exact OCR-derived
// child line refs are also exposed so Sol can express finer structure without
// rewriting or splitting source language itself.

function symbolBreakType(symbol) {
  return symbol && symbol.property && symbol.property.detectedBreak && symbol.property.detectedBreak.type;
}

function normalizeBbox(vertices, pageWidth, pageHeight) {
  if (!vertices || !vertices.length || !pageWidth || !pageHeight) return null;
  const xs = vertices.map((v) => v.x || 0);
  const ys = vertices.map((v) => v.y || 0);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX / pageWidth, y: minY / pageHeight, w: (maxX - minX) / pageWidth, h: (maxY - minY) / pageHeight };
}

function unionBboxes(boxes) {
  const valid = (boxes || []).filter(Boolean);
  if (!valid.length) return null;
  const minX = Math.min(...valid.map((b) => b.x));
  const minY = Math.min(...valid.map((b) => b.y));
  const maxX = Math.max(...valid.map((b) => b.x + b.w));
  const maxY = Math.max(...valid.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function avgConfidence(items) {
  const values = (items || []).map((x) => Number(x.confidence)).filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function extractParagraphLines(paragraph, pageWidth, pageHeight) {
  const lines = [];
  let text = '';
  let boxes = [];
  let confidences = [];

  const flush = () => {
    const cleaned = text.replace(/[ \t]+$/g, '').trim();
    if (cleaned) {
      lines.push({
        text: cleaned,
        bbox: unionBboxes(boxes),
        confidence: avgConfidence(confidences.map((confidence) => ({ confidence })))
      });
    }
    text = '';
    boxes = [];
    confidences = [];
  };

  for (const word of paragraph.words || []) {
    let wordText = '';
    let breakType = null;
    for (const symbol of word.symbols || []) {
      wordText += symbol.text || '';
      breakType = symbolBreakType(symbol) || breakType;
    }
    if (!wordText) continue;
    text += wordText;
    if (word.boundingBox) boxes.push(normalizeBbox(word.boundingBox.vertices, pageWidth, pageHeight));
    if (Number.isFinite(Number(word.confidence))) confidences.push(Number(word.confidence));

    if (breakType === 'LINE_BREAK' || breakType === 'EOL_SURE_SPACE') flush();
    else if (breakType === 'SPACE' || breakType === 'SURE_SPACE') text += ' ';
  }
  flush();
  return lines;
}

export async function runOcrOnPage(dataUrl, pageNumber, pageWidth, pageHeight) {
  if (!process.env.GOOGLE_VISION_API_KEY) throw new Error('GOOGLE_VISION_API_KEY is not set.');
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] })
  });
  if (!res.ok) throw new Error(`Google Vision API error (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const response = data.responses && data.responses[0];
  if (response && response.error) throw new Error(`Google Vision API error: ${response.error.message}`);

  const pages = (response && response.fullTextAnnotation && response.fullTextAnnotation.pages) || [];
  const fragments = [];
  const blocks = [];
  let fragmentOrder = 0;
  let blockOrder = 0;

  for (const page of pages) {
    // PDF renders provide dimensions upstream. Direct image uploads deliberately
    // bypass decoding/preprocessing, so use Vision's own page dimensions instead.
    const effectiveWidth = pageWidth || page.width;
    const effectiveHeight = pageHeight || page.height;
    for (const block of page.blocks || []) {
      blockOrder++;
      const blockId = `b${pageNumber}-${blockOrder}`;
      const paragraphRefs = [];
      const paragraphConfidences = [];
      for (const paragraph of block.paragraphs || []) {
        const rawLines = extractParagraphLines(paragraph, effectiveWidth, effectiveHeight);
        if (!rawLines.length) continue;
        const text = rawLines.map((line) => line.text).join('\n');
        fragmentOrder++;
        const id = `o${pageNumber}-${fragmentOrder}`;
        const lines = rawLines.map((line, i) => ({
          id: `${id}.l${i + 1}`,
          order: i + 1,
          parentId: id,
          text: line.text,
          bbox: line.bbox,
          confidence: line.confidence
        }));
        paragraphRefs.push(id);
        if (Number.isFinite(Number(paragraph.confidence))) paragraphConfidences.push(Number(paragraph.confidence));
        fragments.push({
          id,
          order: fragmentOrder,
          blockId,
          text,
          bbox: paragraph.boundingBox ? normalizeBbox(paragraph.boundingBox.vertices, effectiveWidth, effectiveHeight) : unionBboxes(lines.map((line) => line.bbox)),
          confidence: Number.isFinite(Number(paragraph.confidence)) ? Number(paragraph.confidence) : avgConfidence(lines),
          lines
        });
      }
      if (paragraphRefs.length) {
        blocks.push({
          id: blockId,
          order: blockOrder,
          paragraphRefs,
          bbox: block.boundingBox ? normalizeBbox(block.boundingBox.vertices, effectiveWidth, effectiveHeight) : null,
          confidence: Number.isFinite(Number(block.confidence)) ? Number(block.confidence) : avgConfidence(paragraphConfidences.map((confidence) => ({ confidence })))
        });
      }
    }
  }

  return { fullText: (response && response.fullTextAnnotation && response.fullTextAnnotation.text) || '', blocks, fragments };
}
