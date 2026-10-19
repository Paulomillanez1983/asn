const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.scripts = Object.assign({}, p.scripts, { test: 'playwright test', 'test:ui': 'playwright test --ui' });
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
console.log(JSON.stringify(p.scripts));
