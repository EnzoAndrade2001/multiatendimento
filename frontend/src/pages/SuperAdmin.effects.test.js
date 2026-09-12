import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./SuperAdmin.jsx', import.meta.url), 'utf8');

test('modais nao retornam Promises como cleanup do useEffect', () => {
  assert.doesNotMatch(source, /useEffect\(\s*(?:loadRows|reload)\s*,/);
  assert.match(source, /useEffect\(\(\) => \{ loadRows\(\); \}, \[\]\)/);
  assert.match(source, /useEffect\(\(\) => \{ reload\(\); \}, \[\]\)/);
});
