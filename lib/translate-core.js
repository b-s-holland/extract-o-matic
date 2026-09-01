// lib/translate-core.js
//
// The deliberately boring architecture:
//
//   PDF -> render selected page(s) to PNG --\
//                                          -> multimodal model -> plain text + HTML
//   IMAGE -------------------------------/
//
// The rendered page image is the source supplied to the model. Nothing tries
// to pre-interpret the page before the model sees it.

import { createPdfWorkspace, getPageCount, renderPagesToPng, pngToDataUrl } from './pdf-tools.js';
import { inferInputKind, bufferToDataUrl } from './source-input.js';
import { RECONSTRUCT_SYSTEM_PROMPT, buildReconstructUserContent } from './reconstruct-prompt.js';
import { callVisionForReconstruction, getVisionConfig } from './openai-vision.js';

const MAX_PAGES_PER_CALL = 20;
const MAX_OUTPUT_TOKENS_PER_PAGE = 12000;

function resolvePageRange({ pageFrom, pageTo, totalPages }) {
  const hasFrom = pageFrom !== undefined && pageFrom !== null && pageFrom !== '';
  const hasTo = pageTo !== undefined && pageTo !== null && pageTo !== '';
  if (!hasFrom && !hasTo) return { from: 1, to: totalPages, requested: null };
  const from = parseInt(pageFrom, 10);
  const to = parseInt(pageTo, 10);
  if (!from || !to || to < from) throw new Error('Invalid page range.');
  if (from > totalPages) throw new Error(`This PDF only has ${totalPages} page(s) — the requested range starts at ${from}.`);
  return { from, to: Math.min(to, totalPages), requested: { from, to } };
}

function combinePlainText(pages) {
  if (pages.length === 1) return pages[0].plainText || '';
  return pages.map((p) => `PAGE ${p.page}\n\n${p.plainText || ''}`).join('\n\n\n');
}

function combineHtml(pages) {
  return pages.map((p) => `<section class="reconstructed-page" data-page="${p.page}">${p.html || ''}</section>`).join('\n');
}

export async function runPipeline({ inputBuffer, pdfBuffer, fileName, mimeType, pageFrom, pageTo, sectionTitle }) {
  const sourceBuffer = inputBuffer || pdfBuffer;
  if (!sourceBuffer || !sourceBuffer.length) throw new Error('No document file was received.');

  const input = inferInputKind(sourceBuffer, fileName, mimeType);
  let workspace = null;

  try {
    let totalPages = 1;
    let requested = { from: 1, to: 1 };
    let pageImages = [];

    if (input.sourceType === 'pdf') {
      workspace = await createPdfWorkspace(sourceBuffer);
      totalPages = await getPageCount(workspace.pdfPath);
      const range = resolvePageRange({ pageFrom, pageTo, totalPages });
      requested = range.requested || 'all';
      if (range.to - range.from + 1 > MAX_PAGES_PER_CALL) {
        throw new Error(`That's ${range.to - range.from + 1} pages in one go — this build caps a single run at ${MAX_PAGES_PER_CALL} pages. Narrow the range and try again.`);
      }
      const rendered = await renderPagesToPng(workspace.dir, workspace.pdfPath, range.from, range.to);
      for (const r of rendered) pageImages.push({ page: r.page, dataUrl: await pngToDataUrl(r.pngPath) });
    } else {
      pageImages = [{ page: 1, dataUrl: bufferToDataUrl(sourceBuffer, input.mimeType) }];
    }

    const pages = [];
    for (const p of pageImages) {
      const userContent = buildReconstructUserContent({
        page: p.page,
        imageDataUrl: p.dataUrl,
        sectionTitle
      });
      const result = await callVisionForReconstruction(
        RECONSTRUCT_SYSTEM_PROMPT,
        userContent,
        MAX_OUTPUT_TOKENS_PER_PAGE
      );
      pages.push({
        page: p.page,
        plainText: String(result.plainText || ''),
        html: String(result.html || '')
      });
    }

    const vision = getVisionConfig();
    const plainText = combinePlainText(pages);
    const html = combineHtml(pages);

    return {
      result: { pages, plainText, html },
      pageImages,
      source: {
        sourceType: input.sourceType,
        fileName: fileName || (input.sourceType === 'pdf' ? 'unknown.pdf' : 'unknown-image'),
        pageRange: requested,
        totalPages,
        sectionTitle: String(sectionTitle || '').trim() || null
      },
      provenance: {
        generatedAt: new Date().toISOString(),
        pipeline: 'direct-page-image-reconstruction-v1',
        model: vision.model,
        apiMode: vision.apiMode,
        calls: 'one multimodal reconstruction call per page'
      }
    };
  } finally {
    if (workspace) await workspace.cleanup();
  }
}
