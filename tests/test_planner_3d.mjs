// Regression contract for the progressive 3D planner upgrade.
// Run with: node tests/test_planner_3d.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const html=readFileSync('planner.html','utf8');
const js=readFileSync('planner.js','utf8');
const three=readFileSync('planner-3d.js','utf8');
const css=readFileSync('planner-3d.css','utf8');
const headers=readFileSync('_headers','utf8');

for(const id of ['scene','scene-3d','view-3d','view-top','view-eye','reset-camera',
                 'zoom-in','zoom-out','fit-view','mobile-planner-dock',
                 'arrange-apply','request-quote','request-quote-top','export-image']){
  assert.match(html,new RegExp('id="'+id+'"'),'missing UI element '+id);
}
assert.match(html,/planner-3d\.js\?v=/);
assert.match(html,/type="module"/);
assert.match(html,/planner-3d\.css\?v=/);
assert.match(css,/#scene-3d\s*\{/);
assert.match(css,/#scene\s*\{position:relative;z-index:1/);
assert.match(headers,/script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
assert.match(three,/three@0\.186\.1\/build\/three\.module\.js/);
assert.match(three,/window\.Regal3D\s*=\s*\{/);
assert.match(three,/webglcontextlost/);
// Chair reference geometry is reused across instances and remains selectable.
assert.match(three,/function chairMoldGeometry\(w,d\)/);
assert.match(three,/new THREE\.ExtrudeGeometry\(seatShape/);
assert.match(three,/new THREE\.ExtrudeGeometry\(backShape/);
assert.match(three,/function chairTube\(group,a,b/);
assert.match(three,/chairTube\(group,rearFoot,rearHinge/);
assert.match(three,/chairTube\(group,frontFoot,seatHinge/);
assert.match(three,/chairMolds\.has\(id\)/);
assert.match(three,/else if\(o\.kind==='chair'\)makeChair\(group,w,d\)/);
assert.match(html,/planner-3d\.js\?v=20261022-chair1/);

assert.match(js,/window\.Regal3D\?\.ready/);
assert.match(js,/const pointers = new Map\(\)/);
assert.match(js,/gesture\.distance\/nextGap/);
assert.match(js,/panBetween\(/);
// Horizontal orbit motion tracks the direction of a finger swipe.
assert.match(js,/targetView\.yaw=dragging\.yaw-\(pt\.x-dragging\.startX\)\*\.008/);
assert.doesNotMatch(js,/targetView\.yaw=dragging\.yaw\+\(pt\.x-dragging\.startX\)/);
assert.match(js,/Math\.exp\(-delta\/105\)/);
assert.match(js,/function setView\(mode\)/);
assert.match(js,/setView\('eye'\)/);
assert.match(js,/function arrangeSelected\(/);
assert.match(js,/function transferQuote\(/);
assert.match(js,/localStorage\.setItem\(LS_KEY/);
const check=['planner.js','planner-3d.js'];
for(const file of check){
  const p=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(p.status,0,file+' syntax: '+p.stderr);
}
console.log('3D planner contracts and JS syntax: PASS');
