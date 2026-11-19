'use strict';
const fs = require('fs');
const path = '/evolution/dist/main.js';
let source = fs.readFileSync(path, 'utf8');
const anchor = 'let n=o?.error?.output?.statusCode,r=[_.DisconnectReason.loggedOut,_.DisconnectReason.forbidden,402,406,408];';
const open = 'if(t==="open"){';
if (source.split(anchor).length !== 2 || source.split(open).length !== 2) {
  throw new Error('Unexpected Evolution bundle: refusing to patch');
}
source = source.replace(anchor, 'if(o?.error?.output?.statusCode===408){await require("/evolution/timeoutRecovery.cjs").handle(this);return}' + anchor);
source = source.replace(open, open + 'require("/evolution/timeoutRecovery.cjs").reset(this);');
fs.writeFileSync(path, source);
