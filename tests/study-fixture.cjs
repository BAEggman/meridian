'use strict';

// Generate a realistic full-catalog fixture without repeatedly copying every
// other card on each answer. Each answer still executes the real exposure and
// review APIs; daily plans are checked against the actual SRS forecast.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Engine = require('../exam-engine.js');

function loadCatalog() {
  const scope = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../exam-catalog.js'), 'utf8'), scope);
  return scope.window.MERIDIAN_EXAM_CATALOG;
}

function mergeCardResult(total, result, id) {
  total.records[id] = result.records[id];
  for (const [day, entry] of Object.entries(result.days)) {
    if (!total.days[day]) total.days[day] = {
      reviews: 0, correct: 0, lapses: 0, seconds: 0, timedReviews: 0,
      reviewedIds: [], newIds: [], dueIds: []
    };
    for (const key of ['reviews', 'correct', 'lapses', 'seconds', 'timedReviews']) total.days[day][key] += entry[key];
    for (const key of ['reviewedIds', 'newIds', 'dueIds']) total.days[day][key].push(...entry[key]);
  }
  for (const [day, entry] of Object.entries(result.reversal.days)) {
    if (!total.reversal.days[day]) total.reversal.days[day] = {
      ...entry, first: {}, exposures: {}, correctedIds: [], recoveredIds: []
    };
    Object.assign(total.reversal.days[day].first, entry.first);
    Object.assign(total.reversal.days[day].exposures, entry.exposures);
    total.reversal.days[day].correctedIds.push(...entry.correctedIds);
    total.reversal.days[day].recoveredIds.push(...entry.recoveredIds);
  }
  Object.assign(total.reversal.eventIds, result.reversal.eventIds);
  total.lastReview = result.lastReview;
  total.lastActiveDay = result.lastActiveDay;
}

function createScheduledStudyFixture() {
  const catalog = loadCatalog(), firstDay = '2026-11-03', lastDay = '2026-12-31';
  const dayCount = 59, originalAnswer = '핵심을 스스로 떠올린 짧은 답안';
  let state = Engine.createState(firstDay), responses = 0;
  const forecast = Engine.forecast(catalog, state, { today: firstDay, days: dayCount });
  for (let offset = 0; offset < dayCount; offset++) {
    const day = Engine.addDays(firstDay, offset);
    state = Engine.normalizeState(state, catalog, day);
    const plan = Engine.getPlan(catalog, state, day), expected = forecast.days[offset];
    assert.equal(plan.newRemaining, expected.new, `${day}: new count must match the all-correct forecast`);
    assert.equal(plan.dueCount, expected.review, `${day}: review count must match the all-correct forecast`);
    for (const card of plan.dueCards.concat(plan.newCards)) {
      const attemptId = `${card.id}:scheduled:${day}`;
      let isolated = Engine.createState(day);
      isolated.settings = { ...state.settings };
      if (state.records[card.id]) isolated.records[card.id] = state.records[card.id];
      isolated = Engine.recordExposure(isolated, card.id, { today: day, attemptId });
      isolated = Engine.review(isolated, card.id, 2, {
        today: day, attemptId, evidence: 'recall', unaided: true,
        usedHint: false, originalAnswer, seconds: 20
      });
      mergeCardResult(state, isolated, card.id);
      responses++;
    }
  }
  state = Engine.normalizeState(state, catalog, lastDay);
  assert.equal(responses, Object.values(state.days).reduce((n, entry) => n + entry.reviews, 0));
  assert.equal(responses, Object.values(state.records).reduce((n, record) => n + record.history.length, 0));
  assert.equal(Object.keys(state.records).length, 1198);
  assert.equal(responses, 6244);
  return { state, catalog, firstDay, lastDay, dayCount, responses, answerCharacters: originalAnswer.length };
}

module.exports = { createScheduledStudyFixture };
