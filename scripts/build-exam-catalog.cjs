#!/usr/bin/env node
'use strict';

/**
 * Build the exam recall catalogue from the existing hub's own data.
 * No browser, network, npm packages, or external medical facts are used.
 * Run: node scripts/build-exam-catalog.cjs
 * Check without writing: node scripts/build-exam-catalog.cjs --check
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fillHtml = fs.readFileSync(path.join(ROOT, 'saam_bosa_fill.html'), 'utf8');
const scripts = Object.fromEntries(Array.from(html.matchAll(/<script\b[^>]*\bid="src-([^"]+)"[^>]*>([\s\S]*?)<\/script>/g), m => [m[1], m[2]]));

// Read exactly one initializer. Quotes and comments are deliberately scanned so
// punctuation in Korean prose, mnemonics, or HTML cannot truncate a data array.
function initializer(src, name) {
  const re = new RegExp('(?:\\b(?:const|let|var)\\s+|,\\s*)' + name + '\\s*=\\s*', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('Missing initializer: ' + name);
  const start = re.lastIndex;
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let i = start; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (comment === '//') { if (c === '\n') comment = ''; continue; }
    if (comment === '/*') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && (n === '/' || n === '*')) { comment = c + n; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('[({'.includes(c)) depth++;
    if ('])}'.includes(c)) depth--;
    if (depth === 0 && (c === ';' || c === ',')) return src.slice(start, i);
    if (depth < 0) throw new Error('Unbalanced initializer: ' + name);
  }
  throw new Error('Unterminated initializer: ' + name);
}
function literal(tool, name) {
  assert.ok(scripts[tool], 'Missing source script ' + tool);
  return vm.runInNewContext('(' + initializer(scripts[tool], name) + ')', Object.create(null), { timeout: 1000 });
}
function functionText(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Missing function ' + name);
  const brace = src.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let i = brace; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (comment === '//') { if (c === '\n') comment = ''; continue; }
    if (comment === '/*') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && (n === '/' || n === '*')) { comment = c + n; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return src.slice(start, i + 1);
    // The decrement above applies only to closing braces.
  }
  throw new Error('Unterminated function ' + name);
}
function plain(value) {
  return String(value == null ? '' : value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:div|p|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[ \t\u3000]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function hash(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12); }
function stableKey(s) { return String(s).normalize('NFC').replace(/\s+/g, '_'); }
function joined(xs) { return xs.map(plain).filter(Boolean).join('\n'); }

const topics = [
  { id: 'systems', label: '계통·기능·기경', description: '경맥·경별·낙맥·기경·경근·피부, 원문과 변별' },
  { id: 'points', label: '오수·특정혈', description: '오수혈·오행·원락극모배수·팔회·팔맥교회·순행 개별지식' },
  { id: 'history', label: '발전사', description: '시대·의가·저서·혈수·업적 연결' },
  { id: 'syndromes', label: '시동·소생', description: '12경맥의 시동병·소생병·소생병 주·개념' },
  { id: 'routes', label: '12경맥 유주 원문', description: '전체 원문의 다음 구절과 6구절 단위 순서 회상' },
  { id: 'back_cross', label: '배수·교회', description: '척추 높이·유모 짝·교회 경맥·14개 니모닉 묶음' },
  { id: 'saam', label: '사암 보사', description: '자경·주객·정격·승격·한열, 오행 관계와 니모닉' },
];
const cards = [], coverage = [], ids = new Set(), audit = { banks: {}, routes: [], sourceConflicts: [], mappings: [] };
const refs = new Map();
function requiresChoices(prompt) {
  return /다음\s*중|아닌\s*(?:것|혈|경|짝|항목)|옳지\s*않|잘못|틀린|해당하지\s*않|속하지\s*않|순행하지\s*않|적절하지\s*않/.test(plain(prompt));
}
function add({ id, topic, prompt, answer, detail = '', tool, sourceId, kind = 'recall', choices, choiceRequired }) {
  assert.ok(!ids.has(id), 'Duplicate card id: ' + id);
  assert.ok(topics.some(t => t.id === topic), 'Unknown topic: ' + topic);
  const c = { id, topic, prompt: plain(prompt), answer: plain(answer), detail: plain(detail), tool, sourceId: String(sourceId), kind };
  if (choices && choices.length) {
    c.choices = Array.from(choices, plain);
    c.requiresChoices = Boolean(choiceRequired);
  }
  assert.ok(c.prompt && c.answer, 'Empty prompt or answer: ' + id);
  ids.add(id); cards.push(c);
  if (!refs.has(tool)) refs.set(tool, new Set());
  refs.get(tool).add(id);
  return c;
}
function mapRefs(tool, xs) {
  if (!refs.has(tool)) refs.set(tool, new Set());
  xs.forEach(x => refs.get(tool).add(typeof x === 'string' ? x : x.id));
}
function cover(tool, label, status, note) {
  const mapped = refs.get(tool) || new Set();
  assert.ok(mapped.size > 0, 'Empty coverage: ' + tool);
  coverage.push({ tool, label, status, note, cardCount: mapped.size });
}
function makeBank(tool, topic, label) {
  const bank = literal(tool, 'BANK');
  const cats = Object.fromEntries(literal(tool, 'CATS').map(c => [c.key, c.label]));
  bank.forEach(b => add({
    id: tool + ':' + b.id, topic, tool, sourceId: b.id,
    prompt: b.q, answer: b.a, choices: [b.a, ...(b.d || [])], choiceRequired: requiresChoices(b.q),
    detail: joined([b.note, '원래 분야: ' + (cats[b.cat] || b.cat), b.d && b.d.length ? '원문 오답 보기(정답 아님): ' + b.d.join(' / ') : '']),
  }));
  audit.banks[tool] = bank.length;
  cover(tool, label, 'included', '원본 BANK ' + bank.length + '문항의 질문·정답·해설·오답 보기를 전량 보존. 보기 선택을 답 가린 회상으로 바꿈.');
}

// The five literal banks, plus the acu generator below, are the six SRS tools.
makeBank('func', 'systems', '기능 퀴즈');
makeBank('history', 'history', '발전사');
makeBank('sidong', 'syndromes', '시동·소생');
makeBank('baesurule', 'back_cross', '배수혈 추론');
makeBank('saamquiz', 'saam', '사암 보사 퀴즈');

// Use the original acu question builders, not a newly invented answer bank.
const acuSource = scripts.acu;
const acuPrefix = acuSource.slice(acuSource.indexOf('"use strict";'), acuSource.indexOf('/* ============ GAME STATE'));
const fixedMath = Object.create(Math); fixedMath.random = () => 0.3141592653589793;
const acu = vm.runInNewContext(acuPrefix + '\n({MERID,POS,WX_YIN,WX_YANG,RAK_X,GEUK_X,HAHAP,PALHOE,PALMAEK,OSUZHU,GYEONGMAEK,PAIRS,SANGYONG,CATS_DEF,qOsu,qWx,qOsuZhu,qWon,qMo,qBaesu,qRak,qGeuk,qHahap,qPalhoe,qPalmaek,qGyeong,qHomo,qSang})', {
  Math: fixedMath, document: { documentElement: {} },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
}, { timeout: 3000 });
function addAcu(q, reverse) {
  return add({ id: 'acu:' + q.id, topic: 'points', tool: 'acu', sourceId: q.id,
    prompt: q.qtext, answer: q.answer, choices: q.options, choiceRequired: requiresChoices(q.qtext),
    detail: joined([q.explain, '원래 분야: ' + q.kind, q.wx ? '오행: ' + q.wx : '', reverse ? '역방향 원문: ' + reverse.qtext + ' → ' + reverse.answer : '']),
  });
}
acu.MERID.forEach((m, mi) => {
  m.osu.forEach((_, pi) => addAcu(acu.qOsu(mi, pi, false), acu.qOsu(mi, pi, true)));
  [['qWon', mi], ['qMo', mi], ['qBaesu', mi], ['qRak', m.k], ['qGeuk', m.k]].forEach(([f, a]) => addAcu(acu[f](a, false), acu[f](a, true)));
});
['음', '양'].forEach(yy => acu.POS.forEach((_, pi) => addAcu(acu.qWx(yy, pi))));
acu.OSUZHU.forEach((_, i) => addAcu(acu.qOsuZhu(i)));
acu.RAK_X.forEach(([k]) => addAcu(acu.qRak(k, false)));
acu.GEUK_X.forEach(([k]) => addAcu(acu.qGeuk(k, false)));
acu.HAHAP.forEach((_, i) => addAcu(acu.qHahap(i)));
acu.PALHOE.forEach((_, i) => addAcu(acu.qPalhoe(i, false), acu.qPalhoe(i, true)));
acu.PALMAEK.forEach((_, i) => addAcu(acu.qPalmaek(i, false), acu.qPalmaek(i, true)));
acu.GYEONGMAEK.forEach((_, i) => addAcu(acu.qGyeong(i)));
acu.PAIRS.forEach((_, i) => [0, 1].forEach(side => addAcu(acu.qHomo(i, side))));
acu.SANGYONG.forEach((_, i) => addAcu(acu.qSang(i)));
audit.banks.acu = refs.get('acu').size;
assert.equal(audit.banks.acu, acu.CATS_DEF.reduce((s, x) => s + x.n, 0), 'acu categories do not match generated fact count');
cover('acu', '경혈 퀴즈', 'included', '원래 14분야의 모든 생성 문항 ID를 1회씩 수록. 동일 ID의 역방향 질문·답은 해설에 보존하여 중복 분모를 만들지 않음.');

// Both five-transport games use the same ten mappings. Verify before mapping.
for (const tool of ['osstep', 'osspeed']) {
  const yin = literal(tool, 'YIN'), yang = literal(tool, 'YANG');
  const canon = ['井', '滎', '兪', '經', '合'];
  canon.forEach((p, i) => { assert.equal(yin[p], acu.WX_YIN[i]); assert.equal(yang[p], acu.WX_YANG[i]); });
  mapRefs(tool, cards.filter(c => c.tool === 'acu' && c.sourceId.startsWith('wx|')));
  cover(tool, tool === 'osstep' ? '오수혈 상생휠' : '오수혈 스피드', 'mapped', '음·양 오수혈↔오행의 10관계를 경혈 퀴즈의 wx 카드와 공유. 타이머·방향·화면 배치의 차이는 별도 지식으로 세지 않음.');
}

// Full original sequence, not an abbreviated route summary.
const flow = literal('jingorder', 'FLOW');
const jataMeridians = literal('jata', 'MERIDIANS');
assert.equal(Object.keys(flow).length, 12);
assert.equal(jataMeridians.length, 12);
for (const [key, f] of Object.entries(flow)) {
  assert.ok(jataMeridians.some(m => m.key === key && m.full === f.full), 'Unmapped jata meridian ' + key);
  const all = f.seq.map(s => s.h).join(' → ');
  for (let start = 0; start < f.seq.length; start += 6) {
    const segment = f.seq.slice(start, start + 6);
    const anchor = start === 0 ? '맨 처음부터' : '「' + f.seq[start - 1].h + '」 다음부터';
    add({ id: 'jingorder:' + key + ':chunk:' + (start + 1), topic: 'routes', tool: 'jingorder', sourceId: key + '|chunk|' + start, kind: 'sequence',
      prompt: f.full + ' · ' + (start + 1) + '–' + (start + segment.length) + '번째 구절\n' + anchor + ' 이어지는 ' + segment.length + '구절을 순서대로 말하세요.',
      answer: segment.map(s => s.h).join(' → '),
      detail: '독음: ' + segment.map(s => s.d).join(' → ') + '\n원문 전체(' + f.seq.length + '구절): ' + all + '\n출처: 허브 순행 순서맞추기 FLOW / 靈樞 經脈篇',
    });
  }
  for (let i = 1; i < f.seq.length; i++) {
    const prev = f.seq.slice(Math.max(0, i - 2), i);
    add({ id: 'jingorder:' + key + ':next:' + (i + 1), topic: 'routes', tool: 'jingorder', sourceId: key + '|next|' + i,
      prompt: f.full + ' · ' + (i + 1) + '번째 구절\n「' + prev.map(s => s.h).join(' → ') + '」 다음 구절은?',
      answer: f.seq[i].h,
      detail: '독음: ' + f.seq[i].d + '\n앞뒤 원문: ' + f.seq.slice(Math.max(0, i - 2), Math.min(f.seq.length, i + 2)).map(s => s.h).join(' → '),
    });
  }
  audit.routes.push({ key, full: f.full, phrases: f.seq.length, chunks: Math.ceil(f.seq.length / 6), next: f.seq.length - 1 });
}
cover('jingorder', '순행 순서맞추기', 'included', '12경맥 원문 모든 구절을 6구절 묶음과 다음 구절 회상에 포함. 같은 원문을 서로 다른 길이로 회상하므로 이 카드수는 고유 사실 수가 아님.');
mapRefs('jata', cards.filter(c => c.tool === 'jingorder'));
cover('jata', '자타 암송', 'mapped', '12경맥 명칭을 FLOW와 대조하여 순행 원문 카드에 연결. 원본 선창·후창 음원 및 개인 구절 마킹은 기존 자타 탭에서 사용하며 음원 바이트는 카드로 복제하지 않음.');

// Back-shu map and reference tables: preserve codes, notes, locations and pairs.
const spineShu = literal('spine', 'SHU'), refShu = literal('ref', 'SHU');
const refShuByH = Object.fromEntries(refShu.map(s => [s.h, s]));
spineShu.forEach(s => {
  const r = refShuByH[s.h]; assert.ok(r); assert.equal(s.lv, r.lv);
  const c = add({ id: 'spine:shu:' + s.h, topic: 'back_cross', tool: 'spine', sourceId: 'SHU|' + s.h,
    prompt: s.h + '의 척추 높이·혈위 번호·연결 장부/구분은?',
    answer: s.lv + ' · ' + s.c + ' · ' + s.j,
    detail: joined(['원본 오행/구분: ' + s.el, r.nt, '배수혈맵 SHU 및 가리기표 SHU의 동일 행을 함께 보존.']),
  });
  mapRefs('ref', [c]);
});
const spineJiao = literal('spine', 'JIAO'), refJiao = literal('ref', 'JIAO');
spineJiao.forEach(j => {
  const r = refJiao.find(x => x.pt === j.pt); assert.ok(r); assert.equal(r.mer, j.m.join('·'));
  const c = add({ id: 'spine:jiao:' + j.pt, topic: 'back_cross', tool: 'spine', sourceId: 'JIAO|' + j.pt,
    prompt: j.pt + ' (' + j.c + ')에서 교회하는 경맥을 모두 말하세요.', answer: j.m.join(' · '),
    detail: joined([j.note, r.nt, '기존 배수혈맵/가리기표의 교회 구성을 그대로 보존.']),
  });
  mapRefs('ref', [c]);
});
literal('ref', 'MOMU').forEach(r => add({ id: 'ref:momu:' + r.j, topic: 'back_cross', tool: 'ref', sourceId: 'MOMU|' + r.j,
  prompt: r.j + '의 募穴·위치·짝 背兪穴은?', answer: r.mo + ' · ' + r.pos + ' · ' + r.shu,
  detail: '가리기표 MOMU 원문 행. 위치 표현은 원자료를 그대로 보존.',
}));
cover('spine', '배수혈맵', 'included', '背兪 14개(높이·코드·장부)와 교회 10개의 전체 경맥 구성. 가리기표의 동일 행·비고를 함께 보존.');
cover('ref', '가리기표', 'included', '背兪 14행·교회 10행은 배수혈맵 카드와 공유, 兪募 12행의 위치·짝을 추가.');

const clozeGroups = literal('cloze', 'GROUPS');
let clozeBlankCount = 0;
assert.equal(clozeGroups.length, 14);
clozeGroups.forEach(g => {
  const blanks = Array.from(g.m.matchAll(/\(([^)]+)\)/g), x => x[1]);
  assert.equal(blanks.length, g.rows.length, 'Cloze mnemonic/row count mismatch ' + g.k);
  blanks.forEach((a, i) => assert.equal(a, g.rows[i][0], 'Cloze mnemonic/row order mismatch ' + g.k));
  add({ id: 'cloze:' + g.k + ':sequence', topic: 'back_cross', tool: 'cloze', sourceId: g.k + '|sequence', kind: 'sequence',
    prompt: g.label + ' 교회혈 묶음을 원자료 순서대로 회상하세요.\n' + g.m.replace(/\(([^)]+)\)/g, '(____)'),
    answer: g.rows.map(x => x[0]).join(' → '),
    detail: g.m + '\n한자·독음: ' + g.rows.map(x => x[0] + '(' + x[1] + ')').join(' · '),
  });
  blanks.forEach((a, i) => {
    let bi = 0;
    add({ id: 'cloze:' + g.k + ':blank:' + a, topic: 'back_cross', tool: 'cloze', sourceId: g.k + '|' + a,
      prompt: g.label + ' · 빈칸 ' + (i + 1) + '/' + blanks.length + '\n' + g.m.replace(/\(([^)]+)\)/g, m => bi++ === i ? '(____)' : m),
      answer: a, detail: '독음: ' + g.rows[i][1] + '\n원문 니모닉: ' + g.m,
    });
  });
  clozeBlankCount += blanks.length;
});
cover('cloze', '교회혈 니모닉', 'included', '14묶음, ' + clozeBlankCount + '개 원문 빈칸과 전체 묶음 순서를 보존. 원문에서 묶은 방식(예: 肺·心包)을 임의로 재분류하지 않음.');

const eras = Object.fromEntries(literal('era', 'ERAS').map(e => [e.k, e]));
literal('era', 'CARDS').forEach(c => add({ id: 'era:' + stableKey(c.t), topic: 'history', tool: 'era', sourceId: c.t,
  prompt: c.t + '의 시대와 원자료에 연결된 인물/특징' + (c.n ? '·혈수' : '') + '는?',
  answer: [eras[c.e].label, c.p, c.n].filter(Boolean).join(' · '), detail: eras[c.e].sub || '연표 배치 CARDS의 원문 속성.',
}));
cover('era', '연표 배치', 'included', '연표의 13개 저서·자료 행과 시대·표시된 인물/특징·혈수를 전부 수록.');
literal('match', 'ROWS').forEach(r => add({ id: 'match:' + r.p, topic: 'history', tool: 'match', sourceId: r.p,
  prompt: r.p + '의 著書·穴數·時代·業績 네 속성을 연결하세요.', answer: [r.book, r.cnt, r.era, r.feat].join(' · '),
  detail: '발전사 매칭 ROWS의 네 속성을 모두 보존.',
}));
cover('match', '발전사 매칭', 'included', '6명의 의가 × 4속성을 연결형 6장으로 수록. 발전사/연표와 겹치는 사실이 있으나 연결 회상 단위는 따로 계산.');

const treeGroups = literal('systree', 'GROUPS');
const comps = Object.fromEntries(treeGroups.flatMap(g => g.comps.map(c => [c.k, { label: c.label, group: g.g }])));
literal('systree', 'CARDS').forEach(c => add({ id: 'systree:' + hash(c.t), topic: 'systems', tool: 'systree', sourceId: c.t,
  prompt: '「' + c.t + '」의 계통명과 상위 분류는?', answer: comps[c.c].label + ' · ' + comps[c.c].group,
  detail: '계통 트리의 기능 카드와 GROUPS 분류를 함께 보존.',
}));
cover('systree', '계통 트리', 'included', '18개 기능 카드와 3개 상위 분류/6개 구성 계통의 연결을 전부 수록.');
literal('swipe', 'ITEMS').forEach(i => add({ id: 'swipe:' + hash(i.clue + '|' + i.ans), topic: 'systems', tool: 'swipe', sourceId: i.clue,
  prompt: joined([i.clue, i.sm, i.ans + ' / ' + i.no + ' 중 어느 쪽인가?']), answer: i.ans,
  detail: joined([i.note, '반대 선택지(정답 아님): ' + i.no]),
}));
cover('swipe', '변별 스와이프', 'included', '24개 변별 단서·정답·반대 선택지·해설을 모두 보존.');

// Saam full contexts are computed by the original buildCtx function.
const saamFull = literal('saammaster', 'SAAMF');
const saamWheel = literal('saamwheel', 'SAAMF');
assert.equal(JSON.stringify(saamFull), JSON.stringify(saamWheel), 'Saam wheel/master data diverged: review mapping');
const buildCtx = vm.runInNewContext('(' + functionText(scripts.saammaster, 'buildCtx') + ')', Object.create(null), { timeout: 1000 });
const contexts = ['za_heo', 'za_sil', 'jeong', 'seung', 'juu', 'han', 'yeol'];
const contextCards = new Map();
saamFull.forEach(s => {
  contexts.forEach(mode => {
    const ctx = buildCtx(s, mode);
    const card = add({ id: 'saammaster:' + s.k + ':' + mode, topic: 'saam', tool: 'saammaster', sourceId: s.k + '|' + mode,
      prompt: s.name + ' · ' + plain(ctx.label) + '\n보사 원리와 각 자리의 혈을 모두 말하세요.',
      answer: plain(ctx.rule) + '\n' + ctx.slots.map(x => plain(x.label) + ': ' + x.need.map(p => p[0] + '(' + p[1] + ')').join(' · ')).join('\n'),
      detail: joined([ctx.sys, ctx.note, (mode === 'han' || mode === 'yeol') ? '원본 주석: 한열의 특이배합은 교재 그대로. 이 카드는 원본 표를 재현하며 별도 판본 검증을 뜻하지 않음.' : '']),
    });
    contextCards.set(s.k + '|' + mode, card);
  });
  const relations = add({ id: 'saamwheel:' + s.k + ':relations', topic: 'saam', tool: 'saamwheel', sourceId: s.k + '|relations',
    prompt: s.name + '의 본행·母(生我)·官(克我)·子(我生)와 表裏經은?',
    answer: '本 ' + s.el + ' · 母 ' + s.mo + ' · 官 ' + s.of + ' · 子 ' + s.ch + ' · 表裏 ' + s.py,
    detail: '사암 수레바퀴 SAAMF의 el/mo/of/ch/py를 그대로 보존.',
  });
  ['jeong', 'seung', 'juu', 'han'].forEach(mode => mapRefs('saamwheel', [contextCards.get(s.k + '|' + mode)]));
});
for (const [name, label, verb] of [['SHENG', '相生', '生'], ['KE', '相克', '克']]) {
  literal('saamwheel', name).forEach(([a, b]) => add({ id: 'saamwheel:' + name + ':' + a, topic: 'saam', tool: 'saamwheel', sourceId: name + '|' + a,
    prompt: label + ' 고리: ' + a + '은(는) 어느 오행을 ' + verb + '하는가?', answer: a + verb + b,
    detail: '원본 수레바퀴 ' + name + ' 관계선.',
  }));
}
cover('saammaster', '사암 종합', 'included', '12경맥 × 7맥락 = 84개 원본 buildCtx 결과를 보사 원리·슬롯·한자·독음·해설과 함께 수록.');
cover('saamwheel', '사암 수레바퀴', 'included', '12경 관계 카드와 상생·상극 10관계를 추가. 正格·勝格·主客·寒證 혈 구성은 같은 SAAMF임을 대조하여 종합 카드와 공유.');

assert.equal(JSON.stringify(literal('saammirror', 'SAAM')), JSON.stringify(literal('saamcloze', 'SAAM')), 'Saam mirror/cloze mnemonic data diverged: review mapping');
for (const tool of ['saammirror', 'saamcloze']) {
  const arr = literal(tool, 'SAAM');
  assert.equal(arr.length, 12);
  arr.forEach(s => {
    const base = saamFull.find(b => b.k === s.k); assert.ok(base);
    for (const k of ['el', 'mo', 'of', 'ch', 'jbo', 'jsa', 'sbo', 'ssa']) assert.equal(JSON.stringify(s[k]), JSON.stringify(base[k]), tool + ' mismatch ' + s.k + '/' + k);
    ['jeong', 'seung'].forEach(mode => mapRefs(tool, [contextCards.get(s.k + '|' + mode)]));
    if (tool === 'saamcloze') {
      for (const [mode, mnemonic] of [['jeong', s.mj], ['seung', s.ms]]) {
        const c = contextCards.get(s.k + '|' + mode);
        c.detail += '\n원문 니모닉: ' + plain(mnemonic);
      }
    }
  });
  cover(tool, tool === 'saammirror' ? '사암 거울' : '사암 니모닉', 'mapped', tool === 'saammirror'
    ? '12경의 正格·勝格 혈쌍 및 母·官·子를 원본 종합표와 전량 대조 후 24개 종합 카드에 연결. 官혈 역할 전환은 각 카드의 원리에 보존.'
    : '12경의 正格·勝格 24개 혈 구성을 종합 카드와 공유하고 24개 니모닉 문장은 해당 카드 해설에 원문 그대로 보존.');
}

// The separate iframe has its own generated 60-card deck. Preserve its actual
// derived formulas rather than assuming all rows agree with the main table.
const fillScript = Array.from(fillHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g), m => m[1]).find(s => s.includes('var M ='));
assert.ok(fillScript, 'Missing external fill source');
const fillPrefix = fillScript.slice(fillScript.indexOf('"use strict";'), fillScript.indexOf('// ===== 상태/렌더'));
const fill = vm.runInNewContext(fillPrefix + '\n({CARDS,M})', { Math: fixedMath }, { timeout: 3000 });
assert.equal(fill.CARDS.length, fill.M.length * 5);
fill.CARDS.forEach(c => {
  const mode = c.sys === '自經' ? (c.badge.includes('實證') ? 'za_sil' : 'za_heo') : ({ '主客': 'juu', '正格': 'jeong', '勝格': 'seung' })[c.sys];
  const sourceId = c.sys + '|' + c.mer + '|' + c.badge;
  const question = c.parts.map(p => p.t || p.hl || (p.b ? '[' + p.b.label + ': ____]' : '')).join('');
  const solution = c.parts.map(p => p.t || p.hl || (p.b ? p.b.ans.h + '(' + p.b.ans.d + ')' : '')).join('');
  const base = saamFull.find(s => s.k === c.mer), ctx = buildCtx(base, mode);
  const canonical = ctx.slots.flatMap(s => s.need.map(p => p[0])).sort();
  const external = c.answers.map(a => a.h).sort();
  const mismatch = canonical.join('|') !== external.join('|');
  if (mismatch) audit.sourceConflicts.push({ meridian: c.mer, mode, main: canonical.join(' · '), fill: external.join(' · ') });
  add({ id: 'saambosafill:' + c.mer + ':' + mode, topic: 'saam', tool: 'saambosafill', sourceId,
    prompt: c.badge + '\n' + question, answer: solution,
    detail: 'saam_bosa_fill.html의 원본 도출식·빈칸 순서·정답·독음을 보존.' + (mismatch ? '\n자료 내부 차이: 사암 종합표의 같은 맥락은 ' + canonical.join(' · ') + '. 원본 두 자료를 임의 통합하지 않음.' : '\n주 허브 종합표와 혈 구성 일치(혈 순서 제외).'),
  });
});
cover('saambosafill', '사암 補瀉', 'included', '별도 saam_bosa_fill.html의 12경 × 5문항 = 60개 도출식을 실제 빌더로 생성. 원래 빈칸·보사 동사·정답을 보존; 주 허브 표와 비교한 차이는 문서에 명시.');

// Keep conflicting original answers visible for review, but give the scheduler
// an explicit machine-readable reason to exclude them from confirmed mastery.
for (const conflict of audit.sourceConflicts) {
  const titles = { za_heo: '虛證', za_sil: '實證', juu: '主客', jeong: '正格', seung: '勝格' };
  const mainId = 'saammaster:' + conflict.meridian + ':' + conflict.mode;
  const fillId = 'saambosafill:' + conflict.meridian + ':' + conflict.mode;
  const message = conflict.meridian + (titles[conflict.mode] || conflict.mode) + '의 원자료가 서로 다릅니다. 주 허브 표: ' + conflict.main + ' / 외부 보사 도출식: ' + conflict.fill + '. 교재의 기준을 확인하기 전에는 확정 암기 대상으로 채점하지 마세요.';
  cards.filter(c => c.id === mainId || c.id === fillId ||
    (c.tool === 'saamquiz' && c.prompt.includes(conflict.meridian + '(') && c.prompt.includes(titles[conflict.mode])))
    .forEach(c => { c.needsVerification = true; c.sourceConflict = message; c.detail = '【원자료 확인 필요】 ' + message + '\n' + c.detail; });
}
const verificationCount = cards.filter(c => c.needsVerification).length;
assert.equal(verificationCount, 3, 'Expected three original cards affected by the known 胃勝格 source conflict; review after source changes');
assert.deepEqual(cards.filter(c => c.needsVerification).map(c => c.id).sort(), ['saamquiz:saamS3', 'saammaster:胃:seung', 'saambosafill:胃:seung'].sort());
for (const id of ['saamquiz:saamS3', 'saammaster:胃:seung']) {
  const c = cards.find(x => x.id === id); assert.ok(c.answer.includes('厲兌') && c.answer.includes('商丘'), 'Main source conflict value changed: ' + id);
}
assert.ok(cards.find(c => c.id === 'saambosafill:胃:seung').answer.includes('商陽'), 'External source conflict value changed');

// Completeness and integrity are build gates, not UI percentages.
const toolList = literal('home', 'TOOLS');
assert.equal(toolList.length, 22);
assert.deepEqual(coverage.map(c => c.tool).sort(), Array.from(toolList, t => t.id).sort());
const order = new Map(toolList.map((t, i) => [t.id, i]));
coverage.sort((a, b) => order.get(a.tool) - order.get(b.tool));
for (const [tool, set] of refs) for (const id of set) assert.ok(ids.has(id), 'Broken coverage reference: ' + tool + '/' + id);
for (const c of cards) {
  assert.ok(!/<\/?[a-z][^>]*>/i.test(c.prompt + c.answer + c.detail), 'Unstripped HTML ' + c.id);
  assert.ok(['recall', 'sequence'].includes(c.kind));
  if (c.choices) assert.ok(c.choices.includes(c.answer), 'Original correct answer missing from choices: ' + c.id);
  if (c.requiresChoices) assert.ok(c.choices && c.choices.length > 1, 'Directive question has no choices: ' + c.id);
}
const catalogue = { version: 1, topics, cards, coverage };
const topicCounts = topics.map(t => ({ ...t, count: cards.filter(c => c.topic === t.id).length }));
const js = '/* Generated by scripts/build-exam-catalog.cjs. Edit source data, then rebuild. */\n' +
  '(function(root){"use strict";var catalogue=' + JSON.stringify(catalogue, null, 2).replace(/<\/script/gi, '<\\/script') +
  ';if(typeof module==="object"&&module.exports)module.exports=catalogue;if(root)root.MERIDIAN_EXAM_CATALOG=catalogue;})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:this);\n';

const docs = `# 기말 대비 카탈로그 범위와 검증\n\n` +
  `이 파일과 \`exam-catalog.js\`는 \`node scripts/build-exam-catalog.cjs\`로 기존 \`index.html\`과 \`saam_bosa_fill.html\`에서 생성한다. 외부 지식이나 새 정답을 보태지 않는다.\n\n` +
  `## 범위\n\n` +
  `- 회상 카드 **${cards.length}장**, 주제 **${topics.length}개**. 이 중 원자료 간 차이가 있는 **${verificationCount}장**은 \`needsVerification: true\`로 별도 표시한다.\n` +
  `- 기존 학습 도구 **22/22개**를 직접 추출하거나 동일 자료의 카드에 연결했다. 홈은 학습 도구 22개에 포함하지 않는다.\n` +
  `- 정적 BANK 5종 **${Object.entries(audit.banks).filter(([k]) => k !== 'acu').reduce((s, [, n]) => s + n, 0)}문항**과 경혈 생성기 **${audit.banks.acu}개 원래 문항 ID**를 전량 포함한다.\n` +
  `- 12경맥 원문 **${audit.routes.reduce((s, r) => s + r.phrases, 0)}구절** 모두 포함: **${audit.routes.reduce((s, r) => s + r.chunks, 0)}개 6구절 이하 묶음**, **${audit.routes.reduce((s, r) => s + r.next, 0)}개 다음 구절**.\n` +
  `- 교회 니모닉 **14묶음·${clozeBlankCount}개 빈칸**을 모든 한자·독음·문장과 함께 포함한다.\n` +
  `- 사암 종합 **84맥락**, 외부 사암 補瀉 **60문항**, 원본 사암 SRS **${audit.banks.saamquiz}문항**을 포함한다.\n\n` +
  `| 주제 ID | 주제 | 카드 수 |\n| --- | --- | ---: |\n` +
  topicCounts.map(t => `| ${t.id} | ${t.label} | ${t.count} |`).join('\n') + '\n\n' +
  `## 도구별 포함 범위\n\n` +
  `카드 수는 해당 도구가 연결되는 카드 수이다. 여러 도구가 같은 카드를 공유하므로 이 열을 합산하면 전체 카드 수와 다를 수 있다. \`included\`는 직접 추출을 포함, \`mapped\`는 원자료 동일성/범위를 대조하고 다른 카드에 연결했음을 뜻한다.\n\n` +
  `| 원래 도구 | ID | 처리 | 연결 카드 | 근거 |\n| --- | --- | --- | ---: | --- |\n` +
  coverage.map(c => `| ${c.label} | ${c.tool} | ${c.status} | ${c.cardCount} | ${c.note} |`).join('\n') + '\n\n' +
  `## 12경맥 원문 점검\n\n| 경맥 | 구절 | 묶음 | 다음 구절 |\n| --- | ---: | ---: | ---: |\n` +
  audit.routes.map(r => `| ${r.full} | ${r.phrases} | ${r.chunks} | ${r.next} |`).join('\n') + '\n\n' +
  `## 분모를 읽는 법\n\n` +
  `카드 수는 **학습 단위 수**이지 독립된 지식 수·시험 문항 수·임상적 사실 수가 아니다. 원본의 서로 다른 문제 문장과 연결 회상을 보존하기 위해 기능 퀴즈·계통 트리·스와이프, 발전사·매칭·연표 사이에 같은 사실이 반복될 수 있다. 유주 원문은 구간 회상과 다음 구절 회상을 각각 연습한다. 교회 니모닉도 전체 묶음과 개별 빈칸을 별도로 센다. 사암의 직접 회상과 외부 도출식은 같은 혈 구성을 다른 문제로 연습한다. 반대로 오수혈 게임 두 종류와 자타 암송, 사암 거울/니모닉은 검증된 공통 카드에 연결하므로 게임 수만큼 전체 분모를 늘리지 않는다.\n\n` +
  `정답을 한 번 열어보거나 한 번 맞힌 것은 장기 암기를 검증한 것이 아니다. 카탈로그 포함률 100%는 원본 데이터가 시험 대비 큐에 연결되었다는 뜻이며, 사용자 암기율 100% 또는 기말 출제 범위 보증이 아니다.\n\n` +
  `## 원본 보존과 한계\n\n` +
  `- 원래 SRS 질문·정답·해설을 보존하고 HTML 태그만 일반 텍스트로 바꾼다. 고정 오답 보기는 정답이 아닌 것으로 명확히 표시하여 해설에 남긴다. \`choices\`는 고정 BANK의 \`[a, ...d]\` 원문 순서를 보존하므로 화면에서 따로 섞어야 한다. 경혈 생성 문항은 원본 빌더의 보기를 보존한다. ‘다음 중·아닌 것·옳지 않은·잘못’ 등 지시 질문 ${cards.filter(c => c.requiresChoices).length}장에는 \`requiresChoices: true\`를 붙인다. 해당 문항은 선택지를 기본 제공하고, 나머지에서는 선택지를 힌트로 사용할 수 있다.\n` +
  `- 경혈 생성기의 순방향 1개를 기본 카드로 삼고 같은 ID의 역방향 질문·답은 해설에 보존한다. 원래 무작위 보기 조합의 모든 순열은 별도 카드로 만들지 않는다.\n` +
  `- 사암 종합표·외부 도출식은 각각 보존한다. 학술적 교정·판본 확정은 이 빌드의 범위가 아니다. 원본 한열 표의 특이배합 주석도 보존한다. 충돌 ${verificationCount}장의 질문·답은 원문대로 두고 \`needsVerification\` 및 \`sourceConflict\`를 추가한다. 시험 대비 엔진은 교재 확인 전 해당 항목을 확정 숙련으로 채점하지 않아야 한다.\n` +
  `- 배수혈맵·가리기표의 원본에는 프로토타입/교재 대조 예정 문구가 있다. 이 카탈로그는 해당 데이터를 옮겼으며 외부 표준과의 대조 검증을 완료했다고 주장하지 않는다.\n` +
  `- 자타의 12개 음원과 기능 암기송 6곡, 재생 속도·구절 마킹·노래 반복, 시각적 배치/시간제한은 기존 도구에 그대로 남는다. 음원 바이트·UI 설정은 암기 카드 수에 포함하지 않는다. 기능 암기송의 지식은 기능 BANK·계통 트리·스와이프 범위와 겹치며, 반복 후렴은 새 사실로 늘리지 않는다.\n` +
  `- 기존 로컬 진도는 출석·누적 오답·퀴즈 성적이며, 이 새 카드들의 지연 회상 성취로 자동 인정하지 않는다.\n\n` +
  `## 자료 내부 비교\n\n` +
  (audit.sourceConflicts.length ? `사암 종합표와 외부 사암 補瀉의 혈 구성을 순서 제외하고 비교했을 때 다음 차이가 있었다. 두 출처를 명시한 채 보존하며 자동으로 정답을 통합하지 않는다.\n\n| 경맥 | 맥락 | 종합표 | 외부 補瀉 |\n| --- | --- | --- | --- |\n` + audit.sourceConflicts.map(x => `| ${x.meridian} | ${x.mode} | ${x.main} | ${x.fill} |`).join('\n') : `사암 종합표와 외부 사암 補瀉에서 공통인 60맥락의 혈 구성은 순서 제외 비교 시 일치했다. 한열 맥락은 외부 게임에 없으므로 이 비교 대상이 아니다.`) + '\n\n' +
  `## 재생성과 검증\n\n` +
  `\`node scripts/build-exam-catalog.cjs\`로 재생성하고 \`node scripts/build-exam-catalog.cjs --check\`로 저장본과의 일치를 확인한다. 빌드 시 22도구 누락, 원래 경혈 분야 개수 불일치, 중복 ID, 빈 질문/답, 깨진 참조, 교회 니모닉과 표의 불일치, 공유한다고 선언한 사암·오수혈 데이터의 차이를 오류로 처리한다. 무작위 보기 순서는 고정 난수로 재현 가능하게 만들고 생성 날짜를 파일에 넣지 않는다. Node에서는 \`require('./exam-catalog.js')\`, 브라우저에서는 \`window.MERIDIAN_EXAM_CATALOG\`로 같은 객체를 읽는다.\n`;

const files = [['exam-catalog.js', js], ['docs/exam-coverage.md', docs]];
if (process.argv.includes('--check')) {
  for (const [relative, expected] of files) {
    if (fs.readFileSync(path.join(ROOT, relative), 'utf8') !== expected) throw new Error(relative + ' is stale; rebuild the catalogue');
  }
} else {
  for (const [relative, content] of files) {
    const dest = path.join(ROOT, relative); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, content);
  }
}
console.log(JSON.stringify({ action: process.argv.includes('--check') ? 'checked' : 'built', cards: cards.length, topics: topicCounts.map(({ id, count }) => ({ id, count })), coverage: coverage.map(({ tool, status, cardCount }) => ({ tool, status, cardCount })), sourceConflicts: audit.sourceConflicts }, null, 2));
