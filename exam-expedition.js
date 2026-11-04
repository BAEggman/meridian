/* Meridian expedition: a finite game view of real study evidence.
 * Pure queries only. Scheduling, answers and persistence stay with the exam engine.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./exam-engine.js'));
  else root.MeridianExpedition = factory(root.MeridianExamEngine);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  if (!E || typeof E.normalizeState !== 'function') throw new Error('MeridianExamEngine must load before MeridianExpedition');

  var ROOM_SIZE = 6;
  var METRICS = ['total', 'introduced', 'recalled', 'connected', 'recovered', 'choiceConfirmed'];

  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function todayFor(options) { return options && E.isValidDay(options.today) ? options.today : E.localDay(); }
  function validAttempt(value) { return typeof value === 'string' && value.length > 0 && value.length <= 240; }
  function validGrade(value) { return Number.isInteger(value) && value >= 0 && value <= 3; }
  function validHistory(event, today) {
    return object(event) && E.isValidDay(event.day) && event.day <= today && validGrade(event.grade);
  }
  function cardsFrom(catalog) {
    var cards = Array.isArray(catalog) ? catalog : (catalog && Array.isArray(catalog.cards) ? catalog.cards : []);
    var seen = new Set();
    return cards.filter(function (card) {
      if (!object(card) || typeof card.id !== 'string' || !card.id || seen.has(card.id)) return false;
      seen.add(card.id);
      return card.needsVerification !== true;
    });
  }
  function recordFor(state, id) {
    return object(state) && object(state.records) && own(state.records, id) && object(state.records[id]) ? state.records[id] : {};
  }
  function supportedProof(state) {
    return object(state) && (state.version === undefined || state.version === 1) &&
      (!object(state.reversal) || state.reversal.featureVersion === undefined || state.reversal.featureVersion === 1);
  }
  function explicitEvidence(event, today) {
    if (!validHistory(event, today) || typeof event.firstOfDay !== 'boolean' ||
        typeof event.unaided !== 'boolean' || typeof event.usedHint !== 'boolean') return false;
    if (event.attemptId !== undefined && event.attemptId !== null && !validAttempt(event.attemptId)) return false;
    if (event.delayedDays !== undefined && event.delayedDays !== null &&
        (!Number.isInteger(event.delayedDays) || event.delayedDays <= 0)) return false;
    if (event.reversalStatus !== undefined && event.reversalStatus !== null &&
        ['queued', 'corrected', 'recovered'].indexOf(event.reversalStatus) < 0) return false;
    if (event.evidence === 'recall') return !event.unaided || !event.usedHint;
    return event.evidence === 'choice' && event.unaided === false && event.reversalStatus !== 'recovered';
  }
  function introduced(record, today) {
    if (record.seen !== true) return false;
    if ((E.isValidDay(record.firstSeen) && record.firstSeen <= today) ||
        (E.isValidDay(record.lastReviewed) && record.lastReviewed <= today) ||
        (Array.isArray(record.history) && record.history.some(function (event) { return validHistory(event, today); })) ||
        (Array.isArray(record.successDays) && record.successDays.some(function (day) { return E.isValidDay(day) && day <= today; }))) return true;
    // Existing imported/seen-only records still mean "encountered". A future-only
    // record does not introduce a card into today's collection after quarantine.
    return !(E.isValidDay(record.firstSeen) && record.firstSeen > today) &&
      !(Array.isArray(record.quarantinedHistory) && record.quarantinedHistory.length) &&
      !(Array.isArray(record.quarantinedSuccessDays) && record.quarantinedSuccessDays.length) &&
      !record.quarantinedLastReviewed;
  }
  function firstMatches(state, id, event) {
    var days = object(state.reversal) && object(state.reversal.days) ? state.reversal.days : {};
    var day = object(days[event.day]) ? days[event.day] : {};
    var first = object(day.first) && own(day.first, id) ? day.first[id] : null;
    // Older detailed daily observations are archived; the original history is
    // retained. When both proofs remain, disagreement must not create growth.
    if (!first) return true;
    return object(first) && first.grade === event.grade && first.evidence === event.evidence &&
      first.attemptId === event.attemptId && first.usedHint === false &&
      first.unaided === event.unaided && first.earlierExposure === false;
  }
  function cardProgress(state, id, today, allowProof, usedAttempts) {
    var record = recordFor(state, id);
    var result = { introduced: introduced(record, today), recalled: false, connected: false,
      recovered: false, choiceConfirmed: false, proofEvents: [] };
    if (!allowProof) return result;
    var dates = new Set(), recallDates = new Set(), attempts = usedAttempts || new Set();
    var failureDay = null;
    var history = Array.isArray(record.history) ? record.history : [];
    history.forEach(function (event) {
      if (!validHistory(event, today)) return;
      var firstOnDate = !dates.has(event.day);
      dates.add(event.day);
      var repeated = validAttempt(event.attemptId) && attempts.has(event.attemptId);
      if (validAttempt(event.attemptId)) attempts.add(event.attemptId);
      var previousFailure = failureDay;
      if (event.grade < 2 && (!failureDay || event.day > failureDay)) failureDay = event.day;
      if (repeated || !firstOnDate || !explicitEvidence(event, today) || event.grade < 2 ||
          !event.firstOfDay || event.usedHint || event.reversalStatus === 'corrected' || !firstMatches(state, id, event)) return;
      var recall = event.evidence === 'recall' && event.unaided;
      var choice = event.evidence === 'choice' && !event.unaided;
      var recovered = recall && event.reversalStatus === 'recovered' &&
        previousFailure !== null && previousFailure < event.day &&
        event.lastRecoveredDay === event.day;
      if (recall) recallDates.add(event.day);
      if (choice) result.choiceConfirmed = true;
      if (recovered) result.recovered = true;
      if (recall || choice) result.proofEvents.push({ event: event, recall: recall, choice: choice, recovered: !!recovered });
    });
    result.recalled = recallDates.size > 0;
    result.connected = recallDates.size > 1;
    return result;
  }
  function emptyCounts() {
    return { total: 0, introduced: 0, recalled: 0, connected: 0, recovered: 0, choiceConfirmed: 0 };
  }
  function getWorld(catalog, rawState, options) {
    var today = todayFor(options), state = E.normalizeState(rawState, catalog, today), cards = cardsFrom(catalog);
    var topics = [], byTopic = Object.create(null), totals = emptyCounts(), usedAttempts = new Set();
    function addTopic(id, label) {
      if (own(byTopic, id)) return byTopic[id];
      var row = Object.assign({ id: id, label: label }, emptyCounts());
      byTopic[id] = row; topics.push(row); return row;
    }
    if (catalog && Array.isArray(catalog.topics)) catalog.topics.forEach(function (topic) {
      if (typeof topic === 'string' && topic) addTopic(topic, topic);
      else if (object(topic) && typeof topic.id === 'string' && topic.id) {
        addTopic(topic.id, typeof topic.label === 'string' ? topic.label : (typeof topic.title === 'string' ? topic.title : topic.id));
      }
    });
    var allowProof = supportedProof(rawState);
    cards.forEach(function (card) {
      var id = typeof card.topic === 'string' && card.topic ? card.topic : 'other';
      var row = own(byTopic, id) ? byTopic[id] : addTopic(id, id);
      var progress = cardProgress(state, card.id, today, allowProof, usedAttempts);
      METRICS.forEach(function (key) {
        var count = key === 'total' ? 1 : (progress[key] ? 1 : 0);
        row[key] += count; totals[key] += count;
      });
    });
    return { topics: topics, totals: totals };
  }

  function dayContext(catalog, rawState, options) {
    var today = todayFor(options), state = E.normalizeState(rawState, catalog, today);
    var cards = cardsFrom(catalog), validIds = new Set(cards.map(function (card) { return card.id; }));
    var plan = E.getPlan(catalog, state, today), answered = new Set();
    var entry = object(state.days[today]) ? state.days[today] : {};
    if (Array.isArray(entry.reviewedIds)) entry.reviewedIds.forEach(function (id) { if (validIds.has(id)) answered.add(id); });
    var first = object(state.reversal.days[today]) && object(state.reversal.days[today].first) ? state.reversal.days[today].first : {};
    cards.forEach(function (card) {
      var record = recordFor(state, card.id);
      if (record.lastReviewed === today || own(first, card.id) ||
          (Array.isArray(record.history) && record.history.some(function (event) { return validHistory(event, today) && event.day === today; }))) answered.add(card.id);
    });
    var due = plan.dueCards.filter(function (card) { return !answered.has(card.id); });
    var fresh = plan.newCards.filter(function (card) { return !answered.has(card.id); });
    var repairs = plan.dueCards.filter(function (card) { return answered.has(card.id); });
    var tomorrow = E.addDays(today, 1), tomorrowRetestCount = 0;
    cards.forEach(function (card) {
      var record = recordFor(state, card.id), reversal = object(record.reversal) ? record.reversal : {};
      if (record.seen && record.attempts > 0 && tomorrow && E.isValidDay(reversal.retestDue) && reversal.retestDue <= tomorrow) tomorrowRetestCount += 1;
    });
    return { today: today, state: state, cards: cards, plan: plan, answered: answered,
      due: due, fresh: fresh, repairs: repairs, tomorrowRetestCount: tomorrowRetestCount };
  }
  function getDay(catalog, state, options) {
    var context = dayContext(catalog, state, options);
    var remainingIds = context.plan.studyDeadlinePassed ? [] : context.due.concat(context.fresh).map(function (card) { return card.id; });
    return { status: context.plan.studyDeadlinePassed ? 'after-exam' : (remainingIds.length ? 'ready' : 'complete'),
      remainingIds: remainingIds, attempted: context.answered.size, remaining: remainingIds.length,
      roomCount: Math.ceil(remainingIds.length / ROOM_SIZE), unresolved: context.repairs.length,
      tomorrowRetestCount: context.tomorrowRetestCount, requiredRemaining: context.plan.requiredRemaining };
  }
  function preferTopic(cards, topic) {
    if (!topic) return cards.slice();
    return cards.filter(function (card) { return card.topic === topic; }).concat(cards.filter(function (card) { return card.topic !== topic; }));
  }
  function pendingReservation(context) {
    var reservation = context.state.reversal.reservation;
    if (!object(reservation) || !E.isValidDay(reservation.day) || reservation.day > context.today) return null;
    var record = recordFor(context.state, reservation.cardId);
    return record.seen && (!record.lastReviewed || record.lastReviewed < reservation.day) ? reservation.cardId : null;
  }
  function isBoss(card, state, today) {
    if (card.requiresChoices === true) return false;
    var record = recordFor(state, card.id), reversal = object(record.reversal) ? record.reversal : {};
    if (!record.seen || (!E.isValidDay(reversal.retestDue) && !(validGrade(record.lastGrade) && record.lastGrade < 2))) return false;
    var failure = null, recovered = null;
    (Array.isArray(record.history) ? record.history : []).forEach(function (event) {
      if (!validHistory(event, today)) return;
      if (event.grade < 2 && (!failure || event.day > failure)) failure = event.day;
      if (explicitEvidence(event, today) && event.firstOfDay && event.unaided && !event.usedHint &&
          event.evidence === 'recall' && event.grade >= 2 && event.reversalStatus === 'recovered' &&
          event.lastRecoveredDay === event.day && (!recovered || event.day > recovered)) recovered = event.day;
    });
    return failure !== null && failure < today && (!recovered || recovered < failure);
  }
  function buildRoom(catalog, rawState, options) {
    options = options || {};
    var context = dayContext(catalog, rawState, options), topic = typeof options.topic === 'string' && options.topic ? options.topic : null;
    var approach = options.approach === 'recall' ? 'recall' : 'play', phase = options.phase === 'repair' ? 'repair' : 'primary';
    var candidates = phase === 'repair' ? preferTopic(context.repairs, topic) :
      (context.plan.studyDeadlinePassed ? [] : preferTopic(context.due, topic).concat(preferTopic(context.fresh, topic)));
    var seen = new Set();
    candidates = candidates.filter(function (card) { if (seen.has(card.id)) return false; seen.add(card.id); return true; });
    var reserved = pendingReservation(context), reservedCard = candidates.find(function (card) { return card.id === reserved; });
    if (reservedCard) candidates = [reservedCard].concat(candidates.filter(function (card) { return card.id !== reserved; }));
    else reserved = null;
    // Fix the room's set before decorating it. A boss never displaces scheduled
    // work, extends a room, or appears solely because an old lapse total is high.
    var selected = candidates.slice(0, ROOM_SIZE), boss = selected.find(function (card) { return isBoss(card, context.state, context.today); });
    if (boss && boss.id !== reserved) selected = selected.filter(function (card) { return card.id !== boss.id; }).concat([boss]);
    return { ids: selected.map(function (card) { return card.id; }), bossId: boss ? boss.id : null,
      reservedFirstId: reserved, topic: topic, approach: approach, phase: phase,
      remainingAfter: Math.max(0, candidates.length - selected.length) };
  }

  function validChoices(card) {
    if (!object(card) || typeof card.answer !== 'string' || !card.answer.trim() || !Array.isArray(card.choices) || card.choices.length < 2) return false;
    return card.choices.every(function (choice) { return typeof choice === 'string' && choice.trim().length > 0; }) &&
      new Set(card.choices).size === card.choices.length && card.choices.indexOf(card.answer) >= 0;
  }
  function sequenceFragments(card) {
    if (!object(card) || card.kind !== 'sequence' || typeof card.answer !== 'string') return null;
    var fragments = card.answer.split(' → ');
    if (fragments.length < 2 || fragments.length > 8 || fragments.some(function (fragment) { return !fragment.trim(); }) ||
        new Set(fragments).size !== fragments.length) return null;
    return fragments;
  }
  function getInteraction(card, options) {
    options = options || {};
    if (object(card) && card.requiresChoices === true && validChoices(card)) return { type: 'choice', choices: card.choices.slice() };
    if (options.approach === 'recall' || options.boss === true) return { type: 'recall' };
    if (validChoices(card)) return { type: 'choice', choices: card.choices.slice() };
    var fragments = sequenceFragments(card);
    return fragments ? { type: 'sequence', fragments: fragments } : { type: 'recall' };
  }

  function outcome(kind, source, memory, choice, boss) {
    return { kind: kind, advancesMemory: !!memory, advancesChoice: !!choice, breaksBoss: !!boss, source: source };
  }
  function hasAttempt(state, attemptId) {
    if (!object(state) || !object(state.records)) return false;
    return Object.keys(state.records).some(function (id) {
      var record = recordFor(state, id);
      return ['history', 'quarantinedHistory'].some(function (key) {
        return Array.isArray(record[key]) && record[key].some(function (event) { return object(event) && event.attemptId === attemptId; });
      });
    });
  }
  function classifyOutcome(card, beforeState, afterState, options) {
    options = options || {};
    var today = todayFor(options), last = object(afterState) && object(afterState.lastReview) ? afterState.lastReview : null;
    var none = outcome('practice', 'none');
    if (!object(card) || typeof card.id !== 'string' || !card.id || card.needsVerification === true ||
        !validAttempt(options.attemptId) || !last || last.cardId !== card.id || last.attemptId !== options.attemptId) return none;
    if (last.duplicate === true || hasAttempt(beforeState, options.attemptId)) return outcome('duplicate', 'none');
    if (last.today !== today || last.duplicate !== false || !supportedProof(afterState)) return none;
    var before = E.normalizeState(beforeState, null, today), after = E.normalizeState(afterState, null, today);
    var history = recordFor(after, card.id).history;
    var event = Array.isArray(history) ? history.find(function (entry) {
      return object(entry) && entry.day === today && entry.attemptId === options.attemptId;
    }) : null;
    if (!explicitEvidence(event, today) || event.grade !== last.grade || event.firstOfDay !== last.firstOfDay ||
        event.unaided !== last.unaided || event.reversalStatus !== last.reversalStatus ||
        last.passed !== (event.grade >= 2)) return none;
    var source = event.usedHint ? 'assisted' : (event.evidence === 'choice' ? 'choice' : (event.unaided ? 'self-recall' : 'assisted'));
    if (event.usedHint) return outcome('assisted', 'assisted');
    if (event.grade < 2) return outcome('miss', source);
    if (event.evidence === 'choice' && (typeof options.choiceValue !== 'string' || options.choiceValue !== card.answer)) return outcome('miss', source);
    if (event.reversalStatus === 'corrected') return outcome('corrected', source);
    var prior = cardProgress(before, card.id, today, supportedProof(beforeState));
    var current = cardProgress(after, card.id, today, true);
    var proof = current.proofEvents.find(function (item) { return item.event.attemptId === options.attemptId && item.event.day === today; });
    if (!proof) return outcome('practice', source);
    var memory = (!prior.recalled && current.recalled) || (!prior.connected && current.connected) || (!prior.recovered && current.recovered);
    if (proof.recovered) return outcome('recovered', source, memory, false, true);
    if (proof.recall && !prior.recalled && current.recalled) return outcome('first-recall', source, true);
    if (proof.recall && !prior.connected && current.connected) return outcome('connected', source, true);
    if (proof.choice && !prior.choiceConfirmed && current.choiceConfirmed) return outcome('first-choice', source, false, true);
    return outcome('practice', source);
  }

  return { version: 1, getWorld: getWorld, getDay: getDay, buildRoom: buildRoom,
    getInteraction: getInteraction, classifyOutcome: classifyOutcome };
}));
