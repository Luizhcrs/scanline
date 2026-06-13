const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
fs.writeFileSync(
  path.join(__dirname, '../dist-electron/package.json'),
  JSON.stringify({ type: 'commonjs', version: pkg.version })
);
