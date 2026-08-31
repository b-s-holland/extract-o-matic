// lib/render-preview.js
// Turns the structured pages/blocks array into the semantic HTML shown
// in the shell's Preview subtab. Purely a display concern -- the
// Structured subtab shows the actual JSON, this is just easier to skim.

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function uncertaintyMark(block) {
  return block.uncertain
    ? ' <span title="' + escapeHtml(block.uncertaintyNote || 'Low confidence') + '">\u26A0\uFE0F</span>'
    : '';
}

function renderBlock(block) {
  switch (block.type) {
    case 'heading':
      var level = Math.min(Math.max(block.level || 4, 2), 4);
      return '<h' + level + '>' + escapeHtml(block.text || '') + uncertaintyMark(block) + '</h' + level + '>';
    case 'paragraph':
      var fallbackMark = block.fallback
        ? ' <span title="Sol didn\'t explicitly place/type this OCR fragment -- deterministic fallback preserved it as a plain paragraph rather than dropping it.">\uD83D\uDD27</span>'
        : '';
      return '<p>' + escapeHtml(block.text || '') + fallbackMark + uncertaintyMark(block) + '</p>';
    case 'list':
      return '<ul>' + (block.items || []).map(function (i) { return '<li>' + escapeHtml(i) + '</li>'; }).join('') + '</ul>' + uncertaintyMark(block);
    case 'table':
      var caption = block.caption ? '<p><em>' + escapeHtml(block.caption) + '</em></p>' : '';
      var head = '<tr>' + (block.columns || []).map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') + '</tr>';
      var body = (block.rows || []).map(function (row) {
        return '<tr>' + row.map(function (cell) { return '<td>' + escapeHtml(cell) + '</td>'; }).join('') + '</tr>';
      }).join('');
      var footnotes = (block.footnotes || []).length
        ? '<p style="font-size:0.85em;">' + block.footnotes.map(escapeHtml).join('<br>') + '</p>'
        : '';
      return caption + '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' + footnotes + uncertaintyMark(block);
    case 'figure':
      var groupsByRole = { central: [], category: [], annotation: [], other: [] };
      (block.groups || []).forEach(function (g) {
        var role = groupsByRole[g.role] ? g.role : 'other';
        var label = escapeHtml(g.label || '');
        var members = (g.items || []).map(escapeHtml);
        var rendered = label;
        if (members.length) {
          rendered += (rendered ? ': ' : '') + members.join(' • ');
        }
        groupsByRole[role].push(rendered);
      });
      var groupParts = [];
      if (groupsByRole.central.length) groupParts.push('Central: ' + groupsByRole.central.join('; '));
      if (groupsByRole.category.length) groupParts.push('Categories: ' + groupsByRole.category.join('; '));
      if (groupsByRole.annotation.length) groupParts.push('Annotations: ' + groupsByRole.annotation.join('; '));
      if (groupsByRole.other.length) groupParts.push('Other: ' + groupsByRole.other.join('; '));
      return '<p><em>[Figure]</em> ' + groupParts.join('. ') + (groupParts.length ? '.' : '') + uncertaintyMark(block) + '</p>';
    case 'unresolved':
      return '<p style="color:#ff8a7a;"><em>[Unresolved]</em> ' + escapeHtml(block.note || 'Sol referenced a fragment id ENCODE could not find.') + '</p>';
    default:
      return '';
  }
}

export function renderPreviewHtml(pages, sectionTitle) {
  var heading = '<h4>' + escapeHtml(sectionTitle || 'Untitled section') + '</h4>';
  var body = pages.map(function (p) {
    var pageLabel = '<p style="font-size:0.75em; opacity:0.7; text-transform:uppercase; letter-spacing:.06em;">Page ' + p.page + '</p>';
    var blocks = (p.blocks || []).map(renderBlock).join('');
    return pageLabel + (blocks || '<p class="empty-note">No extractable content on this page.</p>');
  }).join('<hr style="border-color:#3a4038; margin:1em 0;">');
  return heading + body;
}
