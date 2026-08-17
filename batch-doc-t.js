const fs = require('fs');
const path = require('path');

const pagesDir = path.join(__dirname, 'src', 'ui', 'js', 'pages');
const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.js'));

const jsDoc = `    /**
     * Translates an i18n key into the current locale.
     *
     * @param {string} key - Translation key.
     * @param {Record<string, unknown>} [vars] - Optional interpolation variables.
     * @returns {string} Localized string.
     */`;

let totalReplacements = 0;

for (const file of files) {
  const filePath = path.join(pagesDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;
  
  // Replace all occurrences of the t function declaration with documented version
  content = content.replace(
    /(\s*)const t = \(key, vars\) => window\.I18n\?\.t\(key, vars\) \?\? key;/g,
    `$1${jsDoc}\n$1const t = (key, vars) => window.I18n?.t(key, vars) ?? key;`
  );
  
  if (content !== original) {
    fs.writeFileSync(filePath, content);
    const count = (content.match(/Translates an i18n key/g) || []).length;
    console.log(`${file}: added ${count} JSDoc comment(s)`);
    totalReplacements += count;
  }
}

console.log(`\nTotal: documented ${totalReplacements} t-functions across ${files.length} files`);
