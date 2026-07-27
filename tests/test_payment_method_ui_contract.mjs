import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, script, api] = await Promise.all([
  readFile(new URL('../sign.html', import.meta.url), 'utf8'),
  readFile(new URL('../sign.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/sign/[token].js', import.meta.url), 'utf8')
]);

for (const method of ['credit_card', 'debit_card', 'cash']) {
  assert.match(html, new RegExp(`value="${method}"`));
  assert.match(api, new RegExp(`'${method}'`));
}

assert.match(html, /Credit Card/);
assert.match(html, /Debit Card — 50% Refundable Deposit/);
assert.match(html, /Cash — 50% Refundable Deposit/);
assert.match(script, /Choose Credit Card, Debit Card, or Cash/);
assert.match(api, /applicableDeposit/);
assert.match(api, /\['debit_card', 'cash', 'security_deposit'\]/);

console.log('Payment-method signing UI contract tests passed.');
