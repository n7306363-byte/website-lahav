#!/usr/bin/env node
'use strict';
// node tools/test.js — renderer + API checks (no network)
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { render, validate } = require('../lib/render');
const root = path.join(__dirname, '..');

const template = fs.readFileSync(path.join(root, 'template.html'), 'utf8');
const content = JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8'));

// 1. the committed index.html is exactly what the renderer produces from content.json
const html = render(template, validate(content));
if (html !== fs.readFileSync(path.join(root, 'index.html'), 'utf8')) { console.error('index.html is out of date: run node tools/build.js'); process.exit(1); }
console.log('ok  index.html == render(template, content)');

// 2. editing content changes both desktop and mobile markup
const c2 = JSON.parse(JSON.stringify(content));
c2.hero.title1 = 'כותרת <חדשה> & "בדיקה"';
c2.testimonials[1].name = 'שם בדיקה';
c2.services[0].color = '#112233';
c2.projects[2].paragraphs = ['פסקה אחת'];
const h2 = render(template, validate(c2));
assert(h2.includes('כותרת &lt;חדשה&gt; &amp; "בדיקה"'));
assert.strictEqual(h2.split('כותרת &lt;חדשה&gt;').length - 1, 2, 'hero title in desktop + mobile');
assert.strictEqual(h2.split('שם בדיקה').length - 1, 2, 'testimonial name in desktop + mobile');
assert(h2.includes('var CARD_RGB = [[17,34,51],'));
assert(h2.includes('"text":["פסקה אחת"]'));
console.log('ok  edits reach desktop + mobile, text is escaped');

// 2b. project info strip (location / size / duration) comes from content.json
const c3 = JSON.parse(JSON.stringify(content));
c3.projects[1].location = 'מקום <בדיקה>';
c3.projects[1].duration = '';
c3.projectsSection.labelArea = 'שטח בדיקה';
const h3 = render(template, validate(c3));
assert(h3.includes('"location":"מקום \\u003cבדיקה>"') || h3.includes('"location":"מקום <בדיקה>"'.replace('<', '\\u003c')));
assert(h3.includes('"labels"') === false);
assert(h3.includes('שטח בדיקה'));
console.log('ok  project info strip data reaches the page');

// 3. validation rejects bad input
assert.throws(() => validate(Object.assign({}, content, { projects: content.projects.slice(0, 2) })));
const bad = JSON.parse(JSON.stringify(content)); bad.projects[0].photo = '../secret.png';
assert.throws(() => validate(bad));
const bad2 = JSON.parse(JSON.stringify(content)); bad2.services[0].color = 'red';
assert.throws(() => validate(bad2));
console.log('ok  validation');
console.log('all good');
