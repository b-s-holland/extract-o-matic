import assert from 'node:assert/strict';
import { encodePage } from '../lib/encode.js';
import { runChecks } from '../lib/translation-checks.js';

// Regression: a block containing one valid and one invalid ref must not make
// the valid OCR fragment disappear. The valid text is emitted; the bad ref is
// surfaced as an encoding issue.
{
  const ocrPage = {
    page: 1,
    fragments: [
      { id: 'o1-1', text: 'REAL HEADING', confidence: 0.99 },
      { id: 'o1-2', text: 'Body text', confidence: 0.99 }
    ]
  };
  const structurePage = {
    page: 1,
    blocks: [
      { type: 'heading', level: 2, refs: ['o1-1', 'BAD'] },
      { type: 'paragraph', refs: ['o1-2'] }
    ],
    omittedRefs: []
  };
  const encoded = encodePage(ocrPage, structurePage);
  assert.equal(encoded.blocks[0].text, 'REAL HEADING');
  assert.deepEqual(encoded.blocks[0].sourceRefs, ['o1-1']);
  assert.ok(encoded.issues.some((x) => x.type === 'invalid_ref' && x.ref === 'BAD'));
  assert.deepEqual(encoded.unaccountedRefs, []);
}

// List marker normalisation: structural OCR bullets/punctuation are consumed
// by the list structure, while lexical text remains untouched and every source
// ref stays accounted for.
{
  const ocrPage = {
    page: 1,
    fragments: [
      { id: 'o1-1', text: '•', confidence: 0.5 },
      { id: 'o1-2', text: 'First item', confidence: 0.99 },
      { id: 'o1-3', text: '.\nSecond item', confidence: 0.98 }
    ]
  };
  const structurePage = {
    page: 1,
    blocks: [{ type: 'list', items: [{ refs: ['o1-1', 'o1-2'] }, { refs: ['o1-3'] }] }],
    omittedRefs: []
  };
  const encoded = encodePage(ocrPage, structurePage);
  const list = encoded.blocks[0];
  assert.deepEqual(list.items, ['First item', 'Second item']);
  assert.deepEqual(list.sourceRefs, ['o1-1', 'o1-2', 'o1-3']);
  assert.equal(list.normalizations.length, 2);
  assert.deepEqual(encoded.unaccountedRefs, []);
}

// QC: low-confidence marker-only glyphs are not noisy review warnings; low-
// confidence lexical evidence is.
{
  const ocrPages = [{ page: 1, fragments: [
    { id: 'o1-1', text: '•', confidence: 0.4 },
    { id: 'o1-2', text: 'Odd OCR', confidence: 0.7 }
  ] }];
  const pages = [{ page: 1, blocks: [
    { type: 'paragraph', text: '•', sourceRefs: ['o1-1'] },
    { type: 'paragraph', text: 'Odd OCR', sourceRefs: ['o1-2'] }
  ] }];
  const checks = runChecks(pages, { 1: [] }, { 1: [] }, { 1: { status: 'ok' } }, ocrPages);
  assert.equal(checks.ocrConfidence.status, 'warn');
  assert.equal(checks.ocrConfidence.count, 1);
  assert.equal(checks.ocrConfidence.details[0].ref, 'o1-2');
  assert.equal(checks.sourceText.status, 'pass');
}

console.log('encoder regression tests: PASS');

// Figure grouping regression: several OCR fragments that visually form one
// logical label must encode as one group, not peer labels separated by commas.
{
  const ocrPage = {
    page: 1,
    fragments: [
      { id: 'o1-4', text: 'UX, Information', confidence: 0.99 },
      { id: 'o1-5', text: 'Architecture', confidence: 0.99 },
      { id: 'o1-6', text: '& Process Design', confidence: 0.99 },
      { id: 'o1-17', text: 'Strategic Comms', confidence: 0.99 },
      { id: 'o1-20', text: '& Content Creation', confidence: 0.99 }
    ]
  };
  const structurePage = {
    page: 1,
    blocks: [{
      type: 'figure',
      groups: [
        { role: 'category', labelRefs: ['o1-4', 'o1-5', 'o1-6'] },
        { role: 'category', labelRefs: ['o1-17', 'o1-20'] }
      ]
    }],
    omittedRefs: []
  };
  const encoded = encodePage(ocrPage, structurePage);
  const figure = encoded.blocks[0];
  assert.equal(figure.type, 'figure');
  assert.equal(figure.groups.length, 2);
  assert.equal(figure.groups[0].label, 'UX, Information\nArchitecture\n& Process Design');
  assert.deepEqual(figure.groups[0].labelSourceRefs, ['o1-4', 'o1-5', 'o1-6']);
  assert.deepEqual(figure.groups[0].items, []);
  assert.equal(figure.groups[1].label, 'Strategic Comms\n& Content Creation');
  assert.deepEqual(encoded.unaccountedRefs, []);

  const checks = runChecks(
    [{ page: 1, blocks: [figure] }],
    { 1: [] },
    { 1: [] },
    { 1: { status: 'ok' } },
    [ocrPage]
  );
  assert.equal(checks.sourceText.status, 'pass');
}


// Figure hierarchy regression: a category heading must remain distinct from
// subordinate content even when all of it belongs to one visual group.
{
  const ocrPage = {
    page: 2,
    fragments: [
      { id: 'o2-35', text: 'UX, IA &', confidence: 0.99 },
      { id: 'o2-36', text: 'Process Design', confidence: 0.99 },
      { id: 'o2-37', text: 'Process mapping & documentation\n• Information architecture\nWorkflow & systems design', confidence: 0.98 },
      { id: 'o2-41', text: 'Strategic Comms\n& Content Creation', confidence: 0.99 },
      { id: 'o2-42', text: 'Onboarding & training materials\n• Copywriting & editing', confidence: 0.98 },
      { id: 'o2-43', text: 'Figma, PowerPoint', confidence: 0.99 }
    ]
  };
  const structurePage = {
    page: 2,
    blocks: [{
      type: 'figure',
      groups: [
        {
          role: 'category',
          labelRefs: ['o2-35', 'o2-36'],
          items: [{ refs: ['o2-37'] }]
        },
        {
          role: 'category',
          labelRefs: ['o2-41'],
          items: [{ refs: ['o2-42'] }, { refs: ['o2-43'] }]
        }
      ]
    }],
    omittedRefs: []
  };

  const encoded = encodePage(ocrPage, structurePage);
  const figure = encoded.blocks[0];
  assert.equal(figure.groups[0].label, 'UX, IA &\nProcess Design');
  assert.deepEqual(figure.groups[0].items, ['Process mapping & documentation\n• Information architecture\nWorkflow & systems design']);
  assert.deepEqual(figure.groups[0].labelSourceRefs, ['o2-35', 'o2-36']);
  assert.deepEqual(figure.groups[0].itemSourceRefs, [['o2-37']]);
  assert.equal(figure.groups[1].label, 'Strategic Comms\n& Content Creation');
  assert.deepEqual(figure.groups[1].items, ['Onboarding & training materials\n• Copywriting & editing', 'Figma, PowerPoint']);
  assert.deepEqual(encoded.unaccountedRefs, []);

  const checks = runChecks(
    [{ page: 2, blocks: [figure] }],
    { 2: [] },
    { 2: [] },
    { 2: { status: 'ok' } },
    [ocrPage]
  );
  assert.equal(checks.sourceText.status, 'pass');
}


// Fine OCR evidence regression: a paragraph may expose exact child line refs.
// Sol can structure those lines independently without retyping or splitting
// their source strings, while completeness is still measured exactly once.
{
  const ocrPage = {
    page: 2,
    fragments: [{
      id: 'o2-37',
      text: 'Process mapping & documentation\n• Information architecture\nWorkflow & systems design',
      confidence: 0.98,
      lines: [
        { id: 'o2-37.l1', parentId: 'o2-37', text: 'Process mapping & documentation', confidence: 0.99 },
        { id: 'o2-37.l2', parentId: 'o2-37', text: '• Information architecture', confidence: 0.97 },
        { id: 'o2-37.l3', parentId: 'o2-37', text: 'Workflow & systems design', confidence: 0.98 }
      ]
    }]
  };
  const structurePage = {
    page: 2,
    blocks: [{ type: 'figure', groups: [{
      role: 'category',
      labelRefs: [],
      items: [
        { refs: ['o2-37.l1'] },
        { refs: ['o2-37.l2'] },
        { refs: ['o2-37.l3'] }
      ]
    }]}],
    omittedRefs: []
  };
  const encoded = encodePage(ocrPage, structurePage);
  const figure = encoded.blocks[0];
  assert.deepEqual(figure.groups[0].items, [
    'Process mapping & documentation',
    '• Information architecture',
    'Workflow & systems design'
  ]);
  assert.deepEqual(encoded.unaccountedRefs, []);

  const checks = runChecks([{ page: 2, blocks: [figure] }], { 2: [] }, { 2: [] }, { 2: { status: 'ok' } }, [ocrPage]);
  assert.equal(checks.sourceText.status, 'pass');
}

// Parent/child alias protection: once a child line is used, using its parent
// paragraph would overlap the same lexical evidence and must be surfaced.
{
  const ocrPage = {
    page: 1,
    fragments: [{
      id: 'o1-1', text: 'Line A\nLine B', confidence: 0.99,
      lines: [
        { id: 'o1-1.l1', parentId: 'o1-1', text: 'Line A', confidence: 0.99 },
        { id: 'o1-1.l2', parentId: 'o1-1', text: 'Line B', confidence: 0.99 }
      ]
    }]
  };
  const structurePage = {
    page: 1,
    blocks: [
      { type: 'paragraph', refs: ['o1-1.l1'] },
      { type: 'paragraph', refs: ['o1-1'] }
    ],
    omittedRefs: []
  };
  const encoded = encodePage(ocrPage, structurePage);
  assert.ok(encoded.issues.some((x) => x.type === 'overlapping_ref' && x.ref === 'o1-1'));
  assert.ok(encoded.blocks.some((b) => b.fallback && b.text === 'Line B'));
  assert.deepEqual(encoded.unaccountedRefs, []);
}
