const fs = require('fs');

/**
 * Render a template file by replacing {{KEY}} placeholders with values.
 *
 * @param {string} filePath - Absolute path to the template file.
 * @param {Record<string, string | number>} data - Key/value pairs to substitute.
 * @returns {string} Rendered HTML.
 */
function renderTemplate(filePath, data = {}) {
  let html = fs.readFileSync(filePath, 'utf8');
  for (const [key, value] of Object.entries(data)) {
    html = html.split(`{{${key}}}`).join(String(value));
  }
  return html;
}

module.exports = { renderTemplate };
