// lib/encode.js
// Resolve Sol's reference-only structure back to exact OCR strings.
// Source language always comes from OCR. Deterministic normalisations are
// limited to structural glyphs (for example bullet markers inside list items)
// and are recorded so nothing is silently rewritten.

function markerOnly(text) {
  return /^[\s•\u2022\u25CF\u25AA\u25E6\-*|.·]+$/.test(text || '');
}

function stripLeadingListMarker(text) {
  const original = text || '';
  if (markerOnly(original)) return { text: '', changed: !!original.trim() };

  // Vision sometimes emits the bullet as part of the paragraph ("•\nText"),
  // as punctuation (".\nText"), or as a separate tiny paragraph. A list block
  // already carries that structural meaning, so remove only the leading marker.
  const cleaned = original.replace(/^\s*(?:[•\u2022\u25CF\u25AA\u25E6*]|[.\-])\s*(?:\r?\n|\s)+/, '');
  return { text: cleaned, changed: cleaned !== original };
}

function makeLookup(ocrPage) {
  const byId = {};
  const leafIdsByRef = {};
  const allLeafIds = [];

  for (const fragment of ocrPage.fragments || []) {
    const lines = Array.isArray(fragment.lines) && fragment.lines.length
      ? fragment.lines
      : [{ id: fragment.id, parentId: fragment.id, text: fragment.text, bbox: fragment.bbox, confidence: fragment.confidence }];
    const leafIds = lines.map((line) => line.id);
    leafIdsByRef[fragment.id] = leafIds;
    byId[fragment.id] = { ...fragment, leafIds, isParent: true };
    for (const line of lines) {
      allLeafIds.push(line.id);
      leafIdsByRef[line.id] = [line.id];
      byId[line.id] = { ...line, leafIds: [line.id], isLine: line.id !== fragment.id };
    }
  }
  return { byId, leafIdsByRef, allLeafIds };
}

function resolveRefs(refs, lookup, emittedLeaves, issues, options = {}) {
  const { byId, leafIdsByRef } = lookup;
  const separator = options.separator === undefined ? '\n' : options.separator;
  const normalizeListMarkers = !!options.normalizeListMarkers;
  const values = [];
  const used = [];
  const normalizations = [];

  for (const ref of refs || []) {
    const id = typeof ref === 'string' ? ref : ref && ref.ref;
    if (!id || !byId[id]) {
      issues.push({ type: 'invalid_ref', ref: id || null });
      continue;
    }
    const leafIds = leafIdsByRef[id] || [];
    if (leafIds.some((leafId) => emittedLeaves.has(leafId))) {
      issues.push({ type: 'overlapping_ref', ref: id, overlaps: leafIds.filter((leafId) => emittedLeaves.has(leafId)) });
      continue;
    }

    const original = byId[id].text || '';
    let text = original;
    if (normalizeListMarkers) {
      const normalized = stripLeadingListMarker(original);
      text = normalized.text;
      if (normalized.changed) {
        normalizations.push({ type: 'list_marker_removed', ref: id, before: original, after: text });
      }
    }

    used.push(id);
    leafIds.forEach((leafId) => emittedLeaves.add(leafId));
    if (text) values.push(text);
  }

  return { text: values.join(separator), used, normalizations };
}

function encodeBlock(block, lookup, emittedLeaves, issues) {
  if (!block || !block.type) return null;

  if (block.type === 'heading' || block.type === 'paragraph') {
    const joined = resolveRefs(block.refs || (block.ref ? [block.ref] : []), lookup, emittedLeaves, issues);
    if (!joined.used.length) return null;
    return block.type === 'heading'
      ? { type: 'heading', level: Math.min(Math.max(Number(block.level) || 4, 2), 4), text: joined.text, sourceRefs: joined.used }
      : { type: 'paragraph', text: joined.text, sourceRefs: joined.used };
  }

  if (block.type === 'list') {
    const items = [];
    const sourceRefs = [];
    const itemSourceRefs = [];
    const normalizations = [];

    for (const item of block.items || []) {
      const joined = resolveRefs(
        item.refs || (item.ref ? [item.ref] : []),
        lookup,
        emittedLeaves,
        issues,
        { separator: '\n', normalizeListMarkers: true }
      );
      if (!joined.used.length) continue;
      sourceRefs.push(...joined.used);
      itemSourceRefs.push(joined.used);
      normalizations.push(...joined.normalizations);
      if (joined.text) items.push(joined.text);
      else items.push('');
    }

    // Empty marker-only items should not become visible blank bullets, but the
    // refs remain accounted for in sourceRefs/itemSourceRefs.
    const visibleItems = [];
    const visibleItemSourceRefs = [];
    items.forEach((text, i) => {
      if (!text) return;
      visibleItems.push(text);
      visibleItemSourceRefs.push(itemSourceRefs[i]);
    });
    if (!visibleItems.length && !sourceRefs.length) return null;

    return {
      type: 'list',
      items: visibleItems,
      sourceRefs,
      itemSourceRefs: visibleItemSourceRefs,
      ...(normalizations.length ? { normalizations } : {})
    };
  }

  if (block.type === 'table') {
    const columns = [];
    const columnSourceRefs = [];
    const sourceRefs = [];
    for (const ref of block.columnRefs || []) {
      const joined = resolveRefs([ref], lookup, emittedLeaves, issues);
      if (joined.used.length) {
        columns.push(joined.text);
        columnSourceRefs.push(joined.used);
        sourceRefs.push(...joined.used);
      }
    }

    const cellSourceRefs = [];
    const rows = (block.rows || []).map((row) => (row || []).map((cell) => {
      if (cell && cell.blank) {
        cellSourceRefs.push([]);
        return '';
      }
      const joined = resolveRefs((cell && cell.refs) || (cell && cell.ref ? [cell.ref] : []), lookup, emittedLeaves, issues);
      sourceRefs.push(...joined.used);
      cellSourceRefs.push(joined.used);
      return joined.text;
    }));
    if (!columns.length && !rows.length) return null;
    return { type: 'table', columns, rows, sourceRefs, columnSourceRefs, cellSourceRefs };
  }

  if (block.type === 'figure') {
    const groups = [];
    const sourceRefs = [];

    // v6 figure schema (figure hierarchy retained from v5): a visual group can have a logical label plus
    // subordinate member/items. Sol decides those relationships only;
    // ENCODE resolves exact OCR strings. Legacy v4 `refs` groups and v3
    // one-ref labels are adapted into labelRefs so saved runs remain readable.
    const rawGroups = Array.isArray(block.groups)
      ? block.groups
      : (block.labels || []).map((label) => ({ role: label.role, labelRefs: label && label.ref ? [label.ref] : [] }));

    for (const group of rawGroups) {
      const labelRefs = (group && group.labelRefs)
        || (group && group.refs)
        || (group && group.ref ? [group.ref] : []);
      const label = resolveRefs(labelRefs, lookup, emittedLeaves, issues, { separator: '\n' });

      const items = [];
      const itemSourceRefs = [];
      for (const item of (group && group.items) || []) {
        const refs = (item && item.refs) || (item && item.ref ? [item.ref] : []);
        const joined = resolveRefs(refs, lookup, emittedLeaves, issues, { separator: '\n' });
        if (!joined.used.length) continue;
        items.push(joined.text);
        itemSourceRefs.push(joined.used);
      }

      const groupRefs = [...label.used, ...itemSourceRefs.flat()];
      if (!groupRefs.length) continue;
      sourceRefs.push(...groupRefs);
      groups.push({
        role: (group && group.role) || 'other',
        label: label.text,
        labelSourceRefs: label.used,
        items,
        itemSourceRefs,
        sourceRefs: groupRefs
      });
    }

    if (!groups.length && !sourceRefs.length) return null;
    return { type: 'figure', groups, sourceRefs };
  }

  issues.push({ type: 'unknown_block_type', blockType: block.type });
  return null;
}

export function encodePage(ocrPage, structurePage) {
  const lookup = makeLookup(ocrPage);
  const { byId, leafIdsByRef, allLeafIds } = lookup;
  const emittedLeaves = new Set();
  const issues = [];
  const blocks = [];

  for (const block of (structurePage && structurePage.blocks) || []) {
    const encoded = encodeBlock(block, lookup, emittedLeaves, issues);
    if (encoded) blocks.push(encoded);
  }

  const intentionalOmissions = [];
  for (const omission of (structurePage && structurePage.omittedRefs) || []) {
    const ref = omission && omission.ref;
    if (!ref || !byId[ref]) {
      issues.push({ type: 'invalid_omitted_ref', ref: ref || null });
      continue;
    }
    const leafIds = leafIdsByRef[ref] || [];
    if (leafIds.some((leafId) => emittedLeaves.has(leafId))) {
      issues.push({ type: 'omitted_but_emitted', ref });
      continue;
    }
    leafIds.forEach((leafId) => emittedLeaves.add(leafId));
    intentionalOmissions.push({ ref, reason: omission.reason || 'other', text: byId[ref].text });
  }

  // Completeness is measured at the finest deterministic OCR evidence level.
  // If an entire paragraph remains unresolved, preserve it as one paragraph;
  // if only some child lines remain unresolved, preserve those exact lines.
  for (const fragment of ocrPage.fragments || []) {
    const lines = Array.isArray(fragment.lines) && fragment.lines.length
      ? fragment.lines
      : [{ id: fragment.id, text: fragment.text }];
    const remaining = lines.filter((line) => !emittedLeaves.has(line.id));
    if (!remaining.length) continue;

    if (remaining.length === lines.length) {
      lines.forEach((line) => emittedLeaves.add(line.id));
      blocks.push({ type: 'paragraph', text: fragment.text, sourceRefs: [fragment.id], fallback: true, fallbackReason: 'not_structured_by_model' });
    } else {
      for (const line of remaining) {
        emittedLeaves.add(line.id);
        blocks.push({ type: 'paragraph', text: line.text, sourceRefs: [line.id], fallback: true, fallbackReason: 'partially_unstructured_ocr_fragment' });
      }
    }
  }

  const unaccountedRefs = allLeafIds.filter((id) => !emittedLeaves.has(id));
  return { page: structurePage && structurePage.page ? structurePage.page : null, blocks, issues, intentionalOmissions, fallbackRefs: [], unaccountedRefs };
}

export function encodePages(ocrPages, structureByPage) {
  const pages = [];
  const unreferencedByPage = {};
  const issuesByPage = {};
  for (const ocrPage of ocrPages) {
    const encoded = encodePage(ocrPage, structureByPage[ocrPage.page] || { page: ocrPage.page, blocks: [], omittedRefs: [] });
    encoded.page = ocrPage.page;
    pages.push({ page: encoded.page, blocks: encoded.blocks, intentionalOmissions: encoded.intentionalOmissions, encodingIssues: encoded.issues });
    unreferencedByPage[ocrPage.page] = encoded.unaccountedRefs;
    issuesByPage[ocrPage.page] = encoded.issues;
  }
  return { pages, unreferencedByPage, issuesByPage };
}
