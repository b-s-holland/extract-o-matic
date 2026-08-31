// lib/multipart.js
// Tiny dependency-free multipart/form-data parser. Good enough for this
// shell's one form (a document file plus a few text fields) so we don't need
// to pull in formidable/busboy just to test wiring. If this app grows
// real file handling (actually reading PDF bytes server-side), swap
// this out for a proper streaming parser rather than extending it.

export function parseMultipart(buffer, contentType) {
  var match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  var boundary = match ? (match[1] || match[2]) : null;
  if (!boundary) throw new Error('No multipart boundary found.');

  var boundaryBuf = Buffer.from('--' + boundary);
  var parts = splitBuffer(buffer, boundaryBuf);

  var fields = {};
  var files = {};

  parts.forEach(function (part) {
    if (part.length === 0) return;
    var headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    var headerText = part.slice(0, headerEnd).toString('utf8');
    var body = part.slice(headerEnd + 4);
    // strip trailing \r\n before next boundary
    if (body.slice(-2).toString() === '\r\n') body = body.slice(0, -2);

    var nameMatch = /name="([^"]+)"/i.exec(headerText);
    if (!nameMatch) return;
    var name = nameMatch[1];
    var filenameMatch = /filename="([^"]*)"/i.exec(headerText);

    if (filenameMatch) {
      var typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
      files[name] = { filename: filenameMatch[1], contentType: typeMatch ? typeMatch[1].trim() : '', data: body };
    } else {
      fields[name] = body.toString('utf8');
    }
  });

  return { fields: fields, files: files };
}

function splitBuffer(buffer, delimiter) {
  var parts = [];
  var start = 0;
  var idx;
  while ((idx = buffer.indexOf(delimiter, start)) !== -1) {
    if (idx > start) parts.push(buffer.slice(start, idx));
    start = idx + delimiter.length;
  }
  return parts;
}
