'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../exam-engine.js');

function catalog(count) {
  return {
    topics: [{ id: 'route', title: '유주' }, { id: 'point', title: '혈위' }],
    cards: Array.from({ length: count }, (_, i) => ({
      id: `c${i}`, topic: i % 2 ? 'point' : 'route',
      prompt: `질문 ${i}`, answer: `답 ${i}`, detail: '', tool: 'test', sourceId: String(i), kind: 'recall'
    }))
  };
}
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(freezeDeep);
  }
  return value;
}

test('KST boundaries, leap days, year changes, and invalid dates are exact', () => {
  assert.equal(E.localDay('2026-11-02T14:59:59.999Z'), '2026-11-02');
  assert.equal(E.localDay('2026-11-02T15:00:00.000Z'), '2026-11-03');
  assert.equal(E.localDay('2026-12-31T15:00:00.000Z'), '2027-01-01');
  assert.equal(E.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(E.addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(E.addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(E.dayDiff('2026-11-02', '2027-01-01'), 60);
  assert.equal(E.dayDiff('2024-02-28', '2024-03-01'), 2);
  assert.equal(E.dayDiff('2026-12-31', '2026-11-02'), -59);
  assert.equal(E.isValidDay('2026-02-29'), false);
  assert.equal(E.isValidDay('2024-02-29'), true);
  assert.equal(E.localDay('2026-02-31'), null);
  assert.equal(E.localDay(null), null);
  assert.equal(E.addDays('2026-02-31', 1), null);
  assert.equal(Number.isNaN(E.dayDiff('oops', '2027-01-01')), true);
});

test('the same file exports a browser global without CommonJS', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../exam-engine.js'), 'utf8'), context);
  assert.equal(context.MeridianExamEngine.version, 1);
  assert.equal(context.MeridianExamEngine.createState('2026-11-02').settings.examDate, '2027-01-01');
});

test('deadline quota remains stable during the day and rises after missed days', () => {
  const c = catalog(470);
  let state = E.createState('2026-11-02');
  let plan = E.getPlan(c, state, '2026-11-02');
  assert.equal(plan.coverageDays, 47);
  assert.equal(plan.coverageDeadline, '2026-12-18');
  assert.equal(plan.newTarget, 10);
  state = E.review(state, 'c0', 2, { today: '2026-11-02' });
  plan = E.getPlan(c, state, '2026-11-02');
  assert.equal(plan.newTarget, 10);
  assert.equal(plan.newCompletedToday, 1);
  assert.equal(plan.newRemaining, 9);
  assert.equal(E.getPlan(c, state, '2026-11-03').newTarget, 11);
  assert.equal(E.getPlan(c, state, '2026-11-07').newTarget, 12);
});

test('a two-minute capacity never disguises the deadline target', () => {
  const c = catalog(1000);
  const state = E.createState('2026-11-02');
  state.settings.dailyMinutes = 2;
  const plan = E.getPlan(c, state, '2026-11-02');
  assert.equal(plan.newTarget, 22);
  assert.equal(plan.newRemaining, 22);
  assert.equal(plan.capacityCards, 2);
  assert.equal(plan.estimatedSecondsPerCard, 45);
  assert.equal(plan.capacityShortfall, true);
  assert.equal(plan.estimatedMinutes, 17);
  assert.equal(plan.shortfallMinutes, 15);
  assert.equal(plan.capacityShortfallPercent, 750);
  assert.equal(E.buildSession(c, state, { today: '2026-11-02' }).length, 12);
  assert.equal(E.buildSession(c, state, { today: '2026-11-02', limit: 100 }).length, 22);
});

test('mastery requires three distinct successful days, not repeated same-day taps', () => {
  const c = catalog(1);
  let state = E.createState('2026-11-02');
  state = E.review(state, 'c0', 2, { today: '2026-11-02' });
  state = E.review(state, 'c0', 3, { today: '2026-11-02' });
  state = E.review(state, 'c0', 2, { today: '2026-11-02' });
  assert.equal(state.records.c0.correct, 3);
  assert.equal(state.records.c0.successDays.length, 1);
  assert.equal(state.records.c0.stage, 1);
  assert.equal(E.summary(c, state, '2026-11-02').mastered, 0);
  state = E.review(state, 'c0', 2, { today: '2026-11-03' });
  state = E.review(state, 'c0', 2, { today: '2026-11-06' });
  assert.equal(E.summary(c, state, '2026-11-06').mastered, 1);
  assert.equal(state.records.c0.correct, 5);
  assert.equal(state.records.c0.due, '2026-11-13');
});

test('a lapse resets mastery but preserves cumulative correct attempts and can recover', () => {
  const c = catalog(1);
  let state = E.createState('2026-11-02');
  for (const day of ['2026-11-02', '2026-11-03', '2026-11-06']) state = E.review(state, 'c0', 2, { today: day });
  state = E.review(state, 'c0', 1, { today: '2026-11-07' });
  assert.equal(state.records.c0.mastered, false);
  assert.equal(state.records.c0.correct, 3);
  assert.equal(state.records.c0.lapses, 1);
  assert.deepEqual(state.records.c0.successDays, []);
  assert.equal(state.records.c0.due, '2026-11-07');
  for (const day of ['2026-11-07', '2026-11-08', '2026-11-09']) state = E.review(state, 'c0', 2, { today: day });
  assert.equal(E.summary(c, state, '2026-11-09').mastered, 1);
  assert.equal(state.records.c0.correct, 6);
});

test('new-card failures stay due until corrected and never double-count daily completion', () => {
  const c = catalog(100);
  let state = E.createState('2026-11-02');
  state = E.review(state, 'c0', 0, { today: '2026-11-02' });
  let plan = E.getPlan(c, state, '2026-11-02');
  assert.equal(plan.newTarget, 3);
  assert.equal(plan.newCompletedToday, 1);
  assert.equal(plan.newRetryCount, 1);
  assert.equal(plan.reviewRemaining, 1);
  assert.equal(plan.totalTarget, 3);
  assert.equal(plan.totalCompletedToday, 0);
  assert.equal(plan.totalRemaining, 3);
  state = E.review(state, 'c0', 2, { today: '2026-11-02' });
  state = E.review(state, 'c0', 2, { today: '2026-11-02' });
  plan = E.getPlan(c, state, '2026-11-02');
  assert.equal(plan.newCompletedToday, 1);
  assert.equal(plan.dueCount, 0);
  assert.equal(plan.totalCompletedToday, 1);
  assert.equal(plan.totalRemaining, 2);
  assert.equal(E.summary(c, state, '2026-11-02').uniqueReviewedToday, 1);
  assert.equal(E.summary(c, state, '2026-11-02').reviewsToday, 3);
});

test('today sessions finish the quota without refilling already completed cards', () => {
  const c = catalog(100);
  let state = E.createState('2026-11-02');
  for (const id of ['c0', 'c1', 'c2']) state = E.review(state, id, 2, { today: '2026-11-02' });
  const plan = E.getPlan(c, state, '2026-11-02');
  assert.equal(plan.totalTarget, 3);
  assert.equal(plan.totalCompletedToday, 3);
  assert.equal(plan.totalRemaining, 0);
  assert.equal(E.buildSession(c, state, { mode: 'today', today: '2026-11-02' }).length, 0);
});

test('all overdue cards precede new cards; due completion is unique and persistent', () => {
  const c = catalog(6);
  const initial = E.createState('2026-11-02');
  initial.records.c1 = { seen: true, imported: true, due: '2026-11-01', successDays: [] };
  initial.records.c2 = { seen: true, imported: true, due: '2026-10-30', successDays: [] };
  let state = E.normalizeState(initial, c, '2026-11-02');
  assert.deepEqual(E.buildSession(c, state, { today: '2026-11-02' }).map(card => card.id), ['c2', 'c1', 'c0']);
  state = E.review(state, 'c2', 0, { today: '2026-11-02' });
  assert.equal(E.getPlan(c, state, '2026-11-02').reviewRemaining, 2);
  state = E.review(state, 'c2', 2, { today: '2026-11-02' });
  state = E.review(state, 'c2', 2, { today: '2026-11-02' });
  const plan = E.getPlan(c, state, '2026-11-02');
  assert.equal(plan.dueTarget, 2);
  assert.equal(plan.dueCompletedToday, 1);
  assert.equal(plan.dueCount, 1);
  assert.equal(plan.totalTarget, 3);
  assert.equal(plan.totalCompletedToday, 1);
});

test('empty catalogs, exam day, the reserve period, and passed deadlines are finite', () => {
  const c = catalog(3);
  const state = E.createState('2026-11-02');
  assert.equal(E.getPlan(c, state, '2026-12-19').inReserve, true);
  assert.equal(E.getPlan(c, state, '2026-12-19').coverageDays, 1);
  assert.equal(E.getPlan(c, state, '2027-01-01').examIsToday, true);
  const past = E.getPlan(c, state, '2027-01-02');
  assert.equal(past.deadlinePassed, true);
  assert.equal(past.studyDeadlinePassed, true);
  assert.equal(past.daysRemaining, 0);
  assert.equal(past.newTarget, 0);
  assert.equal(past.requiredRemaining, 0);
  assert.equal(past.coverageDays, 1);
  const empty = E.getPlan([], state, '2027-01-02');
  assert.equal(empty.totalTarget, 0);
  assert.equal(empty.estimatedMinutes, 0);
  assert.equal(E.summary([], state, '2027-01-02').masteryPercent, 0);
});

test('spacing intervals use distinct-day successes and a completed final check does not loop on exam day', () => {
  let state = E.createState('2026-11-02');
  for (const [day, expected] of [
    ['2026-11-02', '2026-11-03'], ['2026-11-03', '2026-11-06'],
    ['2026-11-06', '2026-11-13'], ['2026-11-13', '2026-11-27'],
    ['2026-11-27', '2026-12-27'], ['2026-12-27', '2027-01-26'],
    ['2027-01-01', '2027-01-31']
  ]) {
    state = E.review(state, 'c0', 2, { today: day });
    assert.equal(state.records.c0.due, expected);
  }
  assert.equal(E.getPlan(catalog(1), state, '2027-01-01').dueCount, 0);
});

test('the exam cutoff spreads long-interval checks across reserve days rather than one final pileup', () => {
  const c = catalog(100);
  let state = E.createState('2026-12-10');
  for (const card of c.cards) state.records[card.id] = {
    seen: true, successDays: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'], due: '2026-12-10'
  };
  for (const card of c.cards) state = E.review(state, card.id, 2, { today: '2026-12-10' });
  const distribution = {};
  for (const card of c.cards) {
    const due = state.records[card.id].due;
    assert.equal(due >= '2026-12-18' && due <= '2026-12-31', true);
    distribution[due] = (distribution[due] || 0) + 1;
  }
  assert.equal(Object.keys(distribution).length >= 10, true);
  assert.equal(Math.max(...Object.values(distribution)) < 20, true);
  const firstCard = c.cards[0];
  const finalDay = state.records[firstCard.id].due;
  state = E.review(state, firstCard.id, 2, { today: finalDay });
  assert.equal(state.records[firstCard.id].examReviewedFor, '2027-01-01');
  assert.equal(state.records[firstCard.id].due > '2027-01-01', true);
});

test('required final reviews finish before exam day, including a natural interval exactly on exam day', () => {
  const c = catalog(3);
  let state = E.createState('2026-12-02');
  state.records.c0 = {
    seen: true, successDays: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'], due: '2026-12-02'
  };
  state = E.review(state, 'c0', 2, { today: '2026-12-02' });
  assert.equal(state.records.c0.due >= '2026-12-18' && state.records.c0.due <= '2026-12-31', true);
  state.records.c1 = { seen: true, successDays: ['2026-12-29'], due: '2026-12-30' };
  state = E.review(state, 'c1', 2, { today: '2026-12-30' });
  assert.equal(state.records.c1.due, '2026-12-31');
  state = E.review(state, 'c1', 2, { today: '2026-12-31' });
  assert.equal(state.records.c1.mastered, true);
  assert.equal(state.records.c1.examReviewedFor, '2027-01-01');
  state = E.review(state, 'c2', 2, { today: '2026-12-31' });
  assert.equal(state.records.c2.mastered, false);
  const examDay = E.getPlan(c, state, '2027-01-01');
  assert.equal(examDay.lastStudyDay, '2026-12-31');
  assert.equal(examDay.studyDeadlinePassed, true);
  assert.equal(examDay.requiredRemaining, 0);
  assert.equal(examDay.optionalReviewCount >= 1, true);
  assert.equal(examDay.newRemaining, 0);
  const forecast = E.forecast(c, E.createState('2026-12-20'), { today: '2026-12-20', days: 30 });
  assert.equal(forecast.days.at(-1).day, '2026-12-31');
  assert.equal(E.forecast(c, state, { today: '2027-01-01', days: 14 }).days.length, 0);
});

test('migration keeps unseen, imported exposure, invalid input, and orphan records distinct', () => {
  const raw = {
    version: 0,
    settings: { examDate: '2026-02-31', dailyMinutes: -2, reserveDays: 'bad', custom: 'keep' },
    records: {
      c0: { seen: true, imported: true, due: '2026-11-02', successDays: [], custom: { kept: true } },
      c1: { seen: true, mastered: true, successDays: [], attempts: -3, due: 'invalid' },
      c2: 17,
      removed: { seen: true, correct: 3, attempts: 3, firstSeen: '2026-10-01' }
    },
    days: { invalid: { keep: 'this' }, '2026-11-01': null },
    foreignFeature: { untouched: true }
  };
  const before = JSON.stringify(raw);
  const state = E.normalizeState(raw, catalog(3), '2026-11-02');
  assert.equal(JSON.stringify(raw), before);
  assert.equal(state.version, 1);
  assert.equal(state.previousVersion, 0);
  assert.equal(state.settings.examDate, '2027-01-01');
  assert.equal(state.settings.dailyMinutes, 60);
  assert.equal(state.settings.reserveDays, 14);
  assert.equal(state.settings.custom, 'keep');
  assert.equal(state.foreignFeature.untouched, true);
  assert.equal(state.records.c0.imported, true);
  assert.equal(state.records.c0.custom.kept, true);
  assert.equal(state.records.c0.mastered, false);
  assert.equal(state.records.c1.mastered, false);
  assert.equal(state.records.c1.due, '2026-11-02');
  assert.equal(state.records.c1.invalidFields.attempts, -3);
  assert.equal(state.records.c1.invalidFields.due, 'invalid');
  assert.equal(state._recovery.records.c2, 17);
  assert.equal(state._recovery.days.invalid.keep, 'this');
  assert.equal(state.records.removed.correct, 3);
  assert.equal(E.summary(catalog(3), state, '2026-11-02').seen, 2);
  assert.equal(E.summary(catalog(3), state, '2026-11-02').mastered, 0);
  assert.equal(E.normalizeState(null, catalog(3), '2026-11-02').version, 1);
});

test('future-clock records do not award mastery and their source data survives correction', () => {
  const raw = E.createState('2026-11-02');
  raw.records.c0 = {
    seen: true, attempts: 3, correct: 3, due: '2026-12-08', lastReviewed: '2026-12-01',
    successDays: ['2026-11-10', '2026-11-11', '2026-12-01'], mastered: true
  };
  const state = E.normalizeState(raw, catalog(1), '2026-11-02');
  assert.equal(state.records.c0.successDays.length, 0);
  assert.equal(state.records.c0.quarantinedSuccessDays.length, 3);
  assert.equal(state.records.c0.mastered, false);
  assert.equal(E.summary(catalog(1), state, '2026-11-02').mastered, 0);
  assert.equal(E.getPlan(catalog(1), state, '2026-11-02').dueCount, 1);
  assert.equal(E.getPlan(catalog(1), state, '2026-11-02').clockAffectedCards, 1);
  const corrected = E.review(state, 'c0', 2, { today: '2026-11-02', now: '2026-12-01T00:00:00Z' });
  assert.deepEqual(corrected.records.c0.successDays, ['2026-11-02']);
  assert.equal(corrected.records.c0.quarantinedSuccessDays.length, 3);
  assert.equal(corrected.records.c0.quarantinedLastReviewed, '2026-12-01');
  assert.equal(corrected.lastReview.warnings.includes('timestamp-day-mismatch'), true);
  assert.equal(corrected.records.c0.correct, 4);
});

test('a future-clock lapse cannot erase the original past grade or mastered streak', () => {
  const c = catalog(1);
  let state = E.createState('2026-11-02');
  for (const day of ['2026-11-02', '2026-11-03', '2026-11-06']) state = E.review(state, 'c0', 2, { today: day });
  const before = state.records.c0;
  state = E.review(state, 'c0', 0, { today: '2026-12-31' });
  assert.equal(state.records.c0.mastered, false);
  const restored = E.normalizeState(state, c, '2026-11-06');
  assert.equal(restored.records.c0.mastered, true);
  assert.equal(restored.records.c0.lastGrade, before.lastGrade);
  assert.equal(restored.records.c0.lastReviewed, before.lastReviewed);
  assert.equal(restored.records.c0.due, before.due);
  assert.deepEqual(restored.records.c0.successDays, before.successDays);
  assert.equal(restored.records.c0.quarantinedHistory.length, 1);
  assert.equal(restored.records.c0.quarantinedHistory[0].grade, 0);
  assert.equal(restored.days['2026-12-31'], undefined);
  assert.equal(restored._recovery.futureDays['2026-12-31'].lapses, 1);
  const next = E.review(restored, 'c0', 2, { today: '2026-11-06' });
  assert.equal(next.records.c0.successDays.length, 3);
  assert.equal(next.records.c0.mastered, true);
  assert.equal(next.records.c0.quarantinedHistory.length, 1);
  assert.equal(E.normalizeState(next, c, '2026-12-31').records.c0.mastered, true);
});

test('conflicting source cards are preserved but excluded from study queues and denominators', () => {
  const c = catalog(4);
  c.cards[2].needsVerification = true;
  c.cards[2].sourceConflict = 'A differs from B';
  c.cards[3].needsVerification = true;
  const state = E.createState('2026-11-02');
  state.records.c2 = { seen: true, successDays: ['2026-10-01', '2026-10-02', '2026-10-03'], due: '2026-10-04' };
  const normalized = E.normalizeState(state, c, '2026-11-02');
  assert.equal(normalized.records.c2.seen, true);
  const summary = E.summary(c, normalized, '2026-11-02');
  assert.equal(summary.catalogTotal, 4);
  assert.equal(summary.total, 2);
  assert.equal(summary.verificationPending, 2);
  assert.equal(summary.seen, 0);
  assert.equal(summary.mastered, 0);
  const plan = E.getPlan(c, normalized, '2026-11-02');
  assert.equal(plan.catalogTotal, 4);
  assert.equal(plan.total, 2);
  assert.equal(plan.verificationPending, 2);
  for (const mode of ['today', 'weak', 'mock', 'topic']) {
    assert.equal(E.buildSession(c, normalized, { mode, topic: 'route', today: '2026-11-02' }).some(card => card.needsVerification), false);
  }
});

test('queues are stable, deduplicate catalog IDs, support every mode, and keep topical breadth', () => {
  const c = catalog(10);
  c.cards.push(c.cards[0]);
  let state = E.createState('2026-11-02');
  state = E.review(state, 'c3', 0, { today: '2026-11-02' });
  for (const mode of ['today', 'weak', 'mock', 'topic']) {
    const options = { mode, topic: 'route', limit: 6, today: '2026-11-02' };
    const first = E.buildSession(c, state, options);
    const second = E.buildSession(c, state, options);
    assert.deepEqual(first.map(card => card.id), second.map(card => card.id));
    assert.equal(new Set(first.map(card => card.id)).size, first.length);
  }
  assert.deepEqual(E.buildSession(c, state, { mode: 'weak', today: '2026-11-02' }).map(card => card.id), ['c3']);
  assert.equal(E.buildSession(c, state, { mode: 'topic', topic: 'route', today: '2026-11-02' }).every(card => card.topic === 'route'), true);
  assert.equal(new Set(E.buildSession(c, state, { mode: 'mock', limit: 2, today: '2026-11-02' }).map(card => card.topic)).size, 2);
  assert.equal(E.summary(c, state, '2026-11-02').total, 10);
  assert.deepEqual(E.buildSession(c, state, { limit: 0, today: '2026-11-02' }), []);
});

test('new material interleaves topics, keeps each topic order, and resumes the same balanced quota', () => {
  const c = catalog(120);
  c.cards.sort((a, b) => a.topic.localeCompare(b.topic));
  let state = E.createState('2026-12-01');
  const first = E.getPlan(c, state, '2026-12-01').newCards;
  assert.equal(new Set(first.slice(0, 2).map(card => card.topic)).size, 2);
  for (const topic of ['point', 'route']) {
    const expected = c.cards.filter(card => card.topic === topic).map(card => card.id);
    assert.deepEqual(first.filter(card => card.topic === topic).map(card => card.id), expected.slice(0, first.filter(card => card.topic === topic).length));
  }
  state = E.review(state, first[0].id, 2, { today: '2026-12-01' });
  assert.deepEqual(E.getPlan(c, state, '2026-12-01').newCards.map(card => card.id), first.slice(1).map(card => card.id));
  const a = E.buildSession(c, state, { mode: 'mock', today: '2026-12-01', seed: 123 });
  const b = E.buildSession(c, state, { mode: 'mock', today: '2026-12-01', seed: 456 });
  assert.notDeepEqual(a.map(card => card.id), b.map(card => card.id));
  assert.deepEqual(a.map(card => card.id), E.buildSession(c, state, { mode: 'mock', today: '2026-12-01', seed: 123 }).map(card => card.id));
});

test('forecast matches actual all-correct daily sessions across reserve and exam dates', () => {
  const c = catalog(30);
  let state = E.createState('2026-12-15');
  state = E.review(state, 'c0', 2, { today: '2026-12-15' });
  state = E.review(state, 'c1', 0, { today: '2026-12-15' });
  const before = JSON.stringify(state);
  const forecast = E.forecast(c, state, { today: '2026-12-15', days: 20 });
  assert.equal(JSON.stringify(state), before);
  assert.equal(forecast.days.length, 17);
  assert.equal(forecast.assumption, 'all-first-attempt-correct');
  for (const row of forecast.days) {
    const plan = E.getPlan(c, state, row.day);
    assert.equal(row.new, plan.newRemaining, `${row.day}: new`);
    assert.equal(row.review, plan.dueCount, `${row.day}: review`);
    assert.equal(row.total, plan.totalRemaining, `${row.day}: total`);
    assert.equal(row.minutes, plan.remainingMinutes, `${row.day}: minutes`);
    for (const card of E.buildSession(c, state, { today: row.day, limit: 10000 })) state = E.review(state, card.id, 2, { today: row.day });
    assert.equal(row.masteredAfter, E.summary(c, state, row.day).mastered, `${row.day}: mastered`);
  }
  assert.equal(E.forecast(c, state, { today: '2027-01-04', days: 0 }).days.length, 0);
});

test('summary differentiates exposure, success, mastery, unique work, and measured study time', () => {
  const c = catalog(2);
  let state = E.createState('2026-11-02');
  state = E.review(state, 'c0', 0, { today: '2026-11-02', seconds: 15, evidence: 'choice' });
  state = E.review(state, 'c0', 2, { today: '2026-11-02', seconds: 75, evidence: 'choice' });
  const s = E.summary(c, state, '2026-11-02');
  assert.equal(s.seen, 1);
  assert.equal(s.mastered, 0);
  assert.equal(s.coveragePercent, 50);
  assert.equal(s.masteryPercent, 0);
  assert.equal(s.uniqueReviewedToday, 1);
  assert.equal(s.reviewsToday, 2);
  assert.equal(s.recallSuccessRate, 50);
  assert.equal(s.studyMinutesToday, 1.5);
  assert.equal(s.recentDays.length, 7);
  assert.equal(s.recentActiveDays, 1);
  assert.equal(s.topics.find(topic => topic.id === 'route').seen, 1);
  assert.equal(s.topics.find(topic => topic.id === 'route').title, '유주');
  assert.equal(E.getPlan(c, state, '2026-11-02').estimatedSecondsPerCard, 45);
  assert.equal(E.getPlan(c, state, '2026-11-02').estimateHasTimingData, true);
  assert.equal(state.records.c0.lastEvidence, 'choice');
});

test('one short answer cannot collapse the whole-catalog time forecast', () => {
  const c = catalog(1000);
  const initial = E.createState('2026-11-02');
  const before = E.forecast(c, initial, { today: '2026-11-02', days: 14 });
  let state = E.review(initial, 'c0', 2, { today: '2026-11-02', seconds: 17, evidence: 'recall' });
  const plan = E.getPlan(c, state, '2026-11-02');
  assert.equal(plan.estimateSampleCount, 1);
  assert.equal(plan.estimatePriorWeight, 20);
  assert.equal(plan.estimatedSecondsPerCard, 43.7);
  const after = E.forecast(c, state, { today: '2026-11-02', days: 14 });
  assert.equal(after.totalMinutes >= before.totalMinutes * 0.9, true);
  state = E.review(state, 'c1', 2, { today: '2026-11-02', seconds: 0, evidence: 'choice' });
  assert.equal(E.getPlan(c, state, '2026-11-02').estimatedSecondsPerCard, 43.7);
  assert.equal(E.getPlan(c, state, '2026-11-02').estimateSampleCount, 1);
});

test('all read APIs and review preserve their inputs; JSON round trips retain progress', () => {
  const c = freezeDeep(catalog(10));
  const initial = freezeDeep(E.createState('2026-11-02'));
  const before = JSON.stringify(initial);
  const state = E.review(initial, 'c0', 2, { today: '2026-11-02' });
  E.getPlan(c, initial, '2026-11-02');
  E.summary(c, initial, '2026-11-02');
  E.buildSession(c, initial, { today: '2026-11-02' });
  assert.equal(JSON.stringify(initial), before);
  assert.equal(initial.records.c0, undefined);
  const saved = JSON.parse(JSON.stringify(state));
  const restored = E.normalizeState(saved, c, '2026-11-03');
  assert.equal(restored.records.c0.seen, true);
  assert.deepEqual(restored.records.c0.successDays, ['2026-11-02']);
  assert.equal(E.getPlan(c, restored, '2026-11-03').dueCount, 1);
  assert.throws(() => E.review(state, 'c0', 4, { today: '2026-11-02' }), RangeError);
});
