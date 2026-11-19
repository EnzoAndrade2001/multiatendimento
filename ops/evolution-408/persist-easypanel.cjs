// Run inside EasyPanel after copying helper and patch to /tmp/lcd-408-*.cjs.
// Updates only the source/build/deploy mode of the named service, atomically.
const fs = require('fs');
const db = require('/app/node_modules/lmdb').open({ path: '/etc/easypanel/data' });
(async () => {
  const key = 'services:marketing-ai:evolution-api';
  const base = 'evoapicloud/evolution-api@sha256:b4a18ed5213d34a0845f841ba9afae1b67940457d021b42af863eae67dc2cfbd';
  const helper = fs.readFileSync('/tmp/lcd-408-helper.cjs').toString('base64');
  const patch = fs.readFileSync('/tmp/lcd-408-patch.cjs').toString('base64');
  const code = `require('fs').writeFileSync('/evolution/timeoutRecovery.cjs',Buffer.from('${helper}','base64'));require('fs').writeFileSync('/tmp/lcd-408-patch.cjs',Buffer.from('${patch}','base64'));require('/tmp/lcd-408-patch.cjs')`;
  const dockerfile = `FROM ${base}\nRUN node -e ${JSON.stringify(code)} && node --check /evolution/dist/main.js\nLABEL lcd.timeout-recovery="408-preserve-v1"\n`;
  fs.writeFileSync('/tmp/lcd-408-persistent.Dockerfile', dockerfile);
  await db.transaction(() => {
    const raw = db.get(key);
    const obj = JSON.parse(raw);
    if (obj.json?.type !== 'app' || obj.json.source?.type !== 'image'
      || obj.json.source.image !== 'evoapicloud/evolution-api:2.4.0-rc2') throw Error('Unexpected source: refusing update');
    fs.writeFileSync('/etc/easypanel/data/backups/evolution-source-before-408-20261119.json', raw, { mode: 0o600 });
    obj.json.source = { type: 'dockerfile', dockerfile };
    obj.json.build = { type: 'dockerfile' };
    obj.json.deploy.zeroDowntime = false;
    db.putSync(key, JSON.stringify(obj));
  });
  const saved = JSON.parse(db.get(key)).json;
  console.log(JSON.stringify({ source: saved.source.type, basePinned: saved.source.dockerfile.includes(base), containsFix: saved.source.dockerfile.includes('408-preserve-v1'), stopFirst: !saved.deploy.zeroDowntime }));
  await db.close();
})().catch(e => { console.error(e.message); process.exit(1); });
