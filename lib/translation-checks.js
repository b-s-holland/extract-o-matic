// lib/translation-checks.js
// Deterministic QC only. Do not advertise checks we are not actually running.
// The architecture prevents model paraphrase of source text by construction:
// source-language fields are resolved from OCR refs inside ENCODE.

const LOW_OCR_CONFIDENCE = 0.90;

function countFallbacks(pages) {
  let count = 0;
  pages.forEach((p) => (p.blocks || []).forEach((b) => { if (b.fallback) count++; }));
  return count;
}

function checkTables(pages) {
  let seen = false;
  let flagged = false;
  pages.forEach((p) => (p.blocks || []).forEach((block) => {
    if (block.type !== 'table') return;
    seen = true;
    const columns = block.columns || [];
    const rows = block.rows || [];
    if (!columns.length || !rows.every((row) => row.length === columns.length)) flagged = true;
  }));
  return { seen, flagged };
}

function auditSourceText(pages, ocrPages) {
  const ocrByPage = Object.fromEntries((ocrPages || []).map((p) => {
    const entries = [];
    for (const f of p.fragments || []) {
      entries.push([f.id, f]);
      for (const line of f.lines || []) entries.push([line.id, line]);
    }
    return [p.page, Object.fromEntries(entries)];
  }));
  const failures = [];

  for (const page of pages || []) {
    const byId = ocrByPage[page.page] || {};
    for (const block of page.blocks || []) {
      if (block.type === 'heading' || block.type === 'paragraph') {
        const expected = (block.sourceRefs || []).map((id) => byId[id] && byId[id].text).filter((x) => x !== undefined).join('\n');
        if (block.text !== expected) failures.push({ page: page.page, type: block.type, sourceRefs: block.sourceRefs || [] });
      } else if (block.type === 'figure') {
        for (const group of block.groups || []) {
          const labelRefs = group.labelSourceRefs || [];
          const expectedLabel = labelRefs.map((id) => byId[id] && byId[id].text).filter((x) => x !== undefined).join('\n');
          if (group.label !== expectedLabel) {
            failures.push({ page: page.page, type: 'figure_group_label', sourceRefs: labelRefs });
          }

          const itemRefs = group.itemSourceRefs || [];
          const items = group.items || [];
          if (itemRefs.length !== items.length) {
            failures.push({ page: page.page, type: 'figure_group_items', sourceRefs: group.sourceRefs || [] });
            continue;
          }
          itemRefs.forEach((refs, i) => {
            const expectedItem = (refs || []).map((id) => byId[id] && byId[id].text).filter((x) => x !== undefined).join('\n');
            if (items[i] !== expectedItem) {
              failures.push({ page: page.page, type: 'figure_group_item', sourceRefs: refs || [] });
            }
          });
        }
      }
    }
  }
  return failures;
}

function isStructuralMarker(text) {
  return /^[\s•\u2022\u25CF\u25AA\u25E6\-*|.·]+$/.test(text || '');
}

function lowConfidenceEvidence(ocrPages) {
  const fragments = [];
  for (const page of ocrPages || []) {
    for (const fragment of page.fragments || []) {
      if (!isStructuralMarker(fragment.text) && Number.isFinite(fragment.confidence) && fragment.confidence < LOW_OCR_CONFIDENCE) {
        fragments.push({ page: page.page, ref: fragment.id, confidence: fragment.confidence, text: fragment.text });
      }
    }
  }
  return fragments;
}

export function runChecks(pages, unreferencedByPage, issuesByPage, modelDiagnostics, ocrPages) {
  let encodingIssueCount = 0;
  let structureFailureCount = 0;
  Object.values(issuesByPage || {}).forEach((issues) => { encodingIssueCount += (issues || []).length; });
  Object.values(modelDiagnostics || {}).forEach((d) => { if (d && d.status === 'failed') structureFailureCount++; });

  const unreferencedCount = Object.values(unreferencedByPage || {}).reduce((sum, refs) => sum + (refs || []).length, 0);
  const fallbackCount = countFallbacks(pages || []);
  const tables = checkTables(pages || []);
  const sourceTextFailures = auditSourceText(pages || [], ocrPages || []);
  const lowConfidence = lowConfidenceEvidence(ocrPages || []);

  return {
    structure: { status: structureFailureCount ? 'flag' : 'pass', count: structureFailureCount },
    references: { status: encodingIssueCount ? 'flag' : 'pass', count: encodingIssueCount },
    completeness: { status: unreferencedCount ? 'flag' : 'pass', count: unreferencedCount },
    typing: { status: fallbackCount ? 'warn' : 'pass', count: fallbackCount },
    sourceText: { status: sourceTextFailures.length ? 'flag' : 'pass', count: sourceTextFailures.length, details: sourceTextFailures },
    ocrConfidence: { status: lowConfidence.length ? 'warn' : 'pass', count: lowConfidence.length, threshold: LOW_OCR_CONFIDENCE, details: lowConfidence },
    tables: { status: tables.seen ? (tables.flagged ? 'flag' : 'pass') : 'na', count: tables.flagged ? 1 : 0 }
  };
}
