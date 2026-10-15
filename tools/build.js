#!/usr/bin/env node
'use strict';
// node tools/build.js  ->  writes index.html from template.html + content.json
const fs = require('fs');
const path = require('path');
const { render, validate } = require('../lib/render');
const root = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'template.html'), 'utf8');
const content = validate(JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8')));
const out = process.argv[2] || path.join(root, 'index.html');
fs.writeFileSync(out, render(template, content));
console.log('wrote', out);
