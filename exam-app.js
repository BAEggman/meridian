(function () {
  'use strict';
  var STORAGE = 'meridian_exam_v1';
  var SESSION_STORAGE = 'meridian_exam_session_v1';
  var LEGACY_KEYS = ['acu_srs_v3', 'gyeongnak_func_srs_v1', 'gyeongnak_history_srs_v1', 'sidong_sosaeng_srs_v1', 'baesu_rule_srs_v1', 'saam_bosa_srs_v1', 'jata_jingmai_v1', 'jiaohoe_cloze_v1', 'hub_track_v1', 'hub_stats_v1', 'hub_session_last', 'mrd_song_pref_v1'];
  var E, C, state, cardMap, sourceMap;
  var root, activeSession = null, pendingSession = null, unsavedSession = null, revealed = false;
  var startedAt = 0, elapsedBeforePause = 0, protectedRaw = null, storageWarning = '', notice = '', dirty = false;
  var sourceLabels = {}, feedback = '', settingsOpen = false, busy = false;
  var sessionChoices = [], selectedChoice = null, usedHint = false;
  var viewMode = 'world', worldTopic = null, effectContext = null;
  function expeditionApi() { return window.MeridianExpedition; }
  function isExpedition() { return !!(activeSession && activeSession.expedition && activeSession.expedition.version === 1 && expeditionApi()); }
  function day() { return E.localDay(); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]; }); }
  function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
  function pct(v, total) { return total ? Math.max(0, Math.min(100, Math.round(v / total * 100))) : 0; }
  function safeRead(key) { try { return localStorage.getItem(key); } catch (err) { storageWarning = '이 브라우저에서 기록 저장을 사용할 수 없습니다. 학습 후 기록을 백업해 주세요.'; return null; } }
  function parse(raw) { try { return raw ? JSON.parse(raw) : null; } catch (err) { return null; } }
  function parseStoredExam(raw) {
    if (!raw) return null;
    try { var codec = window.MeridianExamStorage; return JSON.parse(codec && typeof codec.decode === 'function' ? codec.decode(raw) : raw); }
    catch (err) { return null; }
  }
  function encodeStoredExam(value) {
    var raw = JSON.stringify(value), codec = window.MeridianExamStorage;
    return codec && typeof codec.encode === 'function' ? codec.encode(raw) : raw;
  }
  function unreadableExam(raw, saved) { return !!raw && (!saved || typeof saved !== 'object' || Array.isArray(saved) || (saved.version && saved.version !== 1)); }
  function protectExam(raw) {
    protectedRaw = raw;
    storageWarning = '저장된 시험 기록을 읽지 못해 임시 모드로 열었습니다. 원본은 보존되어 있습니다. 먼저 기록 백업을 내려받고 정상 백업을 복원해 주세요.';
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function persist() {
    if (protectedRaw !== null) return false;
    try { localStorage.setItem(STORAGE, encodeStoredExam(state)); dirty = false; return true; }
    catch (err) { dirty = true; storageWarning = '기록을 저장하지 못했습니다. 이 화면을 닫기 전에 학습 기록을 백업해 주세요.'; announce(storageWarning); return false; }
  }
  function announce(msg) { var live = document.getElementById('exam-live'); if (live) live.textContent = (msg || '') + (storageWarning && msg !== storageWarning ? ' ' + storageWarning : ''); }
  function loadState() {
    var raw = safeRead(STORAGE), saved = parseStoredExam(raw);
    if (unreadableExam(raw, saved)) {
      protectExam(raw);
      state = E.createState(day());
      return;
    }
    state = E.normalizeState(saved || E.createState(day()), C, day());
    if (!saved) migrateLegacy();
  }
  function migrateLegacy() {
    var imported = 0, stats = parse(safeRead('hub_stats_v1'));
    function seen(tool, id) {
      var ids = sourceMap[tool + '::' + id] || [];
      ids.forEach(function (cardId) {
        if (state.records[cardId] && state.records[cardId].seen) return;
        state.records[cardId] = {seen:true, imported:true, due:day(), successDays:[]};
        imported++;
      });
    }
    if (stats && stats.q && typeof stats.q === 'object') {
      Object.keys(stats.q).forEach(function (key) { var r = stats.q[key]; if (r && num(r.seen) > 0 && r.tool && r.id != null) seen(r.tool, String(r.id)); });
    }
    var keys = {acu:'acu_srs_v3', func:'gyeongnak_func_srs_v1', history:'gyeongnak_history_srs_v1', sidong:'sidong_sosaeng_srs_v1', baesurule:'baesu_rule_srs_v1', saamquiz:'saam_bosa_srs_v1'};
    Object.keys(keys).forEach(function (tool) {
      var db = parse(safeRead(keys[tool]));
      if (db && db.cards && typeof db.cards === 'object') Object.keys(db.cards).forEach(function (id) { seen(tool, id); });
    });
    state = E.normalizeState(state, C, day());
    state.migrations = Object.assign({}, state.migrations, {legacyV1:{date:day(), imported:imported}});
    if (imported) notice = '기존 기록에서 ' + imported + '개 항목을 가져왔습니다. 이미 접한 내용으로 표시하고, 기억 상태는 복습으로 확인합니다.';
    persist();
  }
  function refreshState() {
    if (protectedRaw !== null || dirty) return;
    var raw = safeRead(STORAGE), saved = parseStoredExam(raw);
    if (unreadableExam(raw, saved)) { protectExam(raw); announce(storageWarning); return; }
    if (saved && saved.version === 1) state = E.normalizeState(saved, C, day());
  }
  function getPending() {
    var s = unsavedSession ? clone(unsavedSession) : parse(safeRead(SESSION_STORAGE));
    if (!s || s.version !== 1 || s.day !== day() || !Array.isArray(s.ids) || !Number.isInteger(s.index) || s.index < 0 || s.index >= s.ids.length || s.ids.length > 200) return null;
    if (!s.ids.every(function (id) { return typeof id === 'string' && cardMap[id] && !cardMap[id].needsVerification; })) return null;
    s.results = Array.isArray(s.results) ? s.results.filter(function (r) { return r && typeof r.id === 'string' && cardMap[r.id] && Number.isInteger(r.grade) && r.grade >= 0 && r.grade <= 3; }) : [];
    if (!s.retries || typeof s.retries !== 'object') s.retries = {};
    if (!s.drafts || typeof s.drafts !== 'object' || Array.isArray(s.drafts)) s.drafts = {};
    if (s.expedition) {
      if (s.expedition.version !== 1 || !expeditionApi() || s.ids.length > 6 || new Set(s.ids).size !== s.ids.length) return null;
      if (s.expedition.approach !== 'play' && s.expedition.approach !== 'recall') return null;
      if (s.expedition.phase !== 'primary' && s.expedition.phase !== 'repair') return null;
      if (!s.expedition.forks || typeof s.expedition.forks !== 'object' || Array.isArray(s.expedition.forks)) s.expedition.forks = {};
    }
    return s;
  }
  function currentDraft() {
    if (!activeSession) return null;
    if (!activeSession.sessionId || typeof activeSession.sessionId !== 'string' || activeSession.sessionId.length > 200) activeSession.sessionId = 'session-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    if (!activeSession.drafts || typeof activeSession.drafts !== 'object' || Array.isArray(activeSession.drafts)) activeSession.drafts = {};
    var key = String(activeSession.index), d = activeSession.drafts[key], card = cardMap[activeSession.ids[activeSession.index]];
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    function preserveInvalid(field) {
      if (!d.invalidFields || typeof d.invalidFields !== 'object' || Array.isArray(d.invalidFields)) d.invalidFields = {};
      if (!Object.prototype.hasOwnProperty.call(d.invalidFields, field)) d.invalidFields[field] = clone(d[field]);
    }
    ['usedHint', 'revealed', 'started'].forEach(function (field) { if (d[field] !== undefined && typeof d[field] !== 'boolean') { preserveInvalid(field); if (field !== 'started') d.usedHint = true; } });
    if (d.attemptId !== undefined && (typeof d.attemptId !== 'string' || !d.attemptId || d.attemptId.length > 240)) { preserveInvalid('attemptId'); d.usedHint = true; }
    d.attemptId = typeof d.attemptId === 'string' && d.attemptId && d.attemptId.length <= 240 ? d.attemptId : activeSession.sessionId + ':' + (isExpedition() && card ? card.id : key);
    if (d.originalAnswer !== undefined && d.originalAnswer !== null && typeof d.originalAnswer !== 'string') { preserveInvalid('originalAnswer'); d.usedHint = true; }
    d.text = typeof d.text === 'string' ? d.text : '';
    d.originalAnswer = typeof d.originalAnswer === 'string' ? d.originalAnswer : null;
    d.usedHint = d.usedHint === true;
    d.revealed = d.revealed !== undefined && d.revealed !== false;
    d.started = d.started === true;
    d.elapsedMs = Math.max(0, num(d.elapsedMs));
    d.choiceValue = typeof d.choiceValue === 'string' ? d.choiceValue : null;
    var interaction = isExpedition() && card ? expeditionApi().getInteraction(card, {approach:activeSession.expedition.approach, boss:activeSession.expedition.bossId === card.id}) : null;
    var choices = card && Array.isArray(card.choices) ? card.choices : [];
    if (!Array.isArray(d.choices) || d.choices.length !== choices.length || d.choices.some(function (v) { return typeof v !== 'string' || choices.indexOf(v) < 0; }) || new Set(d.choices).size !== new Set(choices).size) {
      if (d.choices !== undefined) { preserveInvalid('choices'); d.usedHint = true; }
      d.choices = choices.slice();
      for (var i = d.choices.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), tmp = d.choices[i]; d.choices[i] = d.choices[j]; d.choices[j] = tmp; }
    }
    if (d.choiceValue !== null && (!interaction || interaction.type !== 'sequence') && d.choices.indexOf(d.choiceValue) < 0) { preserveInvalid('choiceValue'); d.usedHint = true; d.choiceValue = null; }
    if (interaction) {
      if (d.interactionType !== undefined && d.interactionType !== interaction.type) { preserveInvalid('interactionType'); d.usedHint = true; }
      d.interactionType = interaction.type;
      if (d.graded !== undefined && typeof d.graded !== 'boolean') { preserveInvalid('graded'); d.usedHint = true; }
      d.graded = d.graded === true;
      if (interaction.type === 'sequence') {
        var fragments = interaction.fragments;
        if (!Array.isArray(d.fragments) || d.fragments.length !== fragments.length || new Set(d.fragments).size !== fragments.length || d.fragments.some(function (v) { return fragments.indexOf(v) < 0; })) {
          if (d.fragments !== undefined) { preserveInvalid('fragments'); d.usedHint = true; }
          d.fragments = shuffle(fragments);
        }
        if (!Array.isArray(d.assembled) || new Set(d.assembled).size !== d.assembled.length || d.assembled.some(function (n) { return !Number.isInteger(n) || n < 0 || n >= fragments.length; })) {
          if (d.assembled !== undefined) { preserveInvalid('assembled'); d.usedHint = true; }
          d.assembled = [];
        }
      }
    }
    if ((d.usedHint || d.revealed) && d.originalAnswer === null) d.originalAnswer = d.text;
    activeSession.drafts[key] = d;
    return d;
  }
  function captureTime() {
    if (!activeSession || activeSession.index >= activeSession.ids.length) return;
    var d = currentDraft();
    if (d && d.graded) { startedAt = 0; return; }
    if (startedAt) { elapsedBeforePause += Math.max(0, Date.now() - startedAt); startedAt = document.hidden ? 0 : Date.now(); }
    if (d) d.elapsedMs = elapsedBeforePause;
  }
  function saveSession() {
    captureTime();
    try { if (activeSession) localStorage.setItem(SESSION_STORAGE, JSON.stringify(activeSession)); else localStorage.removeItem(SESSION_STORAGE); unsavedSession = null; return true; }
    catch (err) { unsavedSession = activeSession ? clone(activeSession) : null; storageWarning = '세트의 중간 위치를 저장하지 못했습니다. 이 화면을 닫기 전에 학습 기록을 백업해 주세요.'; announce(storageWarning); return false; }
  }
  function ensureRoot() {
    if (window.__active !== 'home') return null;
    var mount = document.getElementById('mount');
    root = document.getElementById('exam-root');
    if (!root) { root = document.createElement('section'); root.id = 'exam-root'; root.setAttribute('aria-label', '경락 시험 대비'); mount.insertBefore(root, mount.firstChild); }
    return root;
  }
  function track(seen, mastered, total) {
    return '<div class="ex-track" role="img" aria-label="전체 ' + total + '개 중 숙련 ' + mastered + '개, 학습 중 ' + Math.max(0, seen - mastered) + '개"><span class="ex-master-fill" style="width:' + pct(mastered, total) + '%"></span><span class="ex-seen-fill" style="width:' + pct(Math.max(0, seen - mastered), total) + '%"></span></div>';
  }
  function topicsSummary() {
    return C.topics.map(function (t) {
      var cards = C.cards.filter(function (c) { return c.topic === t.id && !c.needsVerification; });
      var seen = 0, mastered = 0, due = 0;
      cards.forEach(function (c) { var r = state.records[c.id]; if (r && r.seen) { seen++; if (r.mastered) mastered++; if (r.due && r.due <= day()) due++; } });
      return {id:t.id, label:t.label, total:cards.length, seen:seen, mastered:mastered, due:due, tool:cards.length ? cards[0].tool : ''};
    });
  }
  function activityStrip() {
    var cells = [];
    for (var i = 13; i >= 0; i--) {
      var d = E.addDays(day(), -i), r = state.days[d] || {};
      var attempts = num(r.reviews), active = attempts > 0;
      cells.push('<span class="ex-day-cell" data-active="' + active + '" data-today="' + (i === 0) + '" title="' + d + ' · ' + attempts + '회 응답">' + Number(d.slice(-2)) + '</span>');
    }
    return cells.join('');
  }
  function forecastMarkup(plan) {
    if (typeof E.forecast !== 'function' || plan.daysRemaining <= 0) return '';
    var forecast = E.forecast(C, state, {today:day(), days:Math.min(366, Math.max(1, plan.daysRemaining))});
    var next = forecast.days.slice(0, 14), peak = Math.max(1, num(forecast.peakMinutes));
    return '<section class="ex-section ex-card"><div class="ex-section-header"><h2>시험 전날까지 필요한 시간</h2><span class="ex-muted">계획 시뮬레이션 · 실제 성적 예측 아님</span></div><div class="ex-forecast-summary"><div><span>남은 기간 합계</span><b>' + (num(forecast.totalMinutes) / 60).toFixed(1) + '<small>시간</small></b></div><div><span>하루 평균</span><b>' + Math.ceil(num(forecast.averageMinutes)) + '<small>분</small></b></div><div><span>가장 많은 날</span><b>' + Math.ceil(num(forecast.peakMinutes)) + '<small>분</small></b></div></div>' + (num(forecast.overCapacityDays) ? '<p class="ex-alert">설정한 하루 ' + num(state.settings.dailyMinutes) + '분을 넘는 날이 ' + num(forecast.overCapacityDays) + '일입니다. 계획 설정에서 실제로 확보할 시간을 정해 주세요.</p>' : '') + '<div class="ex-forecast-bars" aria-label="앞으로 14일의 예상 학습 시간">' + next.map(function (x) { return '<div class="ex-forecast-day" aria-label="' + esc(x.day) + ', 신규 ' + num(x.new) + '개, 복습 ' + num(x.review) + '개, 예상 ' + Math.ceil(num(x.minutes)) + '분"><span class="ex-forecast-value">' + Math.ceil(num(x.minutes)) + '</span><div class="ex-forecast-track"><i style="height:' + Math.max(2, pct(num(x.minutes), peak)) + '%"></i></div><span>' + Number(x.day.slice(5, 7)) + '/' + Number(x.day.slice(8)) + '</span></div>'; }).join('') + '</div><p class="ex-muted">막대는 앞으로 14일, 숫자는 분입니다. 항목당 ' + Math.round(num(forecast.estimatedSecondsPerCard)) + '초 · 모든 첫 시도 성공을 가정합니다. 오답, 긴 원문, 휴식은 시간을 더 늘릴 수 있습니다. 오늘 막대는 남은 학습만 포함합니다.</p></section>';
  }
  function ratio(correct, attempts) { return num(attempts) ? num(correct) + '/' + num(attempts) + ' · ' + pct(correct, attempts) + '%' : '—'; }
  function delayLabel(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    if (num(seconds) < 0) return Math.ceil(Math.abs(num(seconds)) / 60) + '분 일찍';
    if (!num(seconds)) return '정시';
    return num(seconds) < 60 ? Math.round(num(seconds)) + '초' : Math.ceil(num(seconds) / 60) + '분';
  }
  function bundleCount(d) {
    var rows = state.reversal && state.reversal.uiDays, row = rows && rows[d];
    return row && Array.isArray(row.completedSessions) ? new Set(row.completedSessions).size : 0;
  }
  function reversalControls(r, prefix) {
    var reservation = r.reservation, candidates = r.tomorrowCandidates || [], selected = reservation && reservation.day === E.addDays(day(), 1) ? reservation.cardId : '';
    var current = reservation && cardMap[reservation.cardId];
    return '<div class="ex-reversal-controls"><h3>내일의 첫 질문을 정해두세요</h3><p class="ex-muted">오늘 틀렸거나 내일까지 다시 볼 질문에서 고릅니다. 정답은 시작할 때 가려집니다.</p>' + (current ? '<div class="ex-booked"><span>예약 ' + esc(reservation.day) + (reservation.plannedTime ? ' · ' + esc(reservation.plannedTime) : '') + '</span><p>' + esc(current.prompt) + '</p></div>' : '') + '<form data-reversal-form><div class="ex-reversal-form-grid"><label class="ex-field" for="' + prefix + '-cue">시작 신호<input id="' + prefix + '-cue" name="cue" maxlength="160" value="' + esc(r.cue || '') + '" placeholder="예: 아침 커피를 내려놓으면"></label><label class="ex-field" for="' + prefix + '-time">예정 시작 시각 <span class="ex-muted">선택 · 한국 시간</span><input id="' + prefix + '-time" name="plannedTime" type="time" value="' + esc(r.plannedTime || '') + '"></label></div><label class="ex-field" for="' + prefix + '-question">내일 첫 질문<select id="' + prefix + '-question" name="cardId" ' + (candidates.length ? '' : 'disabled') + '><option value="">' + (candidates.length ? '질문을 선택하세요' : '학습 후 예약할 질문이 여기에 나타납니다') + '</option>' + candidates.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === selected ? ' selected' : '') + '>' + esc(c.prompt.length > 120 ? c.prompt.slice(0, 117) + '…' : c.prompt) + '</option>'; }).join('') + '</select></label><div class="ex-row ex-control-actions"><button class="ex-btn ex-btn-primary ex-btn-small" type="submit" ' + (candidates.length ? '' : 'disabled') + '>내일 첫 질문 예약</button><button class="ex-btn ex-btn-small" type="button" data-save-cue>시작 신호·시각 저장</button>' + (reservation ? '<button class="ex-btn ex-btn-quiet ex-btn-small" type="button" data-clear-reservation>예약 해제</button>' : '') + '</div><p class="ex-form-status ex-muted" data-reversal-status role="status"></p></form>' + reflectionMarkup(r.today, prefix) + '</div>';
  }
  function reflectionMarkup(row, prefix) {
    var intent = row && row.returnIntent, labels = ['전혀 없음', '낮음', '보통', '있음', '매우 큼'];
    return '<fieldset class="ex-reflection"><legend>내일 다시 시작할 마음 <span class="ex-muted">선택 · 하루 한 번</span></legend><div class="ex-intent-options">' + labels.map(function (label, i) { return '<label><input type="radio" name="' + prefix + '-intent" data-return-intent value="' + i + '"' + (intent === i ? ' checked' : '') + '><span><b>' + i + '</b>' + label + '</span></label>'; }).join('') + '<label class="ex-intent-skip"><input type="radio" name="' + prefix + '-intent" data-return-intent value=""' + (intent === null || intent === undefined ? ' checked' : '') + '><span>기록 안 함</span></label></div><p class="ex-form-status ex-muted" data-reflection-status role="status">정답·시간·학습 항목은 자동 기록됩니다. 직접 적는 기록은 하루 5분 이내로 마칩니다.</p></fieldset>';
  }
  function reversalMarkup(r) {
    var row = r.today || {}, first = r.startCard, future = r.reservation && r.reservation.day > day() ? cardMap[r.reservation.cardId] : null;
    var recovered = (row.recoveredIds || []).map(function (id) { return cardMap[id]; }).filter(Boolean);
    return '<section class="ex-card ex-reversal" aria-labelledby="ex-reversal-title"><div class="ex-reversal-lead"><div><div class="ex-eyebrow">TOMORROW STARTS HERE</div><h2 id="ex-reversal-title">내일의 반전</h2><p class="ex-soft">오늘 고친 답을, 다음 날 첫 시도에 스스로 꺼내는 순간.</p></div><span class="ex-reversal-tag">작게 시작 · 실제 회복 확인</span></div><div class="ex-reversal-grid"><div class="ex-first-question"><div class="ex-kicker">' + (pendingSession ? '중단한 질문부터 이어서' : r.reservation && r.reservation.day <= day() ? '예약한 오늘 첫 질문' : '오늘 첫 질문') + '</div>' + (r.cue ? '<p class="ex-cue">' + esc(r.cue) + (r.plannedTime ? ' · ' + esc(r.plannedTime) : '') + '</p>' : '<p class="ex-cue">첫 질문 하나부터 시작해 보세요.</p>') + '<p class="ex-first-prompt">' + esc(pendingSession && cardMap[pendingSession.ids[pendingSession.index]] ? cardMap[pendingSession.ids[pendingSession.index]].prompt : first ? first.prompt : '오늘 필요한 회상을 마쳤습니다. 추가 연습으로 이어갈 수 있습니다.') + '</p><button class="ex-btn ex-btn-primary" data-action="' + (pendingSession ? 'resume' : 'rescue') + '">' + (pendingSession ? '첫 질문 이어가기 →' : '첫 2분 시작 →') + '</button><p class="ex-muted ex-start-note">' + (pendingSession ? '저장된 ' + pendingSession.ids.length + '문항 묶음을 이어갑니다. 2분은 다시 시작하기 위한 목표이며, 남은 질문은 나누어 진행할 수 있습니다.' : '2분 동안 첫 질문부터 시작합니다. 짧은 세트는 최대 2문항이며 시간 제한은 없습니다. 하루 전체 목표는 아래에 남아 있습니다.') + '</p>' + (future ? '<p class="ex-next-cue">내일 예약됨 · ' + esc(future.prompt) + '</p>' : '') + '</div><div class="ex-reversal-outcomes"><div class="ex-reversal-metrics"><div><span>오늘 교정</span><b>' + num(row.corrections) + '</b><small>같은 날 다시 맞힘</small></div><div><span>지연 첫 무힌트 회상</span><b class="ex-ratio">' + ratio(row.delayedCorrect, row.delayedAttempts) + '</b><small>이전 학습일 이후 첫 회상</small></div><div class="ex-recovery-metric"><span>실제 회복</span><b>' + num(row.recoveries) + '</b><small>과거 오답 → 날짜 넘긴 첫 성공</small></div></div><p class="ex-muted">오늘 재검사 ' + (r.retestCards || []).length + '개 · 내일 재검사 ' + num(r.tomorrowRetestCount) + '개. 당일 교정은 실제 회복과 따로 셉니다.</p>' + (recovered.length ? '<ul class="ex-recovered-list">' + recovered.slice(0, 3).map(function (c) { return '<li><span>회복 확인</span>' + esc(c.prompt) + '</li>'; }).join('') + '</ul>' : '<p class="ex-no-recovery">아직 확인된 회복은 0개입니다. 다음 날의 첫 회상이 쌓이면 여기에 나타납니다.</p>') + '</div></div><details class="ex-reversal-details"><summary>내일 첫 질문 예약 · 시작 신호 · 짧은 기록</summary>' + reversalControls(r, 'home') + '</details></section>';
  }
  function observationMarkup(r) {
    return '<section class="ex-section ex-card ex-observation"><div class="ex-section-header"><h2>7일 관찰</h2><span class="ex-muted">학습은 자동 기록 · 회고는 5분 이내</span></div><p class="ex-muted">첫 회상은 선택지·힌트 없이 시작한 그날의 첫 응답입니다. 1일 뒤·3일 뒤는 직전 학습일과의 간격이며, 교정과 회복은 따로 기록합니다. —는 측정값이 없습니다.</p><div class="ex-table-scroll" role="region" aria-label="최근 7일 학습 기록" tabindex="0"><table class="ex-observation-table"><thead><tr><th scope="col">날짜</th><th scope="col">시작 지연</th><th scope="col">완료 묶음<br>학습 항목</th><th scope="col">첫 무힌트</th><th scope="col">1일 뒤</th><th scope="col">3일 뒤</th><th scope="col">당일 교정</th><th scope="col">회복</th><th scope="col">학습 시간</th><th scope="col">재방문 의향</th></tr></thead><tbody>' + (r.recentDays || []).map(function (row) { return '<tr' + (row.day === day() ? ' data-today="true"' : '') + '><th scope="row">' + esc(row.day.slice(5).replace('-', '/')) + (row.day === day() ? '<small>오늘</small>' : '') + '</th><td>' + delayLabel(row.startDelaySeconds) + '</td><td>' + bundleCount(row.day) + '묶음 / ' + num(row.uniqueStudied) + '개</td><td>' + ratio(row.firstCorrect, row.firstAttempts) + '</td><td>' + ratio(row.d1Correct, row.d1Attempts) + '</td><td>' + ratio(row.d3Correct, row.d3Attempts) + '</td><td>' + num(row.corrections) + '</td><td class="ex-recovery-cell">' + num(row.recoveries) + '</td><td>' + (num(row.seconds) ? (num(row.seconds) / 60).toFixed(1) + '분' : '—') + '</td><td>' + (row.returnIntent === null || row.returnIntent === undefined ? '—' : num(row.returnIntent) + '/4') + '</td></tr>'; }).join('') + '</tbody></table></div><p class="ex-muted ex-observation-note">시작 지연은 입력·선택·말로 회상 시작을 누른 시점부터 예정 시각과 비교합니다. 학습 시간은 실제 응답 시작 후 화면이 보이는 동안 측정하며, 페이지를 열고 준비하는 시간은 제외합니다. 묶음은 완료한 세트 수이고, 항목은 그날 다룬 고유 문항 수입니다.</p></section>';
  }
  function bindReversal(onSaved) {
    root.querySelectorAll('[data-reversal-form]').forEach(function (form) {
      function savePreferences(reserve) {
        var status = form.querySelector('[data-reversal-status]');
        try {
          refreshState();
          var cue = form.elements.cue.value, time = form.elements.plannedTime.value, id = form.elements.cardId.value;
          if (reserve && !(E.getReversal(C, state, day()).tomorrowCandidates || []).some(function (c) { return c.id === id; })) { status.textContent = '내일 확인할 질문을 목록에서 선택해 주세요.'; return; }
          var next = E.setReversalPreferences(state, {cue:cue, plannedTime:time}, {today:day()});
          if (reserve) next = E.reserveFirst(next, id, {today:day(), plannedTime:time});
          state = next;
          var saved = persist();
          status.textContent = saved ? (reserve ? '내일 첫 질문을 예약했습니다.' : '시작 신호와 예정 시각을 저장했습니다.') : storageWarning;
          if (saved && onSaved) { notice = status.textContent; onSaved(); }
          announce(status.textContent);
        } catch (err) { status.textContent = '설정을 저장하지 못했습니다. 입력한 질문과 시각을 확인해 주세요.'; announce(status.textContent); }
      }
      form.addEventListener('submit', function (ev) { ev.preventDefault(); savePreferences(true); });
      form.querySelector('[data-save-cue]').addEventListener('click', function () { savePreferences(false); });
      var clear = form.querySelector('[data-clear-reservation]');
      if (clear) clear.addEventListener('click', function () { refreshState(); state = E.reserveFirst(state, null, {today:day()}); var saved = persist(); form.querySelector('[data-reversal-status]').textContent = saved ? '첫 질문 예약을 해제했습니다. 예정 복습은 유지됩니다.' : storageWarning; if (saved && onSaved) onSaved(); announce(saved ? '첫 질문 예약을 해제했습니다.' : storageWarning); });
    });
    root.querySelectorAll('[data-return-intent]').forEach(function (input) { input.addEventListener('change', function () { refreshState(); state = E.recordReflection(state, {today:day(), returnIntent:input.value === '' ? null : Number(input.value)}); var saved = persist(), status = input.closest('fieldset').querySelector('[data-reflection-status]'); status.textContent = saved ? (input.value === '' ? '오늘 재방문 의향은 미측정으로 남깁니다.' : '오늘 재방문 의향을 기록했습니다. ' + input.value + '/4') : storageWarning; announce(status.textContent); }); });
  }
  function dashboard() {
    if (expeditionApi() && viewMode !== 'plan') expeditionHome();
    else planDashboard();
  }
  function planDashboard() {
    if (!ensureRoot()) return;
    root.setAttribute('data-scene', 'plan');
    announce(storageWarning || '');
    activeSession = null;
    startedAt = 0; elapsedBeforePause = 0;
    refreshState();
    pendingSession = getPending();
    var p = E.getPlan(C, state, day()), s = E.summary(C, state, day()), reversal = E.getReversal(C, state, day());
    var remaining = num(p.totalRemaining), completed = num(p.totalCompletedToday), target = num(p.totalTarget);
    var examDate = state.settings.examDate;
    var deficit = Math.max(0, Math.ceil(num(p.estimatedMinutes) - num(p.capacityMinutes)));
    var migrated = state.migrations && state.migrations.legacyV1 ? num(state.migrations.legacyV1.imported) : 0;
    var dday = p.daysRemaining > 0 ? 'D−' + p.daysRemaining : p.daysRemaining === 0 ? 'D-DAY' : '시험일 이후';
    root.innerHTML =
      (expeditionApi() ? '<button class="ex-btn ex-btn-quiet ex-btn-small xp-plan-return" data-action="world">← 원정 지도로</button>' : '') + '<div class="ex-top"><div><div class="ex-eyebrow">MERIDIAN · EXAM PLAN</div><h1>오늘의 기억을<br>시험일까지.</h1><p class="ex-intro">전 범위를 먼저 만나고, 잊기 전에 다시 꺼냅니다.<br>남은 분량과 날짜로 오늘의 학습량을 계산합니다.</p></div><div class="ex-deadline"><div class="ex-dday">' + esc(dday) + '</div><div class="ex-date">' + esc(examDate.replace(/-/g, '.')) + ' 기말고사</div><button class="ex-btn ex-btn-quiet ex-btn-small" data-action="settings">계획 설정</button></div></div>' +
      (storageWarning ? '<div class="ex-notice ex-notice-error" role="alert">' + esc(storageWarning) + '</div>' : '') +
      (notice ? '<div class="ex-notice" role="status">' + esc(notice) + '</div>' : '') +
      (p.studyDeadlinePassed ? '<div class="ex-notice">설정된 시험일입니다. 필수 분량의 마감은 시험 전날이며, 아직 남은 내용은 과목별 기록에서 확인하고 선택 복습할 수 있습니다. 다음 시험을 준비한다면 날짜를 바꿔주세요.</div>' : '') +
      reversalMarkup(reversal) +
      '<div class="ex-main-grid"><div class="ex-card ex-daily"><div class="ex-eyebrow">TODAY’S MISSION</div><h2>' + (p.studyDeadlinePassed ? '시험일 이후 선택 복습' : remaining ? '오늘 남은 학습' : '오늘 계획을 마쳤습니다') + '</h2><div class="ex-target-number">' + remaining + '<small>개 항목</small></div><div class="ex-plan-parts"><span>신규 <b>' + num(p.newRemaining) + '</b></span><span>복습 <b>' + num(p.dueCount) + '</b></span><span>예상 <b>' + Math.ceil(num(p.remainingMinutes)) + '</b>분</span></div>' +
      '<div class="ex-progress-label"><span>오늘 계획</span><b>' + completed + ' / ' + target + '개 완료</b></div><div class="ex-track" role="progressbar" aria-label="오늘 계획 완료" aria-valuenow="' + pct(completed, target) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + pct(completed, target) + '%"></span></div>' +
      '<p class="ex-muted" style="margin-top:10px">신규 목표 ' + num(p.newTarget) + '개 · 처음 본 내용도 틀렸다면 다시 확인합니다.</p>' +
      (deficit ? '<div class="ex-alert">오늘 전체 계획의 예상 시간이 설정한 하루 ' + num(p.capacityMinutes) + '분보다 ' + deficit + '분 많습니다. 날짜·학습시간을 조정하거나 세트를 나눠 진행하세요.</div>' : '<div class="ex-alert">12개씩 나눠 진행합니다. 한 세트 완료와 하루 목표 완료는 별개입니다.</div>') +
      '<div class="ex-plan-cta"><button class="ex-btn ex-btn-primary" data-action="' + (pendingSession ? 'resume' : 'start') + '">' + (pendingSession ? '이어서 학습 · ' + pendingSession.index + '/' + pendingSession.ids.length : remaining ? '오늘 학습 시작 →' : '추가 혼합 회상 →') + '</button><button class="ex-btn" data-action="rescue">첫 2분 시작</button></div></div>' +
      '<div class="ex-card"><div class="ex-row ex-between"><h2>전 범위 현황</h2><span class="ex-muted">학습 ' + s.total + '개 · 검토 ' + num(s.verificationPending) + '개</span></div><div class="ex-stats"><div><div class="ex-stat-label">아직 처음</div><div class="ex-stat-value">' + s.unseen + '</div></div><div><div class="ex-stat-label">접한 내용</div><div class="ex-stat-value">' + s.seen + '</div></div><div><div class="ex-stat-label">숙련 확인</div><div class="ex-stat-value">' + s.mastered + '</div></div></div>' + track(s.seen, s.mastered, s.total) +
      '<div class="ex-small-lines"><div>숙련 기준 <b>서로 다른 3일에 성공</b></div><div>첫 회독 목표 <b>' + esc(p.coverageDeadline) + '</b></div><div>마무리 복습 <b>시험 전 ' + num(state.settings.reserveDays) + '일</b></div><div>오늘 기록 <b>' + num(s.reviewsToday) + '회 응답 · ' + num(s.studyMinutesToday).toFixed(1) + '분</b></div></div><div class="ex-day-strip" aria-label="최근 14일 실제 응답 기록">' + activityStrip() + '</div><p class="ex-muted" style="margin-top:9px">접속만으로 진도가 오르지 않습니다. 숙련은 자가채점·퀴즈 기록에 따른 지표입니다.</p></div></div>' +
      '<div id="exam-settings" class="ex-card ex-settings" ' + (settingsOpen ? '' : 'hidden') + '><div class="ex-row ex-between"><h2>시험 계획</h2><button class="ex-btn ex-btn-quiet ex-btn-small" data-action="settings">닫기</button></div><form id="exam-settings-form"><div class="ex-settings-grid"><label class="ex-field">시험일<input name="examDate" type="date" value="' + esc(examDate) + '" required min="2020-01-01" max="2100-12-31"></label><label class="ex-field">하루 학습 가능 시간<input name="dailyMinutes" type="number" min="5" max="600" step="5" value="' + num(state.settings.dailyMinutes) + '" required><small>분 · 필요한 양을 숨기지 않고 비교합니다.</small></label><label class="ex-field">마무리 복습 기간<input name="reserveDays" type="number" min="0" max="60" value="' + num(state.settings.reserveDays) + '" required><small>일 · 이 기간 전에 새 내용을 한 번씩 봅니다.</small></label></div><p class="ex-muted">예상 시간은 초기에는 항목당 약 45초, 기록이 쌓이면 실제 응답 시간을 바탕으로 계산합니다. 시험 합격이나 완전 암기를 보장하는 수치는 아닙니다.</p><div class="ex-row" style="margin-top:15px"><button class="ex-btn ex-btn-primary" type="submit">계획 적용</button><span id="exam-settings-error" class="ex-alert" role="alert"></span></div></form></div>' +
      observationMarkup(reversal) + forecastMarkup(p) + '<div class="ex-section"><div class="ex-section-header"><h2>과목별 기억 지도</h2><div class="ex-legend"><span><i class="ex-dot"></i>학습 중</span><span><i class="ex-dot ex-dot-master"></i>숙련</span></div></div><div class="ex-topics">' + topicsSummary().map(function (t) {
        return '<article class="ex-topic"><div class="ex-row ex-between"><h3 class="ex-topic-name">' + esc(t.label) + '</h3><span class="ex-topic-count">' + t.total + '개</span></div><div class="ex-topic-meta">접함 ' + t.seen + ' · 숙련 ' + t.mastered + ' · 복습 ' + t.due + '</div>' + track(t.seen, t.mastered, t.total) + '<div class="ex-row"><button class="ex-btn" data-action="topic" data-topic="' + esc(t.id) + '">이 과목 회상</button><button class="ex-btn ex-btn-quiet" data-action="tool" data-tool="' + esc(t.tool) + '">관련 학습도구 ↗</button></div></article>';
      }).join('') + '</div></div>' +
      '<div class="ex-section"><div class="ex-section-header"><h2>한 번 더 도전</h2><span class="ex-muted">추가 연습도 기록에 반영됩니다.</span></div><div class="ex-challenges"><div class="ex-challenge"><h3>약점 재대결</h3><p>최근 오답과 불확실한 항목을 먼저 다시 꺼냅니다.</p><button class="ex-btn ex-btn-small" data-action="weak">약점 5개</button></div><div class="ex-challenge"><h3>혼합 회상 20</h3><p>과목을 섞어 단서 없이 설명합니다. 자가채점으로 확인합니다.</p><button class="ex-btn ex-btn-small" data-action="mock">20개 도전</button></div><div class="ex-challenge"><h3>내일도 떠오를까?</h3><p>같은 날 반복은 숙련 일수에 중복 반영하지 않습니다.</p><button class="ex-btn ex-btn-small" data-action="start">오늘 계획 계속</button></div></div></div>' +
      '<div class="ex-footer"><div><h3>기록을 이어가세요</h3><p class="ex-muted" style="margin-top:4px">이 브라우저에 저장됩니다. 기기를 바꿀 때는 백업을 복원하세요.' + (migrated ? '<br>기존 기록에서 ' + migrated + '개 항목을 보존해 가져왔습니다.' : '') + '</p></div><div class="ex-row"><button class="ex-btn ex-btn-small" data-action="export">학습 기록 백업</button><button class="ex-btn ex-btn-small" data-action="import">백업 복원</button><button class="ex-btn ex-btn-quiet ex-btn-small" data-action="legacy">기존 통계 보기</button><input id="exam-import-file" type="file" accept="application/json,.json" hidden></div></div>' +
      '<details class="ex-coverage"><summary>교재 확인이 필요한 ' + num(s.verificationPending) + '개 항목</summary><p>원래 도구끼리 정답이 다른 항목은 자동 출제와 숙련 분모에서 보류했습니다. 수업 교재와 확인한 뒤 학습 범위를 확정해야 합니다.</p>' + C.cards.filter(function (c) { return c.needsVerification; }).map(function (c) { return '<div class="ex-coverage-item"><b>' + esc(c.prompt) + '</b><div>' + esc(sourceLabels[c.tool] || c.tool) + ' · ' + esc(c.answer) + '</div><span>' + esc(c.sourceConflict || '') + '</span></div>'; }).join('') + '</details>' +
      '<details class="ex-coverage"><summary>학습 범위와 숙련 기준 확인</summary><p>기존 22개 도구의 정적 학습자료를 공통 회상 목록으로 연결했습니다. 같은 지식을 다른 방향으로 묻는 항목도 포함되므로 항목 수는 고유한 의학 사실의 수와 같지 않습니다. 원문 출처별 표현은 그대로 유지합니다.</p><div class="ex-coverage-list">' + C.coverage.map(function (x) { return '<div class="ex-coverage-item"><b>' + esc(x.label) + '</b><span>' + esc(x.note) + '</span></div>'; }).join('') + '</div><p style="margin-top:12px">정답과 일치하게 회상한 날이 서로 다른 3일에 쌓여야 숙련으로 표시됩니다. 최근 오답은 다시 복습합니다. 기존의 누적 오답 횟수나 방문 기록은 숙련으로 바꾸지 않습니다. 기록 백업에는 직접 추가한 오디오 파일은 포함되지 않습니다.</p></details>';
    bindDashboard();
  }
  function bindDashboard() {
    root.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.action;
        if (action === 'start') start('today', 12);
        else if (action === 'resume') resume();
        else if (action === 'world') { viewMode = 'world'; dashboard(); }
        else if (action === 'weak') start('weak', 5);
        else if (action === 'mock') start('mock', 20);
        else if (action === 'rescue') start('today', 2, null, true);
        else if (action === 'topic') start('topic', 12, btn.dataset.topic);
        else if (action === 'tool') openTool(btn.dataset.tool);
        else if (action === 'settings') { settingsOpen = !settingsOpen; var form = root.querySelector('#exam-settings'); form.hidden = !settingsOpen; if (settingsOpen) form.scrollIntoView({block:'nearest', behavior:reducedMotion() ? 'instant' : 'smooth'}); }
        else if (action === 'export') exportBackup();
        else if (action === 'import') root.querySelector('#exam-import-file').click();
        else if (action === 'legacy') { document.getElementById('mount').classList.toggle('exam-show-legacy'); var show = document.getElementById('mount').classList.contains('exam-show-legacy'); btn.textContent = show ? '기존 통계 접기' : '기존 통계 보기'; if (show) { var old = document.querySelector('#mount>.hm-wrap'); if (old) old.scrollIntoView({block:'start'}); } }
      });
    });
    root.querySelector('#exam-settings-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.currentTarget, next = f.elements.examDate.value, minutes = Number(f.elements.dailyMinutes.value), reserve = Number(f.elements.reserveDays.value);
      var validDate = /^\d{4}-\d{2}-\d{2}$/.test(next) && E.addDays(next, 0) === next;
      if (!validDate || minutes < 5 || minutes > 600 || reserve < 0 || reserve > 60 || !Number.isInteger(minutes) || !Number.isInteger(reserve)) { root.querySelector('#exam-settings-error').textContent = '날짜, 학습시간 5~600분, 복습 기간 0~60일을 확인해 주세요.'; return; }
      refreshState();
      state.settings = Object.assign({}, state.settings, {examDate:next, dailyMinutes:minutes, reserveDays:reserve});
      state = E.normalizeState(state, C, day());
      var saved = persist(); settingsOpen = false; notice = saved ? '시험일까지 남은 분량으로 계획을 다시 계산했습니다.' : storageWarning; dashboard(); announce(notice);
    });
    root.querySelector('#exam-import-file').addEventListener('change', function (ev) { var file = ev.target.files && ev.target.files[0]; if (file) importFile(file); });
    bindReversal(dashboard);
  }
  function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function openTool(tool) {
    if (tool && typeof window.__activate === 'function') { if (activeSession) { prepareToolVisit(tool); saveSession(); } window.__activate(tool); }
  }
  function prepareToolVisit(tool) {
    var draft = currentDraft(), card = activeSession && cardMap[activeSession.ids[activeSession.index]];
    if (isExpedition()) markRoomExposure('', tool || (card && card.tool));
    if (!draft || !card || draft.revealed) return;
    freezeOriginal(card); draft.usedHint = true; usedHint = true; exposeCurrent(card);
  }
  function stopLegacySession() { if (window.HubSession && typeof window.HubSession.cancel === 'function') window.HubSession.cancel(); }
  function rolloverSession() {
    if (!activeSession || activeSession.day === day()) return false;
    saveSession();
    notice = '한국 시간 기준으로 날짜가 바뀌었습니다. 이전 응답을 오늘의 첫 무힌트 성공으로 바꾸지 않고, 새 오늘 계획에서 시작합니다.';
    dashboard(); announce(notice); return true;
  }
  function start(mode, limit, topic, rescue) {
    viewMode = 'plan';
    stopLegacySession();
    refreshState();
    var cards = E.buildSession(C, state, {mode:mode, limit:limit, topic:topic, today:day(), seed:Date.now()});
    if (!cards.length && (mode === 'today' || rescue)) cards = E.buildSession(C, state, {mode:'mock', limit:rescue ? 2 : limit, today:day()});
    if (!cards.length) { notice = mode === 'weak' ? '현재 표시할 약점이 없습니다. 오늘 학습이나 혼합 회상을 시작해 보세요.' : '이 조건에 해당하는 항목이 없습니다.'; dashboard(); return; }
    activeSession = {version:1, sessionId:'session-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10), day:day(), mode:mode, topic:topic || null, rescue:!!rescue, ids:cards.map(function (c) { return c.id; }), index:0, initialCount:cards.length, results:[], retries:{}, drafts:{}};
    startedAt = 0; elapsedBeforePause = 0; feedback = ''; saveSession(); renderCard();
  }
  function resume() { stopLegacySession(); activeSession = getPending(); if (!activeSession) { if (expeditionApi() && viewMode !== 'plan') expeditionHome(); else start('today', 12); return; } viewMode = isExpedition() ? 'world' : 'plan'; feedback = '중단했던 질문과 원답부터 이어갑니다.'; renderCard(); if (root && isExpedition()) root.scrollIntoView({block:'start'}); }
  function labelMode() { if (activeSession.rescue) return '첫 2분 · 짧은 세트'; return ({today:'오늘의 학습', weak:'약점 재대결', mock:'혼합 회상', topic:'주제 집중'})[activeSession.mode] || '회상 연습'; }
  function markStarted() {
    if (rolloverSession()) return false;
    var draft = currentDraft();
    if (!draft || draft.revealed || draft.graded) return false;
    if (!draft.started) {
      draft.started = true;
      startedAt = document.hidden ? 0 : Date.now();
      refreshState();
      state = E.recordStart(state, {today:day(), now:Date.now()});
      persist();
    }
    var oral = root && root.querySelector('#exam-recall-start'), note = root && root.querySelector('#exam-attempt-note');
    if (oral) oral.hidden = true;
    if (note) note.textContent = '회상을 시작했습니다. 답을 확인하기 전 생각을 남겨두세요.';
    saveSession();
    return true;
  }
  function freezeOriginal(card) {
    var draft = currentDraft(), scratch = root && root.querySelector('#exam-scratch');
    if (!draft) return;
    if (draft.originalAnswer === null) {
      if (scratch) draft.text = scratch.value;
      draft.originalAnswer = draft.text || (draft.choiceValue === null ? '' : draft.choiceValue);
    }
    if (scratch) scratch.readOnly = true;
  }
  function exposeCurrent(card) {
    var draft = currentDraft();
    refreshState();
    state = E.recordExposure(state, card.id, {today:day(), attemptId:draft.attemptId});
    persist();
  }
  function choiceMarkup(card) {
    var draft = currentDraft();
    sessionChoices = draft.choices.slice();
    selectedChoice = draft.choiceValue === null ? null : sessionChoices.indexOf(draft.choiceValue);
    if (selectedChoice < 0) selectedChoice = null;
    usedHint = draft.usedHint;
    if (!sessionChoices.length) return '';
    return (card.requiresChoices ? '<p class="ex-muted">원문 선택지에서 고르세요. 선택형 응답은 첫 무힌트 회상과 따로 기록합니다.</p>' : '<button class="ex-btn ex-btn-quiet ex-btn-small" id="exam-choice-hint"' + (draft.usedHint || draft.revealed ? ' hidden' : '') + '>선택지 힌트 보기</button>') + '<div id="exam-choices" class="ex-choices" ' + (card.requiresChoices || draft.usedHint ? '' : 'hidden') + '>' + sessionChoices.map(function (v, n) { return '<button type="button" class="ex-choice" data-choice="' + n + '" aria-pressed="' + (selectedChoice === n) + '"' + (draft.revealed ? ' disabled' : '') + '><span class="ex-choice-index">' + (n + 1) + '</span><span>' + esc(v) + '</span><span class="ex-choice-verdict"></span></button>'; }).join('') + '</div>';
  }
  function answerMarkup(card, draft) {
    var record = state.records[card.id], first = record && record.reversal && record.reversal.firstAnswer;
    var original = draft.originalAnswer || (draft.started ? '말로 회상 · 입력한 답 없음' : '입력한 답 없음 · 회상 시작 기록 없음');
    return '<div class="ex-answer-comparison"><div class="ex-original"><div class="ex-answer-label">' + (draft.usedHint ? '힌트 전 원답 · 보존' : '확인 전 원답 · 보존') + '</div><p>' + esc(original) + '</p>' + (draft.choiceValue !== null && draft.choiceValue !== draft.originalAnswer ? '<p class="ex-selected-answer"><span>선택한 답</span>' + esc(draft.choiceValue) + '</p>' : '') + '</div><div class="ex-answer"><div class="ex-answer-label">정답 · 비교</div>' + esc(card.answer) + '</div></div>' + (card.detail ? '<div class="ex-detail">' + esc(card.detail) + '</div>' : '') + (first && first.day === day() && first.attemptId !== draft.attemptId ? '<details class="ex-prior-answer"><summary>오늘 첫 응답의 원답 보기</summary><p>' + esc(first.originalAnswer || '입력한 답 없음 · 말로 회상') + '</p></details>' : '') + '<p class="ex-muted ex-grade-help">' + (draft.usedHint ? '힌트를 사용했습니다. 원답을 보존하고 다시 확인할 항목으로 남깁니다.' : !draft.started ? '회상 시작 없이 정답을 확인했습니다. 이번 응답은 첫 무힌트 성공에 포함되지 않습니다.' : '말로 답한 경우도 직접 정답과 비교해 채점합니다. 맞힌 뒤의 교정은 첫 응답을 바꾸지 않습니다.') + '</p><div class="ex-grades" aria-label="회상 결과 자가채점"><button class="ex-btn ex-grade" data-grade="0">1 · 몰랐음<small>다시 연습</small></button><button class="ex-btn ex-grade" data-grade="1">2 · 헷갈림<small>다시 확인</small></button><button class="ex-btn ex-grade" data-grade="2">3 · 맞혔음<small>스스로 회상</small></button><button class="ex-btn ex-grade" data-grade="3">4 · 바로 떠오름<small>확실하게 회상</small></button></div>';
  }
  function applyRevealed(card, draft) {
    var area = root.querySelector('#exam-answer-area');
    area.hidden = false; area.innerHTML = answerMarkup(card, draft);
    root.querySelector('#exam-reveal').hidden = true;
    root.querySelector('#exam-scratch').readOnly = true;
    var oral = root.querySelector('#exam-recall-start'); if (oral) oral.hidden = true;
    var incorrect = (card.requiresChoices && selectedChoice === null) || (selectedChoice !== null && sessionChoices[selectedChoice] !== card.answer);
    root.querySelectorAll('[data-choice]').forEach(function (b) { b.disabled = true; var n = Number(b.dataset.choice); if (sessionChoices[n] === card.answer) { b.dataset.correct = 'true'; b.querySelector('.ex-choice-verdict').textContent = '✓ 정답'; } else if (n === selectedChoice) b.querySelector('.ex-choice-verdict').textContent = '선택 · 오답'; });
    root.querySelectorAll('[data-grade]').forEach(function (b) { if ((incorrect || usedHint) && Number(b.dataset.grade) >= 2) b.disabled = true; b.addEventListener('click', function () { grade(Number(b.dataset.grade)); }); });
  }
  function renderCard() {
    if (isExpedition()) { renderExpedition(); return; }
    if (!ensureRoot() || !activeSession) return;
    root.setAttribute('data-scene', 'plan');
    if (rolloverSession()) return;
    announce(storageWarning || '');
    if (activeSession.index >= activeSession.ids.length) { checkpoint(); return; }
    var card = cardMap[activeSession.ids[activeSession.index]];
    if (!card) { activeSession.index++; renderCard(); return; }
    var topic = C.topics.find(function (t) { return t.id === card.topic; });
    var r = state.records[card.id], dates = r && Array.isArray(r.successDays) ? r.successDays.length : 0, draft = currentDraft();
    revealed = draft.revealed; elapsedBeforePause = draft.elapsedMs; startedAt = draft.started && !document.hidden ? Date.now() : 0;
    root.innerHTML = '<div class="ex-study"><div class="ex-study-head"><button class="ex-btn ex-btn-quiet ex-btn-small" data-action="pause">← 계획으로</button><div class="ex-study-meta">' + esc(labelMode()) + ' · ' + (activeSession.index + 1) + '/' + activeSession.ids.length + '</div></div><div class="ex-track" role="progressbar" aria-label="세트 진행" aria-valuenow="' + pct(activeSession.index, activeSession.ids.length) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + pct(activeSession.index, activeSession.ids.length) + '%"></span></div><div class="ex-study-status" role="status">' + esc(feedback) + '</div>' + (activeSession.rescue ? '<p class="ex-muted ex-rescue-note">착수 목표 2분 · 최대 2문항의 짧은 세트입니다. 시간 제한은 없으며, 언제든 계획으로 돌아갈 수 있습니다.</p>' : '') + '<article class="ex-card ex-question-card"><div class="ex-row ex-between"><div class="ex-eyebrow">' + esc(topic ? topic.label : card.topic) + '</div><span class="ex-muted">' + (r && r.seen ? '기존 숙련 지표 · 성공 날짜 ' + Math.min(3, dates) + '/3' : '처음 만나는 항목') + '</span></div><h2 class="ex-question">' + esc(card.prompt) + '</h2>' + choiceMarkup(card) + '<label class="ex-field" for="exam-scratch">먼저 떠올린 답 <span class="ex-muted">입력은 선택입니다. 정답·힌트를 본 뒤 원답은 바뀌지 않습니다.</span><textarea class="ex-textarea" id="exam-scratch" rows="3" maxlength="2000" placeholder="핵심만 적거나 아래에서 말로 회상을 시작하세요." autocomplete="off"' + (draft.originalAnswer !== null ? ' readonly' : '') + '>' + esc(draft.text) + '</textarea></label><div class="ex-recall-actions"><button class="ex-btn ex-btn-small" id="exam-recall-start"' + (draft.started || draft.revealed ? ' hidden' : '') + '>말로 회상 시작</button><p id="exam-attempt-note" class="ex-muted">' + (draft.originalAnswer !== null ? '확인 전 원답이 보존되어 있습니다.' : draft.started ? '회상을 시작했습니다. 생각한 답을 정답과 비교해 주세요.' : '입력·선택·말로 회상 시작부터 시간을 기록합니다. 구술 답은 자가채점입니다.') + '</p></div><button class="ex-btn ex-btn-primary ex-reveal" id="exam-reveal"' + (draft.revealed ? ' hidden' : '') + '>정답 확인 <span class="ex-muted" style="color:inherit">· Space</span></button><div id="exam-answer-area" hidden></div></article><div class="ex-study-foot"><span>정답을 보고 알았던 경우에는 ‘몰랐음’ 또는 ‘헷갈림’을 선택하세요.</span><button class="ex-btn ex-btn-quiet ex-btn-small" data-action="source">' + esc(sourceLabels[card.tool] || '관련 학습도구') + ' · 힌트로 보기 ↗</button></div></div>';
    root.querySelector('[data-action="pause"]').addEventListener('click', function () { var saved = saveSession(); dashboard(); announce(saved ? '중간 위치와 원답을 저장했습니다. 이어서 학습할 수 있습니다.' : storageWarning); });
    root.querySelector('[data-action="source"]').addEventListener('click', function () { openTool(card.tool); });
    root.querySelector('#exam-reveal').addEventListener('click', reveal);
    root.querySelector('#exam-recall-start').addEventListener('click', markStarted);
    root.querySelector('#exam-scratch').addEventListener('input', function (ev) { var d = currentDraft(); if (d.revealed || d.originalAnswer !== null) return; d.text = ev.target.value; markStarted(); });
    var hint = root.querySelector('#exam-choice-hint');
    if (hint) hint.addEventListener('click', function () { var d = currentDraft(); if (d.revealed) return; freezeOriginal(card); d.usedHint = true; usedHint = true; hint.hidden = true; root.querySelector('#exam-choices').hidden = false; exposeCurrent(card); saveSession(); root.querySelector('#exam-attempt-note').textContent = '힌트 전 원답을 보존했습니다. 이번 응답은 무힌트 성공과 구별합니다.'; announce('선택지 힌트를 사용한 응답으로 기록합니다.'); });
    root.querySelectorAll('[data-choice]').forEach(function (b) { b.addEventListener('click', function () { if (revealed || !markStarted()) return; var d = currentDraft(); if (!d) return; selectedChoice = Number(b.dataset.choice); d.choiceValue = sessionChoices[selectedChoice]; root.querySelectorAll('[data-choice]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); saveSession(); }); });
    if (draft.revealed) applyRevealed(card, draft);
    saveSession();
    root.scrollIntoView({block:'start'});
  }
  function reveal() {
    if (isExpedition()) { revealExpedition(); return; }
    if (!activeSession || revealed) return;
    if (rolloverSession()) return;
    var card = cardMap[activeSession.ids[activeSession.index]], draft = currentDraft();
    freezeOriginal(card); draft.revealed = true; revealed = true;
    exposeCurrent(card); saveSession(); applyRevealed(card, draft);
    var incorrect = (card.requiresChoices && selectedChoice === null) || (selectedChoice !== null && sessionChoices[selectedChoice] !== card.answer);
    announce(incorrect ? '선택한 답은 오답입니다. 원답과 정답의 차이를 확인하고 다시 연습으로 남깁니다.' : usedHint ? '힌트를 사용한 항목은 다시 확인할 대상으로 남깁니다.' : '원답을 보존했습니다. 정답과 비교해 채점하세요.');
  }
  function grade(value) {
    if (isExpedition()) { gradeExpedition(value); return; }
    if (busy || !activeSession || !revealed || value < 0 || value > 3) return;
    busy = true;
    captureTime();
    var id = activeSession.ids[activeSession.index], draft = currentDraft(), seconds = Math.round(draft.elapsedMs / 1000), card = cardMap[id];
    if (usedHint || (selectedChoice !== null && sessionChoices[selectedChoice] !== card.answer)) value = Math.min(value, 1);
    if (card.requiresChoices && selectedChoice === null) value = 0;
    var choice = card.requiresChoices || usedHint || selectedChoice !== null;
    refreshState();
    state = E.review(state, id, value, {today:day(), now:Date.now(), seconds:seconds, evidence:choice ? 'choice' : 'recall', unaided:draft.started && !choice && activeSession.day === day(), usedHint:draft.usedHint, originalAnswer:draft.originalAnswer || '', attemptId:draft.attemptId});
    persist();
    var result = state.lastReview || {}, r = state.records[id] || {};
    if (result.duplicate && Number.isInteger(result.grade)) value = result.grade;
    activeSession.results.push({id:id, grade:value, attemptId:draft.attemptId, seconds:seconds, reversalStatus:result.reversalStatus || null});
    if (value < 2 && !activeSession.rescue && !activeSession.retries[id]) {
      activeSession.retries[id] = 1;
      var insertion = Math.min(activeSession.ids.length, activeSession.index + 4);
      activeSession.ids.splice(insertion, 0, id);
      feedback = '원답을 남겼습니다. 다른 질문 뒤에 교정하고, 다음 날에도 다시 확인합니다.';
    } else if (value < 2) feedback = '다시 볼 항목으로 남겼습니다. 오늘 교정과 다음 날 재검사를 따로 확인합니다.';
    else if (result.reversalStatus === 'recovered') feedback = '실제 회복 1개. 과거 오답을 날짜가 지난 첫 무힌트 회상에서 맞혔습니다.';
    else if (result.reversalStatus === 'corrected') feedback = '오늘 교정했습니다. 첫 응답의 원답은 그대로 두고, 다음 날 첫 회상에서 다시 확인합니다.';
    else if (r.mastered) feedback = '기존 숙련 기준인 서로 다른 날짜의 성공이 쌓였습니다. 첫 무힌트 지표는 따로 기록합니다.';
    else feedback = '응답을 기록했습니다. 다음 복습일 ' + (result.due || r.due || '예정') + ' · 같은 날 반복은 첫 무힌트 성공을 늘리지 않습니다.';
    activeSession.index++; startedAt = 0; elapsedBeforePause = 0;
    saveSession(); busy = false; renderCard();
  }
  function recordBundle(finished) {
    refreshState();
    if (!state.reversal || typeof state.reversal !== 'object') state.reversal = {featureVersion:1};
    if (!state.reversal.uiDays || typeof state.reversal.uiDays !== 'object' || Array.isArray(state.reversal.uiDays)) state.reversal.uiDays = {};
    var rows = state.reversal.uiDays, date = day(), row = rows[date];
    if (!row || typeof row !== 'object' || Array.isArray(row)) row = {};
    var sessions = Array.isArray(row.completedSessions) ? row.completedSessions.filter(function (id) { return typeof id === 'string'; }) : [];
    if (finished.sessionId && sessions.indexOf(finished.sessionId) < 0) sessions.push(finished.sessionId);
    row.completedSessions = sessions; rows[date] = row;
    persist();
  }
  function checkpoint() {
    if (isExpedition()) { expeditionCheckpoint(); return; }
    var finished = activeSession, results = finished.results || [], unique = new Map();
    results.forEach(function (r) { unique.set(r.id, r.grade); });
    var correct = Array.from(unique.values()).filter(function (g) { return g >= 2; }).length;
    var missed = Array.from(unique.entries()).filter(function (x) { return x[1] < 2; });
    recordBundle(finished);
    var p = E.getPlan(C, state, day()), reversal = E.getReversal(C, state, day());
    var recovered = results.filter(function (r) { return r.reversalStatus === 'recovered'; }).length, corrected = results.filter(function (r) { return r.reversalStatus === 'corrected'; }).length;
    activeSession = null; startedAt = 0; elapsedBeforePause = 0; saveSession(); pendingSession = null;
    root.innerHTML = '<div class="ex-study"><div class="ex-card ex-checkpoint"><div class="ex-eyebrow">SESSION COMPLETE</div><h1>' + (finished.rescue ? '첫 질문부터 시작했습니다.' : '한 묶음을 마쳤습니다.') + '</h1><p class="ex-soft">' + (finished.rescue ? '짧은 세트 완료입니다. 2분은 착수 목표이며, 오늘 남은 전체 분량은 아래에서 확인합니다.' : '방금의 교정과 날짜를 넘긴 첫 성공을 따로 확인합니다.') + '</p><div class="ex-result-grid"><div><b>' + unique.size + '</b><span>다룬 항목</span></div><div><b>' + corrected + '</b><span>이번 묶음 당일 교정</span></div><div><b>' + recovered + '</b><span>이번 묶음 실제 회복</span></div></div><p class="ex-muted">마지막 응답 성공 ' + correct + '개 · 재확인 필요 ' + missed.length + '개 · 응답 시간 ' + (results.reduce(function (sum, r) { return sum + num(r.seconds); }, 0) / 60).toFixed(1) + '분</p><p class="ex-soft ex-remaining-plan">오늘 남은 계획 <strong>' + num(p.totalRemaining) + '개</strong> · 예상 ' + Math.ceil(num(p.remainingMinutes)) + '분</p>' + (missed.length ? '<details class="ex-missed-details"><summary>다시 볼 원답과 정답 ' + missed.length + '개</summary><ul class="ex-review-list">' + missed.slice(0, 6).map(function (x) { var c = cardMap[x[0]], record = state.records[x[0]], original = record && record.reversal && record.reversal.lastFailureAnswer; return '<li><b>' + esc(c.prompt) + '</b><span class="ex-missed-original">원답: ' + esc(original && original.originalAnswer || '입력 없음 · 자가채점') + '</span><span>정답: ' + esc(c.answer) + '</span></li>'; }).join('') + '</ul></details>' : '<p class="ex-muted ex-checkpoint-note">당일 정답은 교정의 결과일 수 있습니다. 실제 회복은 다음 날 이후의 첫 무힌트 성공으로 확인합니다.</p>') + '<div class="ex-checkpoint-planning">' + reversalControls(reversal, 'checkpoint') + '</div><div class="ex-row ex-checkpoint-actions"><button class="ex-btn ex-btn-primary" id="exam-next-set">' + (p.totalRemaining ? '다음 12개 이어가기' : '혼합 회상 더 하기') + '</button><button class="ex-btn" id="exam-finish">오늘 계획 보기</button></div></div></div>';
    root.querySelector('#exam-next-set').addEventListener('click', function () { start('today', 12); });
    root.querySelector('#exam-finish').addEventListener('click', dashboard);
    bindReversal(null);
    announce('한 묶음을 마쳤습니다. 실제 회복 ' + recovered + '개, 오늘 남은 계획은 ' + num(p.totalRemaining) + '개입니다.');
    root.scrollIntoView({block:'start'});
  }
  var REGIONS = {
    systems:{symbol:'gate', name:'기경의 관문', line:'흩어진 계통에 이름을 되찾아 주세요.', color:'#e8bb72', x:22, y:22},
    points:{symbol:'river', name:'오수의 강', line:'혈과 이름을 이어, 막힌 물길을 여세요.', color:'#77d4cd', x:50, y:46},
    history:{symbol:'tower', name:'기록의 탑', line:'의가와 저서의 잊힌 기록을 찾아가세요.', color:'#c4a2ef', x:52, y:8},
    syndromes:{symbol:'storm', name:'징후의 폭풍', line:'닮은 증상 사이에서 경맥을 찾아내세요.', color:'#eeb18a', x:81, y:29},
    routes:{symbol:'serpent', name:'유주의 뱀길', line:'원문의 조각을 이어 다음 길을 여세요.', color:'#a7cf83', x:76, y:69},
    back_cross:{symbol:'bridge', name:'교회의 다리', line:'높이와 교차점을 잇는 다리를 놓으세요.', color:'#80bfe5', x:18, y:67},
    saam:{symbol:'mirror', name:'오행의 거울', line:'오행의 관계를 비추어 보사의 길을 찾으세요.', color:'#e6a5bf', x:45, y:83}
  };
  var OUTCOMES = {
    recovered:{label:'실제 회복', title:'기억의 매듭이 풀렸습니다', line:'지난 오답을 날짜가 지난 첫 무힌트 회상으로 되찾았습니다.', glyph:'✦'},
    'first-recall':{label:'직접 회상', title:'새로운 기억에 불이 켜졌습니다', line:'단서 없이 꺼낸 기억 하나가 지도에 남습니다.', glyph:'✧'},
    connected:{label:'기억 연결', title:'기억과 기억 사이, 길이 이어졌습니다', line:'서로 다른 날에 직접 회상한 연결입니다.', glyph:'⌁'},
    'first-choice':{label:'보기·조각 확인', title:'단서를 정확히 읽어냈습니다', line:'보기·조각을 사용해 정답을 확인했습니다. 직접 회상 기록과 따로 남깁니다.', glyph:'◇'},
    corrected:{label:'오늘 교정', title:'오늘의 연결을 고쳤습니다', line:'원답은 그대로 남깁니다. 날짜가 지난 첫 회상에서 다시 확인합니다.', glyph:'↻'},
    assisted:{label:'도움으로 확인', title:'실마리를 따라 길을 확인했습니다', line:'도움을 받은 응답입니다. 스스로 꺼낸 기억과 구별해 남깁니다.', glyph:'◌'},
    miss:{label:'다시 볼 연결', title:'다음에 풀 실마리를 남겼습니다', line:'원답과 정답을 비교해 보세요. 이번 판의 문항 수는 늘어나지 않습니다.', glyph:'⋈'},
    practice:{label:'다시 확인', title:'기억을 한 번 더 살펴봤습니다', line:'이번 응답은 연습으로 남습니다. 같은 기억을 반복해 지도를 부풀리지 않습니다.', glyph:'✓'},
    duplicate:{label:'저장된 응답', title:'이 연결은 이미 기록했습니다', line:'저장된 결과에서 이어갑니다.', glyph:'✓'}
  };
  function shuffle(values) {
    var result = values.slice();
    for (var i = result.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), item = result[i]; result[i] = result[j]; result[j] = item; }
    return result;
  }
  function regionInfo(id) { return REGIONS[id] || REGIONS.systems; }
  function topicLabel(id) { var topic = C.topics.find(function (t) { return t.id === id; }); return topic ? topic.label : '경락'; }
  function art(symbol, className, label) {
    return '<svg class="xp-art ' + (className || '') + '" viewBox="0 0 320 320" ' + (label ? 'role="img" aria-label="' + esc(label) + '"' : 'aria-hidden="true"') + '><use href="expedition-art.svg#' + symbol + '"></use></svg>';
  }
  function expeditionPreferences() {
    var p = state.expedition;
    return {approach:p && p.approach === 'recall' ? 'recall' : 'play', sound:!!(p && p.sound === true)};
  }
  function setExpeditionPreference(key, value) {
    refreshState();
    var old = state.expedition && typeof state.expedition === 'object' && !Array.isArray(state.expedition) ? state.expedition : {};
    state.expedition = Object.assign({}, old, {version:1}); state.expedition[key] = value; persist();
  }
  function soundButton() {
    var on = expeditionPreferences().sound;
    return '<button class="xp-text-button xp-sound" data-x-action="sound" aria-pressed="' + on + '" title="효과음 ' + (on ? '끄기' : '켜기') + '"><span aria-hidden="true">' + (on ? '♪' : '♩') + '</span> 효과음 ' + (on ? '켜짐' : '꺼짐') + '</button>';
  }
  function playEffect(kind) {
    if (!expeditionPreferences().sound) return;
    try {
      var Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      if (!effectContext) effectContext = new Audio();
      if (effectContext.state === 'suspended') effectContext.resume();
      var notes = kind === 'recovered' ? [392, 523.25, 659.25] : kind === 'miss' ? [261.63, 293.66] : [392, 523.25];
      notes.forEach(function (frequency, i) {
        var oscillator = effectContext.createOscillator(), gain = effectContext.createGain(), now = effectContext.currentTime + i * .08;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.035, now + .015); gain.gain.exponentialRampToValueAtTime(.001, now + .22);
        oscillator.connect(gain); gain.connect(effectContext.destination); oscillator.start(now); oscillator.stop(now + .23);
      });
    } catch (err) { /* Effects are optional; a blocked audio context never interrupts a question. */ }
  }
  function bindExpeditionActions() {
    root.querySelectorAll('[data-x-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        var action = button.dataset.xAction;
        if (action === 'start' || action === 'next-route') startExpedition('primary');
        else if (action === 'repair') startExpedition('repair');
        else if (action === 'resume') resume();
        else if (action === 'plan') { if (activeSession) saveSession(); viewMode = 'plan'; dashboard(); root.scrollIntoView({block:'start'}); }
        else if (action === 'world' || action === 'finish') { if (activeSession) saveSession(); viewMode = 'world'; expeditionHome(); root.scrollIntoView({block:'start'}); }
        else if (action === 'sound') {
          var on = !expeditionPreferences().sound; setExpeditionPreference('sound', on);
          button.setAttribute('aria-pressed', String(on)); button.innerHTML = '<span aria-hidden="true">' + (on ? '♪' : '♩') + '</span> 효과음 ' + (on ? '켜짐' : '꺼짐');
          if (on) playEffect('practice');
        }
      });
    });
  }
  function worldMapMarkup(world) {
    var paths = ['M176 92 Q270 12 416 52', 'M416 52 Q570 30 648 124', 'M176 92 Q205 185 400 195', 'M648 124 Q530 238 400 195', 'M400 195 Q260 210 144 290', 'M400 195 Q620 220 608 298', 'M144 290 Q210 405 360 360', 'M608 298 Q520 400 360 360'];
    return '<div class="xp-world-map" aria-label="경락 원정의 일곱 학습 구역"><div class="xp-map-grain"></div><svg class="xp-world-lines" viewBox="0 0 800 430" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="400" cy="215" rx="359" ry="194" class="xp-map-orbit"/><ellipse cx="400" cy="215" rx="295" ry="159" class="xp-map-orbit xp-map-orbit-inner"/>' + paths.map(function (p) { return '<path d="' + p + '"/>'; }).join('') + '<path class="xp-map-river" d="M10 210 C110 148 210 365 355 233 S575 55 790 206"/></svg><div class="xp-map-compass" aria-hidden="true"><span>✧</span>MERIDIAN</div>' + world.topics.map(function (topic) {
      var r = regionInfo(topic.id), selected = worldTopic === topic.id;
      return '<button class="xp-region' + (selected ? ' is-selected' : '') + (topic.recalled ? ' is-lit' : '') + (topic.choiceConfirmed ? ' is-recognized' : '') + '" data-region="' + esc(topic.id) + '" aria-pressed="' + selected + '" style="--region:' + r.color + ';--rx:' + r.x + '%;--ry:' + r.y + '%"><span class="xp-region-island">' + art(r.symbol, '', '') + '<span class="xp-region-halo"></span></span><span class="xp-region-name">' + esc(r.name) + '</span><span class="xp-region-topic">' + esc(topic.label) + '</span><span class="xp-region-memory">' + (topic.recalled ? '✦ 회상 ' + topic.recalled : topic.choiceConfirmed ? '◇ 보기 확인 ' + topic.choiceConfirmed : '새로운 길') + '</span></button>';
    }).join('') + '<span class="xp-map-caption">FIND YOUR WAY BACK</span></div>';
  }
  function expeditionHome() {
    if (!expeditionApi()) { viewMode = 'plan'; planDashboard(); return; }
    if (!ensureRoot()) return;
    root.setAttribute('data-scene', 'world'); activeSession = null; startedAt = 0; elapsedBeforePause = 0; busy = false;
    refreshState(); pendingSession = getPending();
    var X = expeditionApi(), today = X.getDay(C, state, {today:day()}), world = X.getWorld(C, state, {today:day()}), pref = expeditionPreferences();
    var room = X.buildRoom(C, state, {today:day(), topic:worldTopic, approach:pref.approach, phase:'primary'});
    var pendingCard = pendingSession && cardMap[pendingSession.ids[pendingSession.index]];
    var pendingTopic = pendingSession && C.topics.some(function (t) { return t.id === pendingSession.topic; }) ? pendingSession.topic : pendingCard && pendingCard.topic;
    var chosenTopic = pendingTopic || worldTopic || (room.ids[0] && cardMap[room.ids[0]].topic) || C.topics[0].id, region = regionInfo(chosenTopic);
    var chosen = world.topics.find(function (t) { return t.id === chosenTopic; }), isPending = !!pendingSession, count = isPending ? pendingSession.ids.length : room.ids.length;
    var button = isPending ? '<button class="xp-primary" data-x-action="resume">' + (pendingSession.expedition ? '원정 이어가기' : '진행 중인 학습 이어가기') + '<span aria-hidden="true">→</span></button>' : count ? '<button class="xp-primary" data-x-action="start">' + count + '문항 원정 시작<span aria-hidden="true">→</span></button>' : today.unresolved ? '<button class="xp-primary" data-x-action="repair">남은 연결 살펴보기<span aria-hidden="true">→</span></button>' : '<button class="xp-primary" data-x-action="plan">학습 기록 살펴보기<span aria-hidden="true">↗</span></button>';
    var roomLine = isPending ? '중단한 위치와 원답이 기다립니다.' : count ? '길을 고르고, 정한 ' + count + '문항에서 끝나는 한 판.' : today.status === 'after-exam' ? '설정한 시험일 이후입니다. 기록에서 날짜와 연습을 선택하세요.' : today.unresolved ? '첫 원정은 마쳤습니다. 다시 확인할 연결이 남아 있습니다.' : '오늘의 계획을 마쳤습니다. 여기서 쉬어도 좋습니다.';
    root.innerHTML = '<div class="xp-home"><header class="xp-topbar"><div class="xp-wordmark"><span class="xp-wordmark-mark" aria-hidden="true">✧</span> MERIDIAN <span>기억을 잇는 세계</span></div><nav aria-label="원정 보조 메뉴">' + soundButton() + '<button class="xp-text-button" data-x-action="plan">학습 기록 · 계획 <span aria-hidden="true">↗</span></button></nav></header>' +
      (storageWarning ? '<div class="ex-notice ex-notice-error" role="alert">' + esc(storageWarning) + '</div>' : '') + (notice ? '<div class="ex-notice" role="status">' + esc(notice) + '</div>' : '') +
      '<div class="xp-home-heading"><div><p class="xp-eyebrow">THE MERIDIAN EXPEDITION</p><h1>흩어진 기억을,<br><em>하나의 길로.</em></h1></div><p>일곱 구역을 건너고,<br>어제의 오답과 다시 만나는 원정.</p></div>' +
      '<div class="xp-world-layout"><section class="xp-map-panel"><div class="xp-map-label"><span><i></i> 원정 지도</span><button class="xp-text-button' + (!worldTopic ? ' is-active' : '') + '" id="expedition-recommend">추천 경로</button></div>' + worldMapMarkup(world) + '<div class="xp-map-legend"><span><i class="xp-legend-lit"></i>직접 떠올린 기억</span><span><i class="xp-legend-choice"></i>보기로 확인한 기억</span><span class="xp-map-note">학습을 위한 상상 지도</span></div></section>' +
      '<aside class="xp-departure" style="--region:' + region.color + '"><div class="xp-guide-welcome">' + art('guide', 'xp-guide-hero', '등불을 든 원정 안내자') + '<p>길은 작게 열고,<br><strong>기억은 직접 찾아요.</strong></p></div><div class="xp-route-intro"><p class="xp-eyebrow">' + (isPending ? '진행 중인 원정' : worldTopic ? '선택한 구역을 먼저' : '오늘의 추천 경로') + '</p><h2>' + esc(region.name) + '</h2><p>' + esc(region.line) + '</p></div>' +
      '<div class="xp-approaches" role="group" aria-label="공략 방식"><button data-approach="play" aria-pressed="' + (pref.approach === 'play') + '"><span aria-hidden="true">◇</span><strong>플레이</strong><small>원래 보기 · 조각 맞추기</small></button><button data-approach="recall" aria-pressed="' + (pref.approach === 'recall') + '"><span aria-hidden="true">✧</span><strong>직접 회상</strong><small>내 힘으로 답 꺼내기</small></button></div>' +
      '<div class="xp-departure-route" aria-label="이번 판 ' + count + '문항">' + Array.from({length:count}, function (_, i) { var boss = isPending ? pendingSession.expedition && pendingSession.ids[i] === pendingSession.expedition.bossId : room.ids[i] === room.bossId; return '<span class="' + (boss ? 'is-boss' : '') + '">' + (boss ? '⋈' : i + 1) + '</span>'; }).join('') + '</div>' +
      (room.bossId && !isPending ? '<p class="xp-boss-teaser"><span aria-hidden="true">⋈</span> 지난 오답의 <b>기억 매듭</b>이 기다립니다.</p>' : '') + button + '<p class="xp-room-promise">' + roomLine + '</p><div class="xp-region-proof"><span>이 구역의 기억</span><b>회상 ' + num(chosen && chosen.recalled) + ' <i>·</i> 보기 확인 ' + num(chosen && chosen.choiceConfirmed) + '</b></div></aside></div>' +
      '<footer class="xp-home-foot"><div><span class="xp-tiny-label">오늘의 실제 계획</span><p>' + (today.status === 'after-exam' ? '설정한 학습 기간 종료' : today.remaining ? '아직 만나지 않은 질문 <b>' + today.remaining + '</b>개' : '오늘의 첫 시도 완료') + ' <span>·</span> 다시 확인 <b>' + today.unresolved + '</b>개 <span>·</span> 전체 남은 필수 <b>' + today.requiredRemaining + '</b>개</p></div><div class="xp-world-proof"><span><b>' + world.totals.recalled + '</b> 직접 회상</span><span><b>' + world.totals.recovered + '</b> 실제 회복</span><button class="xp-text-button" data-x-action="plan">예약 · 원답 · 백업 ↗</button></div></footer></div>';
    bindExpeditionActions();
    root.querySelectorAll('[data-region]').forEach(function (button) { button.addEventListener('click', function () { worldTopic = button.dataset.region; expeditionHome(); }); });
    root.querySelectorAll('[data-approach]').forEach(function (button) { button.addEventListener('click', function () { setExpeditionPreference('approach', button.dataset.approach); expeditionHome(); }); });
    root.querySelector('#expedition-recommend').addEventListener('click', function () { worldTopic = null; expeditionHome(); });
    announce(storageWarning || '구역과 공략 방식을 고르고, 짧은 원정을 시작하세요.');
  }
  function startExpedition(phase, topic, approach) {
    if (!expeditionApi()) return;
    stopLegacySession(); refreshState();
    var selectedTopic = topic === undefined ? worldTopic : topic, selectedApproach = approach || expeditionPreferences().approach;
    var room = expeditionApi().buildRoom(C, state, {today:day(), topic:selectedTopic, approach:selectedApproach, phase:phase === 'repair' ? 'repair' : 'primary'});
    if (!room.ids.length) { notice = phase === 'repair' ? '지금 다시 확인할 연결은 없습니다.' : '오늘의 첫 원정을 모두 마쳤습니다. 남은 교정과 계획은 기록에서 확인할 수 있습니다.'; viewMode = 'world'; expeditionHome(); return; }
    viewMode = 'world';
    activeSession = {version:1, sessionId:'expedition-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10), day:day(), mode:'expedition', topic:selectedTopic || null, ids:room.ids.slice(), index:0, initialCount:room.ids.length, results:[], retries:{}, drafts:{}, expedition:Object.assign({version:1, forks:{}}, room)};
    startedAt = 0; elapsedBeforePause = 0; feedback = ''; busy = false; saveSession(); renderExpedition(); root.scrollIntoView({block:'start'});
  }
  function markRoomExposure(material, tool) {
    if (!isExpedition()) return;
    var currentId = activeSession.ids[activeSession.index], answered = new Set(activeSession.results.map(function (r) { return r.id; })), text = String(material || '');
    refreshState();
    var todayEntry = state.days[day()] || {}, plan = E.getPlan(C, state, day());
    (todayEntry.reviewedIds || []).forEach(function (id) { answered.add(id); });
    var candidates = new Set(activeSession.ids);
    (plan.dueCards || []).concat(plan.newCards || []).forEach(function (card) { candidates.add(card.id); });
    var observed = state.reversal && state.reversal.days && state.reversal.days[day()], exposures = observed && observed.exposures || {}, changed = false;
    candidates.forEach(function (id) {
      var card = cardMap[id];
      if (id === currentId || answered.has(id) || !card || (state.records[id] && state.records[id].lastReviewed === day()) || Object.prototype.hasOwnProperty.call(exposures, id)) return;
      if ((tool && card.tool === tool) || (typeof card.answer === 'string' && card.answer && text.indexOf(card.answer) >= 0)) {
        state = E.recordExposure(state, id, {today:day(), attemptId:null}); changed = true;
      }
    });
    if (changed) persist();
  }
  function roomResult(session, id) { return session.results.find(function (r) { return r.id === id; }); }
  function outcomeInfo(result) { var kind = result && result.outcome && result.outcome.kind; return OUTCOMES[kind] || OUTCOMES.practice; }
  function roomMapMarkup(session, complete) {
    var count = session.ids.length, nodes = session.ids.map(function (id, index) { return {x:count === 1 ? 50 : 7 + index * 86 / (count - 1), y:index % 2 ? 32 : 63}; });
    var paths = nodes.slice(1).map(function (n, i) {
      var previous = nodes[i], result = roomResult(session, session.ids[i]);
      var kind = result && result.outcome && OUTCOMES[result.outcome.kind] ? result.outcome.kind : 'pending';
      return '<path class="xp-path-' + kind + '" d="M' + previous.x + ',' + previous.y + ' C' + (previous.x + (n.x - previous.x) / 2) + ',' + previous.y + ' ' + (previous.x + (n.x - previous.x) / 2) + ',' + n.y + ' ' + n.x + ',' + n.y + '"/>';
    }).join('');
    return '<div class="xp-room-map' + (complete ? ' is-complete' : '') + '"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + paths + '</svg><ol aria-label="이번 원정의 ' + count + '개 연결">' + session.ids.map(function (id, index) {
      var result = roomResult(session, id), kind = result && result.outcome && OUTCOMES[result.outcome.kind] ? result.outcome.kind : (!complete && index === session.index ? 'current' : 'pending');
      var boss = session.expedition.bossId === id, info = result ? outcomeInfo(result) : null;
      return '<li data-room-node="' + index + '" data-result="' + kind + '"' + (boss ? ' data-boss="true"' : '') + (index === session.index && !complete ? ' aria-current="step"' : '') + ' style="--nx:' + nodes[index].x + '%;--ny:' + nodes[index].y + '%"><span class="xp-node-ring"><span>' + (info ? info.glyph : boss ? '⋈' : index + 1) + '</span></span><span class="xp-node-label">' + (boss ? '기억 매듭' : info ? info.label : '연결 ' + (index + 1)) + '</span></li>';
    }).join('') + '</ol></div>';
  }
  function canFork() {
    if (!isExpedition()) return false;
    var s = activeSession, index = s.index, x = s.expedition;
    if ((index !== 1 && index !== 3) || index + 1 >= s.ids.length || x.forks[String(index)]) return false;
    return [index, index + 1].every(function (i) {
      var d = s.drafts[String(i)];
      return s.ids[i] !== x.bossId && s.ids[i] !== x.reservedFirstId && !(d && (d.started || d.revealed || d.graded || d.presented));
    });
  }
  function chooseFork(offset) {
    if (rolloverSession() || !canFork() || (offset !== 0 && offset !== 1)) return;
    var s = activeSession, index = s.index;
    if (offset === 1) {
      var id = s.ids[index]; s.ids[index] = s.ids[index + 1]; s.ids[index + 1] = id;
      var a = String(index), b = String(index + 1), draft = s.drafts[a];
      if (s.drafts[b]) s.drafts[a] = s.drafts[b]; else delete s.drafts[a];
      if (draft) s.drafts[b] = draft; else delete s.drafts[b];
    }
    s.expedition.ids = s.ids.slice(); s.expedition.forks[String(index)] = s.ids[index];
    startedAt = 0; elapsedBeforePause = 0; saveSession(); renderExpedition(); root.scrollIntoView({block:'start'});
  }
  function roomHeader() {
    return '<header class="xp-play-top"><button class="xp-text-button" data-x-action="world">← 지도에 쉬어가기</button><span class="xp-room-name">' + (activeSession.expedition.phase === 'repair' ? '다시 잇는 원정' : activeSession.expedition.approach === 'play' ? '플레이 원정' : '직접 회상 원정') + ' <b>' + (activeSession.index + 1) + ' / ' + activeSession.ids.length + '</b></span>' + soundButton() + '</header>';
  }
  function renderFork() {
    root.innerHTML = '<div class="xp-play">' + roomHeader() + roomMapMarkup(activeSession, false) + '<section class="xp-fork"><div class="xp-fork-guide">' + art('guide', '', '길을 안내하는 등불 친구') + '</div><p class="xp-eyebrow">CHOOSE YOUR NEXT CONNECTION</p><h1>어느 길부터 열까요?</h1><p class="xp-fork-note">먼저 풀 질문을 고르세요. 다른 질문도 이번 판에 남습니다.</p><div class="xp-fork-options">' + [0, 1].map(function (offset) {
      var card = cardMap[activeSession.ids[activeSession.index + offset]], region = regionInfo(card.topic), interaction = expeditionApi().getInteraction(card, {approach:activeSession.expedition.approach, boss:false});
      return '<button data-fork="' + offset + '" style="--region:' + region.color + '">' + art(region.symbol, '', '') + '<span class="xp-fork-topic">' + esc(topicLabel(card.topic)) + '</span><strong>' + esc(card.prompt.length > 100 ? card.prompt.slice(0, 100) + '…' : card.prompt) + '</strong><span class="xp-fork-type">' + (interaction.type === 'sequence' ? '조각 잇기' : interaction.type === 'choice' ? '보기 도전' : '직접 회상') + '<i aria-hidden="true">→</i></span></button>';
    }).join('') + '</div></section></div>';
    bindExpeditionActions();
    root.querySelectorAll('[data-fork]').forEach(function (button) { button.addEventListener('click', function () { chooseFork(Number(button.dataset.fork)); }); });
    announce('갈림길입니다. 다음 두 질문 중 먼저 풀 질문을 고르세요.');
  }
  function expeditionAttemptEvent(card, attemptId) {
    var record = state.records[card.id];
    return record && Array.isArray(record.history) ? record.history.find(function (event) { return event.attemptId === attemptId && event.day === day(); }) : null;
  }
  function storedExpeditionResult(card, draft, event) {
    var existing = draft.result;
    if (existing && existing.attemptId === draft.attemptId && existing.grade === event.grade && existing.outcome && OUTCOMES[existing.outcome.kind]) return existing;
    var kind = event.grade < 2 ? (event.usedHint ? 'assisted' : 'miss') : event.reversalStatus === 'recovered' ? 'recovered' : event.reversalStatus === 'corrected' ? 'corrected' : event.usedHint ? 'assisted' : 'practice';
    return {id:card.id, grade:event.grade, attemptId:draft.attemptId, seconds:num(event.seconds), reversalStatus:event.reversalStatus || null, evidence:event.evidence, unaided:event.unaided === true, firstOfDay:event.firstOfDay === true, usedHint:event.usedHint === true, outcome:{kind:kind, advancesMemory:false, advancesChoice:false, breaksBoss:kind === 'recovered', source:event.usedHint ? 'assisted' : event.evidence === 'choice' ? 'choice' : event.unaided ? 'self-recall' : 'none'}};
  }
  function addExpeditionResult(result) {
    var index = activeSession.results.findIndex(function (r) { return r.attemptId === result.attemptId; });
    if (index < 0) activeSession.results.push(result); else activeSession.results[index] = result;
  }
  function validSubmission(draft) {
    var s = draft.submission;
    return s && s.version === 1 && s.attemptId === draft.attemptId && s.day === activeSession.day && s.type === draft.interactionType && Number.isInteger(s.grade) && s.grade >= 0 && s.grade <= 3 && (s.choiceValue === null || typeof s.choiceValue === 'string');
  }
  function expeditionRecallMarkup(draft) {
    var hint = draft.choices.length ? '<button class="xp-text-button xp-hint-button" id="exam-choice-hint"' + (draft.usedHint || draft.revealed ? ' hidden' : '') + '>단서 열기 · 원래 보기</button>' : '';
    if (draft.usedHint && draft.choices.length && !draft.revealed) hint += '<div class="xp-choice-list xp-hint-choices">' + draft.choices.map(function (choice, index) { return '<button class="xp-choice" data-x-choice="' + index + '" aria-pressed="' + (draft.choiceValue === choice) + '"><span class="xp-choice-letter">' + (index + 1) + '</span><span>' + esc(choice) + '</span></button>'; }).join('') + '</div>';
    return '<label class="xp-answer-field" for="exam-scratch"><span>먼저 떠올린 답</span><textarea id="exam-scratch" rows="2" maxlength="2000" placeholder="핵심만 적거나, 말로 회상해 보세요." autocomplete="off"' + (draft.originalAnswer !== null ? ' readonly' : '') + '>' + esc(draft.text) + '</textarea></label><div class="xp-recall-tools"><button class="xp-text-button" id="exam-recall-start"' + (draft.started || draft.revealed ? ' hidden' : '') + '>말로 회상 시작</button>' + hint + '</div><p id="exam-attempt-note" class="xp-attempt-note">' + (draft.revealed ? '확인 전 원답이 보존되었습니다.' : draft.started ? '떠올린 답을 정답과 비교해 주세요.' : '입력하거나 회상을 시작하면 시간을 기록합니다.') + '</p><button class="xp-primary" id="exam-reveal"' + (draft.revealed ? ' hidden' : '') + '>답 확인<span class="xp-key">Space</span></button><div id="exam-answer-area"' + (draft.revealed ? '' : ' hidden') + '></div>';
  }
  function objectiveMarkup(draft) {
    if (draft.interactionType === 'choice') return '<p class="xp-task-instruction">정답이라고 생각하는 문을 골라 주세요.</p><div class="xp-choice-list">' + draft.choices.map(function (choice, index) {
      return '<button class="xp-choice" data-x-choice="' + index + '" aria-pressed="' + (draft.choiceValue === choice) + '"><span class="xp-choice-letter">' + String.fromCharCode(65 + index) + '</span><span>' + esc(choice) + '</span><span class="xp-choice-check" aria-hidden="true">' + (draft.choiceValue === choice ? '✓' : '→') + '</span></button>';
    }).join('') + '</div><button class="xp-primary" id="expedition-submit"' + (draft.choiceValue === null ? ' disabled' : '') + '>이 답으로 연결<span aria-hidden="true">→</span></button><p class="xp-attempt-note">원래 보기로 도전 · 정답과 자동 비교합니다.</p>';
    var count = draft.fragments.length;
    return '<p class="xp-task-instruction">원문 조각을 순서대로 눌러 길을 완성하세요.</p><div class="xp-sequence-tray" aria-label="내가 조립한 순서">' + Array.from({length:count}, function (_, index) { var fragment = draft.assembled[index]; return '<div class="xp-sequence-slot' + (fragment === undefined ? '' : ' is-filled') + '"><span>' + (index + 1) + '</span>' + (fragment === undefined ? '<i>다음 조각</i>' : '<b>' + esc(draft.fragments[fragment]) + '</b>') + '</div>'; }).join('') + '</div><div class="xp-sequence-tools"><span>' + draft.assembled.length + ' / ' + count + '조각</span><button class="xp-text-button" id="expedition-undo"' + (!draft.assembled.length ? ' disabled' : '') + '>한 조각 되돌리기</button><button class="xp-text-button" id="expedition-reset"' + (!draft.assembled.length ? ' disabled' : '') + '>처음부터</button></div><div class="xp-fragments" aria-label="원문 조각">' + draft.fragments.map(function (fragment, index) { return '<button data-fragment="' + index + '"' + (draft.assembled.indexOf(index) >= 0 ? ' disabled aria-pressed="true"' : ' aria-pressed="false"') + '><span aria-hidden="true">' + (index + 1) + '</span>' + esc(fragment) + '</button>'; }).join('') + '</div><button class="xp-primary" id="expedition-submit"' + (draft.assembled.length !== count ? ' disabled' : '') + '>이 순서로 연결<span aria-hidden="true">→</span></button><p class="xp-attempt-note">원문 그대로의 조각 · 완성한 순서를 자동 비교합니다.</p>';
  }
  function comparisonMarkup(card, draft, withGrades) {
    var record = state.records[card.id], previous = record && record.reversal && record.reversal.lastFailureAnswer;
    var original = draft.originalAnswer || (draft.started ? '말로 회상 · 입력한 답 없음' : '입력한 답 없음');
    var selected = draft.choiceValue && draft.choiceValue !== draft.originalAnswer ? '<p class="xp-submitted"><span>제출한 답</span>' + esc(draft.choiceValue) + '</p>' : '';
    return '<div class="xp-comparison"><div><span class="xp-tiny-label">' + (draft.usedHint ? '힌트 전 내 답' : '내 답 · 보존') + '</span><p>' + esc(original) + '</p>' + selected + '</div><div><span class="xp-tiny-label">정답</span><p>' + esc(card.answer) + '</p></div></div>' +
      (activeSession.expedition.bossId === card.id && previous && previous.attemptId !== draft.attemptId ? '<div class="xp-previous-answer"><span>지난번의 내 답</span><p>' + esc(previous.originalAnswer || '입력 없음 · 자가채점') + '</p></div>' : '') +
      (card.detail ? '<details id="expedition-detail" class="xp-detail"' + (draft.detailOpen === true ? ' open' : '') + '><summary>원문 · 풀이 보기 <span aria-hidden="true">＋</span></summary><div>' + esc(card.detail) + '</div></details>' : '') +
      (withGrades ? '<p class="xp-self-grade-note">' + (draft.usedHint ? '도움을 받은 답입니다. 다시 확인할 연결로 남깁니다.' : draft.started ? '내 답을 직접 비교해 채점해 주세요.' : '회상 시작 없이 확인했습니다. 첫 무힌트 성공으로 기록하지 않습니다.') + '</p><div class="xp-grades" aria-label="회상 결과 자가채점">' + [{grade:0,label:'몰랐음',sub:'다시 익히기'}, {grade:1,label:'헷갈림',sub:'다시 확인'}, {grade:2,label:'맞혔음',sub:'직접 회상'}, {grade:3,label:'바로 떠오름',sub:'확실한 회상'}].map(function (g) { return '<button data-grade="' + g.grade + '"' + (draft.usedHint && g.grade >= 2 ? ' disabled' : '') + '><span>' + (g.grade + 1) + '</span><strong>' + g.label + '</strong><small>' + g.sub + '</small></button>'; }).join('') + '</div>' : '');
  }
  function visibleComparisonExposure(card, draft) {
    var record = state.records[card.id], prior = record && record.reversal && record.reversal.lastFailureAnswer;
    markRoomExposure(card.answer + '\n' + (draft.originalAnswer || '') + '\n' + (draft.choiceValue || '') + (activeSession.expedition.bossId === card.id && prior && prior.attemptId !== draft.attemptId ? '\n' + (prior.originalAnswer || '') : ''));
    if (draft.detailOpen === true) markRoomExposure(card.detail || '');
  }
  function bindComparison(card, draft) {
    var detail = root.querySelector('#expedition-detail');
    if (detail) detail.addEventListener('toggle', function () {
      if (!activeSession || activeSession.ids[activeSession.index] !== card.id) return;
      draft.detailOpen = detail.open === true;
      if (draft.detailOpen) markRoomExposure(card.detail || '');
      saveSession();
    });
    root.querySelectorAll('[data-grade]').forEach(function (button) { button.addEventListener('click', function () { gradeExpedition(Number(button.dataset.grade)); }); });
  }
  function renderExpedition() {
    if (!isExpedition() || !ensureRoot()) return;
    if (rolloverSession()) return;
    root.setAttribute('data-scene', 'play');
    if (activeSession.index >= activeSession.ids.length) { expeditionCheckpoint(); return; }
    captureTime();
    if (canFork()) { renderFork(); saveSession(); return; }
    var card = cardMap[activeSession.ids[activeSession.index]], draft = currentDraft(), event = expeditionAttemptEvent(card, draft.attemptId);
    if (event) {
      draft.graded = true; draft.revealed = true; draft.result = storedExpeditionResult(card, draft, event); addExpeditionResult(draft.result);
    } else if (validSubmission(draft)) {
      draft.graded = false; draft.revealed = true;
      if (draft.interactionType !== 'recall') draft.choiceValue = draft.submission.choiceValue;
      gradeExpedition(draft.submission.grade, true, true); return;
    } else if (draft.graded) { draft.graded = false; draft.usedHint = true; }
    revealed = draft.revealed; usedHint = draft.usedHint; sessionChoices = draft.choices.slice(); selectedChoice = draft.choiceValue === null ? null : sessionChoices.indexOf(draft.choiceValue);
    elapsedBeforePause = draft.elapsedMs; startedAt = draft.started && !draft.graded && !document.hidden ? Date.now() : 0;
    if (draft.graded) { renderExpeditionOutcome(card, draft); saveSession(); return; }
    draft.presented = true;
    var region = regionInfo(card.topic), boss = activeSession.expedition.bossId === card.id;
    if (draft.interactionType === 'choice' || (draft.interactionType === 'recall' && draft.usedHint)) markRoomExposure(draft.choices.join('\n'));
    if (draft.interactionType === 'sequence') markRoomExposure(draft.fragments.join('\n'));
    if (draft.revealed) visibleComparisonExposure(card, draft);
    root.innerHTML = '<div class="xp-play">' + roomHeader() + roomMapMarkup(activeSession, false) + '<article class="xp-question-stage' + (boss ? ' is-boss' : '') + '" style="--region:' + region.color + '"><div class="xp-encounter-heading"><div><p class="xp-eyebrow">' + (boss ? 'MEMORY KNOT · 기억의 매듭' : 'CONNECTION ' + String(activeSession.index + 1).padStart(2, '0')) + '</p><span class="xp-topic-chip">' + esc(topicLabel(card.topic)) + '</span>' + (boss ? '<p class="xp-boss-note">지난 오답과 다시 만났습니다.<br>지금 떠오르는 답으로 매듭에 도전하세요.</p>' : '') + '</div>' + art(boss ? 'keeper' : region.symbol, boss ? 'xp-keeper' : 'xp-question-art', boss ? '지난 오답을 지키는 기억의 매듭' : '') + '</div><h1 class="xp-question">' + esc(card.prompt) + '</h1>' + (draft.interactionType === 'recall' ? expeditionRecallMarkup(draft) : objectiveMarkup(draft)) + '</article><div class="xp-question-foot"><span>' + (draft.interactionType === 'recall' ? '원답을 남기고, 스스로 비교합니다.' : '보기·조각 성공은 직접 회상과 따로 남깁니다.') + '</span><button class="xp-text-button" data-action="source">관련 도구 · 힌트로 보기 ↗</button></div></div>';
    bindExpeditionActions();
    root.querySelector('[data-action="source"]').addEventListener('click', function () { openTool(card.tool); });
    bindExpeditionQuestion(card, draft);
    if (draft.revealed && draft.interactionType === 'recall') { root.querySelector('#exam-answer-area').innerHTML = comparisonMarkup(card, draft, true); bindComparison(card, draft); }
    saveSession();
    announce(storageWarning || (boss ? '실제 과거 오답의 기억 매듭입니다.' : '연결 ' + (activeSession.index + 1) + ' / ' + activeSession.ids.length));
  }
  function bindExpeditionQuestion(card, draft) {
    var scratch = root.querySelector('#exam-scratch'), oral = root.querySelector('#exam-recall-start'), revealButton = root.querySelector('#exam-reveal'), hint = root.querySelector('#exam-choice-hint');
    if (scratch) scratch.addEventListener('input', function (event) { if (draft.revealed || draft.originalAnswer !== null || rolloverSession()) return; draft.text = event.target.value; markStarted(); });
    if (oral) oral.addEventListener('click', markStarted);
    if (revealButton) revealButton.addEventListener('click', revealExpedition);
    if (hint) hint.addEventListener('click', function () { if (draft.revealed || rolloverSession()) return; freezeOriginal(card); draft.usedHint = true; usedHint = true; exposeCurrent(card); markRoomExposure(draft.choices.join('\n')); saveSession(); renderExpedition(); });
    root.querySelectorAll('[data-x-choice]').forEach(function (button) { button.addEventListener('click', function () {
      if (draft.graded || draft.revealed || !markStarted()) return;
      var d = currentDraft(); if (!d || activeSession.ids[activeSession.index] !== card.id) return;
      d.choiceValue = d.choices[Number(button.dataset.xChoice)]; saveSession(); renderExpedition();
    }); });
    root.querySelectorAll('[data-fragment]').forEach(function (button) { button.addEventListener('click', function () {
      if (draft.graded || !markStarted()) return;
      var d = currentDraft(), n = Number(button.dataset.fragment); if (!d || d.assembled.indexOf(n) >= 0) return;
      d.assembled.push(n); d.choiceValue = d.assembled.map(function (i) { return d.fragments[i]; }).join(' → '); saveSession(); renderExpedition();
    }); });
    var undo = root.querySelector('#expedition-undo'), reset = root.querySelector('#expedition-reset'), submit = root.querySelector('#expedition-submit');
    if (undo) undo.addEventListener('click', function () { if (rolloverSession() || draft.graded) return; draft.assembled.pop(); draft.choiceValue = draft.assembled.map(function (i) { return draft.fragments[i]; }).join(' → '); saveSession(); renderExpedition(); });
    if (reset) reset.addEventListener('click', function () { if (rolloverSession() || draft.graded) return; draft.assembled = []; draft.choiceValue = null; saveSession(); renderExpedition(); });
    if (submit) submit.addEventListener('click', submitObjective);
  }
  function revealExpedition() {
    if (!isExpedition() || rolloverSession()) return;
    var card = cardMap[activeSession.ids[activeSession.index]], draft = currentDraft();
    if (draft.graded || draft.revealed || draft.interactionType !== 'recall') return;
    freezeOriginal(card); draft.revealed = true; revealed = true; exposeCurrent(card); visibleComparisonExposure(card, draft); saveSession(); renderExpedition();
  }
  function submitObjective() {
    if (!isExpedition() || rolloverSession()) return;
    var card = cardMap[activeSession.ids[activeSession.index]], draft = currentDraft();
    if (draft.graded || draft.interactionType === 'recall') return;
    if (draft.interactionType === 'choice' && draft.choices.indexOf(draft.choiceValue) < 0) return;
    if (draft.interactionType === 'sequence') {
      if (draft.assembled.length !== draft.fragments.length) return;
      draft.choiceValue = draft.assembled.map(function (i) { return draft.fragments[i]; }).join(' → ');
    }
    if (!draft.started && !markStarted()) return;
    freezeOriginal(card); draft.revealed = true; revealed = true; exposeCurrent(card); visibleComparisonExposure(card, draft);
    gradeExpedition(draft.choiceValue === card.answer ? 2 : 0, true);
  }
  function gradeExpedition(value, objective, restoring) {
    if (!isExpedition() || busy || rolloverSession()) return;
    var card = cardMap[activeSession.ids[activeSession.index]], draft = currentDraft();
    if (draft.graded || !draft.revealed || !Number.isInteger(value) || value < 0 || value > 3) return;
    if (draft.interactionType !== 'recall' && objective !== true) return;
    if (draft.interactionType !== 'recall') value = draft.choiceValue === card.answer ? 2 : 0;
    if (draft.usedHint || (draft.interactionType === 'recall' && draft.choiceValue !== null && draft.choiceValue !== card.answer)) value = Math.min(value, 1);
    busy = true; captureTime();
    var seconds = Math.round(draft.elapsedMs / 1000), evidence = draft.interactionType !== 'recall' || draft.usedHint || draft.choiceValue !== null ? 'choice' : 'recall';
    if (restoring && validSubmission(draft)) seconds = Math.max(0, num(draft.submission.seconds));
    draft.submission = {version:1, day:activeSession.day, attemptId:draft.attemptId, type:draft.interactionType, grade:value, choiceValue:draft.choiceValue, seconds:seconds};
    saveSession(); refreshState();
    var before = state;
    state = E.review(state, card.id, value, {today:day(), now:Date.now(), seconds:seconds, evidence:evidence, unaided:draft.started && evidence === 'recall' && !draft.usedHint && activeSession.day === day(), usedHint:draft.usedHint, originalAnswer:draft.originalAnswer || '', attemptId:draft.attemptId});
    var reviewed = state.lastReview || {};
    if (reviewed.duplicate && reviewed.cardId !== card.id) {
      draft.invalidFields = Object.assign({}, draft.invalidFields || {}, {collidingAttemptId:draft.attemptId});
      draft.attemptId = activeSession.sessionId + ':' + card.id + ':restore-' + Date.now().toString(36);
      draft.usedHint = true; draft.submission = null; draft.graded = false; draft.result = null;
      busy = false; notice = '저장된 응답 식별자가 겹쳐 보수적으로 복원했습니다. 이 질문은 도움을 받은 응답으로 다시 확인합니다.'; saveSession(); renderExpedition(); announce(notice); return;
    }
    var outcome = expeditionApi().classifyOutcome(card, before, state, {today:day(), attemptId:draft.attemptId, choiceValue:draft.choiceValue});
    var event = expeditionAttemptEvent(card, draft.attemptId);
    var result = {id:card.id, grade:Number.isInteger(reviewed.grade) ? reviewed.grade : value, attemptId:draft.attemptId, seconds:seconds, reversalStatus:reviewed.reversalStatus || null, evidence:evidence, unaided:reviewed.unaided === true, firstOfDay:reviewed.firstOfDay === true, usedHint:draft.usedHint, outcome:outcome};
    if (reviewed.duplicate && event) result = storedExpeditionResult(card, draft, event);
    draft.result = result; draft.graded = true; draft.revealed = true; addExpeditionResult(result); startedAt = 0; elapsedBeforePause = draft.elapsedMs;
    persist(); saveSession(); busy = false;
    if (!restoring && !reviewed.duplicate) playEffect(outcome.kind);
    renderExpedition();
    var outcomeScene = root && root.querySelector('[data-outcome]'); if (outcomeScene) outcomeScene.scrollIntoView({block:'start'});
  }
  function renderExpeditionOutcome(card, draft) {
    var result = draft.result, info = outcomeInfo(result), kind = result.outcome && OUTCOMES[result.outcome.kind] ? result.outcome.kind : 'practice', boss = activeSession.expedition.bossId === card.id;
    visibleComparisonExposure(card, draft);
    root.innerHTML = '<div class="xp-play">' + roomHeader() + roomMapMarkup(activeSession, false) + '<section class="xp-outcome xp-outcome-' + kind + '" data-outcome="' + kind + '"><div class="xp-outcome-scene' + (boss ? ' is-boss' : '') + '"><div class="xp-outcome-orbit"></div><div class="xp-outcome-spark xp-spark-one">✦</div><div class="xp-outcome-spark xp-spark-two">✧</div>' + art(boss ? 'keeper' : 'guide', boss ? 'xp-outcome-keeper' : 'xp-outcome-guide', boss ? '기억의 매듭' : '기록을 밝히는 등불 안내자') + '<div class="xp-outcome-seal" aria-hidden="true">' + info.glyph + '</div></div><p class="xp-eyebrow">' + info.label + '</p><h1>' + info.title + '</h1><p class="xp-outcome-message">' + info.line + '</p>' + (draft.interactionType !== 'recall' ? '<p class="xp-objective-verdict" data-objective-correct="' + (draft.choiceValue === card.answer && !draft.usedHint) + '">' + (draft.choiceValue === card.answer ? '✓ ' + (draft.interactionType === 'sequence' ? '원문의 순서와 일치합니다.' : '정답과 일치합니다.') : '↻ ' + (draft.interactionType === 'sequence' ? '원문의 순서를 다시 확인해 보세요.' : '고른 답과 정답을 비교해 보세요.')) + '</p>' : '') + '<div class="xp-outcome-answer"><p class="xp-result-prompt">' + esc(card.prompt) + '</p>' + comparisonMarkup(card, draft, false) + '</div><button class="xp-primary" id="expedition-next">' + (activeSession.index + 1 >= activeSession.ids.length ? '완성한 지도 보기' : '다음 연결로') + '<span aria-hidden="true">→</span></button><p class="xp-room-promise">' + (activeSession.index + 1 >= activeSession.ids.length ? '정한 문항을 모두 만났습니다. 이번 판을 마무리해요.' : '이번 판에 ' + (activeSession.ids.length - activeSession.index - 1) + '문항 남았습니다.') + '</p></section></div>';
    bindExpeditionActions(); bindComparison(card, draft);
    root.querySelector('#expedition-next').addEventListener('click', nextExpedition);
    announce(info.title + '. ' + info.line);
  }
  function nextExpedition() {
    if (!isExpedition() || rolloverSession() || !currentDraft().graded) return;
    activeSession.index++; startedAt = 0; elapsedBeforePause = 0;
    if (activeSession.index >= activeSession.ids.length) expeditionCheckpoint();
    else { saveSession(); renderExpedition(); root.scrollIntoView({block:'start'}); }
  }
  function expeditionCheckpoint() {
    if (!isExpedition() || !ensureRoot()) return;
    var finished = activeSession;
    if (finished.results.length < finished.ids.length) return;
    recordBundle(finished);
    var today = expeditionApi().getDay(C, state, {today:day()}), reversal = E.getReversal(C, state, day());
    var counts = {recall:0, choice:0, corrected:0, recovered:0}, seconds = 0;
    finished.results.forEach(function (result) {
      seconds += num(result.seconds);
      if (result.grade >= 2 && result.evidence === 'recall' && result.unaided) counts.recall++;
      if (result.grade >= 2 && result.evidence === 'choice' && !result.usedHint) counts.choice++;
      if (result.reversalStatus === 'corrected') counts.corrected++;
      if (result.reversalStatus === 'recovered') counts.recovered++;
    });
    var candidate = (reversal.tomorrowCandidates || []).find(function (card) { return finished.ids.indexOf(card.id) >= 0 && finished.results.some(function (result) { return result.id === card.id && result.grade < 2; }); });
    if (!candidate) candidate = (reversal.tomorrowCandidates || [])[0];
    markRoomExposure(finished.ids.map(function (id) { return cardMap[id].answer; }).join('\n'));
    activeSession = null; pendingSession = null; startedAt = 0; elapsedBeforePause = 0; saveSession();
    root.setAttribute('data-scene', 'complete');
    root.innerHTML = '<div class="xp-complete" id="expedition-complete"><header class="xp-play-top"><span class="xp-wordmark">✧ MERIDIAN</span><button class="xp-text-button" data-x-action="plan">학습 기록 ↗</button></header><div class="xp-complete-heading">' + art('guide', 'xp-complete-guide', '원정을 마친 등불 안내자') + '<p class="xp-eyebrow">EXPEDITION COMPLETE</p><h1>이번 길의 끝에 도착했습니다.</h1><p>' + finished.ids.length + '개의 연결을 살펴봤어요.<br>되찾은 기억도, 다시 볼 실마리도 이 지도에 남습니다.</p></div>' + roomMapMarkup(finished, true) + '<div class="xp-complete-stats"><div><b>' + counts.recall + '</b><span>직접 회상</span></div><div><b>' + counts.choice + '</b><span>보기·조각 정답</span></div><div><b>' + counts.corrected + '</b><span>오늘 교정</span></div><div><b>' + counts.recovered + '</b><span>실제 회복</span></div></div><p class="xp-complete-time">실제 응답 ' + (seconds / 60).toFixed(1) + '분 · 실제 회복은 직접 회상에 포함됩니다.</p><div class="xp-complete-actions"><button class="xp-primary" data-x-action="finish">이번 원정 마치기<span aria-hidden="true">✓</span></button>' + (today.remaining ? '<button class="xp-secondary" data-x-action="next-route">다음 경로 · 최대 6문항 →</button>' : today.unresolved ? '<button class="xp-secondary" data-x-action="repair">다시 볼 연결 · 최대 6문항 →</button>' : '') + '</div><p class="xp-complete-remaining">' + (today.remaining ? '오늘 첫 시도 ' + today.remaining + '개 남음' : '오늘의 첫 시도 완료') + ' · 다시 확인 ' + today.unresolved + '개 · 실제 남은 필수 ' + today.requiredRemaining + '개</p><section class="xp-codex"><header><div><p class="xp-eyebrow">FIELD NOTES</p><h2>이번 길에서 만난 지식</h2></div><span>' + finished.ids.length + '개의 원문 조각</span></header><div class="xp-codex-grid">' + finished.ids.map(function (id, index) {
      var card = cardMap[id], result = roomResult(finished, id), info = outcomeInfo(result), region = regionInfo(card.topic);
      return '<article class="xp-codex-card" style="--region:' + region.color + '"><div class="xp-codex-card-head"><span>' + String(index + 1).padStart(2, '0') + ' / ' + esc(topicLabel(card.topic)) + '</span><b>' + info.glyph + ' ' + info.label + '</b></div><h3>' + esc(card.prompt) + '</h3><p>' + esc(card.answer) + '</p></article>';
    }).join('') + '</div></section>' + (candidate ? '<section class="xp-tomorrow"><div><p class="xp-eyebrow">내일 다시 만날 실마리</p><h2>' + esc(candidate.prompt) + '</h2><p>원하면 이 실제 복습 질문으로 다음 원정을 시작할 수 있어요.</p></div><button class="xp-secondary" id="expedition-reserve" data-card="' + esc(candidate.id) + '">내일 첫 질문으로 예약</button><p id="expedition-reservation-status" role="status"></p></section>' : '') + '<footer class="xp-end-note">플레이의 지도와 시험 숙련 지표는 다릅니다. 원답·복습·예약·백업은 <button class="xp-text-button" data-x-action="plan">학습 기록</button>에 보존됩니다.</footer></div>';
    bindExpeditionActions();
    var reserve = root.querySelector('#expedition-reserve');
    if (reserve) reserve.addEventListener('click', function () {
      refreshState();
      try { state = E.reserveFirst(state, reserve.dataset.card, {today:day()}); var saved = persist(); var status = root.querySelector('#expedition-reservation-status'); if (status) status.textContent = saved ? '내일의 첫 질문으로 예약했습니다.' : storageWarning; if (saved) { reserve.disabled = true; reserve.textContent = '내일 첫 질문 예약됨 ✓'; } }
      catch (err) { var status = root.querySelector('#expedition-reservation-status'); if (status) status.textContent = '지금 예약할 수 있는 질문이 바뀌었습니다. 학습 기록에서 확인해 주세요.'; }
    });
    root.scrollIntoView({block:'start'});
    announce('원정 완료. 직접 회상 ' + counts.recall + '개, 실제 회복 ' + counts.recovered + '개. 여기서 마치거나 다음 경로를 선택할 수 있습니다.');
  }
  function expeditionKey(event, tag) {
    if (!isExpedition()) return;
    var draft = currentDraft();
    if (!draft || canFork()) return;
    if (tag === 'BUTTON' && (event.key === 'Enter' || event.code === 'Space' || event.key === ' ')) return;
    if (draft.graded && (event.key === 'Enter' || event.code === 'Space' || event.key === ' ')) { event.preventDefault(); nextExpedition(); return; }
    if (draft.interactionType !== 'recall' && !draft.revealed) {
      if (/^[1-8]$/.test(event.key)) { var selector = draft.interactionType === 'sequence' ? '[data-fragment="' : '[data-x-choice="'; var button = root.querySelector(selector + (Number(event.key) - 1) + '"]'); if (button && !button.disabled) { event.preventDefault(); button.click(); } }
      else if (event.key === 'Enter' || event.code === 'Space' || event.key === ' ') { event.preventDefault(); submitObjective(); }
    } else if (draft.interactionType === 'recall') {
      if (!draft.revealed && (event.code === 'Space' || event.key === ' ')) { event.preventDefault(); revealExpedition(); }
      else if (draft.revealed && /^[1-4]$/.test(event.key)) { event.preventDefault(); gradeExpedition(Number(event.key) - 1); }
    }
  }
  function exportBackup() {
    if (activeSession) captureTime();
    refreshState();
    var legacy = {};
    LEGACY_KEYS.forEach(function (k) { var raw = safeRead(k); if (raw !== null) legacy[k] = raw; });
    var backup = {format:'meridian-exam-backup', version:1, exportedAt:new Date().toISOString(), exam:state, legacy:legacy, session:activeSession ? clone(activeSession) : unsavedSession ? clone(unsavedSession) : parse(safeRead(SESSION_STORAGE))};
    if (protectedRaw !== null) backup.unreadableOriginal = protectedRaw;
    var blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'}), url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'meridian-study-' + day() + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    announce('시험 기록과 기존 학습 기록의 백업을 내려받았습니다.');
  }
  async function importFile(file) {
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('백업 파일은 10MB 이하여야 합니다.');
      var backup = JSON.parse(await file.text());
      if (!backup || backup.format !== 'meridian-exam-backup' || backup.version !== 1 || !backup.exam || backup.exam.version !== 1 || !backup.exam.records || typeof backup.exam.records !== 'object' || Array.isArray(backup.exam.records) || Object.keys(backup.exam.records).length > 20000) throw new Error('이 시험 모드에서 내보낸 학습 기록 백업이 아닙니다.');
      if (!backup.exam.settings || !/^\d{4}-\d{2}-\d{2}$/.test(backup.exam.settings.examDate || '') || E.addDays(backup.exam.settings.examDate, 0) !== backup.exam.settings.examDate) throw new Error('백업의 시험 날짜를 확인할 수 없습니다.');
      var next = E.normalizeState(backup.exam, C, day()), changes = {};
      changes[STORAGE] = encodeStoredExam(next);
      if (backup.legacy != null && (typeof backup.legacy !== 'object' || Array.isArray(backup.legacy))) throw new Error('기존 기록 형식이 올바르지 않습니다.');
      LEGACY_KEYS.forEach(function (k) { if (backup.legacy && Object.prototype.hasOwnProperty.call(backup.legacy, k)) { if (typeof backup.legacy[k] !== 'string') throw new Error('기존 기록 형식이 올바르지 않습니다.'); var parsed = JSON.parse(backup.legacy[k]); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('기존 기록 형식이 올바르지 않습니다.'); changes[k] = backup.legacy[k]; } });
      var dateLabel = typeof backup.exportedAt === 'string' ? backup.exportedAt.slice(0, 10) : '선택한';
      if (!window.confirm(dateLabel + ' 백업으로 시험 기록과 포함된 기존 도구 기록을 교체합니다. 현재 기록이 필요하면 먼저 백업하세요. 복원할까요?')) return;
      var before = {}, written = [];
      Object.keys(changes).forEach(function (k) { before[k] = localStorage.getItem(k); });
      before[SESSION_STORAGE] = localStorage.getItem(SESSION_STORAGE);
      try { Object.keys(changes).forEach(function (k) { localStorage.setItem(k, changes[k]); written.push(k); }); localStorage.removeItem(SESSION_STORAGE); }
      catch (writeError) {
        var rollbackFailed = false;
        written.forEach(function (k) { try { if (before[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, before[k]); } catch (e) { rollbackFailed = true; } });
        throw new Error(rollbackFailed ? '저장 공간 문제로 일부 기록을 복원하지 못했습니다. 백업 파일을 보관하고 브라우저 저장 공간을 확보한 뒤 다시 복원해 주세요.' : '복원을 저장하지 못해 이전 기록으로 되돌렸습니다. 저장 공간을 확인해 주세요.');
      }
      protectedRaw = null; dirty = false; unsavedSession = null; storageWarning = ''; state = next; notice = '학습 기록을 복원했습니다. 기존 도구의 화면은 다시 열면 반영됩니다.'; dashboard(); announce(notice);
    } catch (err) { notice = '복원 실패: ' + (err && err.message ? err.message : '파일을 확인해 주세요.'); dashboard(); announce(notice); }
  }
  function onLegacyAnswer(ev) {
    var d = ev.detail || {}, ids = sourceMap[d.tool + '::' + d.cardId] || [];
    if (!ids.length || typeof d.correct !== 'boolean') return;
    refreshState();
    ids.forEach(function (id) { state = E.review(state, id, d.correct ? 2 : 0, {today:day(), now:Date.now(), seconds:0, evidence:'choice'}); });
    persist();
  }
  function boot() {
    E = window.MeridianExamEngine; C = window.MERIDIAN_EXAM_CATALOG;
    if (!E || !C || !Array.isArray(C.cards) || !C.cards.length) {
      document.getElementById('mount').classList.add('exam-show-legacy');
      announce('시험 모드를 불러오지 못했습니다. 새로고침하거나 기존 학습도구를 이용해 주세요.');
      return;
    }
    cardMap = Object.create(null); sourceMap = Object.create(null);
    C.cards.forEach(function (c) { cardMap[c.id] = c; if (c.needsVerification) return; var key = c.tool + '::' + c.sourceId; if (!sourceMap[key]) sourceMap[key] = []; sourceMap[key].push(c.id); });
    C.coverage.forEach(function (x) { sourceLabels[x.tool] = x.label; });
    loadState();
    window.addEventListener('hub:tabchange', function (ev) {
      if (activeSession) { if (ev.detail && ev.detail.id !== 'home') prepareToolVisit(ev.detail.id); saveSession(); }
      activeSession = null; startedAt = 0; elapsedBeforePause = 0;
      var tools = document.getElementById('hub-tool-list'), toggle = document.getElementById('hub-tools-toggle');
      if (tools) tools.hidden = true; if (toggle) toggle.setAttribute('aria-expanded', 'false');
      if (ev.detail && ev.detail.id === 'home') dashboard();
    });
    window.addEventListener('hub:answer', onLegacyAnswer);
    window.addEventListener('storage', function (ev) { if (ev.key === STORAGE && window.__active === 'home' && !activeSession) dashboard(); });
    window.addEventListener('pagehide', function () { if (activeSession) saveSession(); });
    document.addEventListener('visibilitychange', function () { if (!activeSession) return; if (document.hidden) { saveSession(); startedAt = 0; } else { var d = currentDraft(); if (d && d.started && !d.graded) startedAt = Date.now(); } });
    document.addEventListener('keydown', function (ev) {
      if (!activeSession || window.__active !== 'home' || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable)) return;
      if (isExpedition()) { expeditionKey(ev, tag); return; }
      if ((ev.code === 'Space' || ev.key === ' ') && !revealed) { ev.preventDefault(); reveal(); }
      else if (revealed && /^[1-4]$/.test(ev.key)) { ev.preventDefault(); grade(Number(ev.key) - 1); }
    });
    var toggle = document.getElementById('hub-tools-toggle'), list = document.getElementById('hub-tool-list');
    if (toggle && list) toggle.addEventListener('click', function () { list.hidden = !list.hidden; toggle.setAttribute('aria-expanded', String(!list.hidden)); });
    dashboard();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
