/* Meridian deadline study engine. No DOM, storage, network, or dependencies. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MeridianExamEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 1;
  var DAY_MS = 86400000;
  var KST_MS = 9 * 3600000;
  var DEFAULTS = { examDate: '2027-01-01', dailyMinutes: 60, reserveDays: 14 };
  var INTERVALS = [1, 3, 7, 14, 30];
  var DEFAULT_CARD_SECONDS = 45;
  var ESTIMATE_PRIOR_REVIEWS = 20;

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }
  function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function dictionary() { return Object.create(null); }
  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!object(value)) return value;
    var result = dictionary();
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }
  function number(value, fallback) {
    var n = Number(value);
    return value !== null && value !== '' && Number.isFinite(n) ? n : fallback;
  }
  function nonnegative(value, fallback) {
    return Math.max(0, number(value, fallback === undefined ? 0 : fallback));
  }
  function integer(value, fallback) {
    return Math.floor(nonnegative(value, fallback));
  }
  function unique(values) { return Array.from(new Set(values)); }
  function round(value, places) {
    var factor = Math.pow(10, places || 0);
    return Math.round(value * factor) / factor;
  }
  function stableHash(value) {
    var n = 2166136261;
    for (var i = 0; i < value.length; i += 1) { n ^= value.charCodeAt(i); n = Math.imul(n, 16777619); }
    return n >>> 0;
  }

  function dayTimestamp(day) {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
    var year = Number(day.slice(0, 4));
    var month = Number(day.slice(5, 7));
    var date = Number(day.slice(8, 10));
    if (year < 1 || month < 1 || month > 12 || date < 1 || date > 31) return NaN;
    var candidate = new Date(0);
    candidate.setUTCFullYear(year, month - 1, date);
    candidate.setUTCHours(0, 0, 0, 0);
    if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== date) return NaN;
    return candidate.getTime();
  }
  function validDay(day) { return Number.isFinite(dayTimestamp(day)); }
  function localDay(value) {
    if (validDay(value)) return value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    if (value === null) return null;
    var date = value === undefined ? new Date() : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return new Date(date.getTime() + KST_MS).toISOString().slice(0, 10);
  }
  function todayOrDefault(day) { return validDay(day) ? day : localDay(); }
  function dayDiff(from, to) {
    var a = dayTimestamp(from);
    var b = dayTimestamp(to);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / DAY_MS) : NaN;
  }
  function addDays(day, amount) {
    var timestamp = dayTimestamp(day);
    if (!Number.isFinite(timestamp) || !Number.isFinite(amount)) return null;
    var result = new Date(timestamp + Math.trunc(amount) * DAY_MS);
    var year = result.getUTCFullYear();
    return year >= 1 && year <= 9999 ? result.toISOString().slice(0, 10) : null;
  }

  function createState(today) {
    return {
      version: VERSION,
      settings: Object.assign({}, DEFAULTS),
      records: dictionary(),
      days: dictionary(),
      createdDay: todayOrDefault(today),
      lastActiveDay: null,
      lastReview: null
    };
  }

  function newRecord() {
    return {
      seen: false,
      imported: false,
      firstSeen: null,
      lastReviewed: null,
      lastReviewedAt: null,
      due: null,
      lastGrade: null,
      attempts: 0,
      correct: 0,
      lapses: 0,
      seconds: 0,
      timedAttempts: 0,
      successDays: [],
      stage: 0,
      mastered: false,
      examReviewedFor: null,
      lastEvidence: null,
      historyBase: null,
      history: []
    };
  }
  function newDay() {
    return {
      reviews: 0,
      correct: 0,
      lapses: 0,
      seconds: 0,
      timedReviews: 0,
      reviewedIds: [],
      newIds: [],
      dueIds: []
    };
  }
  function validIds(values) {
    return Array.isArray(values) ? unique(values.filter(function (id) {
      return typeof id === 'string' && id.length > 0;
    })) : [];
  }
  function successDays(record, today) {
    return (Array.isArray(record.successDays) ? record.successDays : [])
      .filter(function (day) { return validDay(day) && day <= today; });
  }
  function preserveRecovery(state, section, key, value) {
    if (!object(state._recovery)) state._recovery = dictionary();
    if (!object(state._recovery[section])) state._recovery[section] = dictionary();
    if (!own(state._recovery[section], key)) state._recovery[section][key] = clone(value);
  }
  function normalizeRecord(raw, today) {
    var record = Object.assign(newRecord(), object(raw) ? clone(raw) : {});
    var invalidFields = object(record.invalidFields) ? record.invalidFields : dictionary();
    if (object(raw)) {
      ['firstSeen', 'lastReviewed', 'due'].forEach(function (key) {
        if (raw[key] !== undefined && raw[key] !== null && !validDay(raw[key])) invalidFields[key] = clone(raw[key]);
      });
      ['attempts', 'correct', 'lapses', 'seconds', 'timedAttempts'].forEach(function (key) {
        if (raw[key] !== undefined && (!Number.isFinite(number(raw[key], NaN)) || number(raw[key], 0) < 0)) invalidFields[key] = clone(raw[key]);
      });
      if (raw.successDays !== undefined && !Array.isArray(raw.successDays)) invalidFields.successDays = clone(raw.successDays);
      if (raw.lastGrade !== undefined && raw.lastGrade !== null && (!Number.isInteger(raw.lastGrade) || raw.lastGrade < 0 || raw.lastGrade > 3)) invalidFields.lastGrade = clone(raw.lastGrade);
    }
    if (Object.keys(invalidFields).length) record.invalidFields = invalidFields;
    var rawSuccessDays = Array.isArray(record.successDays) ? record.successDays : [];
    var invalidDays = rawSuccessDays.filter(function (day) { return !validDay(day); });
    if (invalidDays.length) record.invalidSuccessDays = (Array.isArray(record.invalidSuccessDays) ? record.invalidSuccessDays : []).concat(invalidDays);
    record.successDays = unique(rawSuccessDays.filter(validDay)).sort();
    record.attempts = integer(record.attempts);
    record.correct = integer(record.correct);
    record.lapses = integer(record.lapses);
    record.attempts = Math.max(record.attempts, record.correct + record.lapses);
    record.seconds = nonnegative(record.seconds);
    record.timedAttempts = Math.min(record.attempts, integer(object(raw) ? raw.timedAttempts : undefined,
      record.seconds > 0 ? record.attempts : 0));
    record.firstSeen = validDay(record.firstSeen) ? record.firstSeen : null;
    record.lastReviewed = validDay(record.lastReviewed) ? record.lastReviewed : null;
    record.due = validDay(record.due) ? record.due : null;
    record.lastGrade = Number.isInteger(record.lastGrade) && record.lastGrade >= 0 && record.lastGrade <= 3 ? record.lastGrade : null;
    record.seen = record.seen === true || record.attempts > 0 || record.firstSeen !== null || record.successDays.length > 0;
    record.imported = record.imported === true;
    var history = Array.isArray(record.history) ? record.history : [];
    var validHistory = function (event) {
      return object(event) && validDay(event.day) && Number.isInteger(event.grade) && event.grade >= 0 && event.grade <= 3;
    };
    var invalidHistory = history.filter(function (event) { return !validHistory(event); });
    if (invalidHistory.length) record.invalidHistory = (Array.isArray(record.invalidHistory) ? record.invalidHistory : []).concat(invalidHistory);
    history = history.filter(validHistory);
    var futureHistory = history.filter(function (event) { return event.day > today; });
    var futureSuccess = record.successDays.filter(function (day) { return day > today; });
    var futureLastReviewed = record.lastReviewed && record.lastReviewed > today;
    if (futureSuccess.length) record.quarantinedSuccessDays = unique((Array.isArray(record.quarantinedSuccessDays) ? record.quarantinedSuccessDays : []).concat(futureSuccess)).sort();
    if (futureLastReviewed) record.quarantinedLastReviewed = record.lastReviewed;
    if (futureHistory.length) {
      record.quarantinedHistory = (Array.isArray(record.quarantinedHistory) ? record.quarantinedHistory : []).concat(futureHistory);
      history = history.filter(function (event) { return event.day <= today; });
      var base = object(record.historyBase) ? record.historyBase : {};
      var replayed = Array.isArray(base.successDays) ? unique(base.successDays.filter(function (day) { return validDay(day) && day <= today; })).sort() : [];
      history.forEach(function (event) {
        replayed = event.grade >= 2 ? unique(replayed.concat(event.day)).sort() : [];
      });
      record.successDays = replayed;
      var previous = history.length ? history[history.length - 1] : base;
      var previousDay = previous.day || previous.lastReviewed;
      record.lastReviewed = validDay(previousDay) && previousDay <= today ? previousDay : null;
      var previousGrade = own(previous, 'grade') ? previous.grade : previous.lastGrade;
      record.lastGrade = Number.isInteger(previousGrade) && previousGrade >= 0 && previousGrade <= 3 ? previousGrade : null;
      record.due = validDay(previous.due) ? previous.due : today;
      record.lastReviewedAt = previous.at || previous.lastReviewedAt || null;
      record.examReviewedFor = validDay(previous.examReviewedFor) ? previous.examReviewedFor : null;
      if (record.firstSeen && record.firstSeen > today) {
        record.firstSeen = validDay(base.firstSeen) && base.firstSeen <= today ? base.firstSeen : (history.length ? history[0].day : null);
      }
    } else if (futureLastReviewed) {
      // Old versions did not keep event history. Keep their valid past success
      // days, but do not invent a past grade or a future-derived due date.
      record.lastReviewed = null;
      record.lastGrade = null;
      record.due = today;
      record.lastReviewedAt = null;
    }
    if (futureHistory.length || futureSuccess.length || futureLastReviewed) record.clockCorrected = true;
    record.successDays = record.successDays.filter(function (day) { return day <= today; });
    record.history = history;
    var effectiveDays = successDays(record, today);
    record.stage = Math.min(INTERVALS.length, effectiveDays.length);
    record.mastered = effectiveDays.length >= 3;
    if (record.seen && !record.due) record.due = today;
    return record;
  }
  function normalizeDay(raw) {
    var entry = Object.assign(newDay(), object(raw) ? clone(raw) : {});
    entry.reviews = integer(entry.reviews);
    entry.correct = integer(entry.correct);
    entry.lapses = integer(entry.lapses);
    entry.reviews = Math.max(entry.reviews, entry.correct + entry.lapses);
    entry.seconds = nonnegative(entry.seconds);
    entry.timedReviews = Math.min(entry.reviews, integer(object(raw) ? raw.timedReviews : undefined,
      entry.seconds > 0 ? entry.reviews : 0));
    entry.reviewedIds = validIds(entry.reviewedIds);
    entry.newIds = validIds(entry.newIds);
    entry.dueIds = validIds(entry.dueIds);
    return entry;
  }
  function normalizeState(raw, catalog, today) {
    today = todayOrDefault(today);
    var base = createState(today);
    var state = Object.assign(base, object(raw) ? clone(raw) : {});
    if (raw !== undefined && raw !== null && !object(raw)) preserveRecovery(state, 'state', 'raw', raw);
    if (object(raw) && raw.version !== undefined && raw.version !== VERSION) state.previousVersion = raw.version;
    state.version = VERSION;
    var settings = object(state.settings) ? state.settings : {};
    if (!object(state.settings)) preserveRecovery(state, 'state', 'settings', state.settings);
    state.settings = Object.assign({}, DEFAULTS, settings);
    if (!validDay(state.settings.examDate)) {
      preserveRecovery(state, 'settings', 'examDate', state.settings.examDate);
      state.settings.examDate = DEFAULTS.examDate;
    }
    var minutes = number(state.settings.dailyMinutes, DEFAULTS.dailyMinutes);
    if (minutes <= 0 || minutes > 1440 || !Number.isFinite(number(state.settings.dailyMinutes, NaN))) {
      preserveRecovery(state, 'settings', 'dailyMinutes', state.settings.dailyMinutes);
      minutes = DEFAULTS.dailyMinutes;
    }
    state.settings.dailyMinutes = minutes;
    var reserve = number(state.settings.reserveDays, DEFAULTS.reserveDays);
    if (reserve < 0 || reserve > 3650 || !Number.isFinite(number(state.settings.reserveDays, NaN))) {
      preserveRecovery(state, 'settings', 'reserveDays', state.settings.reserveDays);
      reserve = DEFAULTS.reserveDays;
    }
    state.settings.reserveDays = Math.floor(reserve);
    state.createdDay = validDay(state.createdDay) ? state.createdDay : today;
    state.lastActiveDay = validDay(state.lastActiveDay) ? state.lastActiveDay : null;

    var records = object(state.records) ? state.records : {};
    if (!object(state.records)) preserveRecovery(state, 'state', 'records', state.records);
    state.records = dictionary();
    Object.keys(records).forEach(function (id) {
      if (!object(records[id])) preserveRecovery(state, 'records', id, records[id]);
      state.records[id] = normalizeRecord(records[id], today);
    });
    var days = object(state.days) ? state.days : {};
    if (!object(state.days)) preserveRecovery(state, 'state', 'days', state.days);
    state.days = dictionary();
    Object.keys(days).forEach(function (day) {
      if (!validDay(day) || !object(days[day])) preserveRecovery(state, 'days', day, days[day]);
      if (validDay(day) && day > today) preserveRecovery(state, 'futureDays', day, days[day]);
      else if (validDay(day)) state.days[day] = normalizeDay(days[day]);
    });
    // Records whose cards disappeared from a later catalog are intentionally retained.
    return state;
  }

  function cardsFrom(catalog, includeVerificationPending) {
    var source = Array.isArray(catalog) ? catalog : (catalog && Array.isArray(catalog.cards) ? catalog.cards : []);
    var seen = new Set();
    return source.filter(function (card) {
      if (!object(card) || typeof card.id !== 'string' || !card.id || seen.has(card.id)) return false;
      seen.add(card.id);
      return includeVerificationPending === true || card.needsVerification !== true;
    });
  }
  function recordFor(state, id) { return own(state.records, id) ? state.records[id] : newRecord(); }
  function effectiveDue(record, today) {
    if (!record.seen) return null;
    // A future clock must not hide an already seen card from today's review queue.
    if ((record.lastReviewed && record.lastReviewed > today) || record.successDays.some(function (day) { return day > today; })) return today;
    return validDay(record.due) ? record.due : today;
  }
  function isDue(record, today) {
    var due = effectiveDue(record, today);
    return due !== null && due <= today;
  }
  function isWeak(record, today) {
    return record.seen && (successDays(record, today).length < 3 || (record.lastGrade !== null && record.lastGrade < 2));
  }
  function indexMap(cards) {
    var result = dictionary();
    cards.forEach(function (card, index) { result[card.id] = index; });
    return result;
  }
  function dueSort(state, today, order) {
    return function (a, b) {
      var ra = recordFor(state, a.id), rb = recordFor(state, b.id);
      var da = effectiveDue(ra, today), db = effectiveDue(rb, today);
      if (da !== db) return da < db ? -1 : 1;
      var failedA = ra.lastGrade !== null && ra.lastGrade < 2;
      var failedB = rb.lastGrade !== null && rb.lastGrade < 2;
      if (failedA !== failedB) return failedA ? -1 : 1;
      return order[a.id] - order[b.id];
    };
  }
  function topicDescriptors(catalog) {
    var output = dictionary();
    if (catalog && Array.isArray(catalog.topics)) catalog.topics.forEach(function (topic) {
      if (typeof topic === 'string') output[topic] = { id: topic, label: topic, title: topic };
      else if (object(topic) && typeof topic.id === 'string') output[topic.id] = topic;
    });
    return output;
  }
  function currentNewIds(cards, state, today) {
    var entry = state.days[today] || newDay();
    var recorded = new Set(entry.newIds);
    return cards.filter(function (card) {
      var record = recordFor(state, card.id);
      return record.seen && (record.firstSeen === today || recorded.has(card.id));
    }).map(function (card) { return card.id; });
  }
  function estimateSeconds(cards, state) {
    var seconds = 0, timed = 0;
    cards.forEach(function (card) {
      var record = recordFor(state, card.id);
      seconds += record.seconds;
      timed += record.timedAttempts;
    });
    // A short first answer must not set the pace for all long-form content.
    // Twenty 45-second prior observations gradually yield to actual timings.
    return timed > 0 ? round(Math.max(15, Math.min(180,
      (seconds + ESTIMATE_PRIOR_REVIEWS * DEFAULT_CARD_SECONDS) / (timed + ESTIMATE_PRIOR_REVIEWS))), 1) : DEFAULT_CARD_SECONDS;
  }

  function interleaveNew(unseenCards, limit, alreadyIntroduced) {
    var grouped = dictionary(), counts = dictionary(), positions = dictionary();
    unseenCards.forEach(function (card) {
      var topic = String(card.topic || 'other');
      if (!own(grouped, topic)) { grouped[topic] = []; counts[topic] = 0; positions[topic] = 0; }
      grouped[topic].push(card);
    });
    (alreadyIntroduced || []).forEach(function (card) {
      var topic = String(card.topic || 'other');
      if (own(counts, topic)) counts[topic] += 1;
    });
    var topics = Object.keys(grouped), output = [];
    while (output.length < limit) {
      var selected = null;
      topics.forEach(function (topic) {
        if (positions[topic] < grouped[topic].length && (selected === null || counts[topic] < counts[selected])) selected = topic;
      });
      if (selected === null) break;
      output.push(grouped[selected][positions[selected]]);
      positions[selected] += 1;
      counts[selected] += 1;
    }
    return output;
  }

  function nextDueAfterSuccess(record, today, settings, cardId) {
    var due = addDays(today, INTERVALS[Math.max(0, record.stage - 1)]);
    var examDate = settings.examDate;
    var lastStudyDay = addDays(examDate, -1);
    var finalWindowStart = addDays(lastStudyDay, -(Math.max(1, settings.reserveDays) - 1));
    if (record.stage >= 3 && today >= finalWindowStart && today <= lastStudyDay) record.examReviewedFor = examDate;
    // Spread the last check across the reserve window. Clamping every long
    // interval to exam day would create one enormous, impossible final queue.
    if (lastStudyDay > today && due > lastStudyDay && record.examReviewedFor !== examDate) {
      var first = addDays(today, 1);
      if (finalWindowStart > first) first = finalWindowStart;
      var last = lastStudyDay;
      var span = Math.max(1, dayDiff(first, last) + 1);
      due = addDays(first, stableHash(cardId + ':' + examDate) % span);
    }
    return due;
  }

  function computePlan(cards, state, today) {
    var settings = state.settings;
    var daysUntilExam = dayDiff(today, settings.examDate);
    var lastStudyDay = addDays(settings.examDate, -1);
    var studyDeadlinePassed = daysUntilExam <= 0;
    var coverageDays = Math.max(1, daysUntilExam - settings.reserveDays + 1);
    var order = indexMap(cards);
    var dueCards = cards.filter(function (card) { return isDue(recordFor(state, card.id), today); }).sort(dueSort(state, today, order));
    var unseenCards = cards.filter(function (card) { return !recordFor(state, card.id).seen; });
    var newIds = currentNewIds(cards, state, today);
    var newSet = new Set(newIds);
    var newCompletedToday = newIds.length;
    // Including today's introductions keeps this quota stable while studying.
    var newTarget = studyDeadlinePassed ? newCompletedToday : Math.max(newCompletedToday, Math.ceil((unseenCards.length + newCompletedToday) / coverageDays));
    var newRemaining = Math.max(0, newTarget - newCompletedToday);
    var entry = state.days[today] || newDay();
    var dueTargetIds = new Set(entry.dueIds.filter(function (id) { return own(order, id) && !newSet.has(id); }));
    dueCards.forEach(function (card) { if (!newSet.has(card.id)) dueTargetIds.add(card.id); });
    var dueCompletedToday = 0;
    dueTargetIds.forEach(function (id) {
      var record = recordFor(state, id);
      if (record.lastReviewed === today && record.lastGrade >= 2 && !isDue(record, today)) dueCompletedToday += 1;
    });
    var newSuccessfulToday = newIds.filter(function (id) {
      var record = recordFor(state, id);
      return record.lastReviewed === today && record.lastGrade >= 2 && !isDue(record, today);
    }).length;
    var totalTarget = dueTargetIds.size + newTarget;
    var totalCompletedToday = Math.min(totalTarget, dueCompletedToday + newSuccessfulToday);
    var totalRemaining = Math.max(0, dueCards.length + newRemaining);
    var estimatedSecondsPerCard = estimateSeconds(cards, state);
    var estimatedMinutes = Math.ceil(totalTarget * estimatedSecondsPerCard / 60);
    var remainingMinutes = Math.ceil(totalRemaining * estimatedSecondsPerCard / 60);
    var capacityCards = Math.floor(settings.dailyMinutes * 60 / estimatedSecondsPerCard);
    var clockAffected = cards.filter(function (card) {
      var record = recordFor(state, card.id);
      return record.clockCorrected === true || (record.lastReviewed && record.lastReviewed > today) || record.successDays.some(function (day) { return day > today; });
    }).length;
    return {
      today: today,
      examDate: settings.examDate,
      lastStudyDay: lastStudyDay,
      studyDeadlinePassed: studyDeadlinePassed,
      daysUntilExam: daysUntilExam,
      daysRemaining: Math.max(0, daysUntilExam),
      calendarDaysAvailable: Math.max(0, daysUntilExam),
      coverageDays: coverageDays,
      coverageDeadline: addDays(settings.examDate, -settings.reserveDays),
      reserveDays: settings.reserveDays,
      inReserve: daysUntilExam > 0 && daysUntilExam <= settings.reserveDays,
      deadlinePassed: daysUntilExam < 0,
      examIsToday: daysUntilExam === 0,
      phase: studyDeadlinePassed ? 'after-exam' : (daysUntilExam <= settings.reserveDays ? 'reserve' : 'coverage'),
      total: cards.length,
      unseen: unseenCards.length,
      newTarget: newTarget,
      newCompletedToday: newCompletedToday,
      newSuccessfulToday: newSuccessfulToday,
      newRemaining: newRemaining,
      dueCount: dueCards.length,
      dueTarget: dueTargetIds.size,
      dueCompletedToday: dueCompletedToday,
      overdueCount: dueCards.filter(function (card) { return effectiveDue(recordFor(state, card.id), today) < today; }).length,
      newRetryCount: dueCards.filter(function (card) { return newSet.has(card.id); }).length,
      reviewRemaining: dueCards.length,
      totalTarget: totalTarget,
      totalCompletedToday: totalCompletedToday,
      totalRemaining: totalRemaining,
      requiredRemaining: studyDeadlinePassed ? 0 : totalRemaining,
      optionalReviewCount: studyDeadlinePassed ? dueCards.length : 0,
      dueCards: dueCards,
      newCards: interleaveNew(unseenCards, newRemaining, cards.filter(function (card) { return newSet.has(card.id); })),
      estimatedSecondsPerCard: estimatedSecondsPerCard,
      estimateSampleCount: cards.reduce(function (sum, card) { return sum + recordFor(state, card.id).timedAttempts; }, 0),
      estimatePriorWeight: ESTIMATE_PRIOR_REVIEWS,
      estimateHasTimingData: cards.some(function (card) { return recordFor(state, card.id).timedAttempts > 0; }),
      estimatedMinutes: estimatedMinutes,
      remainingMinutes: remainingMinutes,
      capacityMinutes: settings.dailyMinutes,
      capacityCards: capacityCards,
      capacityShortfall: totalTarget > capacityCards,
      shortfallMinutes: Math.max(0, estimatedMinutes - settings.dailyMinutes),
      capacityShortfallPercent: round(Math.max(0, estimatedMinutes - settings.dailyMinutes) / settings.dailyMinutes * 100, 1),
      clockAffectedCards: clockAffected
    };
  }
  function getPlan(catalog, rawState, today) {
    today = todayOrDefault(today);
    var state = normalizeState(rawState, catalog, today);
    var cards = cardsFrom(catalog);
    var result = computePlan(cards, state, today);
    result.catalogTotal = cardsFrom(catalog, true).length;
    result.verificationPending = result.catalogTotal - cards.length;
    return result;
  }

  function buildSession(catalog, rawState, options) {
    options = options || {};
    var today = todayOrDefault(options.today);
    var state = normalizeState(rawState, catalog, today);
    var cards = cardsFrom(catalog);
    var order = indexMap(cards);
    var limit = options.limit === undefined ? 12 : Math.max(0, integer(options.limit));
    var mode = options.mode || 'today';
    var queue;
    if (mode === 'today') {
      var plan = computePlan(cards, state, today);
      queue = plan.dueCards.concat(plan.newCards);
    } else if (mode === 'weak') {
      queue = cards.filter(function (card) { return isWeak(recordFor(state, card.id), today); });
      queue.sort(function (a, b) {
        var ra = recordFor(state, a.id), rb = recordFor(state, b.id);
        var failedA = ra.lastGrade !== null && ra.lastGrade < 2;
        var failedB = rb.lastGrade !== null && rb.lastGrade < 2;
        if (failedA !== failedB) return failedA ? -1 : 1;
        var daysA = successDays(ra, today).length, daysB = successDays(rb, today).length;
        if (daysA !== daysB) return daysA - daysB;
        return dueSort(state, today, order)(a, b);
      });
    } else if (mode === 'topic') {
      queue = cards.filter(function (card) { return card.topic === options.topic; });
      queue.sort(function (a, b) {
        var ra = recordFor(state, a.id), rb = recordFor(state, b.id);
        var priorityA = isDue(ra, today) ? 0 : (!ra.seen ? 1 : 2);
        var priorityB = isDue(rb, today) ? 0 : (!rb.seen ? 1 : 2);
        return priorityA - priorityB || order[a.id] - order[b.id];
      });
    } else if (mode === 'mock') {
      // Deterministic daily shuffle; breadth across topics instead of catalog order.
      var mockSeed = options.seed === undefined ? (options.nonce === undefined ? today : today + ':' + String(options.nonce)) : today + ':' + String(options.seed);
      var grouped = dictionary();
      cards.forEach(function (card) {
        var topic = String(card.topic || 'other');
        if (!own(grouped, topic)) grouped[topic] = [];
        grouped[topic].push(card);
      });
      var topics = Object.keys(grouped).sort();
      topics.forEach(function (topic) {
        grouped[topic].sort(function (a, b) {
          return stableHash(mockSeed + a.id) - stableHash(mockSeed + b.id) || order[a.id] - order[b.id];
        });
      });
      if (topics.length) {
        var offset = stableHash(mockSeed) % topics.length;
        topics = topics.slice(offset).concat(topics.slice(0, offset));
      }
      queue = [];
      var depth = 0, hasMore = true;
      while (hasMore && queue.length < limit) {
        hasMore = false;
        topics.forEach(function (topic) {
          if (grouped[topic][depth]) { queue.push(grouped[topic][depth]); hasMore = true; }
        });
        depth += 1;
      }
    } else {
      throw new RangeError('Unknown session mode: ' + mode);
    }
    return queue.slice(0, limit);
  }

  function review(rawState, cardId, grade, options) {
    options = options || {};
    if (typeof cardId !== 'string' || !cardId) throw new TypeError('cardId must be a nonempty string');
    if (!Number.isInteger(grade) || grade < 0 || grade > 3) throw new RangeError('grade must be 0, 1, 2, or 3');
    var today = todayOrDefault(options.today);
    var state = normalizeState(rawState, null, today);
    var record = normalizeRecord(recordFor(state, cardId), today);
    var entry = state.days[today] || newDay();
    var isFirstSeen = !record.seen;
    var wasDue = isDue(record, today);
    var seconds = nonnegative(options.seconds);
    var passed = grade >= 2;
    var warnings = [];
    if (!object(record.historyBase)) {
      record.historyBase = {
        successDays: record.successDays.slice(), firstSeen: record.firstSeen,
        lastReviewed: record.lastReviewed, lastGrade: record.lastGrade,
        lastReviewedAt: record.lastReviewedAt, due: record.due,
        examReviewedFor: record.examReviewedFor
      };
    }
    if (record.clockCorrected) warnings.push('future-records-quarantined');

    var futureDays = record.successDays.filter(function (day) { return day > today; });
    if (futureDays.length) {
      record.quarantinedSuccessDays = unique((Array.isArray(record.quarantinedSuccessDays) ? record.quarantinedSuccessDays : []).concat(futureDays)).sort();
      warnings.push('future-success-days-quarantined');
    }
    record.successDays = successDays(record, today);
    if (record.lastReviewed && record.lastReviewed > today) {
      record.quarantinedLastReviewed = record.lastReviewed;
      warnings.push('future-review-date-quarantined');
    }
    if (isFirstSeen) {
      record.firstSeen = today;
      entry.newIds.push(cardId);
    } else if (wasDue && record.firstSeen !== today && entry.newIds.indexOf(cardId) < 0) {
      entry.dueIds.push(cardId);
    }
    record.seen = true;
    record.attempts += 1;
    record.seconds += seconds;
    if (seconds > 0) record.timedAttempts += 1;
    record.lastGrade = grade;
    record.lastReviewed = today;
    record.lastEvidence = options.evidence === undefined ? 'self-grade' : clone(options.evidence);
    record.lastReviewedAt = null;
    if (options.now !== undefined) {
      var instant = new Date(options.now);
      if (Number.isFinite(instant.getTime())) {
        record.lastReviewedAt = instant.toISOString();
        if (localDay(instant) !== today) warnings.push('timestamp-day-mismatch');
      } else warnings.push('invalid-timestamp');
    }

    if (passed) {
      record.correct += 1;
      record.successDays = unique(record.successDays.concat(today)).sort();
      record.stage = Math.min(INTERVALS.length, record.successDays.length);
      record.due = nextDueAfterSuccess(record, today, state.settings, cardId);
    } else {
      record.lapses += 1;
      record.successDays = [];
      record.stage = 0;
      record.examReviewedFor = null;
      record.due = today;
    }
    record.mastered = record.successDays.length >= 3;
    record.history.push({ day: today, grade: grade, due: record.due, at: record.lastReviewedAt, seconds: seconds, examReviewedFor: record.examReviewedFor });
    entry.reviews += 1;
    entry.correct += passed ? 1 : 0;
    entry.lapses += passed ? 0 : 1;
    entry.seconds += seconds;
    entry.timedReviews += seconds > 0 ? 1 : 0;
    entry.reviewedIds = unique(entry.reviewedIds.concat(cardId));
    entry.newIds = unique(entry.newIds);
    entry.dueIds = unique(entry.dueIds);
    state.records[cardId] = record;
    state.days[today] = entry;
    state.lastActiveDay = today;
    state.lastReview = {
      cardId: cardId,
      grade: grade,
      today: today,
      isFirstSeen: isFirstSeen,
      passed: passed,
      mastered: record.mastered,
      successDayCount: record.successDays.length,
      due: record.due,
      warnings: warnings
    };
    return state;
  }

  function forecast(catalog, rawState, options) {
    options = options || {};
    var today = todayOrDefault(options.today);
    var count = options.days === undefined ? 14 : Math.min(366, integer(options.days));
    var state = normalizeState(rawState, catalog, today);
    count = Math.min(count, Math.max(0, dayDiff(today, state.settings.examDate)));
    var cards = cardsFrom(catalog);
    var secondsPerCard = estimateSeconds(cards, state);
    var model = dictionary();
    cards.forEach(function (card) {
      var record = recordFor(state, card.id);
      model[card.id] = {
        seen: record.seen,
        due: effectiveDue(record, today),
        successDays: record.successDays.slice(),
        stage: record.stage,
        examReviewedFor: record.examReviewedFor
      };
    });
    var alreadyIds = new Set(currentNewIds(cards, state, today));
    var introducedToday = cards.filter(function (card) { return alreadyIds.has(card.id); });
    var rows = [];
    for (var offset = 0; offset < count; offset += 1) {
      var day = addDays(today, offset);
      if (!day) break;
      var unseen = cards.filter(function (card) { return !model[card.id].seen; });
      var due = cards.filter(function (card) { return model[card.id].seen && model[card.id].due <= day; });
      var doneNew = offset === 0 ? introducedToday : [];
      var coverageDays = Math.max(1, dayDiff(day, state.settings.examDate) - state.settings.reserveDays + 1);
      var target = Math.max(doneNew.length, Math.ceil((unseen.length + doneNew.length) / coverageDays));
      var newCards = interleaveNew(unseen, Math.max(0, target - doneNew.length), doneNew);
      due.concat(newCards).forEach(function (card) {
        var record = model[card.id];
        record.seen = true;
        record.successDays = unique(record.successDays.concat(day)).sort();
        record.stage = Math.min(INTERVALS.length, record.successDays.length);
        record.due = nextDueAfterSuccess(record, day, state.settings, card.id);
      });
      var total = due.length + newCards.length;
      rows.push({
        day: day, new: newCards.length, review: due.length, total: total,
        minutes: Math.ceil(total * secondsPerCard / 60),
        seenAfter: cards.filter(function (card) { return model[card.id].seen; }).length,
        masteredAfter: cards.filter(function (card) { return model[card.id].successDays.length >= 3; }).length
      });
    }
    var totalMinutes = rows.reduce(function (sum, row) { return sum + row.minutes; }, 0);
    var peak = rows.reduce(function (result, row) { return result === null || row.minutes > result.minutes ? row : result; }, null);
    return {
      days: rows,
      assumption: 'all-first-attempt-correct',
      todayIsRemainingOnly: true,
      estimatedSecondsPerCard: secondsPerCard,
      estimateSampleCount: cards.reduce(function (sum, card) { return sum + recordFor(state, card.id).timedAttempts; }, 0),
      estimatePriorWeight: ESTIMATE_PRIOR_REVIEWS,
      estimateHasTimingData: cards.some(function (card) { return recordFor(state, card.id).timedAttempts > 0; }),
      capacityMinutes: state.settings.dailyMinutes,
      totalMinutes: totalMinutes,
      averageMinutes: rows.length ? round(totalMinutes / rows.length, 1) : 0,
      peakMinutes: peak ? peak.minutes : 0,
      peakDay: peak ? peak.day : null,
      overCapacityDays: rows.filter(function (row) { return row.minutes > state.settings.dailyMinutes; }).length
    };
  }

  function summary(catalog, rawState, today) {
    today = todayOrDefault(today);
    var state = normalizeState(rawState, catalog, today);
    var cards = cardsFrom(catalog);
    var plan = computePlan(cards, state, today);
    var descriptors = topicDescriptors(catalog);
    var topics = dictionary();
    var totalReviews = 0, cumulativeCorrect = 0, totalSeconds = 0, totalLapses = 0;
    var seen = 0, mastered = 0, weak = 0;
    cards.forEach(function (card) {
      var record = recordFor(state, card.id);
      var topicId = String(card.topic || 'other');
      var descriptor = descriptors[topicId] || {};
      if (!own(topics, topicId)) {
        var title = descriptor.title || descriptor.label || descriptor.name || topicId;
        topics[topicId] = { id: topicId, title: title, label: title, name: title, total: 0, seen: 0, mastered: 0, due: 0, weak: 0 };
      }
      var topic = topics[topicId];
      var isMastered = successDays(record, today).length >= 3;
      var weakCard = isWeak(record, today);
      topic.total += 1;
      topic.seen += record.seen ? 1 : 0;
      topic.mastered += isMastered ? 1 : 0;
      topic.due += isDue(record, today) ? 1 : 0;
      topic.weak += weakCard ? 1 : 0;
      seen += record.seen ? 1 : 0;
      mastered += isMastered ? 1 : 0;
      weak += weakCard ? 1 : 0;
      totalReviews += record.attempts;
      cumulativeCorrect += record.correct;
      totalSeconds += record.seconds;
      totalLapses += record.lapses;
    });
    var entry = state.days[today] || newDay();
    var validCardIds = new Set(cards.map(function (card) { return card.id; }));
    var activeDays = Object.keys(state.days).filter(function (day) {
      return day <= today && state.days[day].reviews > 0;
    }).sort();
    var recentDays = [];
    for (var offset = 6; offset >= 0; offset -= 1) {
      var day = addDays(today, -offset);
      var dayEntry = state.days[day] || newDay();
      recentDays.push({ day: day, reviews: dayEntry.reviews, minutes: round(dayEntry.seconds / 60, 1), active: dayEntry.reviews > 0 });
    }
    return {
      today: today,
      catalogTotal: cardsFrom(catalog, true).length,
      verificationPending: cardsFrom(catalog, true).length - cards.length,
      total: cards.length,
      seen: seen,
      unseen: cards.length - seen,
      mastered: mastered,
      learning: seen - mastered,
      masteryPercent: cards.length ? round(mastered / cards.length * 100, 1) : 0,
      coveragePercent: cards.length ? round(seen / cards.length * 100, 1) : 0,
      dueToday: plan.dueCount,
      dueCount: plan.dueCount,
      overdue: plan.overdueCount,
      weak: weak,
      newToday: plan.newCompletedToday,
      reviewsToday: entry.reviews,
      uniqueReviewedToday: entry.reviewedIds.filter(function (id) { return validCardIds.has(id); }).length,
      correctToday: entry.correct,
      studySecondsToday: entry.seconds,
      studyMinutesToday: round(entry.seconds / 60, 1),
      totalReviews: totalReviews,
      cumulativeCorrect: cumulativeCorrect,
      totalLapses: totalLapses,
      recallSuccessRate: totalReviews ? round(cumulativeCorrect / totalReviews * 100, 1) : null,
      totalStudyMinutes: round(totalSeconds / 60, 1),
      activeDays: activeDays.length,
      recentActiveDays: recentDays.filter(function (day) { return day.active; }).length,
      recentDays: recentDays,
      topics: Object.keys(topics).map(function (id) { return topics[id]; }),
      clockAffectedCards: plan.clockAffectedCards
    };
  }

  return {
    version: VERSION,
    defaults: Object.assign({}, DEFAULTS),
    intervals: INTERVALS.slice(),
    createState: createState,
    normalizeState: normalizeState,
    getPlan: getPlan,
    buildSession: buildSession,
    review: review,
    forecast: forecast,
    summary: summary,
    localDay: localDay,
    dayDiff: dayDiff,
    addDays: addDays,
    isValidDay: validDay
  };
}));
