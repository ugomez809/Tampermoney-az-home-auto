const fs = require('node:fs');
const file = process.argv[2];
const state = JSON.parse(fs.readFileSync(file,'utf8'));
const value = process.env.GWPC_WRAPPED_PROFILE_KEY;
if (!value || !Buffer.from(value,'base64').subarray(0,5).equals(Buffer.from('DPAPI'))) throw new Error('Missing protected key');
state.os_crypt.encrypted_key = value;
fs.writeFileSync(file + '.migration-temp',JSON.stringify(state));
fs.renameSync(file + '.migration-temp',file);
