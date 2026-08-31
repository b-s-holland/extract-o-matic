// lib/translate-core.js
//
// Direct architecture with one canonical downstream input: PAGE IMAGE.
//
//   PDF   -> PDFium render -> page image(s) --\
//                                            +-> Google Vision OCR
//   IMAGE -----------------> page image -----/
//                                                -> Sol per-page visual arrangement
//                                                -> deterministic ENCODE
//                                                -> checks
//
// Direct image uploads intentionally bypass PDFium and receive no separate
// preprocessing path. Once pageImages exists, PDF and image inputs are identical.

import { createPdfWorkspace, getPageCount, renderPagesToPng, pngToDataUrl } from './pdf-tools.js';
import { runOcrOnPage } from './ocr.js';
import { STRUCTURE_SYSTEM_PROMPT, buildStructureUserContent } from './structure-prompt.js';
import { callVisionForStructure, getVisionConfig } from './openai-vision.js';
import { encodePages } from './encode.js';
import { runChecks } from './translation-checks.js';
import { renderPreviewHtml } from './render-preview.js';
import { inferInputKind, bufferToDataUrl } from './source-input.js';

const MAX_PAGES_PER_CALL = 20;
const STRUCTURE_BASE_TOKENS = 700;
const STRUCTURE_PER_FRAGMENT_TOKENS = 28;
const STRUCTURE_MAX_TOKENS_PER_PAGE = 5000;

function resolvePageRange({ pageFrom, pageTo, totalPages }) {
  const hasFrom = pageFrom !== undefined && pageFrom !== null && pageFrom !== '';
  const hasTo = pageTo !== undefined && pageTo !== null && pageTo !== '';
  if (!hasFrom && !hasTo) return { from: 1, to: totalPages, requested: null };
  const from = parseInt(pageFrom, 10), to = parseInt(pageTo, 10);
  if (!from || !to || to < from) throw new Error('Invalid page range.');
  if (from > totalPages) throw new Error(`This PDF only has ${totalPages} page(s) — the requested range starts at ${from}.`);
  return { from, to: Math.min(to, totalPages), requested: { from, to } };
}

function structureTokenBudget(fragmentCount) {
  return Math.min(STRUCTURE_MAX_TOKENS_PER_PAGE, STRUCTURE_BASE_TOKENS + fragmentCount * STRUCTURE_PER_FRAGMENT_TOKENS);
}

export async function runPipeline({ inputBuffer, pdfBuffer, fileName, mimeType, pageFrom, pageTo, sectionTitle }) {
  const sourceBuffer = inputBuffer || pdfBuffer; // pdfBuffer kept as a compatibility alias.
  if (!sourceBuffer || !sourceBuffer.length) throw new Error('No document file was received.');

  const input = inferInputKind(sourceBuffer, fileName, mimeType);
  let workspace = null;

  try {
    let totalPages;
    let requested;
    let pageImages = [];
    const pageDims = {};

    // This is the ONLY source-specific branch. Both paths exit with pageImages.
    if (input.sourceType === 'pdf') {
      workspace = await createPdfWorkspace(sourceBuffer);
      totalPages = await getPageCount(workspace.pdfPath);
      const range = resolvePageRange({ pageFrom, pageTo, totalPages });
      const { from, to } = range;
      requested = range.requested;
      if (to - from + 1 > MAX_PAGES_PER_CALL) {
        throw new Error(`That's ${to - from + 1} pages in one go — this build caps a single run at ${MAX_PAGES_PER_CALL} pages (no chunking yet). Narrow the page range and try again.`);
      }

      const rendered = await renderPagesToPng(workspace.dir, workspace.pdfPath, from, to);
      for (const r of rendered) {
        pageImages.push({ page: r.page, dataUrl: await pngToDataUrl(r.pngPath) });
        pageDims[r.page] = { width: r.width, height: r.height };
      }
    } else {
      // No PDFium, no OCR shortcut, no preprocessing: the uploaded image itself
      // is the canonical page image and enters the existing pipeline as page 1.
      totalPages = 1;
      requested = { from: 1, to: 1 };
      pageImages = [{ page: 1, dataUrl: bufferToDataUrl(sourceBuffer, input.mimeType) }];
    }

    // Evidence pass: OCR first. No LLM is needed to create a second description
    // of layout that the image and OCR geometry already contain.
    const ocrPages = [];
    for (const p of pageImages) {
      const dims = pageDims[p.page] || {};
      const result = await runOcrOnPage(p.dataUrl, p.page, dims.width, dims.height);
      ocrPages.push({ page: p.page, ...result });
    }
    const ocrByPage = Object.fromEntries(ocrPages.map((p) => [p.page, p]));

    // One structural interpretation call PER PAGE. This is unchanged for image
    // input: Sol receives the same page image + OCR evidence shape either way.
    const title = (sectionTitle || '').trim() || 'Untitled section';
    const structureByPage = {};
    const modelDiagnostics = {};
    for (const p of pageImages) {
      const ocrPage = ocrByPage[p.page];
      const content = buildStructureUserContent({ page: p.page, imageDataUrl: p.dataUrl, ocrPage, sectionTitle: title });
      const budget = structureTokenBudget((ocrPage.fragments || []).length);
      try {
        structureByPage[p.page] = await callVisionForStructure(STRUCTURE_SYSTEM_PROMPT, content, budget);
        modelDiagnostics[p.page] = { status: 'ok', maxCompletionTokens: budget };
      } catch (err) {
        structureByPage[p.page] = { page: p.page, blocks: [], omittedRefs: [] };
        modelDiagnostics[p.page] = {
          status: 'failed',
          maxCompletionTokens: budget,
          message: err.message,
          rawResponse: err.rawResponse || null
        };
      }
    }

    const { pages: encodedPages, unreferencedByPage, issuesByPage } = encodePages(ocrPages, structureByPage);
    const checks = runChecks(encodedPages, unreferencedByPage, issuesByPage, modelDiagnostics, ocrPages);
    const previewHtml = renderPreviewHtml(encodedPages, title);
    const visionConfig = getVisionConfig();

    return {
      ocr: { pages: ocrPages },
      pageImages,
      structure: { pages: Object.values(structureByPage), diagnostics: modelDiagnostics },
      structured: {
        source: {
          sourceType: input.sourceType,
          fileName: fileName || (input.sourceType === 'pdf' ? 'unknown.pdf' : 'unknown-image'),
          pageRange: requested || 'all',
          totalPages,
          sectionTitle: title
        },
        pages: encodedPages,
        provenance: {
          generatedAt: new Date().toISOString(),
          pipeline: 'ocr-direct-visual-structure-encode-v7',
          sourceType: input.sourceType,
          ocrEngine: 'google-cloud-vision',
          structureModel: visionConfig.model,
          structureApiMode: visionConfig.apiMode,
          structureCallMode: 'per-page'
        }
      },
      previewHtml,
      checks
    };
  } finally {
    if (workspace) await workspace.cleanup();
  }
}
