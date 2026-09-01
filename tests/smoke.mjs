import assert from 'node:assert/strict';
import { inferInputKind, bufferToDataUrl } from '../lib/source-input.js';
import { buildReconstructUserContent } from '../lib/reconstruct-prompt.js';

assert.equal(inferInputKind(Buffer.from('%PDF-1.7'), 'report.pdf', 'application/pdf').sourceType, 'pdf');
assert.equal(inferInputKind(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), 'page.png', 'image/png').sourceType, 'image');
assert.match(bufferToDataUrl(Buffer.from('abc'), 'image/png'), /^data:image\/png;base64,/);
const content = buildReconstructUserContent({ page: 56, imageDataUrl: 'data:image/png;base64,abc', sectionTitle: 'Remuneration' });
assert.equal(content.length, 2);
assert.equal(content[1].type, 'image_url');
assert.match(content[0].text, /page 56/i);
console.log('smoke tests passed');
