import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const [rentalsHtml, homeHtml, rentalsWorker, dynamicCss, stylesCss, smallShield, watermarkShield] = await Promise.all([
  readFile(new URL('../rentals.html', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../functions/rentals.js', import.meta.url), 'utf8'),
  readFile(new URL('../catalog-dynamic.css', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  stat(new URL('../assets/regal-shield-small.webp', import.meta.url)),
  stat(new URL('../assets/regal-shield-watermark.webp', import.meta.url))
]);

assert.match(rentalsHtml, /<meta name="robots" content="noindex, nofollow"/);
assert.match(homeHtml, /<meta name="robots" content="noindex, nofollow"/);
assert.doesNotMatch(rentalsHtml, /Live calendar checking is being added/i);
assert.doesNotMatch(rentalsHtml, /currently opens your email app/i);
assert.match(rentalsHtml, /24-hour hold/i);
assert.match(rentalsHtml, /4 hours for preparation and 12 hours for return and cleaning/i);
assert.equal((rentalsHtml.match(/catalog-dynamic\.css/g) || []).length, 1);
assert.ok(rentalsHtml.indexOf('event-time.js') < rentalsHtml.indexOf('rentals.js'));
assert.match(rentalsHtml, /regal-shield-small\.webp/);
assert.match(rentalsHtml, /regal-shield-watermark\.webp/);
assert.ok(smallShield.size < 15_000, 'Header/footer shield should stay lightweight');
assert.ok(watermarkShield.size < 60_000, 'Hero watermark should stay lightweight');

assert.doesNotMatch(rentalsWorker, /HTMLRewriter|onload=/);
assert.match(dynamicCss, /data-catalog-state="loading"/);
assert.doesNotMatch(dynamicCss, /category-card__status\{display:none/);
assert.match(stylesCss, /\.btn--secondary\.is-added\s*\{[^}]*background-color:\s*#26063f\s*!important;[^}]*color:\s*#ffffff\s*!important;/s);

console.log('Rentals UI readiness tests passed.');
