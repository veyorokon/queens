/* node tools/mirror.js [out.html]

   Two jobs, both about keeping copies honest:

   1. core.js at the site root is a copy of tools/core.js, because the page
      loads it with a plain script tag and the tools load it with require.
      This refreshes that copy and says whether it had drifted.
   2. With an output path, it also writes the single-file mirror that gets
      published as an Artifact: the same page with core.js and levels.js
      inlined, and the head trimmed to what an Artifact host keeps. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// ---- 1. the site's copy of the engine
const source = fs.readFileSync(path.join(__dirname, 'core.js'), 'utf8');
const copyPath = path.join(root, 'core.js');
const existing = fs.existsSync(copyPath) ? fs.readFileSync(copyPath, 'utf8') : null;
if (existing !== source) {
  fs.writeFileSync(copyPath, source);
  console.log('core.js refreshed from tools/core.js (it had drifted)');
} else {
  console.log('core.js already matches tools/core.js');
}

// ---- 2. the single-file mirror
const out = process.argv[2];
if (!out) {
  console.log('no output path given, so no artifact mirror written');
  console.log('usage: node tools/mirror.js ../kitchen-table-queens.html');
  process.exit(0);
}

const src = read('index.html');
const levels = read('levels.js');
const head = src.slice(src.indexOf('<title>'), src.indexOf('</head>'));
let body = src.slice(src.indexOf('<body>') + '<body>'.length, src.indexOf('</body>'));

const tags = '<script src="core.js"></script>\n<script src="levels.js"></script>';
if (body.indexOf(tags) < 0) throw new Error('the two script tags were not found in index.html; the mirror would ship an empty page');
body = body.replace(tags, '<script>\n' + source + '\n</script>\n<script>\n' + levels + '\n</script>');

const page = head.trimEnd() + '\n' + body.trim() + '\n';
if (page.indexOf('src="core.js"') >= 0 || page.indexOf('QUEENS_LEVELS') < 0) throw new Error('the mirror did not inline cleanly');
fs.writeFileSync(out, page);
console.log('wrote ' + out + ', ' + (page.length / 1024).toFixed(1) + ' kB');
