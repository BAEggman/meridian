#!/usr/bin/env node
'use strict';

// Regression checks for a buildless, template-mounted application. No browser or
// external packages are needed. Browser layout/interaction QA remains separate.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const iframeHtml = fs.readFileSync(path.join(ROOT, 'saam_bosa_fill.html'), 'utf8');
const EXPECTED_TOOLS = ['acu', 'osstep', 'osspeed', 'func', 'history', 'sidong',
  'jata', 'jingorder', 'spine', 'baesurule', 'ref', 'cloze', 'era', 'match',
  'systree', 'swipe', 'saamwheel', 'saammirror', 'saamcloze', 'saammaster',
  'saamquiz', 'saambosafill'];

// Snapshots of the original medical data literals (commit 7659e9b). UI and
// telemetry may change; changing these hashes requires an intentional content
// review, not merely regenerating snapshots after a redesign.
const MEDICAL_LITERAL_HASHES = {
  "acu/MERID": "9415c9634ddb29bb125fcb17f603721f3e2c54e91effb8947491967a782b010c",
  "acu/POS": "f6cf3b6f134351bb566f5eacfb876a2ce3a96c3d9e998106abfa6a75623229ea",
  "acu/WX_YIN": "f73677a43e04a2473231cfdafaaaa3017dad80cb3fb408bc9dde336ae3b8ea13",
  "acu/WX_VAR": "a9fcc618508624528c8814053156fdcbade1c47a552897822e001bd5bfa8cf74",
  "acu/RAK_X": "0511bba24c51d9b674bf6cacfc442833fb5742efda2941755eb3453ac172319e",
  "acu/GEUK_X": "bdaa7439466f31d1801b5201b003d7718711c923e2f1a11a25e13f024ee27276",
  "acu/HAHAP": "1efc41cc71e720be98db0aa0a873cb68f6821c62f504d8b1e874abf1e693ce4e",
  "acu/PALHOE": "09f3babb819bb5819a826f0bd6bd621164b5336ce7fedcf8cee31664957cd1ef",
  "acu/PALMAEK": "3ba23657c491ca6124013a39b9d0da127f530d031b30eacd03ebc43a4a49dbcf",
  "acu/OSUZHU": "d71b9fda465c5081b90961c05acad22f0aa0efbe934a6f9722617363a35c8d36",
  "acu/GYEONGMAEK": "b76765bb4c10d4b561b401a383f8b1897fc50b1933ea3d29c8015d7bc5b49ae6",
  "acu/PAIRS": "4a0db0c478462161023ab6952aec0c2f1f21db3de6429877d4f8a5659e1c91f7",
  "acu/SANGYONG": "2991fcb0bf86145c3dd4ec1ed7ffd55bfc334170ffd8a3f3d5978d98b5ceac42",
  "func/CATS": "be2a0695c4ddd7ed260bd60d4e258642ad28410c6ede3ffb203e4cb5be50d170",
  "func/BANK": "5c3b28cf48f6946faa4879d61e4d69e36c07c5f0b7a28efefd5e576653921ffc",
  "history/CATS": "f1aeb82f8a360ee9a623c2d1f382143b81fb54bee3a6a2b0e551fe6209e7e871",
  "history/BANK": "43ffe527aef8bbce0c7253f9274a14e6c9f09ea3c202ddcf0e035befa0718b9f",
  "sidong/CATS": "5842dc1c874b61b8736fab606af079d71eb19c89e934aa64707f89efed72decc",
  "sidong/BANK": "2de27886f4511ce3c12e06db8412f8fba7e410ba230378f7678f15b343e8a0ac",
  "jata/MERIDIANS": "175911c015f8fbb117df681be5ec4896a030c95fc701f17211bed5b42eb0f339",
  "jata/ELS": "e374bb15f99c5b8620997467405d3b5690abb5ff3616ab6543fc4b6b05a48300",
  "jata/CIRC": "9f9c2d764f73ba6e084a91db872cb621873d4dc6605dd8aa26883842fc3c3cb8",
  "spine/EL": "1ca65eea802a45b6cac921db4027a2a8a79f31a7768a64eec5c3ccd6d62b08a7",
  "spine/SHU": "6f1fc5ff05f781fed8cf4a09b77f32a8f3a30463ba9e4e9bddf524a932bf2034",
  "spine/REGIONS": "c37198dfcdb849a73da3516e684832d51ae56b640356c997e7667cc36394db68",
  "spine/MER": "f122248b6ccb196fab8039f1cf595c830a50c4a3ade02f7493ebde8a2cc8afe0",
  "spine/MK": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  "spine/JIAO": "4bdb216306b0503acfe2c5e8162d3a5569f12d81d99f4715bfff780a024801d3",
  "baesurule/CATS": "d271f6bad3fc832181ffd2e63cbde485d72f1dde52f5ef962f5b51824193d7a0",
  "baesurule/BANK": "92d9a5eaeb78a8141f4b19ff1bdfc51e76cfe7ab698ed881e2aae6361767ca24",
  "ref/EL": "2f9d6a833a22bcc4e53301a90b2cdfec62ec006c4ecb91cd6524eac1a1e483c9",
  "ref/SHU": "3d00b6cd6643f9954beb034916c171b161483daea16bb0ffc7f9b2551ef53dbb",
  "ref/MOMU": "f2312f7dbe2aa0eac55735a8f5e7ea47a7d5ee57c389b7168cc17187bd1533e5",
  "ref/JIAO": "2885219b9c7d5fcfbc34462e26b9ce1a63e483d066d4981f2c84f4b52b3b8f2e",
  "ref/SPECS": "e81b3f2252345a96265d1fd3136c12504b4f9462a46322fc07a45b94034a597b",
  "cloze/GROUPS": "3057e367b242127f42ef0d5d182985a9cbb8eb8b54710b4381575e31f7395639",
  "era/ERAS": "29597cb5cd2dadd09234da02453adf99bbeed14a7af8704fea5c58a18f90d824",
  "era/CARDS": "2fff86c2c75e81ccb28f012ced0ad38f533963f6d8504d0f21028b7dea72878a",
  "era/ERA_COUNT": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  "match/ROWS": "16fbe5d8b90649f4dcd0137a9f0986b529c9f9e3fe8963def29d953f7056a216",
  "match/COLS": "4286fa36c5c9b809c6389c05391304f0b504af77a27e11a40f8fd5e4524f4dc3",
  "systree/GROUPS": "22c7321c590ed1fff03fea5f784597d50f081a00a9557d945aebf1d87b081317",
  "systree/CARDS": "ecc0a6438566eeb9150d946cf41299ecbc1a937f9561e2f47b6e1ecdae9f34cc",
  "systree/COMP_LABEL": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  "systree/COMP_COUNT": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  "swipe/ITEMS": "57c66b0cebe999710b59860bb5c065d24727c5a0cfdc3b5d938baaddaf4f977c",
  "saamwheel/SAAMF": "4aae91652e615de6d676047b110e0c375e431b6ca2ebfb5d8902495b54e4a59b",
  "saamwheel/ELALL": "fad5dc54551f9bf0d4ccdb819f9ba3b7eadb3f65d89e9ff9fcdc197090bfa397",
  "saamwheel/POS": "e4abc4c3d715db71af2f2e3e2c5aed1392adc30f891fa572d50e966236bcd331",
  "saamwheel/SHENG": "e3ca649972ce220489cd018580466817cb1bf9758424498a5599babb3b1d24f0",
  "saamwheel/KE": "2367068ee124dbf8b409f129bfb5000a6be911f7f46245681f76d2e1c1dd564a",
  "saamwheel/ELNAME": "e758599520ae518fc7479236eb152f01077209cb76605cb5244dfa3fa7c7f0d1",
  "saammirror/SAAM": "dd67e4ddcc502c3f843ea547b94ea7079a75669c00e3cb81a3dcc81747c54860",
  "saammirror/ELALL": "fad5dc54551f9bf0d4ccdb819f9ba3b7eadb3f65d89e9ff9fcdc197090bfa397",
  "saamcloze/SAAM": "dd67e4ddcc502c3f843ea547b94ea7079a75669c00e3cb81a3dcc81747c54860",
  "saamcloze/ELALL": "fad5dc54551f9bf0d4ccdb819f9ba3b7eadb3f65d89e9ff9fcdc197090bfa397",
  "saammaster/SAAMF": "4aae91652e615de6d676047b110e0c375e431b6ca2ebfb5d8902495b54e4a59b",
  "saammaster/ELALL": "fad5dc54551f9bf0d4ccdb819f9ba3b7eadb3f65d89e9ff9fcdc197090bfa397",
  "saammaster/ELC": "1a5fa10f39adf7ed30705d533e07fa71b67f7836fe39aaa5771d3fe49bfc383c",
  "saammaster/MODES": "ff7482dec690a3ade4d5dd5e161f835c19cced062da04bb3e759825185a687b2",
  "saammaster/GLOBAL": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  "saamquiz/CATS": "6986c9d9e73443881cd533388daffccb834565abd4beee4e7b9d56781965ac53",
  "saamquiz/BANK": "f3ad50ae2ba93bf7e7ed9b881f68cc61ac8e7afc2985c6580b2f6abc8c496d6e",
  "osstep/POS": "92f961ef7b028ac22dae239909c93c71e66f699e8971c2d2cdb7fb4e01b4c87e",
  "osstep/SHENG": "f73677a43e04a2473231cfdafaaaa3017dad80cb3fb408bc9dde336ae3b8ea13",
  "osstep/POSITIONS": "690191c9b8163f5dff070b304302169dd749734594f60754c7e2bab0860d0e90",
  "osstep/YIN": "ee9b579ef046405602bbc5bac93d405b030bb25547c820555b646ec5ecaf95cc",
  "osstep/YANG": "9950632f55cd994705aeb238503f5319200d58c37b5557a935e0ece22a6941c5",
  "osstep/ELKR": "aa9f343315573d5634941d6e51dfc6f21a2ddcb5df296eb69ee4a43cdb7cc010",
  "osspeed/SHENG": "f73677a43e04a2473231cfdafaaaa3017dad80cb3fb408bc9dde336ae3b8ea13",
  "osspeed/POSITIONS": "690191c9b8163f5dff070b304302169dd749734594f60754c7e2bab0860d0e90",
  "osspeed/YIN": "ee9b579ef046405602bbc5bac93d405b030bb25547c820555b646ec5ecaf95cc",
  "osspeed/YANG": "9950632f55cd994705aeb238503f5319200d58c37b5557a935e0ece22a6941c5",
  "osspeed/ELKR": "aa9f343315573d5634941d6e51dfc6f21a2ddcb5df296eb69ee4a43cdb7cc010",
  "osspeed/ELC": "1a5fa10f39adf7ed30705d533e07fa71b67f7836fe39aaa5771d3fe49bfc383c",
  "jingorder/FLOW": "7d09322eff8bdda0d998a9c378b5d90c19400c419d8a9a060a09b699fbe5b38b",
  "jingorder/ORDER": "b9c45ab8b86623ddf25bf8a9531954ced7a8c0d4dcb9286d440d9c63e2af2218"
};

const IFRAME_MEDICAL_HASHES = {
  "M": "b27fc3d41057b4e3907bc1f798a42600e668244c5db45775aa94acb013b33acd",
  "ORDER": "f73677a43e04a2473231cfdafaaaa3017dad80cb3fb408bc9dde336ae3b8ea13",
  "KR": "8808e29bb51eed51a10d569197b6a40461cca52bc0c4b10afa2c3ab777906081",
  "POS": "9c06dcd4db677cf86ac33ae8f924994986ee05af779aba602bc0f515c41a895b"
};

function scripts(source) {
  return Array.from(source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi), m => ({
    attrs: m[1], body: m[2], id: (m[1].match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1],
    src: (m[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1]
  }));
}
const blocks = scripts(html);
const byId = new Map(blocks.filter(s => s.id).map(s => [s.id, s]));

function literal(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('\\b(?:const|var|let)\\s+' + escaped + '\\s*=\\s*([\\[{])');
  const m = re.exec(source);
  assert.ok(m, `Missing medical data declaration: ${name}`);
  const start = m.index + m[0].length - 1;
  const stack = []; let quote = null, escapedChar = false, comment = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i], pair = source.slice(i, i + 2);
    if (comment === 'line') { if (ch === '\n') comment = null; continue; }
    if (comment === 'block') { if (pair === '*/') { comment = null; i++; } continue; }
    if (quote) {
      if (escapedChar) escapedChar = false;
      else if (ch === '\\') escapedChar = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (pair === '//') { comment = 'line'; i++; continue; }
    if (pair === '/*') { comment = 'block'; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if ('[{('.includes(ch)) stack.push(ch);
    else if (']})'.includes(ch)) {
      stack.pop();
      if (!stack.length) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed medical data declaration: ${name}`);
}

function text(value) {
  return String(value ?? '').replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

function syntaxAndPreservation() {
  let compiled = 0;
  for (const [file, source] of [['index.html', html], ['saam_bosa_fill.html', iframeHtml]]) {
    for (const [i, block] of scripts(source).entries()) {
      if (block.src) {
        if (!/^(?:https?:)?\/\//.test(block.src)) {
          const local = path.resolve(ROOT, block.src.split(/[?#]/)[0]);
          assert.ok(local.startsWith(ROOT + path.sep), 'Script path must stay in checkout');
          assert.ok(fs.existsSync(local), `Missing referenced script: ${block.src}`);
          new vm.Script(fs.readFileSync(local, 'utf8'), { filename: block.src });
          compiled++;
        }
      } else if (!/type\s*=\s*["'](?:application\/json|application\/ld\+json)["']/i.test(block.attrs)) {
        new vm.Script(block.body, { filename: `${file}:${block.id || i}` });
        compiled++;
      }
    }
  }
  for (const tool of EXPECTED_TOOLS.filter(t => t !== 'saambosafill')) {
    assert.match(html, new RegExp('<template\\b[^>]*id=["\']tpl-' + tool + '["\']'), `Missing template ${tool}`);
    assert.ok(byId.has('src-' + tool), `Missing game script ${tool}`);
  }
  for (const [name, hash] of Object.entries(MEDICAL_LITERAL_HASHES)) {
    const [tool, variable] = name.split('/');
    const source = byId.get('src-' + tool);
    assert.ok(source, `Missing source for ${name}`);
    const actual = crypto.createHash('sha256').update(literal(source.body, variable)).digest('hex');
    assert.equal(actual, hash, `Original medical data changed: ${name}`);
  }
  for (const [name, hash] of Object.entries(IFRAME_MEDICAL_HASHES)) {
    const actual = crypto.createHash('sha256').update(literal(iframeHtml, name)).digest('hex');
    assert.equal(actual, hash, `Original iframe medical data changed: ${name}`);
  }
  console.log(`PASS: ${compiled} scripts compile; 22 original tools and ${Object.keys(MEDICAL_LITERAL_HASHES).length + Object.keys(IFRAME_MEDICAL_HASHES).length} medical data blocks remain intact.`);
}

function catalogCoverage() {
  const filename = path.join(ROOT, 'exam-catalog.js');
  assert.ok(fs.existsSync(filename), 'exam-catalog.js has not been generated');
  const sandbox = { window: {}, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename, timeout: 10000 });
  const catalog = sandbox.window.MERIDIAN_EXAM_CATALOG || sandbox.module.exports;
  assert.ok(Array.isArray(catalog.cards) && catalog.cards.length > 0, 'Catalog must contain cards');
  const ids = new Set(); const sourceCards = new Map();
  const topics = new Set(catalog.topics.map(t => t.id));
  for (const card of catalog.cards) {
    assert.equal(typeof card.id, 'string');
    assert.ok(card.id && !ids.has(card.id), `Duplicate/empty card ID ${card.id}`);
    ids.add(card.id);
    assert.ok(topics.has(card.topic), `Unknown topic ${card.topic}`);
    assert.ok(text(card.prompt), `Missing question for ${card.id}`);
    assert.ok(text(card.answer), `Missing answer for ${card.id}`);
    assert.ok(EXPECTED_TOOLS.includes(card.tool), `Unknown source tool for ${card.id}`);
    assert.ok(card.sourceId != null, `Missing source ID for ${card.id}`);
    if (card.requiresChoices) {
      assert.ok(Array.isArray(card.choices) && card.choices.length >= 2, `Missing visible options for ${card.id}`);
      assert.ok(card.choices.some(option => text(option) === text(card.answer)), `Correct answer absent from options for ${card.id}`);
    }
    const key = `${card.tool}::${card.sourceId}`;
    if (!sourceCards.has(key)) sourceCards.set(key, []);
    sourceCards.get(key).push(card);
  }
  const coverage = new Map(catalog.coverage.map(item => [item.tool, item]));
  for (const tool of EXPECTED_TOOLS) {
    assert.ok(coverage.has(tool), `No coverage statement for ${tool}`);
    const item = coverage.get(tool);
    assert.ok(['included', 'mapped'].includes(item.status), `Coverage of ${tool} is incomplete`);
    assert.ok(item.cardCount > 0 && text(item.note), `Coverage of ${tool} needs count and rationale`);
  }
  let fixedQuestions = 0;
  for (const tool of ['func', 'history', 'sidong', 'baesurule', 'saamquiz']) {
    const bank = vm.runInNewContext('(' + literal(byId.get('src-' + tool).body, 'BANK') + ')', {}, { timeout: 1000 });
    for (const original of bank) {
      const candidates = sourceCards.get(`${tool}::${original.id}`);
      assert.ok(candidates && candidates.length, `Missing original fixed question ${tool}::${original.id}`);
      const match = candidates.find(c => text(c.prompt) === text(original.q) && text(c.answer) === text(original.a));
      assert.ok(match, `Original question/answer changed: ${tool}::${original.id}`);
      fixedQuestions++;
    }
  }
  console.log(`PASS: ${ids.size} unique cards cover all 22 tools; ${fixedQuestions} original fixed questions retain their answers.`);
  return catalog;
}

function makeTarget() {
  const handlers = new Map();
  return {
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
    dispatchEvent(event) { for (const fn of Array.from(handlers.get(event.type) || [])) fn.call(this, event); return true; }
  };
}
function makeNode() {
  const node = Object.assign(makeTarget(), {
    children: [], dataset: {}, style: {}, textContent: '', _html: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    setAttribute(k, v) { if (k === 'data-tab') this.dataset.tab = String(v); this[k] = String(v); },
    getAttribute(k) { return k === 'data-tab' ? this.dataset.tab : this[k]; },
    querySelector() { return makeNode(); }, querySelectorAll() { return []; }, cloneNode() { return makeNode(); }
  });
  Object.defineProperty(node, 'innerHTML', { get() { return this._html; }, set(value) { this._html = value; this.children = []; } });
  node.content = { cloneNode() { return makeNode(); } };
  return node;
}

async function legacyContracts(catalog) {
  const bootstrap = blocks.find(block => !block.id && /async function activate\(id\)/.test(block.body));
  assert.ok(bootstrap, 'Cannot locate legacy mount controller');
  const storage = new Map([['unrelated-key', 'preserve-me']]);
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  const nodes = new Map();
  const templateIds = new Set(Array.from(html.matchAll(/<template\b[^>]*id=["']([^"']+)["']/g), m => m[1]));
  const tabs = ['home', ...EXPECTED_TOOLS].map(id => Object.assign(makeNode(), { dataset: { id } }));
  const document = Object.assign(makeTarget(), {
    readyState: 'loading', body: makeNode(), documentElement: makeNode(), activeElement: null,
    getElementById(id) {
      if (id.startsWith('tpl-') && !templateIds.has(id)) return null;
      if (id.startsWith('src-') && !byId.has(id)) return null;
      if (!nodes.has(id)) nodes.set(id, makeNode());
      return nodes.get(id);
    },
    querySelectorAll(selector) { return selector === '.tab' ? tabs : []; },
    querySelector() { return null; }, createElement() { return makeNode(); }
  });
  const location = { hash: '', pathname: '/meridian/', search: '', href: 'https://example.test/meridian/' };
  const window = Object.assign(makeTarget(), { scrollTo() {}, location });
  const tabEvents = [], answerEvents = [];
  window.addEventListener('hub:tabchange', event => tabEvents.push(event.detail));
  window.addEventListener('hub:answer', event => answerEvents.push(event.detail));
  function navigate(_state, _title, url) {
    const parsed = new URL(url, location.href);
    Object.assign(location, { hash: parsed.hash, pathname: parsed.pathname, search: parsed.search, href: parsed.href });
  }
  const sandbox = {
    window, document, localStorage, location, history: { replaceState: navigate, pushState: navigate },
    console, Date, Promise, URL, URLSearchParams, setTimeout, clearTimeout,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  };
  Object.assign(window, { history: sandbox.history, CustomEvent: sandbox.CustomEvent });
  vm.runInNewContext(bootstrap.body, sandbox, { filename: 'legacy-mount-controller', timeout: 1000 });
  assert.equal(typeof window.__activate, 'function');
  assert.equal(typeof window.HubStats.record, 'function');
  const sourceCard = catalog.cards.find(c => c.tool === 'func');
  assert.ok(sourceCard, 'No function question available to exercise record contract');
  const card = { id: sourceCard.sourceId, q: sourceCard.prompt, a: sourceCard.answer, cat: 'disc' };
  window.HubStats.record('func', card, false);
  window.HubStats.record('func', card, true);
  const saved = JSON.parse(storage.get('hub_stats_v1')).q['func::' + card.id];
  assert.equal(saved.seen, 2, 'Record contract lost an attempt');
  assert.equal(saved.wrong, 1, 'Historical wrong count must remain cumulative');
  assert.ok(saved.lastWrong && saved.last);
  assert.deepEqual(saved.h.map(entry => entry[1]), [0, 1], 'Recent answer history must survive the exam bridge');
  assert.equal(answerEvents.length, 2, 'Both legacy attempts must notify the exam bridge');
  assert.equal(answerEvents[0].tool, 'func');
  assert.equal(answerEvents[0].cardId, String(card.id));
  assert.equal(answerEvents[0].correct, false);
  assert.equal(answerEvents[1].correct, true);
  for (let i = 0; i < 12; i++) window.HubStats.record('func', card, i % 3 !== 0);
  const recent = JSON.parse(storage.get('hub_stats_v1')).q['func::' + card.id];
  assert.equal(recent.h.length, 10, 'Legacy recent-answer history must stay bounded');
  assert.deepEqual(recent.h.map(entry => entry[1]), Array.from({ length: 12 }, (_, i) => i % 3 !== 0 ? 1 : 0).slice(-10));
  assert.equal(recent.seen, 14);
  assert.equal(recent.wrong, 5, 'Bounding recent history must not erase cumulative errors');
  assert.equal(storage.get('unrelated-key'), 'preserve-me');
  assert.equal(document.readyState, 'loading'); // tests deliberately control mounting
  await window.__activate('func');
  assert.equal(window.__active, 'func');
  assert.equal(document.getElementById('mount').getAttribute('data-tab'), 'func');
  assert.equal(location.hash, '#func');
  assert.equal(tabEvents.at(-1).id, 'func');
  const originalChildren = document.getElementById('mount').children.slice();
  await window.__activate('home');
  assert.equal(window.__active, 'home');
  assert.equal(document.getElementById('mount').getAttribute('data-tab'), 'home');
  assert.equal(location.hash, '#home');
  assert.equal(tabEvents.at(-1).id, 'home');
  assert.ok(!document.getElementById('mount').children.some(c => originalChildren.includes(c)), 'Previous tool DOM must be removed');
  await window.__activate('saambosafill');
  assert.equal(window.__active, 'saambosafill');
  assert.equal(document.getElementById('mount').getAttribute('data-tab'), 'saambosafill');
  assert.ok(document.getElementById('mount').children.some(n => n.src === 'saam_bosa_fill.html'), 'Saam iframe route must remain available');
  assert.equal(tabEvents.at(-1).id, 'saambosafill');
  location.hash = '#history';
  window.dispatchEvent({ type: 'hashchange' });
  await Promise.resolve();
  assert.equal(window.__active, 'history', 'Hash navigation must activate a known tool');
  location.hash = '#no-such-tool';
  window.dispatchEvent({ type: 'popstate' });
  await Promise.resolve();
  assert.equal(window.__active, 'home', 'Invalid history target must fall back to home');
  const beforeRepeat = tabEvents.length;
  await window.__activate('home');
  assert.equal(tabEvents.length, beforeRepeat + 1, 'Reopening home must notify the dashboard');

  // The original integrated queue increments i before mounting a chunk. Its
  // final (or only) chunk must still be cancellable by every manual route.
  const legacySession = window.HubSession;
  const plan = () => [{ tool: 'func', ids: [String(card.id)] }];
  const navigationCases = [
    ['tab', () => tabs.find(t => t.dataset.id === 'home').onclick()],
    ['external activation', () => window.__activate('home')],
    ['hashchange', () => { location.hash = '#home'; window.dispatchEvent({ type: 'hashchange' }); }],
    ['popstate', () => { location.hash = '#home'; window.dispatchEvent({ type: 'popstate' }); }]
  ];
  for (const [label, navigateManually] of navigationCases) {
    legacySession.start(plan());
    assert.equal(legacySession.active(), true, `${label}: final legacy chunk must remain active`);
    await navigateManually();
    await Promise.resolve(); // drain the previous mount's hint callback
    assert.equal(legacySession.active(), false, `${label}: manual navigation must cancel the legacy session`);
    assert.equal(window.__focusDrill, null, `${label}: cancelled legacy drill must not leak into the next tool`);
    assert.equal(window.__active, 'home');
    assert.ok(!document.getElementById('hub-hint').textContent.startsWith('통합 세션 '),
      `${label}: cancelled mount must not replace the new page's hint`);
    const beforeLateNext = tabEvents.length;
    legacySession.next(); // equivalent to an already-scheduled finish callback
    assert.equal(tabEvents.length, beforeLateNext, `${label}: late completion must not interrupt the new page`);
    assert.equal(storage.has('hub_session_last'), false, `${label}: cancelling is not a completed session`);
  }
  legacySession.start([...plan(), ...plan()]);
  await Promise.resolve();
  const firstChunkChildren = document.getElementById('mount').children.slice();
  legacySession.next();
  await Promise.resolve();
  assert.equal(legacySession.active(), true, 'Automatic advancement must preserve the legacy session through its last chunk');
  assert.ok(!document.getElementById('mount').children.some(child => firstChunkChildren.includes(child)),
    'Consecutive chunks of the same tool must remount to consume their drill IDs');
  legacySession.next();
  await Promise.resolve();
  assert.equal(legacySession.active(), false);
  assert.equal(window.__active, 'home');
  const completedLegacy = JSON.parse(storage.get('hub_session_last'));
  assert.equal(completedLegacy.items, 2);
  assert.equal(completedLegacy.chunks, 2);

  // Exercise the actual Saam choose() implementation, not a matching string.
  // This module previously omitted the central stats callback entirely.
  const saamSource = byId.get('src-saamquiz').body;
  const chooseStart = /function choose\(btn\)\s*\{/.exec(saamSource);
  assert.ok(chooseStart, 'Saam choose handler must be present');
  const bodyStart = chooseStart.index + chooseStart[0].length - 1;
  const chooseBody = literal('const chosen = ' + saamSource.slice(bodyStart), 'chosen');
  const saamBank = vm.runInNewContext('(' + literal(saamSource, 'BANK') + ')');
  const b = saamBank[0];
  const G = { db: { cards: {}, log: {} }, cur: b, answered: false, hinted: false,
    queue: [], sCorrect: 0, sWrong: 0, sStreak: 0, sBest: 0, sSeen: 0, sinceMiss: 0 };
  const chooseContext = Object.assign({}, sandbox, {
    G, HubStats: window.HubStats, $: id => document.getElementById(id),
    INT: vm.runInNewContext('(' + literal(saamSource, 'INT') + ')'),
    ST_MAX: Number(/\bST_MAX\s*=\s*(\d+)/.exec(saamSource)[1]),
    addDays: require(path.join(ROOT, 'exam-engine.js')).addDays,
    today: () => '2026-11-02', saveDB() {}, refreshStats() {}
  });
  const choose = vm.runInNewContext('(function choose(btn)' + chooseBody + ')', chooseContext);
  const beforeSaam = answerEvents.length;
  choose({ dataset: { v: b.a } });
  assert.equal(answerEvents.length, beforeSaam + 1, 'Saam answer must reach the shared study record');
  assert.equal(answerEvents.at(-1).tool, 'saamquiz');
  assert.equal(answerEvents.at(-1).cardId, b.id);
  assert.equal(answerEvents.at(-1).correct, true);
  assert.equal(G.db.cards[b.id].st, 2, 'First correct answer must retain the upstream SRS card-creation behavior');
  assert.equal(G.db.cards[b.id].due, '2026-11-09');
  console.log('PASS: recent answer history, legacy queue completion/cancellation, navigation and the Saam answer bridge execute.');
}

async function appStorageContracts(catalog) {
  const filename = path.join(ROOT, 'exam-app.js');
  assert.ok(fs.existsSync(filename), 'exam-app.js must be available');
  const Engine = require(path.join(ROOT, 'exam-engine.js'));
  const Codec = require(path.join(ROOT, 'exam-storage.js'));
  const day = Engine.localDay();
  const base = Engine.createState(day);
  const card = catalog.cards.find(c => !c.needsVerification);
  const learned = Engine.review(base, card.id, 2, { today: day, seconds: 30 });
  const app = fs.readFileSync(filename, 'utf8');
  // Expose closures only in this in-memory test copy; production has no test API.
  const exposed = app.replace(/\}\)\(\);\s*$/, `
    window.__examAudit = {
      init: function(engine, catalog, initial) {
        E = engine; C = catalog; state = initial; cardMap = Object.create(null); sourceMap = Object.create(null);
        C.cards.forEach(function(card) { cardMap[card.id] = card; });
      },
      current: function() { return state; },
      warning: function() { return storageWarning; },
      currentSession: function() { return activeSession; },
      persist: persist, refreshState: refreshState, importFile: importFile, exportBackup: exportBackup,
      loadState: loadState, getPending: getPending, saveSession: saveSession, start: start, resume: resume
    };
  })();`);
  assert.notEqual(exposed, app, 'Test-only app closure adapter did not match');

  function context(initialStorage) {
    const store = new Map(Object.entries(initialStorage || {}));
    const controls = { reject: () => false, writes: 0, blobs: [], downloads: [] };
    const localStorage = {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) {
        controls.writes++;
        if (controls.reject(key)) throw new Error('QuotaExceededError');
        store.set(key, String(value));
      },
      removeItem(key) { store.delete(key); }
    };
    const window = Object.assign(makeTarget(), { confirm: () => true, MeridianExamStorage: Codec });
    const document = Object.assign(makeTarget(), {
      readyState: 'loading', getElementById: () => null, body: makeNode(),
      createElement() {
        return Object.assign(makeNode(), { click() { controls.downloads.push(this.download); }, remove() {} });
      }
    });
    const blobURLs = {
      createObjectURL(blob) { controls.blobs.push(blob); return 'blob:meridian-test'; },
      revokeObjectURL() {}
    };
    vm.runInNewContext(exposed, { window, document, localStorage, console, Date, Map, Set, Number, URL: blobURLs, Blob, setTimeout, clearTimeout }, { filename, timeout: 2000 });
    return { api: window.__examAudit, store, controls, window };
  }

  const failedSave = context({ meridian_exam_v1: JSON.stringify(base) });
  failedSave.api.init(Engine, catalog, learned);
  failedSave.controls.reject = key => key === 'meridian_exam_v1';
  assert.equal(failedSave.api.persist(), false);
  assert.ok(failedSave.api.warning(), 'Storage failure must be visible');
  failedSave.api.refreshState();
  assert.ok(failedSave.api.current().records[card.id]?.seen,
    'A failed write must not let refreshState overwrite unsaved learning with an older saved state');
  failedSave.controls.reject = () => false;
  assert.equal(failedSave.api.persist(), true);
  assert.ok(JSON.parse(Codec.decode(failedSave.store.get('meridian_exam_v1'))).records[card.id].seen);

  const examSession = context({ meridian_exam_v1: JSON.stringify(base) });
  examSession.api.init(Engine, catalog, base);
  let cancellations = 0;
  examSession.window.HubSession = { cancel() { cancellations++; } };
  examSession.api.start('mock', 2);
  assert.equal(cancellations, 1, 'Starting exam study must cancel any pending legacy queue');
  const pendingExam = examSession.store.get('meridian_exam_session_v1');
  assert.ok(pendingExam, 'Starting an exam session must persist its resumable position');
  examSession.api.resume();
  assert.equal(cancellations, 2, 'Resuming exam study must cancel any pending legacy queue');
  assert.equal(examSession.store.get('meridian_exam_session_v1'), pendingExam);

  const blockedSession = context({ meridian_exam_v1: JSON.stringify(base) });
  blockedSession.api.init(Engine, catalog, base);
  blockedSession.controls.reject = key => key === 'meridian_exam_session_v1';
  blockedSession.api.start('mock', 2);
  const unsavedId = blockedSession.api.currentSession().sessionId;
  assert.ok(blockedSession.api.warning());
  assert.equal(blockedSession.store.has('meridian_exam_session_v1'), false);
  assert.equal(blockedSession.api.getPending().sessionId, unsavedId,
    'A failed session write must retain a resumable in-memory attempt');
  blockedSession.api.exportBackup();
  const emergencyBackup = JSON.parse(await blockedSession.controls.blobs[0].text());
  assert.equal(emergencyBackup.session.sessionId, unsavedId);
  blockedSession.controls.reject = () => false;
  assert.equal(blockedSession.api.saveSession(), true);
  assert.equal(JSON.parse(blockedSession.store.get('meridian_exam_session_v1')).sessionId, unsavedId);

  const originalExam = JSON.stringify(base), originalLegacy = JSON.stringify({ q: {} });
  const backup = {
    format: 'meridian-exam-backup', version: 1,
    exportedAt: new Date().toISOString(), exam: learned,
    legacy: {
      hub_stats_v1: JSON.stringify({ q: { probe: { seen: 1 } } }),
      hub_session_last: JSON.stringify({ day, items: 4, chunks: 1, mins: 2 })
    }
  };
  const file = data => ({ size: JSON.stringify(data).length, text: async () => JSON.stringify(data) });
  const rollback = context({ meridian_exam_v1: originalExam, hub_stats_v1: originalLegacy, unrelated: 'keep' });
  rollback.api.init(Engine, catalog, base);
  let rejected = false;
  rollback.controls.reject = key => { if (key === 'hub_stats_v1' && !rejected) { rejected = true; return true; } return false; };
  await rollback.api.importFile(file(backup));
  assert.ok(rejected, 'Fixture must exercise a mid-restore write failure');
  assert.equal(rollback.store.get('meridian_exam_v1'), originalExam, 'Restore failure must roll back the exam record');
  assert.equal(rollback.store.get('hub_stats_v1'), originalLegacy, 'Restore failure must preserve the original legacy record');
  assert.equal(rollback.store.get('unrelated'), 'keep');

  const restored = context({ meridian_exam_v1: originalExam, hub_stats_v1: originalLegacy, unrelated: 'keep' });
  restored.api.init(Engine, catalog, base);
  const extraKey = JSON.parse(JSON.stringify(backup)); extraKey.legacy.unrelated = JSON.stringify({ replace: true });
  await restored.api.importFile(file(extraKey));
  assert.ok(JSON.parse(Codec.decode(restored.store.get('meridian_exam_v1'))).records[card.id]?.seen, 'Valid restore must persist the selected exam record');
  assert.ok(JSON.parse(restored.store.get('hub_stats_v1')).q.probe, 'Valid restore must include named legacy records');
  assert.equal(JSON.parse(restored.store.get('hub_session_last')).items, 4, 'Backup restore must preserve the upstream session summary');
  assert.equal(restored.store.get('unrelated'), 'keep', 'Restore must not write arbitrary keys supplied by a file');

  const invalidDate = context({ meridian_exam_v1: originalExam });
  invalidDate.api.init(Engine, catalog, base);
  const malformed = JSON.parse(JSON.stringify(backup)); malformed.exam.settings.examDate = '2027-99-99';
  await invalidDate.api.importFile(file(malformed));
  assert.equal(invalidDate.controls.writes, 0, 'Invalid calendar dates must be rejected before any backup write');

  const primitiveLegacy = context({ meridian_exam_v1: originalExam, hub_stats_v1: originalLegacy });
  primitiveLegacy.api.init(Engine, catalog, base);
  const malformedLegacy = JSON.parse(JSON.stringify(backup)); malformedLegacy.legacy.hub_stats_v1 = 'null';
  await primitiveLegacy.api.importFile(file(malformedLegacy));
  assert.equal(primitiveLegacy.controls.writes, 0, 'Legacy records must be objects, not merely syntactically valid JSON');

  // Exercise the actual exporter and importer with additive feature data. The
  // previous version-1 format remains a valid import; new records travel inside
  // exam rather than relying on a second, easily omitted browser-storage key.
  const yesterday = Engine.addDays(day, -1);
  let reversal = Engine.setReversalPreferences(Engine.createState(yesterday), {
    cue: '아침 식사를 마치면 책상에 앉기', plannedTime: '09:10'
  }, { today: yesterday });
  reversal = Engine.review(reversal, card.id, 0, {
    today: yesterday, attemptId: 'backup-original', evidence: 'recall', unaided: true,
    usedHint: false, originalAnswer: '백업에도 그대로 남겨야 하는 첫 오답', seconds: 27
  });
  reversal = Engine.review(reversal, card.id, 2, {
    today: yesterday, attemptId: 'backup-correction', evidence: 'recall', unaided: true,
    usedHint: false, originalAnswer: '정답을 본 뒤 교정', seconds: 12
  });
  reversal = Engine.reserveFirst(reversal, card.id, { today: yesterday, plannedTime: '09:10' });
  reversal = Engine.recordReflection(reversal, { today: yesterday, returnIntent: 3 });
  reversal.reversal.customFutureField = { preserve: true };
  reversal.records[card.id].reversal.customFutureField = { preserve: 'record' };
  const selectedRecord = JSON.parse(JSON.stringify(reversal.records[card.id]));
  const exporter = context({
    meridian_exam_v1: JSON.stringify(reversal),
    hub_stats_v1: originalLegacy,
    hub_session_last: backup.legacy.hub_session_last,
    unrelated: 'never-export-this'
  });
  exporter.api.init(Engine, catalog, reversal);
  exporter.api.exportBackup();
  assert.equal(exporter.controls.blobs.length, 1, 'Export must produce a downloadable JSON payload');
  assert.equal(exporter.controls.downloads[0], `meridian-study-${day}.json`);
  const exported = JSON.parse(await exporter.controls.blobs[0].text());
  assert.equal(exported.format, 'meridian-exam-backup');
  assert.equal(exported.version, 1, 'The additive feature must not invalidate existing backups');
  assert.equal(exported.exam.version, 1);
  assert.equal(exported.exam.reversal.featureVersion, 1);
  assert.deepEqual(exported.exam.records[card.id].reversal.firstAnswer, selectedRecord.reversal.firstAnswer);
  assert.equal(Object.hasOwn(exported.legacy, 'unrelated'), false);

  const featureRestore = context({ meridian_exam_v1: originalExam,
    meridian_exam_session_v1: pendingExam, unrelated: 'keep' });
  featureRestore.api.init(Engine, catalog, base);
  await featureRestore.api.importFile(file(exported));
  const importedFeature = JSON.parse(Codec.decode(featureRestore.store.get('meridian_exam_v1')));
  const importedView = Engine.getReversal(catalog, importedFeature, day);
  assert.equal(importedView.cue, '아침 식사를 마치면 책상에 앉기');
  assert.equal(importedView.reservation.cardId, card.id);
  assert.equal(importedView.startCard.id, card.id);
  assert.ok(importedView.retestCards.some(item => item.id === card.id));
  const importedYesterday = importedView.recentDays.find(row => row.day === yesterday);
  assert.equal(importedYesterday.firstAttempts, 1);
  assert.equal(importedYesterday.firstCorrect, 0);
  assert.equal(importedYesterday.corrections, 1);
  assert.equal(importedYesterday.recoveries, 0);
  assert.equal(importedYesterday.returnIntent, 3);
  assert.deepEqual(importedFeature.records[card.id].reversal.firstAnswer, selectedRecord.reversal.firstAnswer);
  assert.deepEqual(importedFeature.records[card.id].reversal.lastFailureAnswer, selectedRecord.reversal.lastFailureAnswer);
  assert.deepEqual(importedFeature.reversal.customFutureField, { preserve: true });
  assert.deepEqual(importedFeature.records[card.id].reversal.customFutureField, { preserve: 'record' });
  assert.equal(featureRestore.store.get('unrelated'), 'keep');
  assert.equal(featureRestore.store.has('meridian_exam_session_v1'), false,
    'Backup restore must keep the established policy of clearing a stale in-progress session');
  assert.equal(featureRestore.store.get('meridian_exam_v1').startsWith(Codec.prefix), true,
    'A restored ordinary JSON backup must be written using the compressed storage codec');
  const freshFeatureRestore = context(Object.fromEntries(featureRestore.store));
  freshFeatureRestore.api.init(Engine, catalog, base);
  freshFeatureRestore.api.loadState();
  assert.equal(Engine.getReversal(catalog, freshFeatureRestore.api.current(), day).reservation.cardId, card.id);
  assert.deepEqual(JSON.parse(JSON.stringify(freshFeatureRestore.api.current().records[card.id].reversal.firstAnswer)),
    selectedRecord.reversal.firstAnswer, 'A fresh app must reload the restored compressed original answer');

  // A restore that fails after writing the new record must preserve both the
  // previous feature state and the still-resumable session.
  const sessionSnapshot = JSON.stringify({ version: 1, day, ids: [card.id], index: 0, results: [], retries: {} });
  const priorCompressed = Codec.encode(JSON.stringify(reversal));
  const featureRollback = context({ meridian_exam_v1: priorCompressed,
    meridian_exam_session_v1: sessionSnapshot, hub_stats_v1: originalLegacy });
  featureRollback.api.init(Engine, catalog, reversal);
  let rejectFeatureOnce = false;
  featureRollback.controls.reject = key => {
    if (key === 'hub_stats_v1' && !rejectFeatureOnce) { rejectFeatureOnce = true; return true; }
    return false;
  };
  await featureRollback.api.importFile(file(backup));
  assert.equal(rejectFeatureOnce, true);
  assert.equal(featureRollback.store.get('meridian_exam_v1'), priorCompressed,
    'A failed restore must restore the exact previous compressed storage string');
  assert.equal(featureRollback.store.get('meridian_exam_session_v1'), sessionSnapshot);
  const freshRollback = context(Object.fromEntries(featureRollback.store));
  freshRollback.api.init(Engine, catalog, base);
  freshRollback.api.loadState();
  assert.deepEqual(JSON.parse(JSON.stringify(freshRollback.api.current().records[card.id].reversal.firstAnswer)),
    selectedRecord.reversal.firstAnswer);

  const unreadable = context({ meridian_exam_v1: '{broken-json' });
  unreadable.api.init(Engine, catalog, base);
  unreadable.api.loadState();
  assert.equal(unreadable.api.persist(), false);
  assert.equal(unreadable.store.get('meridian_exam_v1'), '{broken-json', 'Unreadable source must remain recoverable');
  const futureRaw = JSON.stringify({ version: 9, settings: {}, records: { future: { kept: true } } });
  const futureVersion = context({ meridian_exam_v1: futureRaw });
  futureVersion.api.init(Engine, catalog, base);
  futureVersion.api.loadState();
  assert.equal(futureVersion.api.persist(), false);
  assert.equal(futureVersion.store.get('meridian_exam_v1'), futureRaw);

  const rawCompatible = context({ meridian_exam_v1: originalExam });
  rawCompatible.api.init(Engine, catalog, learned);
  rawCompatible.api.loadState();
  assert.equal(rawCompatible.api.current().version, 1);
  assert.equal(rawCompatible.api.current().records[card.id], undefined,
    'An old plain JSON state must be loaded rather than replaced with the in-memory fixture');
  assert.equal(rawCompatible.api.persist(), true);
  assert.equal(Codec.decode(rawCompatible.store.get('meridian_exam_v1')), JSON.stringify(rawCompatible.api.current()));

  const malformedCompressed = Codec.prefix + '1:999:00000000:00000000:broken-payload';
  const corruptPacked = context({ meridian_exam_v1: malformedCompressed });
  corruptPacked.api.init(Engine, catalog, base);
  corruptPacked.api.loadState();
  assert.equal(corruptPacked.api.persist(), false);
  assert.equal(corruptPacked.store.get('meridian_exam_v1'), malformedCompressed);
  corruptPacked.api.exportBackup();
  const corruptBackup = JSON.parse(await corruptPacked.controls.blobs[0].text());
  assert.equal(corruptBackup.unreadableOriginal, malformedCompressed);

  const corruptedDuringUse = context({ meridian_exam_v1: Codec.encode(JSON.stringify(learned)) });
  corruptedDuringUse.api.init(Engine, catalog, learned);
  corruptedDuringUse.store.set('meridian_exam_v1', malformedCompressed);
  corruptedDuringUse.api.refreshState();
  assert.equal(corruptedDuringUse.api.persist(), false,
    'A checksum failure noticed during refresh must protect the source before another save');
  assert.equal(corruptedDuringUse.store.get('meridian_exam_v1'), malformedCompressed);
  assert.equal(corruptedDuringUse.api.current().records[card.id].seen, true);

  const missingCodec = context({ meridian_exam_v1: priorCompressed });
  missingCodec.window.MeridianExamStorage = undefined;
  missingCodec.api.init(Engine, catalog, base);
  missingCodec.api.loadState();
  assert.equal(missingCodec.api.persist(), false);
  assert.equal(missingCodec.store.get('meridian_exam_v1'), priorCompressed,
    'A missing codec must never replace an unreadable compressed state');
  const plainFallback = context({ meridian_exam_v1: originalExam });
  plainFallback.window.MeridianExamStorage = undefined;
  plainFallback.api.init(Engine, catalog, base);
  plainFallback.api.loadState();
  assert.equal(plainFallback.api.persist(), true);
  assert.equal(JSON.parse(plainFallback.store.get('meridian_exam_v1')).version, 1);
  console.log('PASS: failed saves retain in-memory learning; old/new backups restore original answers, metrics and reservations, roll back on failure, and preserve unreadable sources.');
}

// A small DOM shim executes app event handlers and persistence across fresh VM
// contexts. It intentionally does not test browser layout, accessibility-tree
// rendering or navigation; those still require a real browser.
function studyNode(tagName = 'div') {
  const decode = value => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const node = Object.assign(makeTarget(), {
    tagName: tagName.toUpperCase(), children: [], parentNode: null,
    attributes: {}, dataset: {}, style: {}, textContent: '', value: '',
    hidden: false, disabled: false, readOnly: false, open: false, _html: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    setAttribute(key, value) {
      const v = String(value); this.attributes[key] = v;
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
      else if (key === 'readonly') this.readOnly = true;
      else if (['hidden', 'disabled', 'checked', 'selected'].includes(key)) this[key] = true;
      else this[key] = v;
    },
    getAttribute(key) { return this.attributes[key] ?? null; },
    removeAttribute(key) {
      delete this.attributes[key];
      if (key === 'readonly') this.readOnly = false;
      else if (['hidden', 'disabled', 'checked', 'selected'].includes(key)) this[key] = false;
    },
    matches(selector) {
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) return String(this.class || '').split(/\s+/).includes(selector.slice(1));
      const attr = /^\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(selector);
      if (attr) return Object.hasOwn(this.attributes, attr[1]) && (attr[2] === undefined || this.attributes[attr[1]] === attr[2]);
      return this.tagName.toLowerCase() === selector.toLowerCase();
    },
    querySelectorAll(selector) {
      const found = [];
      const visit = parent => { for (const child of parent.children) { if (child.matches(selector)) found.push(child); visit(child); } };
      visit(this); return found;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    closest(selector) { let n = this; while (n) { if (n.matches(selector)) return n; n = n.parentNode; } return null; },
    scrollIntoView() {}, focus() {}, remove() {},
    click() {
      if (this.disabled) return;
      this.dispatchEvent({ type: 'click', target: this, preventDefault() {} });
      if (this.tagName === 'SUMMARY' && this.parentNode && this.parentNode.tagName === 'DETAILS') {
        this.parentNode.open = !this.parentNode.open;
        this.parentNode.dispatchEvent({ type: 'toggle', target: this.parentNode });
      }
    }
  });
  Object.defineProperty(node, 'elements', { get() {
    const elements = {};
    for (const child of this.querySelectorAll('[name]')) elements[child.name] = child;
    return elements;
  } });
  Object.defineProperty(node, 'innerHTML', {
    get() { return this._html; },
    set(source) {
      this._html = String(source); this.children = []; this.textContent = '';
      const stack = [this];
      const tokens = /<\/?([a-z][\w-]*)\b([^>]*)>|([^<]+)/gi;
      let m;
      while ((m = tokens.exec(this._html))) {
        if (m[3]) { stack.at(-1).textContent += decode(m[3]); continue; }
        const tag = m[1].toLowerCase();
        if (m[0].startsWith('</')) {
          const current = stack.at(-1);
          if (current.tagName === tag.toUpperCase() && stack.length > 1) {
            if (tag === 'textarea') current.value = current.textContent;
            if (tag === 'select') {
              const options = current.querySelectorAll('option');
              current.value = (options.find(option => option.selected) || options[0] || { value: '' }).value;
            }
            stack.pop();
          }
          continue;
        }
        const child = studyNode(tag);
        const attrs = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let attr;
        while ((attr = attrs.exec(m[2]))) child.setAttribute(attr[1], decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
        stack.at(-1).appendChild(child);
        if (!m[0].endsWith('/>') && !['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tag)) stack.push(child);
      }
    }
  });
  return node;
}

async function appStudyContracts() {
  const Engine = require(path.join(ROOT, 'exam-engine.js'));
  const Codec = require(path.join(ROOT, 'exam-storage.js'));
  const day = '2026-11-03';
  const c = {
    topics: [{ id: 'route', title: '유주', label: '유주' }],
    coverage: [{ tool: 'test', label: '테스트 원문' }],
    cards: [{ id: 'study', topic: 'route', prompt: '첫 답을 기억하는 시험 질문', answer: '정답',
      choices: ['정답', '오답'], requiresChoices: false, detail: '설명', tool: 'test', sourceId: 'study', kind: 'recall' }]
  };
  const filename = path.join(ROOT, 'exam-app.js');
  const app = fs.readFileSync(filename, 'utf8');
  const exposed = app.replace(/\}\)\(\);\s*$/, `
    window.__studyAudit = {
      init: function(engine, catalog, initial) {
        E = engine; C = catalog; state = initial; cardMap = Object.create(null); sourceMap = Object.create(null);
        C.cards.forEach(function(card) { cardMap[card.id] = card; sourceMap[card.tool + '::' + card.sourceId] = [card.id]; });
      },
      current: function() { return state; },
      session: function() { return activeSession; },
      loadState: loadState, start: start, resume: resume, getPending: getPending,
      reveal: reveal, grade: grade, dashboard: dashboard
    };
  })();`);
  assert.notEqual(exposed, app);
  function context(initial) {
    const store = new Map(initial instanceof Map ? initial : Object.entries(initial || {}));
    const root = studyNode('section'), mount = studyNode(), live = studyNode();
    root.id = 'exam-root'; mount.id = 'mount'; live.id = 'exam-live';
    const nodes = { 'exam-root': root, mount, 'exam-live': live };
    let clock = Date.parse(`${day}T00:00:00Z`);
    class ClockDate extends Date {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    }
    const localStorage = {
      getItem(key) { return store.get(key) ?? null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); }
    };
    const window = Object.assign(makeTarget(), { __active: 'home', confirm: () => true, MeridianExamStorage: Codec,
      HubSession: { cancel() {} }, matchMedia: () => ({ matches: false }) });
    const document = Object.assign(makeTarget(), {
      readyState: 'loading', hidden: false, activeElement: null, body: studyNode('body'),
      getElementById(id) { return nodes[id] || root.querySelector('#' + id); },
      querySelector(selector) { return root.querySelector(selector); },
      createElement: studyNode
    });
    const fixedEngine = Object.assign({}, Engine, { localDay(value) { return Engine.localDay(value === undefined ? clock : value); } });
    vm.runInNewContext(exposed, { window, document, localStorage, console,
      Date: ClockDate, Map, Set, Number, URL, Blob, setTimeout, clearTimeout }, { filename, timeout: 2000 });
    const api = window.__studyAudit;
    api.init(fixedEngine, c, Engine.createState(day));
    api.loadState();
    return { api, root, store, live, window, tick(seconds) { clock += seconds * 1000; } };
  }
  function input(ctx, value) {
    const field = ctx.root.querySelector('#exam-scratch');
    assert.ok(field, 'A study card must expose its answer field');
    field.value = value;
    field.dispatchEvent({ type: 'input', target: field });
    return field;
  }
  function draft(ctx) { return ctx.api.session().drafts[String(ctx.api.session().index)]; }

  const typed = context();
  typed.api.dashboard();
  assert.equal(Engine.getReversal(c, typed.api.current(), day).today.startedAt, null);
  typed.api.start('mock', 1);
  assert.equal(Engine.getReversal(c, typed.api.current(), day).today.startedAt, null,
    'Opening a question must not be recorded as an actual recall start');
  const original = '내 첫 답 <표식> & "원문"\n둘째 줄';
  input(typed, original);
  const start = Engine.getReversal(c, typed.api.current(), day).today.startedAt;
  assert.ok(start, 'Actual typing must record the first start');
  typed.tick(12);
  typed.api.reveal();
  assert.equal(typed.root.querySelector('#exam-scratch').readOnly, true);
  assert.equal(draft(typed).originalAnswer, original);
  assert.equal(draft(typed).revealed, true);
  const originalAttempt = draft(typed).attemptId;
  const originalSession = typed.store.get('meridian_exam_session_v1');
  assert.ok(originalSession.includes(originalAttempt));
  const reloaded = context(typed.store);
  reloaded.api.resume();
  assert.equal(draft(reloaded).attemptId, originalAttempt, 'Reload must reuse the original attempt identity');
  assert.equal(draft(reloaded).originalAnswer, original);
  assert.equal(reloaded.root.querySelector('#exam-scratch').readOnly, true);
  assert.equal(reloaded.root.querySelector('#exam-scratch').value, original);
  assert.equal(reloaded.root.querySelector('#exam-answer-area').hidden, false);
  assert.equal(Engine.getReversal(c, reloaded.api.current(), day).today.startedAt, start);
  reloaded.api.grade(0);
  let saved = JSON.parse(Codec.decode(reloaded.store.get('meridian_exam_v1')));
  assert.equal(saved.records.study.attempts, 1);
  assert.equal(saved.records.study.reversal.firstAnswer.originalAnswer, original);
  assert.equal(Engine.getReversal(c, saved, day).today.firstAttempts, 1);
  assert.equal(Engine.getReversal(c, saved, day).today.firstCorrect, 0);

  // Simulate the session write being interrupted after the answer was saved.
  // Resuming that exact attempt must not record it a second time.
  const interrupted = new Map(reloaded.store);
  interrupted.set('meridian_exam_session_v1', originalSession);
  const replay = context(interrupted);
  replay.api.resume();
  replay.api.grade(0);
  saved = JSON.parse(Codec.decode(replay.store.get('meridian_exam_v1')));
  assert.equal(saved.records.study.attempts, 1);
  assert.equal(saved.records.study.reversal.firstAnswer.originalAnswer, original);
  assert.equal(Engine.getReversal(c, saved, day).today.firstAttempts, 1);

  const hinted = context();
  hinted.api.start('mock', 1);
  input(hinted, '힌트 이전의 답');
  hinted.root.querySelector('#exam-choice-hint').click();
  assert.equal(draft(hinted).usedHint, true);
  assert.equal(draft(hinted).originalAnswer, '힌트 이전의 답');
  assert.equal(hinted.root.querySelector('#exam-scratch').readOnly, true);
  const hintedChoices = JSON.parse(JSON.stringify(draft(hinted).choices));
  const hintReload = context(hinted.store);
  hintReload.api.resume();
  assert.equal(draft(hintReload).usedHint, true, 'A refresh must not wash away a used hint');
  assert.deepEqual(JSON.parse(JSON.stringify(draft(hintReload).choices)), hintedChoices);
  assert.equal(draft(hintReload).originalAnswer, '힌트 이전의 답');
  hintReload.api.reveal();
  assert.equal(hintReload.root.querySelector('[data-grade="2"]').disabled, true);
  hintReload.api.grade(3); // bypassing the disabled button must remain safe
  saved = JSON.parse(Codec.decode(hintReload.store.get('meridian_exam_v1')));
  assert.equal(saved.records.study.lastGrade < 2, true);
  assert.equal(saved.records.study.reversal.firstAnswer.originalAnswer, '힌트 이전의 답');
  assert.equal(Engine.getReversal(c, saved, day).today.firstAttempts, 0);
  assert.equal(Engine.getReversal(c, saved, day).today.recoveries, 0);

  const malformedHintStore = new Map(hinted.store);
  const malformedHintSession = JSON.parse(malformedHintStore.get('meridian_exam_session_v1'));
  malformedHintSession.drafts['0'].usedHint = 'invalid-boolean';
  malformedHintStore.set('meridian_exam_session_v1', JSON.stringify(malformedHintSession));
  const malformedHint = context(malformedHintStore);
  malformedHint.api.resume();
  malformedHint.api.reveal();
  malformedHint.api.grade(3);
  assert.equal(Engine.getReversal(c, malformedHint.api.current(), day).today.firstCorrect, 0,
    'A malformed hint flag must not turn a previously hinted attempt into unaided success');

  const sourceHint = context();
  sourceHint.window.__activate = () => {};
  sourceHint.api.start('mock', 1);
  input(sourceHint, '원문을 열기 전 답');
  sourceHint.root.querySelector('[data-action="source"]').click();
  assert.equal(draft(sourceHint).usedHint, true);
  assert.equal(draft(sourceHint).originalAnswer, '원문을 열기 전 답');
  const sourceResume = context(sourceHint.store);
  sourceResume.api.resume();
  sourceResume.api.reveal();
  sourceResume.api.grade(3);
  assert.equal(Engine.getReversal(c, sourceResume.api.current(), day).today.firstCorrect, 0,
    'Opening a source answer must be retained as a hint when the question is resumed');

  const exposedOnly = context();
  exposedOnly.api.start('mock', 1);
  exposedOnly.api.reveal();
  assert.equal(Engine.getReversal(c, exposedOnly.api.current(), day).today.startedAt, null,
    'Answer exposure alone is not the start of unaided recall');
  exposedOnly.api.grade(0);
  assert.equal(Engine.getReversal(c, exposedOnly.api.current(), day).today.firstAttempts, 0);

  // Completing and replaying a saved final attempt must not create a second
  // completed bundle or count a correction as a new first success.
  const completed = context();
  completed.api.start('mock', 1);
  input(completed, '정답');
  completed.api.reveal();
  const finalAttemptSession = completed.store.get('meridian_exam_session_v1');
  completed.api.grade(2);
  assert.equal(completed.api.session(), null);
  assert.equal(completed.api.current().reversal.uiDays[day].completedSessions.length, 1);
  const finalReplayStore = new Map(completed.store);
  finalReplayStore.set('meridian_exam_session_v1', finalAttemptSession);
  const finalReplay = context(finalReplayStore);
  finalReplay.api.resume();
  finalReplay.api.grade(2);
  assert.equal(finalReplay.api.current().records.study.attempts, 1);
  assert.equal(finalReplay.api.current().reversal.uiDays[day].completedSessions.length, 1);
  assert.equal(Engine.getReversal(c, finalReplay.api.current(), day).today.firstCorrect, 1);

  const midnight = context();
  midnight.api.start('mock', 1);
  input(midnight, '날짜가 바뀌기 전에 본 답');
  midnight.api.reveal();
  midnight.tick(24 * 60 * 60);
  midnight.api.grade(2);
  const nextDay = Engine.addDays(day, 1);
  assert.equal(Engine.getReversal(c, midnight.api.current(), nextDay).today.firstCorrect, 0,
    'An already exposed attempt must not become tomorrow\'s first unaided success at KST midnight');
  assert.equal(Engine.getReversal(c, midnight.api.current(), nextDay).today.recoveries, 0);

  const midnightChoice = context();
  midnightChoice.api.start('mock', 1);
  midnightChoice.root.querySelector('#exam-choice-hint').click();
  const staleChoice = midnightChoice.root.querySelectorAll('[data-choice]')[0];
  midnightChoice.tick(24 * 60 * 60);
  assert.doesNotThrow(() => staleChoice.click(),
    'A choice clicked at midnight must stop safely after the old session is replaced');
  assert.equal(midnightChoice.api.session(), null);
  assert.equal(Engine.getReversal(c, midnightChoice.api.current(), nextDay).today.firstAttempts, 0);
  assert.equal(Engine.getReversal(c, midnightChoice.api.current(), nextDay).today.startedAt, null);
  console.log('PASS: actual study handlers preserve answer/hint snapshots and attempt IDs across reload; duplicate deliveries and completed bundles stay unique.');
}

async function appExpeditionContracts() {
  const Engine = require(path.join(ROOT, 'exam-engine.js'));
  const Codec = require(path.join(ROOT, 'exam-storage.js'));
  const Expedition = require(path.join(ROOT, 'exam-expedition.js'));
  const day = '2026-11-04', yesterday = Engine.addDays(day, -1);
  const filename = path.join(ROOT, 'exam-app.js');
  const app = fs.readFileSync(filename, 'utf8');
  const exposed = app.replace(/\}\)\(\);\s*$/, `
    window.__expeditionAudit = {
      current: function() { return state; }, session: function() { return activeSession; },
      grade: grade, start: start, importFile: importFile, exportBackup: exportBackup
    };
  })();`);
  assert.notEqual(exposed, app);
  const plain = value => JSON.parse(JSON.stringify(value));
  function catalog(count = 6) {
    return {
      topics: [{ id: 'route', label: '유주', title: '유주' }, { id: 'point', label: '혈위', title: '혈위' }],
      coverage: [{ tool: 'test', label: '테스트 원자료' }],
      cards: Array.from({ length: count }, (_, i) => ({
        id: `room-${i}`, topic: i % 2 ? 'point' : 'route', prompt: `제${i + 1}관문의 원문 질문`,
        answer: `정답표식${i}`, choices: [`정답표식${i}`, `오답표식${i}`], detail: `원자료의 설명 ${i}`,
        requiresChoices: false, kind: 'recall', tool: 'test', sourceId: String(i)
      }))
    };
  }
  function initial() {
    const state = Engine.createState(yesterday);
    state.settings.examDate = Engine.addDays(day, 1);
    state.settings.reserveDays = 0;
    return state;
  }
  function context(c, supplied) {
    const store = new Map(supplied instanceof Map ? supplied : Object.entries(supplied || {}));
    if (!store.has('meridian_exam_v1')) store.set('meridian_exam_v1', JSON.stringify(initial()));
    const root = studyNode('section'), mount = studyNode(), live = studyNode();
    root.id = 'exam-root'; mount.id = 'mount'; live.id = 'exam-live';
    const nodes = { 'exam-root': root, mount, 'exam-live': live };
    let clock = Date.parse(`${day}T01:00:00Z`);
    class ClockDate extends Date {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    }
    const controls = { audioCreated: 0, blobs: [], sources: [] };
    const localStorage = {
      getItem(key) { return store.get(key) ?? null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); }
    };
    const fixedEngine = Object.assign({}, Engine, { localDay(value) { return Engine.localDay(value === undefined ? clock : value); } });
    const window = Object.assign(makeTarget(), {
      __active: 'home', confirm: () => true, MeridianExamStorage: Codec,
      MeridianExamEngine: fixedEngine, MeridianExpedition: Expedition, MERIDIAN_EXAM_CATALOG: c,
      HubSession: { cancel() {} }, matchMedia: () => ({ matches: true }),
      AudioContext: function() { controls.audioCreated++; throw new Error('Sound must stay opt-in'); },
      __activate(tool) {
        controls.sources.push(tool);
        window.__active = tool;
        window.dispatchEvent({ type: 'hub:tabchange', detail: { id: tool } });
      }
    });
    const document = Object.assign(makeTarget(), {
      readyState: 'loading', hidden: false, activeElement: null, body: studyNode('body'),
      getElementById(id) { return nodes[id] || root.querySelector('#' + id); },
      querySelector(selector) { return root.querySelector(selector); },
      createElement: studyNode
    });
    const blobURLs = { createObjectURL(blob) { controls.blobs.push(blob); return 'blob:expedition-test'; }, revokeObjectURL() {} };
    vm.runInNewContext(exposed, { window, document, localStorage, console, Date: ClockDate,
      Map, Set, Number, URL: blobURLs, Blob, setTimeout, clearTimeout }, { filename, timeout: 3000 });
    document.dispatchEvent({ type: 'DOMContentLoaded' });
    return { c, api: window.__expeditionAudit, root, store, window, document, controls,
      tick(seconds) { clock += seconds * 1000; } };
  }
  function node(ctx, selector) {
    const found = ctx.root.querySelector(selector);
    assert.ok(found, `The actual expedition UI must render ${selector}`);
    return found;
  }
  function click(ctx, selector) {
    const target = node(ctx, selector);
    assert.equal(target.disabled, false, `${selector} must be operable now`);
    target.click(); return target;
  }
  function content(element) { return element.textContent + element.children.map(content).join(''); }
  function draft(ctx) {
    const session = ctx.api.session();
    return session && session.drafts[String(session.index)];
  }
  function currentCard(ctx) {
    const session = ctx.api.session();
    return session && ctx.c.cards.find(card => card.id === session.ids[session.index]);
  }
  function fork(ctx, offset = 0) {
    const choice = ctx.root.querySelector(`[data-fork="${offset}"]`);
    if (choice) choice.click();
  }
  function choose(ctx, correct = true) {
    const card = currentCard(ctx), choices = draft(ctx).choices;
    const index = choices.findIndex(value => correct ? value === card.answer : value !== card.answer);
    assert.ok(index >= 0, 'This fixture must exercise an actual original option');
    click(ctx, `[data-x-choice="${index}"]`);
  }
  function submitChoice(ctx, correct = true) {
    fork(ctx);
    const card = currentCard(ctx), before = ctx.api.current().records[card.id]?.attempts || 0;
    choose(ctx, correct);
    assert.equal(ctx.api.current().records[card.id]?.attempts || 0, before,
      'Selecting an option is not an answered question until explicit submission');
    click(ctx, '#expedition-submit');
    assert.ok(ctx.root.querySelector('[data-outcome]'), 'Submission must render the result beat');
    assert.ok(content(ctx.root).includes(card.answer), 'The result must expose the canonical answer');
    assert.equal(ctx.api.current().records[card.id].attempts, before + 1);
  }
  function type(ctx, value) {
    const field = node(ctx, '#exam-scratch'); field.value = value;
    field.dispatchEvent({ type: 'input', target: field }); return field;
  }
  function submitRecall(ctx, correct = true) {
    fork(ctx);
    const card = currentCard(ctx);
    type(ctx, correct ? card.answer : `처음의 오답 ${card.id}`);
    click(ctx, '#exam-reveal');
    click(ctx, `[data-grade="${correct ? 2 : 0}"]`);
    assert.ok(ctx.root.querySelector('[data-outcome]'));
  }
  function next(ctx) { click(ctx, '#expedition-next'); }
  function resume(ctx) { click(ctx, '[data-x-action="resume"]'); }
  function start(ctx, approach = 'play') {
    click(ctx, `[data-approach="${approach}"]`);
    click(ctx, '[data-x-action="start"]');
    assert.ok(ctx.api.session()?.expedition, 'The main CTA must create a real expedition room');
  }

  // The complete loop is driven by real rendered controls, including a wrong
  // choice, post-submission reload, branch, five correct answers and finite repair.
  const c = catalog();
  let play = context(c);
  assert.equal(play.api.session(), null);
  assert.equal(Expedition.getWorld(c, play.api.current(), { today: day }).totals.introduced, 0);
  start(play);
  const ids = plain(play.api.session().ids);
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6);
  assert.equal(node(play, '#expedition-submit').disabled, true);
  const failedId = ids[0];
  choose(play, false);
  const ungradedSession = play.store.get('meridian_exam_session_v1');
  const submitted = click(play, '#expedition-submit');
  submitted.click();
  assert.equal(play.api.session().index, 0, 'A result waits for explicit Next');
  assert.equal(play.api.session().ids.length, 6, 'Wrong answers cannot append invisible extra rooms');
  assert.equal(play.api.current().records[failedId].lastGrade, 0);
  assert.equal(play.api.current().records[failedId].attempts, 1);
  assert.equal(node(play, '[data-outcome]').dataset.outcome, 'miss');
  assert.equal(node(play, '[data-room-node="0"]').dataset.result, 'miss');
  assert.equal(play.root.querySelector('[data-grade="3"]'), null, 'Objective choices must not ask for an honor-system success grade');
  const resultSession = JSON.parse(play.store.get('meridian_exam_session_v1'));
  const originalAttempt = resultSession.drafts['0'].attemptId;
  const priorChoiceOrder = plain(resultSession.drafts['0'].choices);
  play = context(c, play.store);
  resume(play);
  assert.equal(play.api.session().index, 0);
  assert.equal(draft(play).attemptId, originalAttempt);
  assert.deepEqual(plain(draft(play).choices), priorChoiceOrder);
  assert.equal(node(play, '[data-outcome]').dataset.outcome, 'miss');
  assert.equal(play.api.current().records[failedId].attempts, 1);
  play.api.grade(3);
  assert.equal(play.api.current().records[failedId].lastGrade, 0);
  assert.equal(play.api.current().records[failedId].attempts, 1);
  next(play);
  const beforeFork = plain(play.api.session().ids);
  click(play, '[data-fork="1"]');
  assert.deepEqual(plain(play.api.session().ids), [beforeFork[0], beforeFork[2], beforeFork[1], ...beforeFork.slice(3)]);
  const swappedId = currentCard(play).id;
  submitChoice(play);
  assert.equal(play.api.current().records[swappedId].reversal.firstAnswer.originalAnswer,
    c.cards.find(card => card.id === swappedId).answer, 'A branch must keep the current draft attached to its actual card');
  assert.equal(node(play, '[data-outcome]').dataset.outcome, 'first-choice');
  next(play);
  while (play.api.session()) { submitChoice(play); next(play); }
  assert.ok(play.root.querySelector('#expedition-complete'));
  assert.equal(play.root.querySelectorAll('[data-room-node]').length, 6);
  assert.equal(node(play, '[data-room-node="0"]').dataset.result, 'miss');
  assert.ok(play.root.querySelectorAll('[data-room-node]').slice(1).every(n => n.dataset.result === 'first-choice'));
  assert.ok(c.cards.every(card => content(play.root).includes(card.answer)), 'The end collection must contain the canonical fragments actually encountered');
  assert.equal(Expedition.getWorld(c, play.api.current(), { today: day }).totals.choiceConfirmed, 5);
  assert.equal(Expedition.getWorld(c, play.api.current(), { today: day }).totals.recalled, 0);
  assert.equal(Engine.getReversal(c, play.api.current(), day).today.firstAttempts, 0);
  assert.equal(Expedition.getDay(c, play.api.current(), { today: day }).remaining, 0);
  assert.equal(Expedition.getDay(c, play.api.current(), { today: day }).unresolved, 1);
  assert.ok(Engine.getPlan(c, play.api.current(), day).totalRemaining > 0);
  const optionalNext = play.root.querySelector('[data-x-action="next-route"]');
  if (optionalNext && !optionalNext.disabled) {
    optionalNext.click();
    assert.equal(play.api.session(), null, 'An empty primary day must not auto-fill an extra mock room');
  }
  click(play, '[data-x-action="repair"]');
  assert.equal(play.api.session().expedition.phase, 'repair');
  assert.deepEqual(plain(play.api.session().ids), [failedId]);
  submitChoice(play);
  assert.equal(node(play, '[data-outcome]').dataset.outcome, 'corrected');
  assert.equal(play.api.session().ids.length, 1);
  next(play);
  assert.equal(play.api.session(), null);
  assert.ok(play.root.querySelector('#expedition-complete'));
  assert.equal(Expedition.getWorld(c, play.api.current(), { today: day }).totals.choiceConfirmed, 5);
  assert.equal(Engine.getReversal(c, play.api.current(), day).today.recoveries, 0);
  assert.equal(Engine.getReversal(c, play.api.current(), day).tomorrowRetestCount, 1);
  click(play, '[data-x-action="finish"]');
  assert.equal(play.api.session(), null);
  assert.equal(play.controls.audioCreated, 0, 'No default effects may create an audio context');

  // A crash between the exam write and session write must not rewrite the
  // original wrong answer when the same submission is delivered again.
  const interrupted = new Map(play.store);
  const wrongOnly = Engine.review(initial(), failedId, 0, { today: day, attemptId: originalAttempt,
    evidence: 'choice', unaided: false, usedHint: false, originalAnswer: `오답표식${failedId.split('-')[1]}` });
  interrupted.set('meridian_exam_v1', Codec.encode(JSON.stringify(wrongOnly)));
  interrupted.set('meridian_exam_session_v1', ungradedSession);
  const replay = context(c, interrupted);
  resume(replay);
  assert.equal(replay.root.querySelector('[data-x-choice]'), null,
    'An already stored submission must resume at its result instead of accepting a replacement answer');
  replay.api.grade(3);
  assert.equal(replay.api.current().records[failedId].attempts, 1);
  assert.equal(replay.api.current().records[failedId].lastGrade, 0);
  assert.equal(node(replay, '[data-outcome]').dataset.outcome, 'miss');
  assert.equal(replay.api.current().records[failedId].reversal.firstAnswer.originalAnswer,
    `오답표식${failedId.split('-')[1]}`);
  assert.equal(Expedition.getWorld(c, replay.api.current(), { today: day }).totals.choiceConfirmed, 0);

  // A malformed older snapshot can reuse another card's attempt ID. Recovery
  // must stop the restore loop, retain the conflicting ID and require an assisted
  // confirmation, without changing the already stored result of the first card.
  const collisionCatalog = catalog(2);
  const collisionSeed = context(collisionCatalog);
  start(collisionSeed);
  const firstCollisionId = currentCard(collisionSeed).id;
  submitChoice(collisionSeed);
  const reusedAttempt = draft(collisionSeed).attemptId;
  next(collisionSeed);
  const secondCollisionId = currentCard(collisionSeed).id;
  const malformed = JSON.parse(collisionSeed.store.get('meridian_exam_session_v1'));
  const malformedDraft = malformed.drafts['1'];
  malformedDraft.attemptId = reusedAttempt;
  malformedDraft.started = true; malformedDraft.revealed = true;
  malformedDraft.choiceValue = currentCard(collisionSeed).answer;
  malformedDraft.originalAnswer = currentCard(collisionSeed).answer;
  malformedDraft.submission = { version: 1, day, attemptId: reusedAttempt, type: 'choice',
    grade: 2, choiceValue: malformedDraft.choiceValue, seconds: 15 };
  const collisionStore = new Map(collisionSeed.store);
  collisionStore.set('meridian_exam_session_v1', JSON.stringify(malformed));
  const collision = context(collisionCatalog, collisionStore);
  assert.doesNotThrow(() => resume(collision), 'A cross-card attempt collision must not recursively restore forever');
  assert.notEqual(draft(collision).attemptId, reusedAttempt);
  assert.equal(draft(collision).invalidFields.collidingAttemptId, reusedAttempt);
  assert.equal(draft(collision).usedHint, true);
  assert.equal(collision.api.current().records[firstCollisionId].attempts, 1);
  assert.equal(collision.api.current().records[secondCollisionId]?.attempts || 0, 0);
  click(collision, '#expedition-submit');
  assert.equal(node(collision, '[data-outcome]').dataset.outcome, 'assisted');
  assert.ok(collision.api.current().records[secondCollisionId].lastGrade < 2);
  assert.equal(collision.api.current().records[firstCollisionId].attempts, 1);
  assert.equal(Expedition.getWorld(collisionCatalog, collision.api.current(), { today: day }).totals.choiceConfirmed, 1);
  assert.equal(Expedition.getWorld(collisionCatalog, collision.api.current(), { today: day }).totals.recalled, 0);

  // Sequence play assembles original fragments, supports undo/reset, persists
  // its shuffle and partial answer, and grades complete order objectively.
  const sequenceCatalog = catalog(1);
  sequenceCatalog.cards[0].kind = 'sequence';
  sequenceCatalog.cards[0].answer = '起於中焦 → 下絡大腸 → 還循胃口';
  delete sequenceCatalog.cards[0].choices;
  let sequence = context(sequenceCatalog);
  start(sequence);
  const fragments = plain(draft(sequence).fragments);
  const sequenceAttempt = draft(sequence).attemptId;
  function fragment(ctx, value) { click(ctx, `[data-fragment="${draft(ctx).fragments.indexOf(value)}"]`); }
  assert.equal(node(sequence, '#expedition-submit').disabled, true);
  fragment(sequence, '還循胃口'); fragment(sequence, '下絡大腸');
  click(sequence, '#expedition-undo');
  assert.equal(draft(sequence).assembled.length, 1);
  click(sequence, '#expedition-reset');
  assert.equal(draft(sequence).assembled.length, 0);
  fragment(sequence, '還循胃口');
  sequence = context(sequenceCatalog, sequence.store);
  resume(sequence);
  assert.deepEqual(plain(draft(sequence).fragments), fragments);
  assert.equal(draft(sequence).assembled.length, 1);
  assert.equal(draft(sequence).attemptId, sequenceAttempt);
  fragment(sequence, '下絡大腸'); fragment(sequence, '起於中焦');
  click(sequence, '#expedition-submit');
  assert.equal(node(sequence, '[data-outcome]').dataset.outcome, 'miss');
  assert.equal(sequence.api.current().records['room-0'].lastGrade, 0);
  assert.equal(sequence.api.current().records['room-0'].reversal.firstAnswer.originalAnswer, '還循胃口 → 下絡大腸 → 起於中焦');
  sequence.api.grade(3);
  assert.equal(sequence.api.current().records['room-0'].lastGrade, 0);
  next(sequence);
  assert.equal(sequence.api.session(), null);
  const correctSequence = context(sequenceCatalog);
  start(correctSequence);
  for (const value of sequenceCatalog.cards[0].answer.split(' → ')) fragment(correctSequence, value);
  click(correctSequence, '#expedition-submit');
  assert.equal(node(correctSequence, '[data-outcome]').dataset.outcome, 'first-choice');
  assert.equal(Engine.getReversal(sequenceCatalog, correctSequence.api.current(), day).today.firstAttempts, 0);
  assert.equal(Expedition.getWorld(sequenceCatalog, correctSequence.api.current(), { today: day }).totals.choiceConfirmed, 1);

  function bossFixture(spoiler) {
    const cards = catalog();
    const boss = cards.cards.at(-1), first = cards.cards[0];
    boss.answer = '다음날만꺼낼보스정답'; boss.choices = [boss.answer, '보스의다른답'];
    if (spoiler === 'choice') first.choices.push(boss.answer);
    if (spoiler === 'detail') first.detail += ' / ' + boss.answer;
    let state = Engine.review(initial(), boss.id, 0, { today: yesterday, attemptId: 'yesterday-boss',
      evidence: 'recall', unaided: true, usedHint: false, originalAnswer: '어제 막힌 원답' });
    // Another real due question is explicitly reserved first, before the boss.
    state = Engine.review(state, first.id, 2, { today: yesterday, attemptId: 'yesterday-first',
      evidence: 'recall', unaided: true, usedHint: false, originalAnswer: first.answer });
    state = Engine.reserveFirst(state, first.id, { today: yesterday });
    return { cards, boss, first, state };
  }
  function reachBoss(ctx) {
    while (ctx.api.session().index < ctx.api.session().ids.length - 1) { submitChoice(ctx); next(ctx); }
    assert.equal(currentCard(ctx).id, ctx.api.session().expedition.bossId);
    assert.equal(ctx.root.querySelector('[data-x-choice]'), null, 'A recallable boss cannot reveal its choices in play mode');
    assert.ok(ctx.root.querySelector('#exam-scratch'));
  }
  const honest = bossFixture();
  const boss = context(honest.cards, { meridian_exam_v1: JSON.stringify(honest.state) });
  start(boss);
  assert.equal(boss.api.session().ids[0], honest.first.id);
  assert.equal(boss.api.session().ids.at(-1), honest.boss.id);
  reachBoss(boss);
  submitRecall(boss);
  assert.equal(node(boss, '[data-outcome]').dataset.outcome, 'recovered');
  assert.equal(node(boss, '[data-room-node="5"]').dataset.result, 'recovered');
  assert.equal(Engine.getReversal(honest.cards, boss.api.current(), day).today.recoveries, 1);
  next(boss);
  assert.ok(boss.root.querySelector('#expedition-complete'));

  const spoiled = bossFixture('choice');
  const exposedBoss = context(spoiled.cards, { meridian_exam_v1: JSON.stringify(spoiled.state) });
  start(exposedBoss);
  assert.ok(exposedBoss.api.current().reversal.days[day].exposures[spoiled.boss.id],
    'Showing another card\'s correct answer as an original choice is still exposure');
  reachBoss(exposedBoss);
  submitRecall(exposedBoss);
  assert.notEqual(node(exposedBoss, '[data-outcome]').dataset.outcome, 'recovered');
  assert.equal(Engine.getReversal(spoiled.cards, exposedBoss.api.current(), day).today.recoveries, 0);
  assert.equal(exposedBoss.api.current().records[spoiled.boss.id].history.at(-1).unaided, false);

  const detailFixture = bossFixture('detail');
  const detail = context(detailFixture.cards, { meridian_exam_v1: JSON.stringify(detailFixture.state) });
  start(detail);
  submitChoice(detail);
  assert.equal(detail.api.current().reversal.days[day].exposures[detailFixture.boss.id], undefined,
    'A closed detail panel is not visible answer exposure');
  const details = node(detail, '#expedition-detail');
  assert.equal(details.open, false);
  const summary = details.querySelector('summary');
  assert.ok(summary); summary.click();
  assert.ok(detail.api.current().reversal.days[day].exposures[detailFixture.boss.id],
    'Opening a source explanation must expose matching still-unanswered room answers');

  // Visible content can spoil today's next room as well as the current six.
  // Keep one real scheduled prior error outside room one, expose its complete
  // answer in an opened explanation, then actually reach it as room two's boss.
  const nextRoomCatalog = catalog(7);
  let nextRoomState = initial();
  for (const card of nextRoomCatalog.cards) {
    nextRoomState = Engine.review(nextRoomState, card.id, 0, { today: yesterday,
      attemptId: `prior-error-${card.id}`, evidence: 'recall', unaided: true,
      usedHint: false, originalAnswer: `어제의 오답 ${card.id}` });
  }
  const plannedRoom = Expedition.buildRoom(nextRoomCatalog, nextRoomState,
    { today: day, phase: 'primary', approach: 'play' });
  const laterId = Expedition.getDay(nextRoomCatalog, nextRoomState, { today: day }).remainingIds
    .find(id => !plannedRoom.ids.includes(id));
  assert.ok(laterId, 'The fixture must retain one scheduled question beyond the first finite room');
  const laterCard = nextRoomCatalog.cards.find(card => card.id === laterId);
  nextRoomCatalog.cards.find(card => card.id === plannedRoom.ids[0]).detail += ` / 다음 질문의 원문 근거: ${laterCard.answer}`;
  const nextRoom = context(nextRoomCatalog, { meridian_exam_v1: JSON.stringify(nextRoomState) });
  start(nextRoom);
  assert.equal(nextRoom.api.session().ids.includes(laterId), false);
  submitChoice(nextRoom);
  assert.equal(nextRoom.api.current().reversal.days[day].exposures[laterId], undefined);
  node(nextRoom, '#expedition-detail').querySelector('summary').click();
  assert.ok(nextRoom.api.current().reversal.days[day].exposures[laterId],
    'Opened answer material must mark a matching still-unanswered question in today\'s next planned room');
  next(nextRoom);
  while (nextRoom.api.session()) {
    fork(nextRoom);
    if (draft(nextRoom).interactionType === 'recall') submitRecall(nextRoom);
    else submitChoice(nextRoom);
    next(nextRoom);
  }
  const recoveriesBeforeSecondRoom = Engine.getReversal(nextRoomCatalog, nextRoom.api.current(), day).today.recoveries;
  click(nextRoom, '[data-x-action="next-route"]');
  assert.deepEqual(plain(nextRoom.api.session().ids), [laterId]);
  assert.equal(nextRoom.api.session().expedition.bossId, laterId);
  submitRecall(nextRoom);
  assert.notEqual(node(nextRoom, '[data-outcome]').dataset.outcome, 'recovered');
  assert.equal(nextRoom.api.current().records[laterId].history.at(-1).unaided, false);
  assert.equal(Engine.getReversal(nextRoomCatalog, nextRoom.api.current(), day).today.recoveries, recoveriesBeforeSecondRoom);
  const sourceFixture = bossFixture();
  const source = context(sourceFixture.cards, { meridian_exam_v1: JSON.stringify(sourceFixture.state) });
  start(source);
  click(source, '[data-action="source"]');
  assert.deepEqual(source.controls.sources, ['test']);
  assert.ok(source.api.current().reversal.days[day].exposures[sourceFixture.boss.id]);
  const sourceSession = JSON.parse(source.store.get('meridian_exam_session_v1'));
  assert.equal(sourceSession.drafts['0'].usedHint, true);

  // The recall approach changes the actual interaction; original mandatory
  // choice stems remain objective even when a recall approach is requested.
  const recall = context(catalog(1));
  start(recall, 'recall');
  assert.equal(recall.root.querySelector('[data-x-choice]'), null);
  submitRecall(recall);
  assert.equal(node(recall, '[data-outcome]').dataset.outcome, 'first-recall');
  assert.equal(recall.api.session().index, 0);
  assert.equal(Engine.getReversal(recall.c, recall.api.current(), day).today.firstCorrect, 1);
  let recallHint = context(catalog(1));
  start(recallHint, 'recall');
  type(recallHint, '단서 전 원답 <보존>');
  click(recallHint, '#exam-choice-hint');
  const hintedAttempt = draft(recallHint).attemptId;
  assert.equal(draft(recallHint).usedHint, true);
  assert.equal(node(recallHint, '#exam-scratch').readOnly, true);
  recallHint = context(recallHint.c, recallHint.store);
  resume(recallHint);
  assert.equal(draft(recallHint).attemptId, hintedAttempt);
  assert.equal(draft(recallHint).usedHint, true);
  assert.equal(draft(recallHint).originalAnswer, '단서 전 원답 <보존>');
  assert.equal(node(recallHint, '#exam-scratch').readOnly, true);
  choose(recallHint);
  click(recallHint, '#exam-reveal');
  assert.equal(node(recallHint, '[data-grade="2"]').disabled, true);
  recallHint.api.grade(3);
  assert.equal(node(recallHint, '[data-outcome]').dataset.outcome, 'assisted');
  assert.ok(recallHint.api.current().records['room-0'].lastGrade < 2);
  assert.equal(recallHint.api.current().records['room-0'].reversal.firstAnswer.originalAnswer, '단서 전 원답 <보존>');
  assert.equal(Engine.getReversal(recallHint.c, recallHint.api.current(), day).today.firstCorrect, 0);
  const requiredCatalog = catalog(1); requiredCatalog.cards[0].requiresChoices = true;
  const mandatory = context(requiredCatalog);
  start(mandatory, 'recall');
  submitChoice(mandatory);
  assert.equal(Engine.getReversal(requiredCatalog, mandatory.api.current(), day).today.firstCorrect, 0);

  // Existing sessions and backups keep their existing semantics with the new
  // module present. Preference fields must not replace legacy learning data.
  const old = context(catalog(2));
  old.api.start('mock', 1);
  assert.equal(old.api.session().expedition, undefined);
  type(old, '예전 방식의 중단 원답');
  const oldReload = context(old.c, old.store);
  resume(oldReload);
  assert.equal(oldReload.api.session().expedition, undefined);
  assert.equal(node(oldReload, '#exam-scratch').value, '예전 방식의 중단 원답');
  click(oldReload, '#exam-reveal');
  assert.ok(oldReload.root.querySelector('[data-grade="2"]'));
  play.api.exportBackup();
  const backup = JSON.parse(await play.controls.blobs.at(-1).text());
  assert.equal(backup.version, 1);
  assert.equal(backup.format, 'meridian-exam-backup');
  assert.deepEqual(backup.exam.expedition, plain(play.api.current().expedition));
  const restored = context(c);
  await restored.api.importFile({ size: Buffer.byteLength(JSON.stringify(backup)), text: async () => JSON.stringify(backup) });
  assert.deepEqual(plain(Expedition.getWorld(c, restored.api.current(), { today: day })),
    plain(Expedition.getWorld(c, play.api.current(), { today: day })));
  assert.equal(restored.store.has('meridian_exam_session_v1'), false);
  const reloadedBackup = context(c, restored.store);
  assert.deepEqual(plain(Expedition.getWorld(c, reloadedBackup.api.current(), { today: day })),
    plain(Expedition.getWorld(c, play.api.current(), { today: day })));

  const midnight = context(catalog(1));
  start(midnight); choose(midnight);
  const staleSubmit = node(midnight, '#expedition-submit');
  midnight.tick(24 * 60 * 60);
  assert.doesNotThrow(() => staleSubmit.click());
  assert.equal(midnight.api.session(), null);
  assert.equal(Engine.getReversal(midnight.c, midnight.api.current(), Engine.addDays(day, 1)).today.firstCorrect, 0);
  assert.equal(midnight.api.current().records['room-0']?.attempts || 0, 0,
    'A stale room submission must not become a new-day answer');
  console.log('PASS: expedition controls execute choice and sequence grading, fixed rooms, forks, finite repair, result-stage reload, real bosses and cross-question exposure without fake recall growth.');
}

(async () => {
  syntaxAndPreservation();
  const catalog = catalogCoverage();
  await legacyContracts(catalog);
  await appStorageContracts(catalog);
  await appStudyContracts();
  await appExpeditionContracts();
  console.log('Integration smoke checks passed.');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
