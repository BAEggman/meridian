#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, {recursive: true});
for (const name of ['index.html', 'saam_bosa_fill.html', 'exam.css', 'exam-catalog.js', 'exam-engine.js', 'exam-storage.js', 'exam-app.js']) {
  fs.copyFileSync(path.join(root, name), path.join(dist, name));
}
for (const name of ['songs', 'songs_jata']) {
  const source = path.join(root, name);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(dist, name), {recursive: true});
}
console.log('Static preview built in dist/. GitHub Pages continues to serve the repository root.');
