// lib/pdf-tools.js
//
// PDFium -- Google/Chromium's own PDF engine, compiled to WASM via
// @hyzyla/pdfium -- replaces the previous poppler-based implementation.
// Same motivation as before (a real PDF engine over a JS-only parser,
// for fidelity on real-world layouts/fonts/rotation), but this one needs
// no system binary at all: no `brew install poppler`, nothing that can
// be missing on a fresh machine or absent on a Vercel deploy.
//
// PNG encoding is done with pngjs (pure JS, no native bindings) rather
// than sharp, so the "zero native dependencies" property holds end to
// end, not just at the PDF-parsing step.
//
// Public interface is UNCHANGED from the poppler version except that
// renderPagesToPng now also returns width/height per page (needed to
// normalise OCR/page-map bounding boxes to a common fractional
// coordinate space):
//   createPdfWorkspace(buffer) -> { dir, pdfPath, cleanup() }
//   getPageCount(pdfPath) -> number
//   renderPagesToPng(workspaceDir, pdfPath, from, to) -> [{ page, pngPath, width, height }]
//   extractPageText(pdfPath, page) -> string
//   pngToDataUrl(pngPath) -> data: URL string

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PDFiumLibrary } from '@hyzyla/pdfium';
import { PNG } from 'pngjs';

// Roughly 200 DPI (pdfium's scale is relative to 72 DPI). A step up from
// the previous poppler default of 150 DPI -- cheap to raise now that
// there's no per-call process-spawn cost, and small print in real annual
// report footnotes benefits from it.
const RENDER_SCALE = 200 / 72;

// One WASM module instance for the whole process; initialising it has
// real (if small) cost, loading a document from it does not.
let libraryPromise = null;
function getLibrary() {
  if (!libraryPromise) libraryPromise = PDFiumLibrary.init();
  return libraryPromise;
}

// Documents are cached per pdfPath so a single extraction -- which calls
// getPageCount, then renderPagesToPng, then extractPageText once per
// page -- parses the file once, not repeatedly. Closed via
// closeDocument(), wired into createPdfWorkspace()'s cleanup().
const openDocuments = new Map();

async function getDocument(pdfPath) {
  if (openDocuments.has(pdfPath)) return openDocuments.get(pdfPath);
  const library = await getLibrary();
  const buffer = await fs.readFile(pdfPath);
  const document = await library.loadDocument(buffer);
  openDocuments.set(pdfPath, document);
  return document;
}

function closeDocument(pdfPath) {
  const document = openDocuments.get(pdfPath);
  if (document) {
    document.destroy();
    openDocuments.delete(pdfPath);
  }
}

export async function createPdfWorkspace(pdfBuffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-extract-'));
  const pdfPath = path.join(dir, 'source.pdf');
  await fs.writeFile(pdfPath, pdfBuffer);
  return {
    dir,
    pdfPath,
    async cleanup() {
      closeDocument(pdfPath);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

export async function getPageCount(pdfPath) {
  const document = await getDocument(pdfPath);
  return document.getPageCount();
}

// pdfium's bitmap render mode returns pixel data already in RGBA byte
// order (despite the library calling the option "BGRA" -- that refers to
// the underlying native pdfium bitmap format, not the bytes actually
// handed back to JS). Verified empirically with a known-colour test PDF
// before trusting this: swapping the R/B bytes here produced a blue
// rectangle rendering as red. No swap needed -- pngjs can take the
// buffer as-is.
function bitmapToPngBuffer(rgbaData, width, height) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgbaData);
  return PNG.sync.write(png);
}

// Renders pages [from, to] (1-indexed, inclusive) to PNGs at a workspace
// path and returns { page, pngPath, width, height } in page order. Width
// and height (actual rendered pixel dimensions) are exposed so bounding
// OCR boxes can be normalised against the authoritative rendered page
// fractional coordinate space regardless of render DPI.
export async function renderPagesToPng(workspaceDir, pdfPath, from, to) {
  const document = await getDocument(pdfPath);
  const rendered = [];

  for (let pageNum = from; pageNum <= to; pageNum++) {
    const page = document.getPage(pageNum - 1); // pdfium pages are 0-indexed
    const image = await page.render({ scale: RENDER_SCALE, render: 'bitmap' });
    const pngBuffer = bitmapToPngBuffer(image.data, image.width, image.height);
    const pngPath = path.join(workspaceDir, 'page-' + pageNum + '.png');
    await fs.writeFile(pngPath, pngBuffer);
    rendered.push({ page: pageNum, pngPath, width: image.width, height: image.height });
  }

  return rendered;
}

// Raw text layer for a single page, used only for the cheap coverage
// check -- never fed back into the structured output verbatim, since the
// whole point of the vision pass is to recover *visual* structure the
// text layer alone doesn't have.
export async function extractPageText(pdfPath, page) {
  const document = await getDocument(pdfPath);
  const pdfiumPage = document.getPage(page - 1); // 0-indexed
  return pdfiumPage.getText();
}

export async function pngToDataUrl(pngPath) {
  const buf = await fs.readFile(pngPath);
  return 'data:image/png;base64,' + buf.toString('base64');
}
