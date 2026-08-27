const test = require('node:test');
const assert = require('node:assert/strict');
const { detectImageType } = require('../src/controllers/userAvatarController');

test('aceita apenas assinaturas reais de JPG, PNG e WebP para avatares', () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])).mimeType, 'image/jpeg');
  assert.equal(detectImageType(Buffer.from('89504e470d0a1a0a00000000', 'hex')).mimeType, 'image/png');
  assert.equal(detectImageType(Buffer.from('RIFF0000WEBP0000', 'ascii')).mimeType, 'image/webp');
  assert.equal(detectImageType(Buffer.from('<svg></svg>')), null);
});
