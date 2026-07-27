import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../sign.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../sign-review.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../sign-review.js', import.meta.url), 'utf8');

assert.match(html, /class="agreement-card agreement-scroll-box"/);
assert.match(html, /tabindex="0"/);
assert.match(html, /class="key-summary-card"/);
assert.match(html, /This is a convenience summary only/);
assert.match(html, /The complete agreement controls/);
assert.match(html, /id="key-summary-payment"/);
assert.match(html, /id="signed-proof-host"/);
assert.match(html, /sign-review\.css/);
assert.match(html, /sign-review\.js/);

assert.match(css, /\.agreement-scroll-box\{[^}]*overflow-y:auto/);
assert.match(css, /height:min\(65vh,620px\)/);
assert.match(css, /@media print\{[^}]*\.agreement-review-heading/);
assert.match(css, /max-height:none/);

assert.match(js, /MutationObserver/);
assert.match(js, /50% of the rental subtotal/);
assert.match(js, /Credit card selected: no refundable security deposit/);
assert.match(js, /Debit card selected:/);
assert.match(js, /Cash selected:/);
assert.match(js, /proofHost\.appendChild\(proof\)/);

console.log('Signing agreement scroll-box and key-summary tests passed.');
