// api/extract.js
// One request: upload PDF/image, render if needed, then reconstruct directly
// from the actual page image with the multimodal model.

import { runPipeline } from '../lib/translate-core.js';
import { parseMultipart } from '../lib/multipart.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const { fields, files } = parseMultipart(buffer, req.headers['content-type'] || '');
    const upload = files.document || files.pdf;
    const result = await runPipeline({
      inputBuffer: upload ? upload.data : undefined,
      fileName: upload ? upload.filename : undefined,
      mimeType: upload ? upload.contentType : undefined,
      pageFrom: fields.pageFrom,
      pageTo: fields.pageTo,
      sectionTitle: fields.sectionTitle
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong processing that document.' });
  }
}
