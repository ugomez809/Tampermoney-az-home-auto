const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = __dirname;
const mutable = name => /^(browser-profile|migration|monitor-state)\//.test(name);
async function checksum(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Package must not depend on links outside its folder');
    if (entry.isDirectory()) result.push(...await walk(file));
    else result.push(file);
  }
  return result;
}
(async () => {
  const manifestFile = path.join(root, 'package-manifest.json');
  if (process.argv.includes('--create')) {
    const files = [];
    for (const file of await walk(root)) {
      const name = path.relative(root, file).replaceAll('\\', '/');
      if (name === 'package-manifest.json' || name.startsWith('monitor-state/')) continue;
      files.push({ name, bytes: fs.statSync(file).size, sha256: await checksum(file) });
    }
    fs.writeFileSync(manifestFile, JSON.stringify({ format:1, files }, null, 2));
    console.log('Created package manifest:', files.length, 'files');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
  if (manifest.format !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid package manifest');
  let checked = 0;
  for (const entry of manifest.files) {
    if (process.argv.includes('--runtime') && mutable(entry.name)) continue;
    const file = path.resolve(root, entry.name);
    if (!file.toLowerCase().startsWith(root.toLowerCase() + path.sep) || path.isAbsolute(entry.name)) throw new Error('Invalid package path');
    if (!fs.existsSync(file) || fs.statSync(file).size !== entry.bytes || await checksum(file) !== entry.sha256) {
      throw new Error('Package is incomplete or changed: ' + entry.name + '. Extract the complete ZIP to a new folder.');
    }
    checked++;
  }
  console.log('Package integrity verified:', checked, 'files');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
