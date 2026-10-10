import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../admin/admin.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../admin/index.html',import.meta.url),'utf8');

// $() is querySelector (one element); $$() is querySelectorAll (an array).
// The dashboard previously crashed during renderInventory() by calling
// .forEach on $() for the Restore and Delete Permanently buttons.
assert.match(source,/const \$ = \(selector, root = document\) => root\.querySelector\(selector\)/);
assert.match(source,/const \$\$ = \(selector, root = document\) => Array\.from\(root\.querySelectorAll\(selector\)\)/);
assert.match(source,/(\$\$)\('\[data-restore-product\]', list\)\.forEach/);
assert.match(source,/(\$\$)\('\[data-permanent-delete-product\]', list\)\.forEach/);
assert.doesNotMatch(source,/(?<!\$)\$\(['"][^'"]+['"],\s*list\)\.forEach/);
assert.match(html,/\/admin\/admin\.js\?v=20261010-2/);

console.log('Dashboard inventory button listeners and cache-busted admin script passed.');
