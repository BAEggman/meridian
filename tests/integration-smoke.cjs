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
      persist: persist, refreshState: refreshState, importFile: importFile,
      loadState: loadState, getPending: getPending, start: start, resume: resume
    };
  })();`);
  assert.notEqual(exposed, app, 'Test-only app closure adapter did not match');

  function context(initialStorage) {
    const store = new Map(Object.entries(initialStorage || {}));
    const controls = { reject: () => false, writes: 0 };
    const localStorage = {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) {
        controls.writes++;
        if (controls.reject(key)) throw new Error('QuotaExceededError');
        store.set(key, String(value));
      },
      removeItem(key) { store.delete(key); }
    };
    const window = Object.assign(makeTarget(), { confirm: () => true });
    const document = Object.assign(makeTarget(), { readyState: 'loading', getElementById: () => null });
    vm.runInNewContext(exposed, { window, document, localStorage, console, Date, Map, Set, Number, URL, Blob, setTimeout, clearTimeout }, { filename, timeout: 2000 });
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
  assert.ok(JSON.parse(failedSave.store.get('meridian_exam_v1')).records[card.id].seen);

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
  assert.ok(JSON.parse(restored.store.get('meridian_exam_v1')).records[card.id]?.seen, 'Valid restore must persist the selected exam record');
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

  const unreadable = context({ meridian_exam_v1: '{broken-json' });
  unreadable.api.init(Engine, catalog, base);
  unreadable.api.loadState();
  assert.equal(unreadable.api.persist(), false);
  assert.equal(unreadable.store.get('meridian_exam_v1'), '{broken-json', 'Unreadable source must remain recoverable');
  console.log('PASS: failed saves retain in-memory learning; restore rolls back on failure and rejects malformed backups before writes.');
}

(async () => {
  syntaxAndPreservation();
  const catalog = catalogCoverage();
  await legacyContracts(catalog);
  await appStorageContracts(catalog);
  console.log('Integration smoke checks passed.');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
