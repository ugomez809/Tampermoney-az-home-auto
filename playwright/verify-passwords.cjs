const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const profile = process.argv[2], key = fs.readFileSync(process.argv[3]);
let count = 0;
try {
  for (const name of ['Login Data','Login Data For Account']) {
    const filename = path.join(profile,'Default',name);
    if (!fs.existsSync(filename)) continue;
    const db = new DatabaseSync(filename,{readOnly:true});
    try {
      for (const row of db.prepare('SELECT password_value FROM logins WHERE length(password_value)>0').all()) {
        const value = Buffer.from(row.password_value);
        if (value.subarray(0,3).toString() !== 'v10') throw new Error('Unsupported saved password encryption; export in browser before migration');
        const decipher = crypto.createDecipheriv('aes-256-gcm',key,value.subarray(3,15));
        decipher.setAuthTag(value.subarray(-16));
        const plaintext = Buffer.concat([decipher.update(value.subarray(15,-16)),decipher.final()]);
        plaintext.fill(0); count++;
      }
    } finally { db.close(); }
  }
  console.log('Verified transferable saved browser passwords:',count);
} finally { key.fill(0); }
