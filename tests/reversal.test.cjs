'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../exam-engine.js');

function catalog(count = 6) {
  return {
    topics: [{ id: 'route', title: '유주' }, { id: 'point', title: '혈위' }],
    cards: Array.from({ length: count }, (_, i) => ({
      id: `c${i}`, topic: i % 2 ? 'point' : 'route', prompt: `질문 ${i}`,
      answer: `정답 ${i}`, detail: '', tool: 'test', sourceId: String(i), kind: 'recall'
    }))
  };
}

function answer(state, id, grade, today, attemptId, extra = {}) {
  return E.review(state, id, grade, {
    today, attemptId, evidence: 'recall', unaided: true, usedHint: false,
    originalAnswer: grade >= 2 ? `스스로 떠올린 ${id}` : `처음 틀린 ${id}`,
    seconds: 20, ...extra
  });
}

function metrics(state, today, c = catalog()) {
  return E.getReversal(c, state, today).today;
}

function ids(cards) { return cards.map(card => card.id); }
function json(value) { return JSON.parse(JSON.stringify(value)); }
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(freezeDeep);
  }
  return value;
}

test('legacy state is preserved and past grades do not invent unaided measurements', () => {
  const c = catalog();
  let state = E.createState('2026-11-03');
  state.settings.custom = { retained: 'setting' };
  state.foreignFeature = { retained: 'feature' };
  state.records.orphan = { seen: true, correct: 7, attempts: 9, custom: 'removed-card' };
  state = E.review(state, 'c0', 0, { today: '2026-11-03' });
  state = E.review(state, 'c0', 2, { today: '2026-11-03' });
  const before = JSON.stringify(state);
  const normalized = E.normalizeState(state, c, '2026-11-03');
  const view = E.getReversal(c, normalized, '2026-11-03');
  assert.equal(JSON.stringify(state), before);
  assert.equal(normalized.version, 1);
  assert.deepEqual(json(normalized.settings.custom), { retained: 'setting' });
  assert.deepEqual(json(normalized.foreignFeature), { retained: 'feature' });
  assert.equal(normalized.records.orphan.correct, 7);
  assert.equal(normalized.records.orphan.custom, 'removed-card');
  assert.equal(view.today.firstAttempts, 0);
  assert.equal(view.today.firstCorrect, 0);
  assert.equal(view.today.delayedAttempts, 0);
  assert.equal(view.today.recoveries, 0);
  assert.equal(view.recentDays.length, 7);
  assert.deepEqual(view.recentDays.map(row => row.day), [
    '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31',
    '2026-11-01', '2026-11-02', '2026-11-03'
  ]);
  for (const row of view.recentDays.slice(0, -1)) {
    assert.equal(row.firstAttempts, 0);
    assert.equal(row.delayedAttempts, 0);
    assert.equal(row.startedAt, null);
    assert.equal(row.startDelaySeconds, null);
    assert.equal(row.returnIntent, null);
  }
});

test('same-day correction preserves the first failure and only next-day unaided success recovers it', () => {
  const c = catalog(1);
  let state = E.createState('2026-11-03');
  state = E.recordExposure(state, 'c0', { today: '2026-11-03', attemptId: 'first' });
  state = answer(state, 'c0', 0, '2026-11-03', 'first', { originalAnswer: '肺 대신 胃라고 답함' });
  assert.equal(state.lastReview.reversalStatus, 'queued');
  assert.equal(state.lastReview.firstOfDay, true);
  assert.equal(metrics(state, '2026-11-03', c).firstAttempts, 1);
  state = answer(state, 'c0', 2, '2026-11-03', 'corrected', { originalAnswer: '정답을 확인하고 교정' });
  assert.equal(state.lastReview.reversalStatus, 'corrected');
  assert.equal(state.lastReview.firstOfDay, false);
  let row = metrics(state, '2026-11-03', c);
  assert.equal(row.firstAttempts, 1);
  assert.equal(row.firstCorrect, 0);
  assert.equal(row.corrections, 1);
  assert.equal(row.recoveries, 0);
  assert.equal(row.uniqueStudied, 1);
  assert.deepEqual(json(state.records.c0.reversal.firstAnswer), {
    day: '2026-11-03', attemptId: 'first', originalAnswer: '肺 대신 胃라고 답함'
  });
  assert.deepEqual(json(state.records.c0.reversal.lastFailureAnswer), {
    day: '2026-11-03', attemptId: 'first', originalAnswer: '肺 대신 胃라고 답함'
  });
  assert.deepEqual(ids(E.getReversal(c, state, '2026-11-04').retestCards), ['c0']);

  state = answer(state, 'c0', 3, '2026-11-04', 'delayed-success');
  row = metrics(state, '2026-11-04', c);
  assert.equal(state.lastReview.reversalStatus, 'recovered');
  assert.equal(row.firstAttempts, 1);
  assert.equal(row.firstCorrect, 1);
  assert.equal(row.delayedAttempts, 1);
  assert.equal(row.delayedCorrect, 1);
  assert.equal(row.d1Attempts, 1);
  assert.equal(row.d1Correct, 1);
  assert.equal(row.recoveries, 1);
  assert.deepEqual(row.recoveredIds, ['c0']);
  assert.deepEqual(ids(E.getReversal(c, state, '2026-11-04').retestCards), []);
  assert.equal(E.getPlan(c, state, '2026-11-04').totalRemaining, 0);

  state = answer(state, 'c0', 3, '2026-11-04', 'extra-success');
  row = metrics(state, '2026-11-04', c);
  assert.equal(row.firstAttempts, 1);
  assert.equal(row.delayedCorrect, 1);
  assert.equal(row.recoveries, 1);
  assert.equal(row.corrections, 0);
  assert.equal(metrics(state, '2026-11-03', c).firstCorrect, 0);
  assert.equal(state.records.c0.reversal.lastFailureAnswer.originalAnswer, '肺 대신 胃라고 답함');
});

test('same attempt reveal preserves recall while prior exposure cannot be laundered by a restarted attempt', () => {
  const c = catalog(3);
  let state = E.createState('2026-11-03');
  state = E.recordExposure(state, 'c0', { today: '2026-11-03', attemptId: 'own-reveal' });
  state = answer(state, 'c0', 2, '2026-11-03', 'own-reveal');
  assert.equal(metrics(state, '2026-11-03', c).firstCorrect, 1);

  state = E.recordExposure(state, 'c1', { today: '2026-11-03', attemptId: 'abandoned' });
  state = E.recordExposure(state, 'c1', { today: '2026-11-03', attemptId: 'restarted' });
  state = E.normalizeState(json(state), c, '2026-11-03');
  state = answer(state, 'c1', 3, '2026-11-03', 'restarted');
  assert.equal(metrics(state, '2026-11-03', c).firstAttempts, 1);
  assert.equal(metrics(state, '2026-11-03', c).firstCorrect, 1);
  assert.notEqual(state.lastReview.unaided, true);

  // Merely seeing an answer never creates a completed response or mastery.
  const beforeSeen = E.summary(c, state, '2026-11-03').seen;
  state = E.recordExposure(state, 'c2', { today: '2026-11-03', attemptId: 'no-response' });
  assert.equal(E.summary(c, state, '2026-11-03').seen, beforeSeen);
  assert.equal(metrics(state, '2026-11-03', c).firstAttempts, 1);
});

test('hints and choices cannot count as first unaided success or delayed error recovery', () => {
  const c = catalog(3);
  let state = E.createState('2026-11-03');
  for (const id of ['c0', 'c1', 'c2']) state = answer(state, id, 0, '2026-11-03', `${id}-fail`);
  state = answer(state, 'c0', 2, '2026-11-04', 'hint-success', { usedHint: true });
  state = answer(state, 'c1', 2, '2026-11-04', 'choice-success', { evidence: 'choice' });
  state = answer(state, 'c2', 2, '2026-11-04', 'not-unaided', { unaided: false });
  for (const id of ['c0', 'c1', 'c2']) state = answer(state, id, 3, '2026-11-04', `${id}-late-recall`);
  const row = metrics(state, '2026-11-04', c);
  assert.equal(row.firstAttempts, 0);
  assert.equal(row.firstCorrect, 0);
  assert.equal(row.delayedCorrect, 0);
  assert.equal(row.recoveries, 0);
  assert.deepEqual(new Set(ids(E.getReversal(c, state, '2026-11-05').retestCards)), new Set(['c0', 'c1', 'c2']));
  state = answer(state, 'c0', 2, '2026-11-05', 'fresh-next-day');
  assert.equal(metrics(state, '2026-11-05', c).recoveries, 1);
});

test('next-day failure remains unresolved after correction and a skipped D3 check can still recover', () => {
  const c = catalog(1);
  let state = answer(E.createState('2026-11-03'), 'c0', 0, '2026-11-03', 'd0-fail');
  state = answer(state, 'c0', 1, '2026-11-04', 'd1-fail');
  state = answer(state, 'c0', 2, '2026-11-04', 'd1-correct');
  const failed = metrics(state, '2026-11-04', c);
  assert.equal(failed.delayedAttempts, 1);
  assert.equal(failed.delayedCorrect, 0);
  assert.equal(failed.d1Attempts, 1);
  assert.equal(failed.d1Correct, 0);
  assert.equal(failed.corrections, 1);
  assert.equal(failed.recoveries, 0);
  assert.deepEqual(ids(E.getReversal(c, state, '2026-11-05').retestCards), ['c0']);
  assert.deepEqual(ids(E.getReversal(c, state, '2026-11-07').retestCards), ['c0']);
  state = answer(state, 'c0', 2, '2026-11-07', 'd3-success');
  const recovered = metrics(state, '2026-11-07', c);
  assert.equal(recovered.delayedAttempts, 1);
  assert.equal(recovered.delayedCorrect, 1);
  assert.equal(recovered.d1Attempts, 0);
  assert.equal(recovered.d3Attempts, 1);
  assert.equal(recovered.d3Correct, 1);
  assert.equal(recovered.recoveries, 1);
});

test('duplicate attempt delivery changes no counters, duration, original answer or queue', () => {
  const c = catalog(1);
  let state = answer(E.createState('2026-11-03'), 'c0', 0, '2026-11-03', 'stable-session:0', {
    originalAnswer: '첫 응답은 그대로', seconds: 41
  });
  const record = json(state.records.c0);
  const row = json(metrics(state, '2026-11-03', c));
  const plan = json(E.getPlan(c, state, '2026-11-03'));
  state = E.normalizeState(json(state), c, '2026-11-03');
  state = answer(state, 'c0', 3, '2026-11-03', 'stable-session:0', {
    originalAnswer: '중복 전송이 원답을 덮어쓰면 안 됨', seconds: 999
  });
  assert.equal(state.lastReview.duplicate, true);
  assert.deepEqual(json(state.records.c0), record);
  assert.deepEqual(json(metrics(state, '2026-11-03', c)), row);
  assert.deepEqual(json(E.getPlan(c, state, '2026-11-03')), plan);
  assert.equal(state.records.c0.attempts, 1);
  assert.equal(state.records.c0.correct, 0);
  assert.equal(state.records.c0.seconds, 41);
});

test('failed recall recovery survives legacy imports and does not erase cumulative errors', () => {
  const c = catalog(1);
  let state = E.createState('2026-11-03');
  state.records.c0 = { seen: true, imported: true, correct: 7, lapses: 2,
    attempts: 9, successDays: [], firstSeen: '2026-10-01', due: '2026-11-03', custom: 'keep' };
  state = answer(state, 'c0', 0, '2026-11-03', 'current-error');
  const snapshot = json(state);
  state = E.normalizeState(snapshot, c, '2026-11-04');
  state = answer(state, 'c0', 2, '2026-11-04', 'delayed-recovery');
  assert.equal(metrics(state, '2026-11-04', c).recoveries, 1);
  assert.equal(state.records.c0.correct, 8);
  assert.equal(state.records.c0.lapses, 3);
  assert.equal(state.records.c0.custom, 'keep');
  assert.equal(state.records.c0.imported, true);
  assert.equal(snapshot.records.c0.correct, 7);
});

test('tomorrow reservation uses a studied candidate, wins today ordering and persists if missed', () => {
  const c = catalog(6);
  let state = E.createState('2026-11-03');
  state = answer(state, 'c0', 0, '2026-11-03', 'c0-error');
  state = answer(state, 'c1', 2, '2026-11-03', 'c1-correct');
  const candidates = ids(E.getReversal(c, state, '2026-11-03').tomorrowCandidates);
  assert.equal(candidates.includes('c0'), true);
  assert.equal(candidates.includes('c1'), true);
  assert.equal(candidates.includes('c5'), false);
  state = E.reserveFirst(state, 'c1', { today: '2026-11-03', plannedTime: '09:20' });
  let view = E.getReversal(c, state, '2026-11-04');
  assert.equal(view.reservation.cardId, 'c1');
  assert.equal(view.reservation.day, '2026-11-04');
  assert.equal(view.reservation.plannedTime, '09:20');
  assert.equal(view.startCard.id, 'c1');
  assert.equal(E.buildSession(c, state, { today: '2026-11-04', limit: 20 })[0].id, 'c1');
  view = E.getReversal(c, state, '2026-11-07');
  assert.equal(view.startCard.id, 'c1');
  assert.equal(view.reservation.day, '2026-11-04');
  state = E.reserveFirst(state, null, { today: '2026-11-07' });
  assert.equal(E.getReversal(c, state, '2026-11-07').reservation, null);
});

test('general due, next-day retest and reservation contribute one task per card to plan and session', () => {
  const c = catalog(4);
  c.cards.push(c.cards[0]);
  let state = E.createState('2026-11-03');
  state.settings.dailyMinutes = 2;
  state = answer(state, 'c0', 0, '2026-11-03', 'error');
  state = answer(state, 'c0', 2, '2026-11-03', 'correct');
  state = E.reserveFirst(state, 'c0', { today: '2026-11-03', plannedTime: '08:00' });
  const plan = E.getPlan(c, state, '2026-11-04');
  const session = E.buildSession(c, state, { today: '2026-11-04', limit: 100 });
  assert.deepEqual(ids(plan.dueCards), ['c0']);
  assert.equal(plan.dueCount, 1);
  assert.equal(session[0].id, 'c0');
  assert.equal(new Set(ids(session)).size, session.length);
  assert.equal(session.length, plan.totalRemaining);
  assert.equal(plan.totalRemaining, plan.dueCount + plan.newRemaining);
  assert.equal(plan.remainingMinutes, Math.ceil(plan.totalRemaining * plan.estimatedSecondsPerCard / 60));
  assert.equal(plan.totalTarget, plan.dueTarget + plan.newTarget);
  assert.equal(E.buildSession(c, state, { today: '2026-11-04', limit: 0 }).length, 0);
  assert.equal(c.cards.length, 5);
});

test('a future reservation survives an earlier success and forecast counts it at the promised date', () => {
  const c = catalog(1);
  let state = E.setReversalPreferences(E.createState('2026-11-03'), {
    cue: '아침에 첫 질문', plannedTime: '09:00'
  }, { today: '2026-11-03' });
  state = answer(state, 'c0', 0, '2026-11-03', 'reserve-failure');
  state = answer(state, 'c0', 2, '2026-11-03', 'reserve-correction');
  state = E.reserveFirst(state, 'c0', { today: '2026-11-04', plannedTime: '' });
  state = answer(state, 'c0', 2, '2026-11-04', 'early-recovery');
  assert.equal(state.records.c0.due, '2026-11-07');
  const view = E.getReversal(c, state, '2026-11-05');
  assert.equal(view.reservation.day, '2026-11-05');
  assert.equal(view.startCard.id, 'c0');
  assert.equal(view.reservation.plannedTime, '');
  const plan = E.getPlan(c, state, '2026-11-05');
  assert.equal(plan.dueCount, 1);
  assert.deepEqual(ids(E.buildSession(c, state, { today: '2026-11-05', limit: 100 })), ['c0']);
  const forecast = E.forecast(c, state, { today: '2026-11-04', days: 3 });
  const promised = forecast.days.find(row => row.day === '2026-11-05');
  assert.equal(promised.review, 1);
  assert.equal(promised.total, plan.totalRemaining);
  const started = E.recordStart(state, { today: '2026-11-05', now: '2026-11-05T01:00:00.000Z' });
  assert.equal(metrics(started, '2026-11-05', c).startDelaySeconds, null,
    'An explicitly untimed reservation must not borrow the global planned time');
});

test('retest backlog crosses year and leap-day boundaries without becoming due on the failure day', () => {
  const c = catalog(1);
  for (const [failedDay, nextDay, laterDay] of [
    ['2026-12-31', '2027-01-01', '2027-01-04'],
    ['2024-02-28', '2024-02-29', '2024-03-02'],
    ['2024-02-29', '2024-03-01', '2024-03-04']
  ]) {
    let state = E.createState(failedDay);
    state.settings.examDate = E.addDays(laterDay, 90);
    state = answer(state, 'c0', 0, failedDay, `fail:${failedDay}`);
    assert.deepEqual(ids(E.getReversal(c, state, failedDay).retestCards), [], failedDay);
    assert.deepEqual(ids(E.getReversal(c, state, nextDay).retestCards), ['c0'], nextDay);
    assert.deepEqual(ids(E.getReversal(c, state, laterDay).retestCards), ['c0'], laterDay);
  }
});

test('start cue, planned time, first start and return intention are separate from dashboard visits', () => {
  const c = catalog();
  let state = E.createState('2026-11-03');
  state = E.setReversalPreferences(state, { cue: '아침 식사 후 책상에 앉으면', plannedTime: '09:00' }, { today: '2026-11-03' });
  assert.equal(E.getReversal(c, state, '2026-11-03').cue, '아침 식사 후 책상에 앉으면');
  assert.equal(E.getReversal(c, state, '2026-11-03').plannedTime, '09:00');
  assert.equal(metrics(state, '2026-11-03', c).startedAt, null);
  state = E.recordStart(state, { today: '2026-11-03', now: '2026-11-03T00:02:30.000Z' });
  let row = metrics(state, '2026-11-03', c);
  assert.equal(row.startedAt, '2026-11-03T00:02:30.000Z');
  assert.equal(row.startDelaySeconds, 150);
  assert.equal(row.firstAttempts, 0);
  state = E.recordStart(state, { today: '2026-11-03', now: '2026-11-03T04:00:00.000Z' });
  assert.equal(metrics(state, '2026-11-03', c).startedAt, row.startedAt);
  state = E.recordReflection(state, { today: '2026-11-03', returnIntent: 0 });
  assert.equal(metrics(state, '2026-11-03', c).returnIntent, 0);
  state = E.recordReflection(state, { today: '2026-11-03', returnIntent: 4 });
  assert.equal(metrics(state, '2026-11-03', c).returnIntent, 4);
  assert.equal(metrics(state, '2026-11-03', c).firstAttempts, 0);
  state = E.recordReflection(state, { today: '2026-11-03', returnIntent: null });
  assert.equal(metrics(state, '2026-11-03', c).returnIntent, null);

  const noPlan = E.recordStart(E.createState('2026-11-03'), {
    today: '2026-11-03', now: '2026-11-02T15:00:00.000Z'
  });
  assert.equal(metrics(noPlan, '2026-11-03', c).startedAt, '2026-11-02T15:00:00.000Z');
  assert.equal(metrics(noPlan, '2026-11-03', c).startDelaySeconds, null);
});

test('future-clock reversal success is quarantined and cannot erase an earlier real failure', () => {
  const c = catalog(1);
  let state = answer(E.createState('2026-11-03'), 'c0', 0, '2026-11-03', 'past-failure');
  state = answer(state, 'c0', 2, '2026-12-01', 'future-clock-success');
  const corrected = E.normalizeState(state, c, '2026-11-04');
  assert.equal(metrics(corrected, '2026-11-04', c).recoveries, 0);
  assert.deepEqual(ids(E.getReversal(c, corrected, '2026-11-04').retestCards), ['c0']);
  assert.equal(metrics(corrected, '2026-11-03', c).firstCorrect, 0);
  assert.equal(JSON.stringify(corrected).includes('future-clock-success'), true);
  const recovered = answer(corrected, 'c0', 2, '2026-11-04', 'real-success');
  assert.equal(metrics(recovered, '2026-11-04', c).recoveries, 1);
});

test('reversal APIs keep inputs immutable and survive JSON round trips', () => {
  const c = freezeDeep(catalog(2));
  let state = E.createState('2026-11-03');
  state = E.setReversalPreferences(state, { cue: '노트북을 열면', plannedTime: '07:40' }, { today: '2026-11-03' });
  state = answer(state, 'c0', 0, '2026-11-03', 'immutable-answer');
  const frozen = freezeDeep(state), before = JSON.stringify(frozen);
  E.getReversal(c, frozen, '2026-11-03');
  E.reserveFirst(frozen, 'c0', { today: '2026-11-03', plannedTime: '07:40' });
  E.recordReflection(frozen, { today: '2026-11-03', returnIntent: 2 });
  E.recordStart(frozen, { today: '2026-11-03', now: '2026-11-02T22:45:00Z' });
  E.recordExposure(frozen, 'c1', { today: '2026-11-03', attemptId: 'immutable-exposure' });
  E.setReversalPreferences(frozen, { cue: '차를 마시면', plannedTime: '' }, { today: '2026-11-03' });
  assert.equal(JSON.stringify(frozen), before);
  const restored = E.normalizeState(json(frozen), c, '2026-11-04');
  assert.equal(E.getReversal(c, restored, '2026-11-04').cue, '노트북을 열면');
  assert.deepEqual(ids(E.getReversal(c, restored, '2026-11-04').retestCards), ['c0']);
  assert.equal(metrics(restored, '2026-11-03', c).firstAttempts, 1);
});

test('original answer text is bounded and never duplicated into every review history event', () => {
  const original = '원답'.repeat(2000);
  let state = answer(E.createState('2026-11-03'), 'c0', 0, '2026-11-03', 'long-original', {
    originalAnswer: original
  });
  for (let i = 0; i < 8; i++) state = answer(state, 'c0', 2, '2026-11-03', `correction:${i}`, {
    originalAnswer: '교정'.repeat(2000)
  });
  const record = state.records.c0;
  assert.equal(record.reversal.firstAnswer.originalAnswer, original.slice(0, 2000));
  assert.equal(record.reversal.lastFailureAnswer.originalAnswer, original.slice(0, 2000));
  assert.equal(record.history.length, 9);
  assert.equal(record.history.some(event => Object.hasOwn(event, 'originalAnswer')), false);
  assert.equal(metrics(state, '2026-11-03').corrections, 1);
  assert.equal(metrics(state, '2026-11-03').firstCorrect, 0);
});

test('invalid feature fields and future observations remain recoverable without becoming measured success', () => {
  const c = catalog(5);
  const day = '2026-11-03';
  const raw = E.createState(day);
  raw.reversal = {
    featureVersion: 1, cue: { invalid: 'cue' }, plannedTime: '29:99',
    customUnknown: { firstCorrect: 999, preserved: true },
    reservation: { cardId: 'c0', day: '2026-02-31', createdDay: day },
    days: {
      [day]: {
        first: {
          c0: { grade: '3', evidence: 'recall', unaided: true, recovered: true },
          c1: { grade: 3, evidence: 'recall', unaided: 'true', recovered: true },
          c2: { grade: 3, evidence: 'recall', unaided: true, usedHint: true, recovered: true },
          c3: { grade: 3, evidence: 'choice', unaided: true, recovered: true },
          c4: { grade: 3, evidence: 'recall', unaided: true, usedHint: 'malformed-hint-flag', recovered: true }
        },
        recoveredIds: ['c0', 'c1', 'c2', 'c3', 'c4'], firstCorrect: 999,
        startedAt: '2026-11-04T00:00:00.000Z', returnIntent: 9
      },
      '2026-11-04': { first: { c0: {
        grade: 3, evidence: 'recall', unaided: true, usedHint: false,
        previousStudyDay: day, failureDay: day, recovered: true
      } }, recoveredIds: ['c0'], futureMarker: 'future-observation-preserved' },
      '2026-02-31': { invalidMarker: 'invalid-calendar-preserved' }
    }
  };
  const before = JSON.stringify(raw);
  const state = E.normalizeState(raw, c, day);
  const view = E.getReversal(c, state, day);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(view.today.firstAttempts, 0);
  assert.equal(view.today.firstCorrect, 0);
  assert.equal(view.today.delayedCorrect, 0);
  assert.equal(view.today.recoveries, 0);
  assert.equal(view.today.startedAt, null);
  assert.equal(view.today.startDelaySeconds, null);
  assert.equal(view.today.returnIntent, null);
  assert.equal(view.reservation, null);
  assert.deepEqual(json(state.reversal.customUnknown), { firstCorrect: 999, preserved: true });
  assert.equal(JSON.stringify(state).includes('malformed-hint-flag'), true);
  assert.equal(JSON.stringify(state).includes('future-observation-preserved'), true);
  assert.equal(JSON.stringify(state).includes('invalid-calendar-preserved'), true);
});

test('an unsupported feature schema is retained without trusting its apparent first-success counters', () => {
  const c = catalog(1);
  const day = '2026-11-03';
  const raw = E.createState(day);
  raw.reversal = {
    featureVersion: 999, futureMarker: 'unknown-schema-must-survive',
    days: { [day]: { first: { c0: {
      grade: 3, evidence: 'recall', unaided: true, usedHint: false,
      previousStudyDay: '2026-11-02', failureDay: '2026-11-02', recovered: true
    } }, recoveredIds: ['c0'] } }
  };
  const state = E.normalizeState(raw, c, day);
  const row = metrics(state, day, c);
  assert.equal(row.firstAttempts, 0);
  assert.equal(row.firstCorrect, 0);
  assert.equal(row.recoveries, 0);
  assert.equal(JSON.stringify(state).includes('unknown-schema-must-survive'), true);
  assert.equal(raw.reversal.featureVersion, 999);
});

test('preference and reservation validation reject malformed input without changing existing settings', () => {
  const day = '2026-11-03';
  const state = E.setReversalPreferences(E.createState(day), { cue: '가'.repeat(200), plannedTime: '08:30' }, { today: day });
  const before = JSON.stringify(state);
  assert.equal(E.getReversal(catalog(), state, day).cue.length, 160);
  assert.throws(() => E.setReversalPreferences(state, { plannedTime: '24:00' }, { today: day }), RangeError);
  assert.throws(() => E.reserveFirst(state, 'c5', { today: day }), RangeError);
  assert.throws(() => E.recordReflection(state, { today: day, returnIntent: 5 }), RangeError);
  assert.throws(() => E.recordReflection(state, { today: day, returnIntent: '3' }), RangeError);
  assert.throws(() => answer(state, 'c0', 2, day, ''), TypeError);
  assert.throws(() => answer(state, 'c0', 2, day, 'bad-unaided', { unaided: 'true' }), TypeError);
  assert.throws(() => answer(state, 'c0', 2, day, 'bad-hint', { usedHint: 'false' }), TypeError);
  assert.equal(JSON.stringify(state), before);
  const wrongClock = E.recordStart(state, { today: day, now: '2026-11-03T15:00:00.000Z' });
  assert.equal(metrics(wrongClock, day).startedAt, null);
  assert.equal(metrics(wrongClock, day).startDelaySeconds, null);
});

test('seven-day compaction keeps measurements, original answers, unknown metadata and old-attempt idempotence', () => {
  const c = catalog(3), firstDay = '2026-11-03', lastDay = '2026-11-10';
  let state = E.createState(firstDay);
  for (const id of ['c0', 'c1']) {
    state = E.recordExposure(state, id, { today: firstDay, attemptId: `${id}:day0` });
    state = answer(state, id, id === 'c0' ? 0 : 2, firstDay, `${id}:day0`, {
      originalAnswer: id === 'c0' ? '압축 뒤에도 남길 첫 오답' : '첫날 정답'
    });
  }
  state = answer(state, 'c0', 2, firstDay, 'c0:day0-correction');
  state = E.recordExposure(state, 'c2', { today: firstDay, attemptId: 'unanswered-exposure' });
  state.reversal.days[firstDay].customDay = { retain: 'day-metadata' };
  state.reversal.days[firstDay].first.c0.customFirst = { retain: 'first-metadata' };
  state.reversal.days[firstDay].exposures.c0.customExposure = { retain: 'exposure-metadata' };
  const expected = json(metrics(state, firstDay, c));

  for (let offset = 1; offset <= 7; offset++) {
    const today = E.addDays(firstDay, offset);
    for (const id of ['c0', 'c1']) {
      state = E.recordExposure(state, id, { today, attemptId: `${id}:day${offset}` });
      state = answer(state, id, 2, today, `${id}:day${offset}`);
    }
  }
  const firstRecentDay = E.addDays(lastDay, -6);
  assert.equal(Object.keys(state.reversal.days[firstRecentDay].first).length, 2,
    'The seventh visible day still needs per-card first-attempt metadata');
  assert.equal(Object.keys(state.reversal.days[firstDay].first).length, 0,
    'Older completed first-attempt details must be compacted once');
  assert.equal(state.reversal.days[firstDay].exposures.c0, undefined);
  assert.equal(state.reversal.days[firstDay].exposures.c2.attemptId, 'unanswered-exposure',
    'An exposure without a recorded response cannot be discarded as completed work');
  assert.deepEqual(json(state.reversal.days[firstDay].customDay), { retain: 'day-metadata' });
  assert.equal(JSON.stringify(state).includes('first-metadata'), true);
  assert.equal(JSON.stringify(state).includes('exposure-metadata'), true);
  assert.equal(state.records.c0.reversal.lastFailureAnswer.originalAnswer, '압축 뒤에도 남길 첫 오답');
  assert.equal(state.records.c0.history.length, 9);
  assert.equal(state.records.c1.history.length, 8);
  const historical = metrics(state, firstDay, c);
  for (const key of ['firstAttempts', 'firstCorrect', 'delayedAttempts', 'delayedCorrect',
    'd1Attempts', 'd1Correct', 'd3Attempts', 'd3Correct', 'corrections', 'recoveries', 'uniqueStudied', 'seconds']) {
    assert.equal(historical[key], expected[key], `Archived ${key} must retain its original measured value`);
  }
  const restored = E.normalizeState(json(state), c, lastDay);
  assert.deepEqual(json(metrics(restored, firstDay, c)), json(historical),
    'Repeated normalization and a JSON restore must not re-add archived counts');
  const beforeRecords = json(restored.records), beforeDays = json(restored.days);
  const replay = answer(restored, 'c1', 3, lastDay, 'c0:day0', { originalAnswer: '잘못 재전송된 새 답', seconds: 999 });
  assert.equal(replay.lastReview.duplicate, true,
    'An old attempt ID must remain globally idempotent even when its redundant index was removed');
  assert.deepEqual(json(replay.records), beforeRecords);
  assert.deepEqual(json(replay.days), beforeDays);
});

test('legacy idempotency indexes retain orphan events and unknown fields while known duplicates are removable', () => {
  const day = '2026-11-03', c = catalog(2);
  let state = answer(E.createState(day), 'c0', 0, day, 'known-history-event');
  state.reversal.eventIds = {
    'known-history-event': { cardId: 'c0', day, grade: 0, customIndexData: 'unknown-index-metadata' },
    'only-old-index': { cardId: 'orphan', day, grade: 2, unknown: 'orphan-index-metadata' }
  };
  state = E.normalizeState(state, c, '2026-11-11');
  assert.equal(JSON.stringify(state).includes('unknown-index-metadata'), true);
  assert.equal(JSON.stringify(state).includes('orphan-index-metadata'), true);
  const beforeRecords = json(state.records), beforeDays = json(state.days);
  const replay = answer(state, 'c1', 3, '2026-11-11', 'only-old-index');
  assert.equal(replay.lastReview.duplicate, true);
  assert.deepEqual(json(replay.records), beforeRecords);
  assert.deepEqual(json(replay.days), beforeDays);
});
