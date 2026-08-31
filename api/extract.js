// api/extract.js
// Vercel serverless function for the whole simplified pipeline -- one
// request, one response. Parses the multipart form (PDF or image +
// pageFrom/pageTo/sectionTitle) and runs the direct OCR -> per-page Sol
// arrangement -> deterministic encode pipeline.

import { runPipeline } from '../lib/translate-core.js';
import { parseMultipart } from '../lib/multipart.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  try {
    var chunks = [];
    for await (var chunk of req) chunks.push(chunk);
    var buffer = Buffer.concat(chunks);
    var contentType = req.headers['content-type'] || '';
    var { fields, files } = parseMultipart(buffer, contentType);

    var upload = files.document || files.pdf; // pdf retained for older clients
    var result = await runPipeline({
      pageFrom: fields.pageFrom,
      pageTo: fields.pageTo,
      sectionTitle: fields.sectionTitle,
      fileName: upload ? upload.filename : undefined,
      mimeType: upload ? upload.contentType : undefined,
      inputBuffer: upload ? upload.data : undefined
    });

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong processing that document.' });
  }
}
