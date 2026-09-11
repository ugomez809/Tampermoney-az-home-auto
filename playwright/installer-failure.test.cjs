const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');
test('failed credential verification preserves the profile and removes its new Windows task', { timeout: 30000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gwpc-installer-invalid-key-'));
  const taskName = 'GWPC-Quoting-' + crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,16).toUpperCase();
  const powershell = (command) => execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',command], {windowsHide:true,encoding:'utf8'});
  try {
    for (const name of ['Install.ps1','Install-User.ps1','owned-browser.ps1','Migrate-ProfileKey.ps1','verify-passwords.cjs','verify-cookies.cjs']) fs.copyFileSync(path.join(__dirname,name),path.join(root,name));
    for (const dir of ['runtime','browser-engine','browser-profile/Default','extension','node_modules/playwright','migration']) fs.mkdirSync(path.join(root,dir),{recursive:true});
    fs.copyFileSync(process.execPath,path.join(root,'runtime/node.exe'));
    fs.writeFileSync(path.join(root,'browser-engine/gwpc-lab.exe'),'unused test placeholder');
    fs.writeFileSync(path.join(root,'browser-profile/Default/Secure Preferences'),'{}');
    fs.writeFileSync(path.join(root,'extension/manifest.json'),'{}');
    fs.writeFileSync(path.join(root,'node_modules/playwright/package.json'),'{}');
    const state = path.join(root,'browser-profile/Local State');
    fs.writeFileSync(state,'{"fixture":"must remain unchanged"}');
    const database = path.join(root,'browser-profile/Default/Login Data');
    const db = new DatabaseSync(database);
    const nonce = Buffer.alloc(12,2), cipher = crypto.createCipheriv('aes-256-gcm',Buffer.alloc(32,1),nonce);
    const encrypted = Buffer.concat([Buffer.from('v10'),nonce,cipher.update('fixture','utf8'),cipher.final(),cipher.getAuthTag()]);
    db.exec('CREATE TABLE logins(password_value BLOB)');
    db.prepare('INSERT INTO logins VALUES (?)').run(encrypted); db.close();
    fs.writeFileSync(path.join(root,'migration/profile-key.bin'),Buffer.alloc(32,0));
    let failure;
    try { execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'Install.ps1'),'-NoStart'],{windowsHide:true,stdio:'pipe'}); }
    catch (error) { failure = error; }
    assert.equal(failure?.status,1,'Installer must fail when credentials cannot be decrypted');
    assert.match(failure.stderr.toString(),/Saved passwords or cookies failed credential verification/);
    assert.equal(fs.readFileSync(state,'utf8'),'{"fixture":"must remain unchanged"}');
    assert.ok(fs.existsSync(path.join(root,'migration/profile-key.bin')),'Failed verification must preserve the migration key for diagnosis');
    assert.equal(powershell(`@(Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue).Count`).trim(),'0','Failed fresh installation must not leave a scheduled restart task');
  } finally {
    powershell(`if (Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false }`);
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'gwpc-installer-invalid-key-')));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
