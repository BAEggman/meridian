'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Storage = require('../exam-storage.js');
const Engine = require('../exam-engine.js');
const { createScheduledStudyFixture } = require('./study-fixture.cjs');

test('storage codec is dependency-free in a browser and keeps legacy raw JSON unchanged', () => {
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../exam-storage.js'), 'utf8'), sandbox);
  assert.equal(sandbox.MeridianExamStorage.version, 1);
  const raw = JSON.stringify({ version: 1, records: {}, original: '肺 · 胃 / 내 답\n그대로', unknown: { keep: true } });
  assert.equal(Storage.decode(raw), raw);
  assert.equal(sandbox.MeridianExamStorage.decode(raw), raw);
  assert.equal(sandbox.MeridianExamStorage.decode(sandbox.MeridianExamStorage.encode(raw)), raw);
});

test('compression is lossless for Unicode, escaped answers and long repetitive text', () => {
  const inputs = [
    '', '{}', 'null', '단순 원문',
    JSON.stringify({ answer: '腎勝格 <원답> & "보존"\n둘째 줄 😀', empty: '', missing: null, zero: 0 }),
    JSON.stringify({ answer: '\u0000\ud800\udfff\u2028\u2029', notes: '유주 원문·오답→교정→지연 회복'.repeat(5000) })
  ];
  for (const input of inputs) assert.equal(Storage.decode(Storage.encode(input)), input);
  const large = inputs.at(-1), packed = Storage.encode(large);
  assert.equal(packed.startsWith(Storage.prefix), true);
  assert.equal(packed.length < large.length, true);
  assert.deepEqual(JSON.parse(Storage.decode(packed)), JSON.parse(large));
});

test('damaged or unsupported compressed records are rejected without silently yielding a new state', () => {
  const source = JSON.stringify({ version: 1, records: { study: { originalAnswer: '원답 보존'.repeat(500) } } });
  const packed = Storage.encode(source);
  assert.equal(packed.startsWith(Storage.prefix), true);
  assert.throws(() => Storage.decode(Storage.prefix));
  assert.throws(() => Storage.decode(packed.replace(Storage.prefix + '1:', Storage.prefix + '99:')));
  assert.throws(() => Storage.decode(packed.slice(0, -1)));
  const index = packed.length - 3;
  const changed = packed.slice(0, index) + String.fromCharCode(packed.charCodeAt(index) ^ 1) + packed.slice(index + 1);
  assert.throws(() => Storage.decode(changed));
  const pieces = packed.slice(Storage.prefix.length).split(':');
  pieces[1] = String(Number(pieces[1]) + 1);
  assert.throws(() => Storage.decode(Storage.prefix + pieces.join(':')));
  assert.equal(Storage.decode(packed), source, 'A failed decode must not damage the original payload');
});

test('the full 6244-response schedule round-trips losslessly with a bounded storage footprint', () => {
  const fixture = createScheduledStudyFixture();
  const raw = JSON.stringify(fixture.state), packed = Storage.encode(raw);
  assert.equal(Storage.decode(packed), raw, 'Compression must preserve the exact serialized study record');
  assert.equal(packed.startsWith(Storage.prefix), true);
  assert.equal(packed.length * 2 < 2 * 1024 * 1024, true,
    'This fixed full-term fixture must stay below 2 MiB of UTF-16 storage text');
  const restored = Engine.normalizeState(JSON.parse(Storage.decode(packed)), fixture.catalog, fixture.lastDay);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), JSON.parse(JSON.stringify(fixture.state)));
  assert.equal(Engine.getReversal(fixture.catalog, restored, fixture.lastDay).recentDays.length, 7);
  const backup = JSON.stringify({
    format: 'meridian-exam-backup', version: 1, exportedAt: '2026-12-31T00:00:00.000Z',
    exam: fixture.state, legacy: {}, session: null
  }, null, 2);
  const backupUTF8Bytes = Buffer.byteLength(backup);
  assert.equal(backupUTF8Bytes <= 10 * 1024 * 1024, true,
    'The actual full-term JSON backup must fit the current 10 MiB import limit');
  console.log(JSON.stringify({
    fixture: '59-day-all-correct-srs', cards: Object.keys(restored.records).length,
    responses: fixture.responses, answerCharacters: fixture.answerCharacters,
    rawCharacters: raw.length, compressedCharacters: packed.length,
    compressedUTF8Bytes: Buffer.byteLength(packed), compressedUTF16Bytes: packed.length * 2,
    formattedBackupUTF8Bytes: backupUTF8Bytes, backupImportLimitBytes: 10 * 1024 * 1024,
    archivedDays: Object.values(restored.reversal.days).filter(day => day.archive).length
  }));
});
