(function () {
  'use strict';
  var STORAGE = 'meridian_exam_v1';
  var SESSION_STORAGE = 'meridian_exam_session_v1';
  var LEGACY_KEYS = ['acu_srs_v3', 'gyeongnak_func_srs_v1', 'gyeongnak_history_srs_v1', 'sidong_sosaeng_srs_v1', 'baesu_rule_srs_v1', 'saam_bosa_srs_v1', 'jata_jingmai_v1', 'jiaohoe_cloze_v1', 'hub_track_v1', 'hub_stats_v1', 'hub_session_last', 'mrd_song_pref_v1'];
  var E, C, state, cardMap, sourceMap;
  var root, activeSession = null, pendingSession = null, revealed = false;
  var startedAt = 0, elapsedBeforePause = 0, protectedRaw = null, storageWarning = '', notice = '', dirty = false;
  var sourceLabels = {}, feedback = '', settingsOpen = false, busy = false;
  var sessionChoices = [], selectedChoice = null, usedHint = false;
  function day() { return E.localDay(); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]; }); }
  function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
  function pct(v, total) { return total ? Math.max(0, Math.min(100, Math.round(v / total * 100))) : 0; }
  function safeRead(key) { try { return localStorage.getItem(key); } catch (err) { storageWarning = '이 브라우저에서 기록 저장을 사용할 수 없습니다. 학습 후 기록을 백업해 주세요.'; return null; } }
  function parse(raw) { try { return raw ? JSON.parse(raw) : null; } catch (err) { return null; } }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function persist() {
    if (protectedRaw !== null) return false;
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); dirty = false; return true; }
    catch (err) { dirty = true; storageWarning = '기록을 저장하지 못했습니다. 이 화면을 닫기 전에 학습 기록을 백업해 주세요.'; announce(storageWarning); return false; }
  }
  function announce(msg) { var live = document.getElementById('exam-live'); if (live) live.textContent = msg || ''; }
  function loadState() {
    var raw = safeRead(STORAGE), saved = parse(raw);
    if (raw && (!saved || typeof saved !== 'object' || (saved.version && saved.version !== 1))) {
      protectedRaw = raw;
      storageWarning = '저장된 시험 기록을 읽지 못해 임시 모드로 열었습니다. 원본은 보존되어 있습니다. 먼저 기록 백업을 내려받고 정상 백업을 복원해 주세요.';
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
    var saved = parse(safeRead(STORAGE));
    if (saved && saved.version === 1) state = E.normalizeState(saved, C, day());
  }
  function getPending() {
    var s = parse(safeRead(SESSION_STORAGE));
    if (!s || s.version !== 1 || s.day !== day() || !Array.isArray(s.ids) || !Number.isInteger(s.index) || s.index < 0 || s.index >= s.ids.length || s.ids.length > 200) return null;
    if (!s.ids.every(function (id) { return typeof id === 'string' && cardMap[id] && !cardMap[id].needsVerification; })) return null;
    s.results = Array.isArray(s.results) ? s.results.filter(function (r) { return r && typeof r.id === 'string' && cardMap[r.id] && Number.isInteger(r.grade) && r.grade >= 0 && r.grade <= 3; }) : [];
    if (!s.retries || typeof s.retries !== 'object') s.retries = {};
    return s;
  }
  function saveSession() {
    try { if (activeSession) localStorage.setItem(SESSION_STORAGE, JSON.stringify(activeSession)); else localStorage.removeItem(SESSION_STORAGE); }
    catch (err) { storageWarning = '세트의 중간 위치를 저장하지 못했습니다. 학습 기록은 백업으로 보관할 수 있습니다.'; }
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
  function dashboard() {
    if (!ensureRoot()) return;
    announce(storageWarning || '');
    activeSession = null;
    refreshState();
    pendingSession = getPending();
    var p = E.getPlan(C, state, day()), s = E.summary(C, state, day());
    var remaining = num(p.totalRemaining), completed = num(p.totalCompletedToday), target = num(p.totalTarget);
    var examDate = state.settings.examDate;
    var deficit = Math.max(0, Math.ceil(num(p.estimatedMinutes) - num(p.capacityMinutes)));
    var migrated = state.migrations && state.migrations.legacyV1 ? num(state.migrations.legacyV1.imported) : 0;
    var dday = p.daysRemaining > 0 ? 'D−' + p.daysRemaining : p.daysRemaining === 0 ? 'D-DAY' : '시험일 이후';
    root.innerHTML =
      '<div class="ex-top"><div><div class="ex-eyebrow">MERIDIAN · EXAM PLAN</div><h1>오늘의 기억을<br>시험일까지.</h1><p class="ex-intro">전 범위를 먼저 만나고, 잊기 전에 다시 꺼냅니다.<br>남은 분량과 날짜로 오늘의 학습량을 계산합니다.</p></div><div class="ex-deadline"><div class="ex-dday">' + esc(dday) + '</div><div class="ex-date">' + esc(examDate.replace(/-/g, '.')) + ' 기말고사</div><button class="ex-btn ex-btn-quiet ex-btn-small" data-action="settings">계획 설정</button></div></div>' +
      (storageWarning ? '<div class="ex-notice ex-notice-error" role="alert">' + esc(storageWarning) + '</div>' : '') +
      (notice ? '<div class="ex-notice" role="status">' + esc(notice) + '</div>' : '') +
      (p.studyDeadlinePassed ? '<div class="ex-notice">설정된 시험일입니다. 필수 분량의 마감은 시험 전날이며, 아직 남은 내용은 과목별 기록에서 확인하고 선택 복습할 수 있습니다. 다음 시험을 준비한다면 날짜를 바꿔주세요.</div>' : '') +
      '<div class="ex-main-grid"><div class="ex-card ex-daily"><div class="ex-eyebrow">TODAY’S MISSION</div><h2>' + (p.studyDeadlinePassed ? '시험일 이후 선택 복습' : remaining ? '오늘 남은 학습' : '오늘 계획을 마쳤습니다') + '</h2><div class="ex-target-number">' + remaining + '<small>개 항목</small></div><div class="ex-plan-parts"><span>신규 <b>' + num(p.newRemaining) + '</b></span><span>복습 <b>' + num(p.dueCount) + '</b></span><span>예상 <b>' + Math.ceil(num(p.remainingMinutes)) + '</b>분</span></div>' +
      '<div class="ex-progress-label"><span>오늘 계획</span><b>' + completed + ' / ' + target + '개 완료</b></div><div class="ex-track" role="progressbar" aria-label="오늘 계획 완료" aria-valuenow="' + pct(completed, target) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + pct(completed, target) + '%"></span></div>' +
      '<p class="ex-muted" style="margin-top:10px">신규 목표 ' + num(p.newTarget) + '개 · 처음 본 내용도 틀렸다면 다시 확인합니다.</p>' +
      (deficit ? '<div class="ex-alert">오늘 전체 계획의 예상 시간이 설정한 하루 ' + num(p.capacityMinutes) + '분보다 ' + deficit + '분 많습니다. 날짜·학습시간을 조정하거나 세트를 나눠 진행하세요.</div>' : '<div class="ex-alert">12개씩 나눠 진행합니다. 한 세트 완료와 하루 목표 완료는 별개입니다.</div>') +
      '<div class="ex-plan-cta"><button class="ex-btn ex-btn-primary" data-action="' + (pendingSession ? 'resume' : 'start') + '">' + (pendingSession ? '이어서 학습 · ' + pendingSession.index + '/' + pendingSession.ids.length : remaining ? '오늘 학습 시작 →' : '추가 혼합 회상 →') + '</button><button class="ex-btn" data-action="rescue">2분 복귀</button></div></div>' +
      '<div class="ex-card"><div class="ex-row ex-between"><h2>전 범위 현황</h2><span class="ex-muted">학습 ' + s.total + '개 · 검토 ' + num(s.verificationPending) + '개</span></div><div class="ex-stats"><div><div class="ex-stat-label">아직 처음</div><div class="ex-stat-value">' + s.unseen + '</div></div><div><div class="ex-stat-label">접한 내용</div><div class="ex-stat-value">' + s.seen + '</div></div><div><div class="ex-stat-label">숙련 확인</div><div class="ex-stat-value">' + s.mastered + '</div></div></div>' + track(s.seen, s.mastered, s.total) +
      '<div class="ex-small-lines"><div>숙련 기준 <b>서로 다른 3일에 성공</b></div><div>첫 회독 목표 <b>' + esc(E.addDays(examDate, -num(state.settings.reserveDays))) + '</b></div><div>마무리 복습 <b>시험 전 ' + num(state.settings.reserveDays) + '일</b></div><div>오늘 기록 <b>' + num(s.reviewsToday) + '회 응답 · ' + num(s.studyMinutesToday).toFixed(1) + '분</b></div></div><div class="ex-day-strip" aria-label="최근 14일 실제 응답 기록">' + activityStrip() + '</div><p class="ex-muted" style="margin-top:9px">접속만으로 진도가 오르지 않습니다. 숙련은 자가채점·퀴즈 기록에 따른 지표입니다.</p></div></div>' +
      '<div id="exam-settings" class="ex-card ex-settings" ' + (settingsOpen ? '' : 'hidden') + '><div class="ex-row ex-between"><h2>시험 계획</h2><button class="ex-btn ex-btn-quiet ex-btn-small" data-action="settings">닫기</button></div><form id="exam-settings-form"><div class="ex-settings-grid"><label class="ex-field">시험일<input name="examDate" type="date" value="' + esc(examDate) + '" required min="2020-01-01" max="2100-12-31"></label><label class="ex-field">하루 학습 가능 시간<input name="dailyMinutes" type="number" min="5" max="600" step="5" value="' + num(state.settings.dailyMinutes) + '" required><small>분 · 필요한 양을 숨기지 않고 비교합니다.</small></label><label class="ex-field">마무리 복습 기간<input name="reserveDays" type="number" min="0" max="60" value="' + num(state.settings.reserveDays) + '" required><small>일 · 이 기간 전에 새 내용을 한 번씩 봅니다.</small></label></div><p class="ex-muted">예상 시간은 초기에는 항목당 약 45초, 기록이 쌓이면 실제 응답 시간을 바탕으로 계산합니다. 시험 합격이나 완전 암기를 보장하는 수치는 아닙니다.</p><div class="ex-row" style="margin-top:15px"><button class="ex-btn ex-btn-primary" type="submit">계획 적용</button><span id="exam-settings-error" class="ex-alert" role="alert"></span></div></form></div>' +
      forecastMarkup(p) + '<div class="ex-section"><div class="ex-section-header"><h2>과목별 기억 지도</h2><div class="ex-legend"><span><i class="ex-dot"></i>학습 중</span><span><i class="ex-dot ex-dot-master"></i>숙련</span></div></div><div class="ex-topics">' + topicsSummary().map(function (t) {
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
        else if (action === 'weak') start('weak', 5);
        else if (action === 'mock') start('mock', 20);
        else if (action === 'rescue') start('weak', 2, null, true);
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
      persist(); settingsOpen = false; notice = '시험일까지 남은 분량으로 계획을 다시 계산했습니다.'; dashboard(); announce(notice);
    });
    root.querySelector('#exam-import-file').addEventListener('change', function (ev) { var file = ev.target.files && ev.target.files[0]; if (file) importFile(file); });
  }
  function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function openTool(tool) {
    if (tool && typeof window.__activate === 'function') { if (activeSession) saveSession(); window.__activate(tool); }
  }
  function stopLegacySession() { if (window.HubSession && typeof window.HubSession.cancel === 'function') window.HubSession.cancel(); }
  function start(mode, limit, topic, rescue) {
    stopLegacySession();
    refreshState();
    var cards = E.buildSession(C, state, {mode:mode, limit:limit, topic:topic, today:day(), seed:Date.now()});
    if (!cards.length && (mode === 'today' || rescue)) cards = E.buildSession(C, state, {mode:'mock', limit:rescue ? 2 : limit, today:day()});
    if (!cards.length) { notice = mode === 'weak' ? '현재 표시할 약점이 없습니다. 오늘 학습이나 혼합 회상을 시작해 보세요.' : '이 조건에 해당하는 항목이 없습니다.'; dashboard(); return; }
    activeSession = {version:1, day:day(), mode:mode, topic:topic || null, rescue:!!rescue, ids:cards.map(function (c) { return c.id; }), index:0, initialCount:cards.length, results:[], retries:{}};
    feedback = ''; saveSession(); renderCard();
  }
  function resume() { stopLegacySession(); activeSession = getPending(); if (!activeSession) { start('today', 12); return; } feedback = '중단했던 위치부터 이어갑니다.'; renderCard(); }
  function labelMode() { if (activeSession.rescue) return '2분 복귀'; return ({today:'오늘의 학습', weak:'약점 재대결', mock:'혼합 회상', topic:'과목 집중'})[activeSession.mode] || '회상 연습'; }
  function choiceMarkup(card) {
    selectedChoice = null; usedHint = false;
    sessionChoices = Array.isArray(card.choices) ? card.choices.slice() : [];
    for (var i = sessionChoices.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = sessionChoices[i]; sessionChoices[i] = sessionChoices[j]; sessionChoices[j] = tmp; }
    if (!sessionChoices.length) return '';
    return (card.requiresChoices ? '<p class="ex-muted">원문 선택지에서 고르세요.</p>' : '<button class="ex-btn ex-btn-quiet ex-btn-small" id="exam-choice-hint">선택지 힌트 보기</button>') + '<div id="exam-choices" class="ex-choices" ' + (card.requiresChoices ? '' : 'hidden') + '>' + sessionChoices.map(function (v, n) { return '<button type="button" class="ex-choice" data-choice="' + n + '" aria-pressed="false"><span class="ex-choice-index">' + (n + 1) + '</span><span>' + esc(v) + '</span><span class="ex-choice-verdict"></span></button>'; }).join('') + '</div>';
  }
  function renderCard() {
    if (!ensureRoot() || !activeSession) return;
    announce(storageWarning || '');
    if (activeSession.index >= activeSession.ids.length) { checkpoint(); return; }
    var card = cardMap[activeSession.ids[activeSession.index]];
    if (!card) { activeSession.index++; renderCard(); return; }
    var topic = C.topics.find(function (t) { return t.id === card.topic; });
    var r = state.records[card.id], dates = r && Array.isArray(r.successDays) ? r.successDays.length : 0;
    revealed = false; startedAt = document.hidden ? 0 : Date.now(); elapsedBeforePause = 0;
    root.innerHTML = '<div class="ex-study"><div class="ex-study-head"><button class="ex-btn ex-btn-quiet ex-btn-small" data-action="pause">← 계획으로</button><div class="ex-study-meta">' + esc(labelMode()) + ' · ' + (activeSession.index + 1) + '/' + activeSession.ids.length + '</div></div><div class="ex-track" role="progressbar" aria-label="세트 진행" aria-valuenow="' + pct(activeSession.index, activeSession.ids.length) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + pct(activeSession.index, activeSession.ids.length) + '%"></span></div><div class="ex-study-status" role="status">' + esc(feedback) + '</div><article class="ex-card ex-question-card"><div class="ex-row ex-between"><div class="ex-eyebrow">' + esc(topic ? topic.label : card.topic) + '</div><span class="ex-muted">' + (r && r.seen ? '성공한 날짜 ' + Math.min(3, dates) + '/3' : '처음 만나는 항목') + '</span></div><h2 class="ex-question">' + esc(card.prompt) + '</h2>' + choiceMarkup(card) + '<label class="ex-field">먼저 떠올린 답 <span class="ex-muted">말로 답하거나, 필요한 경우 적어보세요.</span><textarea class="ex-textarea" id="exam-scratch" rows="2" placeholder="답을 떠올린 뒤 정답을 확인하세요. 입력은 선택입니다." autocomplete="off"></textarea></label><button class="ex-btn ex-btn-primary ex-reveal" id="exam-reveal">정답 확인 <span class="ex-muted" style="color:inherit">· Space</span></button><div id="exam-answer-area" hidden><div class="ex-answer"><div class="ex-answer-label">ANSWER</div>' + esc(card.answer) + '</div>' + (card.detail ? '<div class="ex-detail">' + esc(card.detail) + '</div>' : '') + '<div class="ex-grades" aria-label="회상 결과 자가채점"><button class="ex-btn ex-grade" data-grade="0">1 · 몰랐음<small>다시 연습</small></button><button class="ex-btn ex-grade" data-grade="1">2 · 헷갈림<small>다시 확인</small></button><button class="ex-btn ex-grade" data-grade="2">3 · 맞혔음<small>스스로 회상</small></button><button class="ex-btn ex-grade" data-grade="3">4 · 바로 떠오름<small>확실하게 회상</small></button></div></div></article><div class="ex-study-foot"><span>정답을 보고 알았던 경우에는 ‘몰랐음’ 또는 ‘헷갈림’을 선택하세요.</span><button class="ex-btn ex-btn-quiet ex-btn-small" data-action="source">' + esc(sourceLabels[card.tool] || '관련 학습도구') + ' ↗</button></div></div>';
    root.querySelector('[data-action="pause"]').addEventListener('click', function () { saveSession(); dashboard(); announce('중간 위치를 저장했습니다. 이어서 학습할 수 있습니다.'); });
    root.querySelector('[data-action="source"]').addEventListener('click', function () { openTool(card.tool); });
    root.querySelector('#exam-reveal').addEventListener('click', reveal);
    var hint = root.querySelector('#exam-choice-hint');
    if (hint) hint.addEventListener('click', function () { usedHint = true; hint.hidden = true; root.querySelector('#exam-choices').hidden = false; announce('선택지 힌트를 사용한 응답으로 기록합니다.'); });
    root.querySelectorAll('[data-choice]').forEach(function (b) { b.addEventListener('click', function () { selectedChoice = Number(b.dataset.choice); root.querySelectorAll('[data-choice]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); });
    root.querySelectorAll('[data-grade]').forEach(function (b) { b.addEventListener('click', function () { grade(Number(b.dataset.grade)); }); });
    root.scrollIntoView({block:'start'});
  }
  function reveal() {
    if (!activeSession || revealed) return;
    revealed = true;
    root.querySelector('#exam-answer-area').hidden = false;
    root.querySelector('#exam-reveal').hidden = true;
    var card = cardMap[activeSession.ids[activeSession.index]], incorrect = (card.requiresChoices && selectedChoice === null) || (selectedChoice !== null && sessionChoices[selectedChoice] !== card.answer);
    root.querySelectorAll('[data-choice]').forEach(function (b) { b.disabled = true; var n = Number(b.dataset.choice); if (sessionChoices[n] === card.answer) { b.dataset.correct = 'true'; b.querySelector('.ex-choice-verdict').textContent = '✓ 정답'; } else if (n === selectedChoice) b.querySelector('.ex-choice-verdict').textContent = '선택 · 오답'; });
    if (incorrect) root.querySelectorAll('[data-grade]').forEach(function (b) { if (Number(b.dataset.grade) >= 2) b.disabled = true; });
    if (usedHint) root.querySelectorAll('[data-grade]').forEach(function (b) { if (Number(b.dataset.grade) >= 2) b.disabled = true; });
    announce(incorrect ? '선택한 답은 오답입니다. 정답과 차이를 확인하고 다시 연습으로 남깁니다.' : usedHint ? '힌트를 사용한 항목은 다시 확인할 대상으로 남깁니다.' : '정답을 확인했습니다. 스스로 떠올린 답과 비교해 채점하세요.');
  }
  function grade(value) {
    if (busy || !activeSession || !revealed || value < 0 || value > 3) return;
    busy = true;
    var id = activeSession.ids[activeSession.index], seconds = Math.min(300, Math.max(1, Math.round((elapsedBeforePause + (startedAt ? Date.now() - startedAt : 0)) / 1000)));
    var card = cardMap[id];
    if (usedHint || (selectedChoice !== null && sessionChoices[selectedChoice] !== card.answer)) value = Math.min(value, 1);
    if (card.requiresChoices && selectedChoice === null) value = 0;
    refreshState();
    state = E.review(state, id, value, {today:day(), now:Date.now(), seconds:seconds, evidence:(card.requiresChoices || usedHint || selectedChoice !== null) ? 'choice' : 'recall'});
    persist();
    var result = state.lastReview || {}, r = state.records[id] || {};
    activeSession.results.push({id:id, grade:value});
    if (value < 2 && !activeSession.rescue && !activeSession.retries[id]) {
      activeSession.retries[id] = 1;
      var insertion = Math.min(activeSession.ids.length, activeSession.index + 4);
      activeSession.ids.splice(insertion, 0, id);
      feedback = '헷갈린 연결을 찾았습니다. 다른 항목 뒤에 한 번 더 확인합니다.';
    } else if (value < 2) feedback = '다시 볼 항목으로 남겼습니다. 이 항목은 아직 오늘 복습에 남아 있습니다.';
    else if (r.mastered) feedback = '서로 다른 날짜의 회상 성공이 쌓였습니다. 다음 복습일 ' + (result.due || r.due || '예정');
    else feedback = '회상 성공. 다음 복습일 ' + (result.due || r.due || '예정') + ' · 같은 날 재시도는 숙련 일수에 중복 반영하지 않습니다.';
    activeSession.index++;
    saveSession(); busy = false; renderCard();
  }
  function checkpoint() {
    var finished = activeSession, results = finished.results || [], unique = new Map();
    results.forEach(function (r) { unique.set(r.id, r.grade); });
    var correct = Array.from(unique.values()).filter(function (g) { return g >= 2; }).length;
    var missed = Array.from(unique.entries()).filter(function (x) { return x[1] < 2; });
    var p = E.getPlan(C, state, day());
    activeSession = null; saveSession(); pendingSession = null;
    root.innerHTML = '<div class="ex-study"><div class="ex-card ex-checkpoint"><div class="ex-eyebrow">SESSION COMPLETE</div><h1>' + (finished.rescue ? '다시 시작했습니다.' : '한 세트, 기억에 더했습니다.') + '</h1><p class="ex-soft">' + (finished.rescue ? '2분 복귀를 기록했습니다. 남은 하루 목표는 그대로 확인할 수 있습니다.' : '지금 맞힌 항목은 다음 복습일에 다시 만납니다.') + '</p><div class="ex-result-grid"><div><b>' + unique.size + '</b><span>다룬 항목</span></div><div><b>' + correct + '</b><span>마지막 회상 성공</span></div><div><b>' + missed.length + '</b><span>재확인 필요</span></div></div><p class="ex-soft">오늘 남은 계획 <strong>' + num(p.totalRemaining) + '개</strong> · 예상 ' + Math.ceil(num(p.remainingMinutes)) + '분</p>' + (missed.length ? '<ul class="ex-review-list">' + missed.slice(0, 4).map(function (x) { var c = cardMap[x[0]]; return '<li>' + esc(c.prompt) + '<span>' + esc(c.answer) + '</span></li>'; }).join('') + '</ul>' : '<p class="ex-muted" style="margin:20px 0">지금의 성공을 며칠 뒤에도 재현하면 숙련으로 바뀝니다.</p>') + '<div class="ex-row" style="justify-content:center;margin-top:24px"><button class="ex-btn ex-btn-primary" id="exam-next-set">' + (p.totalRemaining ? '다음 12개 이어가기' : '혼합 회상 더 하기') + '</button><button class="ex-btn" id="exam-finish">오늘 계획 보기</button></div></div></div>';
    root.querySelector('#exam-next-set').addEventListener('click', function () { start('today', 12); });
    root.querySelector('#exam-finish').addEventListener('click', dashboard);
    announce('한 세트를 마쳤습니다. 오늘 남은 계획은 ' + num(p.totalRemaining) + '개입니다.');
    root.scrollIntoView({block:'start'});
  }
  function exportBackup() {
    refreshState();
    var legacy = {};
    LEGACY_KEYS.forEach(function (k) { var raw = safeRead(k); if (raw !== null) legacy[k] = raw; });
    var backup = {format:'meridian-exam-backup', version:1, exportedAt:new Date().toISOString(), exam:state, legacy:legacy, session:parse(safeRead(SESSION_STORAGE))};
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
      changes[STORAGE] = JSON.stringify(next);
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
      protectedRaw = null; dirty = false; storageWarning = ''; state = next; notice = '학습 기록을 복원했습니다. 기존 도구의 화면은 다시 열면 반영됩니다.'; dashboard(); announce(notice);
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
      if (activeSession) saveSession();
      activeSession = null;
      var tools = document.getElementById('hub-tool-list'), toggle = document.getElementById('hub-tools-toggle');
      if (tools) tools.hidden = true; if (toggle) toggle.setAttribute('aria-expanded', 'false');
      if (ev.detail && ev.detail.id === 'home') dashboard();
    });
    window.addEventListener('hub:answer', onLegacyAnswer);
    window.addEventListener('storage', function (ev) { if (ev.key === STORAGE && window.__active === 'home' && !activeSession) dashboard(); });
    window.addEventListener('pagehide', function () { if (activeSession) saveSession(); });
    document.addEventListener('visibilitychange', function () { if (!activeSession) return; if (document.hidden && startedAt) { elapsedBeforePause += Date.now() - startedAt; startedAt = 0; } else if (!document.hidden) startedAt = Date.now(); });
    document.addEventListener('keydown', function (ev) {
      if (!activeSession || window.__active !== 'home' || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable)) return;
      if ((ev.code === 'Space' || ev.key === ' ') && !revealed) { ev.preventDefault(); reveal(); }
      else if (revealed && /^[1-4]$/.test(ev.key)) { ev.preventDefault(); grade(Number(ev.key) - 1); }
    });
    var toggle = document.getElementById('hub-tools-toggle'), list = document.getElementById('hub-tool-list');
    if (toggle && list) toggle.addEventListener('click', function () { list.hidden = !list.hidden; toggle.setAttribute('aria-expanded', String(!list.hidden)); });
    dashboard();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
