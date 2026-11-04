'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../exam-engine.js');
const X = require('../exam-expedition.js');

const TODAY = '2026-11-04';
const YESTERDAY = E.addDays(TODAY, -1);
function catalog(count = 12) {
  return {
    topics: [{ id: 'route', title: '유주', label: '유주' }, { id: 'point', title: '혈위', label: '혈위' }],
    coverage: [{ tool: 'test', label: '검증된 원자료' }],
    cards: Array.from({ length: count }, (_, i) => ({
      id: `c${i}`, topic: i % 2 ? 'point' : 'route', prompt: `원문 질문 ${i}`,
      answer: `정답 ${i}`, choices: [`정답 ${i}`, `원문 오답 ${i}`], detail: `근거 ${i}`,
      tool: 'test', sourceId: String(i), kind: 'recall'
    }))
  };
}
function initial(today = TODAY) {
  const state = E.createState(E.addDays(today, -3));
  state.settings.examDate = E.addDays(today, 1);
  state.settings.reserveDays = 0;
  return state;
}
function answer(state, id, grade, day, attemptId, options = {}) {
  return E.review(state, id, grade, { today: day, attemptId, evidence: 'recall',
    unaided: true, usedHint: false, seconds: 15, originalAnswer: `원답 ${id}`, ...options });
}
function json(value) { return JSON.parse(JSON.stringify(value)); }
function frozen(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(frozen); }
  return value;
}
function noGrowth(result) {
  assert.equal(result.advancesMemory, false);
  assert.equal(result.advancesChoice, false);
  assert.equal(result.breaksBoss, false);
}

test('expedition exports the same five pure APIs in a browser without storage or DOM', () => {
  const context = vm.createContext({ MeridianExamEngine: E });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../exam-expedition.js'), 'utf8'), context);
  for (const name of ['getWorld', 'getDay', 'buildRoom', 'getInteraction', 'classifyOutcome']) {
    assert.equal(typeof context.MeridianExpedition[name], 'function');
    assert.equal(typeof X[name], 'function');
  }
  const c = catalog(3), state = initial();
  assert.deepEqual(json(context.MeridianExpedition.getWorld(c, state, { today: TODAY })),
    json(X.getWorld(c, state, { today: TODAY })));
});

test('play uses only original choices or bounded unique sequence fragments, while bosses recall', () => {
  const card = catalog(1).cards[0];
  const choice = X.getInteraction(card, { approach: 'play', boss: false });
  assert.equal(choice.type, 'choice');
  assert.deepEqual(choice.choices, card.choices);
  assert.notEqual(choice.choices, card.choices, 'Returned options must not alias the medical source');
  assert.equal(X.getInteraction(card, { approach: 'recall' }).type, 'recall');
  assert.equal(X.getInteraction(card, { approach: 'play', boss: true }).type, 'recall');
  assert.equal(X.getInteraction({ ...card, requiresChoices: true }, { approach: 'recall', boss: true }).type, 'choice');
  for (const choices of [[], ['원문 오답'], ['정답 0'], ['정답 0', '정답 0'], ['정답 0', ''], ['정답 0', 3]]) {
    assert.equal(X.getInteraction({ ...card, choices }, { approach: 'play' }).type, 'recall',
      'Invalid or incomplete original choices must not be repaired by invented alternatives');
  }
  const sequence = { ...card, kind: 'sequence', answer: '起於中焦 → 下絡大腸 → 還循胃口', choices: undefined };
  assert.deepEqual(X.getInteraction(sequence, { approach: 'play' }),
    { type: 'sequence', fragments: ['起於中焦', '下絡大腸', '還循胃口'] });
  for (const answerText of ['한 조각', '첫째 → 첫째', '첫째 →  → 셋째',
    Array.from({ length: 9 }, (_, i) => `구절 ${i}`).join(' → ')]) {
    assert.equal(X.getInteraction({ ...sequence, answer: answerText }, { approach: 'play' }).type, 'recall');
  }
  assert.equal(X.getInteraction({ ...sequence, answer: '甲 → 乙' }, { approach: 'play' }).type, 'sequence');
  assert.equal(X.getInteraction({ ...sequence, answer: Array.from({ length: 8 }, (_, i) => `구절 ${i}`).join(' → ') }, { approach: 'play' }).type, 'sequence');
  assert.equal(X.getInteraction(sequence, { approach: 'play', boss: true }).type, 'recall');
});

test('world growth counts unique explicit recall, distinct dates, recognition and recovered errors separately', () => {
  const c = catalog(7);
  c.cards[6].needsVerification = true;
  c.cards.push({ ...c.cards[0] });
  let state = initial();
  state = answer(state, 'c0', 2, YESTERDAY, 'recall-1');
  state = answer(state, 'c0', 3, YESTERDAY, 'same-day-repeat');
  state = answer(state, 'c1', 2, YESTERDAY, 'choice-1', { evidence: 'choice', unaided: false });
  state = answer(state, 'c2', 0, YESTERDAY, 'old-failure');
  state = answer(state, 'c2', 2, YESTERDAY, 'same-day-fix');
  state = answer(state, 'c0', 2, TODAY, 'recall-2');
  state = answer(state, 'c1', 2, TODAY, 'choice-2', { evidence: 'choice', unaided: false });
  state = answer(state, 'c2', 2, TODAY, 'real-recovery');
  state = answer(state, 'c3', 3, TODAY, 'hinted', { usedHint: true });
  state = E.review(state, 'c4', 3, { today: TODAY, attemptId: 'legacy-self-grade' });
  state = answer(state, 'c6', 3, TODAY, 'excluded-source-conflict');
  const historical = state;
  state = answer(state, 'c5', 3, E.addDays(TODAY, 1), 'future-success');
  state.records.removed = { seen: true, correct: 99, mastered: true, history: [] };
  const world = X.getWorld(c, state, { today: TODAY });
  assert.equal(world.totals.total, 6);
  assert.equal(world.totals.introduced, 5);
  assert.equal(world.totals.recalled, 2);
  assert.equal(world.totals.connected, 1);
  assert.equal(world.totals.recovered, 1);
  assert.equal(world.totals.choiceConfirmed, 1);
  for (const key of ['total', 'introduced', 'recalled', 'connected', 'recovered', 'choiceConfirmed']) {
    assert.equal(world.topics.reduce((sum, topic) => sum + topic[key], 0), world.totals[key]);
  }
  const archiveDay = E.addDays(TODAY, 8);
  const archived = E.normalizeState(historical, c, archiveDay);
  assert.ok(archived.reversal.days[YESTERDAY].archive, 'This fixture must cross the detailed-proof archive boundary');
  assert.deepEqual(X.getWorld(c, archived, { today: archiveDay }).totals, world.totals,
    'Archiving detailed daily observations must preserve long-term world evidence in retained histories');
});

test('malformed, future, quarantined and legacy-only proof cannot fabricate world milestones', () => {
  const c = catalog(10);
  const good = { day: YESTERDAY, grade: 2, evidence: 'recall', unaided: true,
    usedHint: false, firstOfDay: true, attemptId: 'proof', reversalStatus: null };
  const invalid = [
    { ...good, grade: '2' }, { ...good, unaided: 'true' }, { ...good, firstOfDay: 'true' },
    { ...good, usedHint: true }, { ...good, evidence: 'self-grade' },
    { ...good, day: '2026-02-31' }, { ...good, day: E.addDays(TODAY, 1) },
    { day: YESTERDAY, grade: 3 }, { ...good, usedHint: undefined },
    { ...good, evidence: 'choice', unaided: true }
  ];
  const state = initial();
  invalid.forEach((event, i) => {
    state.records[`c${i}`] = { seen: true, attempts: 99, correct: 99, mastered: true,
      successDays: [E.addDays(TODAY, -3), YESTERDAY, TODAY], history: [{ ...event, attemptId: `invalid-${i}` }],
      quarantinedHistory: [{ ...good, day: TODAY, attemptId: `quarantine-${i}` }] };
  });
  const before = JSON.stringify(state);
  const world = X.getWorld(c, state, { today: TODAY });
  assert.equal(world.totals.recalled, 0);
  assert.equal(world.totals.connected, 0);
  assert.equal(world.totals.recovered, 0);
  assert.equal(world.totals.choiceConfirmed, 0);
  assert.equal(JSON.stringify(state), before);
});

test('today primary is finite and attempted failures remain honest unresolved repair work', () => {
  const c = catalog(6);
  let state = initial();
  const first = X.getDay(c, state, { today: TODAY });
  assert.equal(first.status, 'ready');
  assert.equal(first.remaining, 6);
  assert.equal(first.roomCount, 1);
  assert.equal(first.requiredRemaining, E.getPlan(c, state, TODAY).totalRemaining);
  const room = X.buildRoom(c, state, { today: TODAY, approach: 'play', phase: 'primary' });
  assert.equal(room.ids.length, 6);
  assert.equal(new Set(room.ids).size, 6);
  assert.equal(room.remainingAfter, 0);
  room.ids.forEach((id, i) => { state = answer(state, id, i === 0 ? 0 : 2, TODAY, `primary-${i}`); });
  const ended = X.getDay(c, state, { today: TODAY });
  assert.equal(ended.status, 'complete');
  assert.equal(ended.attempted, 6);
  assert.equal(ended.remaining, 0);
  assert.deepEqual(ended.remainingIds, []);
  assert.equal(ended.unresolved, 1);
  assert.equal(ended.requiredRemaining, E.getPlan(c, state, TODAY).totalRemaining);
  assert.ok(ended.requiredRemaining > 0, 'Finishing first attempts cannot claim the true plan is finished');
  assert.deepEqual(X.buildRoom(c, state, { today: TODAY, phase: 'primary' }).ids, []);
  const repair = X.buildRoom(c, state, { today: TODAY, phase: 'repair' });
  assert.deepEqual(repair.ids, [room.ids[0]]);
  state = answer(state, room.ids[0], 2, TODAY, 'repair-once');
  assert.equal(X.getDay(c, state, { today: TODAY }).unresolved, 0);
  assert.equal(X.getDay(c, state, { today: TODAY }).tomorrowRetestCount, 1);
  assert.deepEqual(X.buildRoom(c, state, { today: TODAY, phase: 'repair' }).ids, []);
});

test('room preference reorders within due/new groups while reservations lead and all cards remain planned', () => {
  const c = catalog(12);
  let state = initial();
  for (const id of ['c0', 'c2', 'c4']) state = answer(state, id, 2, YESTERDAY, `due-${id}`);
  state = E.reserveFirst(state, 'c2', { today: YESTERDAY, plannedTime: '09:00' });
  const planned = X.getDay(c, state, { today: TODAY }).remainingIds;
  const room = X.buildRoom(c, state, { today: TODAY, topic: 'point', approach: 'recall', phase: 'primary' });
  assert.equal(room.ids.length, 6);
  assert.equal(room.ids[0], 'c2');
  assert.equal(room.reservedFirstId, 'c2');
  assert.equal(room.topic, 'point');
  assert.equal(room.approach, 'recall');
  assert.equal(room.bossId, null);
  assert.deepEqual(new Set(room.ids.slice(0, 3)), new Set(['c0', 'c2', 'c4']));
  assert.equal(c.cards.find(card => card.id === room.ids[3]).topic, 'point');
  assert.equal(new Set(room.ids).size, room.ids.length);
  assert.ok(room.ids.every(id => planned.includes(id)));
  assert.equal(room.remainingAfter, planned.length - room.ids.length);
});

test('only an unresolved earlier failure already in the room becomes a boss and reservation wins its position', () => {
  const c = catalog(8);
  let state = initial();
  state = answer(state, 'c0', 0, YESTERDAY, 'boss-failed');
  let room = X.buildRoom(c, state, { today: TODAY, phase: 'primary', approach: 'play' });
  assert.equal(room.bossId, 'c0');
  assert.equal(room.ids.at(-1), 'c0');
  assert.equal(new Set(room.ids).size, room.ids.length);
  const plannedBefore = new Set(X.getDay(c, state, { today: TODAY }).remainingIds);
  assert.ok(room.ids.every(id => plannedBefore.has(id)));
  state = E.reserveFirst(state, 'c0', { today: YESTERDAY });
  room = X.buildRoom(c, state, { today: TODAY, phase: 'primary' });
  assert.equal(room.bossId, 'c0');
  assert.equal(room.reservedFirstId, 'c0');
  assert.equal(room.ids[0], 'c0', 'A promised first question cannot be moved to the final battle');
  state = answer(state, 'c0', 2, TODAY, 'boss-recovered');
  const later = E.addDays(TODAY, 3);
  state.settings.examDate = E.addDays(later, 1);
  room = X.buildRoom(c, state, { today: later, phase: 'primary' });
  assert.equal(room.bossId, null, 'An already recovered error is an ordinary scheduled review');
});

test('boss decoration cannot import an unplanned card or promote a legacy error total to a proved failure', () => {
  const c = catalog(10);
  let state = initial();
  for (let i = 0; i < 7; i++) state = answer(state, `c${i}`, 2, YESTERDAY, `ordinary-${i}`);
  // This real error remains due, but falls outside a six-card due prefix.
  state = answer(state, 'c9', 0, YESTERDAY, 'not-in-first-six');
  const day = X.getDay(c, state, { today: TODAY });
  const chosenPrefix = day.remainingIds.slice(0, 6);
  const room = X.buildRoom(c, state, { today: TODAY, phase: 'primary' });
  assert.deepEqual(new Set(room.ids), new Set(chosenPrefix), 'A boss must be selected after the room set is fixed');
  if (!chosenPrefix.includes('c9')) assert.equal(room.bossId, null);
  const legacy = initial();
  legacy.records.c0 = { seen: true, attempts: 50, lapses: 50, lastReviewed: YESTERDAY,
    lastGrade: 0, due: TODAY, successDays: [] };
  assert.equal(X.buildRoom(c, legacy, { today: TODAY, phase: 'primary' }).bossId, null);
  const mandatory = catalog(1);
  mandatory.cards[0].requiresChoices = true;
  const mandatoryFailure = answer(initial(), 'c0', 0, YESTERDAY, 'required-choice-failed',
    { evidence: 'choice', unaided: false });
  const mandatoryRoom = X.buildRoom(mandatory, mandatoryFailure, { today: TODAY, phase: 'primary' });
  assert.deepEqual(mandatoryRoom.ids, ['c0']);
  assert.equal(mandatoryRoom.bossId, null, 'A mandatory-choice stem remains ordinary work, never an unbreakable recall boss');
});

test('outcomes award first recall, distinct-day connection and recognition only at genuine unique milestones', () => {
  const card = catalog(1).cards[0];
  let before = initial(), after = answer(before, card.id, 2, YESTERDAY, 'first');
  let outcome = X.classifyOutcome(card, before, after, { today: YESTERDAY, attemptId: 'first', choiceValue: null });
  assert.equal(outcome.kind, 'first-recall');
  assert.equal(outcome.source, 'self-recall');
  assert.equal(outcome.advancesMemory, true);
  assert.equal(outcome.advancesChoice, false);
  before = after; after = answer(before, card.id, 3, YESTERDAY, 'again');
  outcome = X.classifyOutcome(card, before, after, { today: YESTERDAY, attemptId: 'again', choiceValue: null });
  assert.equal(outcome.kind, 'practice'); noGrowth(outcome);
  before = after; after = answer(before, card.id, 2, TODAY, 'connected');
  outcome = X.classifyOutcome(card, before, after, { today: TODAY, attemptId: 'connected', choiceValue: null });
  assert.equal(outcome.kind, 'connected');
  assert.equal(outcome.advancesMemory, true);
  before = after; after = answer(before, card.id, 2, E.addDays(TODAY, 1), 'third-date');
  outcome = X.classifyOutcome(card, before, after, { today: E.addDays(TODAY, 1), attemptId: 'third-date', choiceValue: null });
  assert.equal(outcome.kind, 'practice'); noGrowth(outcome);
  before = initial(); after = answer(before, card.id, 2, TODAY, 'recognized', { evidence: 'choice', unaided: false });
  outcome = X.classifyOutcome(card, before, after, { today: TODAY, attemptId: 'recognized', choiceValue: card.answer });
  assert.equal(outcome.kind, 'first-choice');
  assert.equal(outcome.source, 'choice');
  assert.equal(outcome.advancesMemory, false);
  assert.equal(outcome.advancesChoice, true);
  assert.equal(outcome.breaksBoss, false);
});

test('same-day correction and assistance do not break a boss; only delayed unaided recovery does', () => {
  const card = catalog(1).cards[0];
  let before = initial(), after = answer(before, card.id, 0, YESTERDAY, 'miss');
  let outcome = X.classifyOutcome(card, before, after, { today: YESTERDAY, attemptId: 'miss', choiceValue: null });
  assert.equal(outcome.kind, 'miss'); noGrowth(outcome);
  before = after; after = answer(before, card.id, 2, YESTERDAY, 'corrected');
  outcome = X.classifyOutcome(card, before, after, { today: YESTERDAY, attemptId: 'corrected', choiceValue: null });
  assert.equal(outcome.kind, 'corrected'); noGrowth(outcome);
  const failed = after;
  before = failed; after = answer(before, card.id, 3, TODAY, 'hinted-recovery', { usedHint: true });
  outcome = X.classifyOutcome(card, before, after, { today: TODAY, attemptId: 'hinted-recovery', choiceValue: card.answer });
  assert.equal(outcome.kind, 'assisted'); noGrowth(outcome);
  before = failed; after = answer(before, card.id, 2, TODAY, 'recognized-recovery', { evidence: 'choice', unaided: false });
  outcome = X.classifyOutcome(card, before, after, { today: TODAY, attemptId: 'recognized-recovery', choiceValue: card.answer });
  assert.equal(outcome.breaksBoss, false);
  assert.equal(outcome.advancesMemory, false);
  before = failed; after = answer(before, card.id, 2, TODAY, 'recovered');
  outcome = X.classifyOutcome(card, before, after, { today: TODAY, attemptId: 'recovered', choiceValue: null });
  assert.equal(outcome.kind, 'recovered');
  assert.equal(outcome.breaksBoss, true);
  assert.equal(outcome.advancesMemory, true);
});

test('duplicate, wrong objective values and unrelated or fabricated result claims never advance a world', () => {
  const card = catalog(1).cards[0], before = initial();
  const after = answer(before, card.id, 2, TODAY, 'objective', { evidence: 'choice', unaided: false });
  noGrowth(X.classifyOutcome(card, before, after, { today: TODAY, attemptId: 'objective', choiceValue: '원문 오답 0' }));
  noGrowth(X.classifyOutcome(card, before, after, { today: TODAY, attemptId: 'not-the-event', choiceValue: card.answer }));
  noGrowth(X.classifyOutcome({ ...card, id: 'other-card' }, before, after,
    { today: TODAY, attemptId: 'objective', choiceValue: card.answer }));
  const duplicate = answer(after, card.id, 3, TODAY, 'objective', { evidence: 'choice', unaided: false });
  const outcome = X.classifyOutcome(card, after, duplicate, { today: TODAY, attemptId: 'objective', choiceValue: card.answer });
  assert.equal(outcome.kind, 'duplicate'); noGrowth(outcome);
  const invented = json(before);
  invented.lastReview = { cardId: card.id, attemptId: 'invented', today: TODAY, grade: 3,
    passed: true, firstOfDay: true, unaided: true, reversalStatus: 'recovered' };
  noGrowth(X.classifyOutcome(card, before, invented, { today: TODAY, attemptId: 'invented', choiceValue: null }));
  const sequence = { ...card, kind: 'sequence', answer: '甲 → 乙 → 丙' };
  const order = answer(before, card.id, 2, TODAY, 'sequence', { evidence: 'choice', unaided: false });
  assert.equal(X.classifyOutcome(sequence, before, order,
    { today: TODAY, attemptId: 'sequence', choiceValue: sequence.answer }).kind, 'first-choice');
  noGrowth(X.classifyOutcome(sequence, before, order,
    { today: TODAY, attemptId: 'sequence', choiceValue: '丙 → 乙 → 甲' }));
});

test('empty and exam-day routes never silently substitute extra mock work', () => {
  const empty = catalog(0), state = initial();
  assert.equal(X.getDay(empty, state, { today: TODAY }).status, 'complete');
  assert.deepEqual(X.buildRoom(empty, state, { today: TODAY, phase: 'primary' }).ids, []);
  const c = catalog(3), examDay = state.settings.examDate;
  assert.equal(X.getDay(c, state, { today: examDay }).status, 'after-exam');
  assert.deepEqual(X.buildRoom(c, state, { today: examDay, phase: 'primary' }).ids, []);
  assert.deepEqual(X.buildRoom(c, state, { today: E.addDays(examDay, 1), phase: 'primary' }).ids, []);
});

test('all expedition reads preserve source content, legacy fields and immutable inputs', () => {
  const c = catalog(6);
  let state = initial();
  state.unknownFeature = { original: 'keep' };
  state.expedition = { version: 1, approach: 'play', sound: false, unknown: { keep: true } };
  state = answer(state, 'c0', 0, YESTERDAY, 'failure');
  const before = JSON.stringify(state), source = JSON.stringify(c);
  frozen(c); frozen(state);
  X.getWorld(c, state, { today: TODAY });
  X.getDay(c, state, { today: TODAY });
  X.buildRoom(c, state, { today: TODAY, phase: 'primary', approach: 'play' });
  X.getInteraction(c.cards[0], { approach: 'play' });
  assert.equal(JSON.stringify(state), before);
  assert.equal(JSON.stringify(c), source);
  assert.deepEqual(json(X.getWorld(c, json(state), { today: TODAY })), json(X.getWorld(c, state, { today: TODAY })));
});
