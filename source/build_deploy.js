// Makes Index.html safe for Apps Script: removes JS comments and writes "//" inside
// JS strings/templates as "\/\/" so no comment-stripper can cut a line.
const fs = require('fs');
const acorn = require('/opt/node-tools/node_modules/acorn');
const [src, out] = process.argv.slice(2);
const html = fs.readFileSync(src, 'utf8');
let total = { comments: 0, slashes: 0 };
const res = html.replace(/<script>([\s\S]*?)<\/script>/g, (all, code) => {
  const edits = [];
  const opts = { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true,
    onComment: (block, text, start, end) => { edits.push([start, end, block ? ' ' : '']); total.comments++; } };
  for (const t of acorn.tokenizer(code, opts)) {
    const type = t.type.label;
    if (type === 'string' || type === 'template') {
      const raw = code.slice(t.start, t.end);
      if (raw.includes('//')) { edits.push([t.start, t.end, raw.split('//').join('\\/\\/')]); total.slashes++; }
    }
  }
  acorn.parse(code, opts.ecmaVersion ? { ecmaVersion: 'latest', allowReturnOutsideFunction: true } : {});
  edits.sort((a, b) => b[0] - a[0]);
  let c = code;
  for (const [s, e, r] of edits) c = c.slice(0, s) + r + c.slice(e);
  acorn.parse(c, { ecmaVersion: 'latest' });
  if (/\/\//.test(c.replace(/\/(?:\\.|[^\/\n])+\/[gimsuy]*/g, ''))) {
    const i = c.indexOf('//'); console.error('WARNING remaining // near:', JSON.stringify(c.slice(i - 40, i + 40)));
  }
  return '<script>' + c + '</script>';
});
fs.writeFileSync(out, res);
console.log(JSON.stringify(total), 'bytes', html.length, '->', res.length);
