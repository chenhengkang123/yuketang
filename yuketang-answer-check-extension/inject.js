/* 雨课堂作业对答案 —— 主世界内容脚本（document_start）
 * 对照本地题库展示参考答案。填空题写入空格；选择题写入当前题的本地答案
 * （单选 / 多选 / 判断，和页面选项的 v-model 同一字段）。不调用提交接口。
 */
(function () {
  'use strict';

  /* ========== 配置 ========== */
  const POLL_INTERVAL = 400;     // 轮询间隔(ms)，切题不换 URL，靠题号/DOM 判断
  const MATCH_THRESHOLD = 0.42;  // 2-gram Jaccard 下限；子串命中视为 1
  const AUTO_FILL_BLANK = true;    // 填空题自动写入空格，不点提交
  const AUTO_SELECT_CHOICE = true;  // 选择题自动写入已选答案，不点提交
  const DEBUG = true;            // 控制台输出 [雨课堂对答案] 日志
  /* ========================== */

  const ENABLED_KEY = 'yuketang-answer-check'; // localStorage，'0' 为关，缺省为开
  const BANK = window.__YKT_ANSWER_BANK__ || [];
  const log = (...a) => { if (DEBUG) console.log('[雨课堂对答案]', ...a); };

  const HAN_MAP = {
    '⺠': '民', '⻅': '见', '⻆': '角', '⻋': '车', '⻓': '长', '⻔': '门',
    '⻘': '青', '⻛': '风', '⻝': '食', '⻢': '马', '⻩': '黄', '戶': '户',
  };

  const isExercisePage = () => /\/exercise(?:\/|$)|\/iframe-exercise/i.test(location.pathname)
    || /\/cloud\/student\/exercise/i.test(location.pathname)
    || !!document.querySelector('iframe.exercise-iframe');
  const isEnabled = () => localStorage.getItem(ENABLED_KEY) !== '0';

  function unify(s) {
    let out = '';
    const nfkc = String(s || '').normalize('NFKC');
    for (const ch of nfkc) out += HAN_MAP[ch] || ch;
    return out;
  }

  function stripHtml(s) {
    return String(s || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&[a-z]+;/gi, ' ');
  }

  function compact(s) {
    return unify(stripHtml(s)).replace(/[^\u4e00-\u9fff\u3400-\u4dbaa-zA-Z0-9]/g, '').toLowerCase();
  }

  function grams(s, n) {
    const g = new Set();
    if (!s) return g;
    if (s.length < n) { g.add(s); return g; }
    for (let i = 0; i <= s.length - n; i++) g.add(s.slice(i, i + n));
    return g;
  }

  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
  }

  for (const q of BANK) {
    q._keys = [q.stem, ...(q.alts || [])].map(compact).filter((k) => k.length >= 6);
  }

  function scoreAgainst(page, q) {
    let best = 0;
    for (const key of q._keys) {
      if (page.includes(key)) best = Math.max(best, 1);
      else if (key.length > 24 && key.includes(page) && page.length > 18) best = Math.max(best, 0.96);
      else best = Math.max(best, jaccard(grams(page, 2), grams(key, 2)));
    }
    return best;
  }

  function matchBank(text, hintLec, course) {
    const page = compact(text);
    if (page.length < 8) return null;
    let best = null;
    for (const q of BANK) {
      if (course && q.c && q.c !== course) continue;
      let s = scoreAgainst(page, q);
      if (hintLec && q.lec && compact(q.lec) === hintLec) s = Math.min(1, s + 0.04);
      if (!best || s > best.score || (s === best.score && q.stem.length > best.q.stem.length)) {
        best = { q, score: s };
      }
    }
    if (!best || best.score < MATCH_THRESHOLD) return null;
    return best;
  }

  /* ---- 拦截作业接口，拿到结构化题干（比刮 DOM 稳） ---- */
  const live = { problems: [], url: '' };

  function resetLive() {
    live.problems = [];
    live.url = location.href;
  }

  function pushProblem(body, options, type, index) {
    const stem = stripHtml(body).replace(/\s+/g, ' ').trim();
    if (stem.length < 4) return;
    if (live.problems.some((p) => p.stem === stem)) return;
    live.problems.push({
      stem,
      options: (options || []).map((o) => ({
        k: String(o.key || o.k || ''),
        t: stripHtml(o.value || o.Value || o.t || '').replace(/\s+/g, ' ').trim(),
      })),
      type: type || '',
      index,
    });
  }

  function ingest(obj, depth) {
    if (!obj || depth > 8) return;
    if (Array.isArray(obj)) {
      obj.forEach((x) => ingest(x, depth + 1));
      return;
    }
    if (typeof obj !== 'object') return;
    const content = obj.content || obj;
    if (typeof content.Body === 'string') {
      pushProblem(content.Body, content.Options || content.options, content.Type, obj.index || obj.problem_id);
      return;
    }
    if (obj.problems) ingest(obj.problems, depth + 1);
    if (obj.data) ingest(obj.data, depth + 1);
    if (obj.problem) ingest(obj.problem, depth + 1);
  }

  function looksLikeProblemUrl(url) {
    return /problem_list|get_exercise|get_kg_problem|exercise\/get_|kg_apply_problem|cloud\/student\/exercise/i.test(url);
  }

  function maybeIngest(url, data) {
    if (!data || typeof data !== 'object') return;
    const has = data.problems || (data.data && (data.data.problems || data.data.content))
      || data.content || data.Body;
    if (!looksLikeProblemUrl(url) && !has) return;
    if (live.url !== location.href) resetLive();
    const before = live.problems.length;
    ingest(data, 0);
    if (live.problems.length !== before) log('接口收录题目', live.problems.length);
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const req = args[0];
    const url = String((req && req.url) || req || '');
    return origFetch.apply(this, args).then((res) => {
      const ct = (res.headers && res.headers.get('content-type')) || '';
      if (looksLikeProblemUrl(url) || (isExercisePage() && /json/i.test(ct))) {
        res.clone().json().then((data) => maybeIngest(url, data)).catch(() => {});
      }
      return res;
    });
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__yktUrl = String(url || '');
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      const url = this.__yktUrl || '';
      if (!looksLikeProblemUrl(url) && !isExercisePage()) return;
      try { maybeIngest(url, JSON.parse(this.responseText)); } catch (e) {}
    });
    return origSend.apply(this, args);
  };

  /* ---- 作业题在学习空间里是同源 iframe（.exercise-iframe），题干还套了加密字体 ---- */
  function exerciseFrame() {
    return document.querySelector('iframe.exercise-iframe, iframe#iframeExerciseId');
  }

  function exerciseDoc() {
    const f = exerciseFrame();
    if (f) {
      try {
        if (f.contentDocument && f.contentDocument.body) return f.contentDocument;
      } catch (e) {}
    }
    return document;
  }

  function exerciseWin() {
    const f = exerciseFrame();
    if (f) {
      try { if (f.contentWindow) return f.contentWindow; } catch (e) {}
    }
    return window;
  }

  function allDocs() {
    const docs = [document];
    const ed = exerciseDoc();
    if (ed && ed !== document) docs.push(ed);
    return docs;
  }

  const ITEM_SEL = [
    '.container-problem',
    '.exercise-item',
    '.problem_item',
    '.problem-wrap',
  ].join(', ');

  const STEM_SEL = [
    '.problem-body',
    '.item-body h4',
    '.item-body',
    '.question-title',
    '.exercise-title',
  ].join(', ');

  function visibleItems() {
    const doc = exerciseDoc();
    return [...doc.querySelectorAll(ITEM_SEL)].filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0);
  }

  function stemFromItem(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll([
      '.list-unstyled-radio', '.list-unstyled-checkbox',
      '.el-radio', '.el-checkbox', '.el-radio-group', '.el-checkbox-group',
      'textarea', 'input', 'button', '.ykt-ans-chip', '.item-type',
    ].join(',')).forEach((n) => n.remove());
    const body = clone.querySelector(STEM_SEL);
    const text = ((body && body.innerText) || clone.innerText || '').replace(/\s+/g, ' ').trim();
    return text;
  }

  const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const COURSE_LABEL = { ethics: '工程伦理', ai: '人工智能安全与伦理', modern: '中国式现代化' };
  // 雨课堂单元标题是「第一讲：习题」，不是「第1讲」
  const UNIT_RE = /第\s*[0-9一二三四五六七八九十]+\s*讲|第\s*[0-9一二三四五六七八九十]+\s*章|结语/;

  function cnNum(s) {
    if (/^\d+$/.test(s)) return Number(s);
    if (s === '十') return 10;
    const ten = s.indexOf('十');
    if (ten >= 0) {
      const hi = ten === 0 ? 1 : (CN_DIGIT[s[ten - 1]] || 0);
      const lo = ten === s.length - 1 ? 0 : (CN_DIGIT[s[ten + 1]] || 0);
      return hi * 10 + lo;
    }
    if (s.length === 1) return CN_DIGIT[s] || 0;
    return 0;
  }

  function parseUnit(s) {
    const t = String(s || '');
    let m = t.match(/第\s*([0-9一二三四五六七八九十]+)\s*讲\s*([^\n]*)/);
    if (m) return { kind: 'lecture', n: cnNum(m[1]), name: compact(m[2]).replace(/习题.*$/, '') };
    m = t.match(/第\s*0*(\d+)\s*章\s*[-—–]?\s*([^\n]*)/);
    if (m) return { kind: 'chapter', n: Number(m[1]), name: compact(m[2]).replace(/习题.*$/, '') };
    m = t.match(/第\s*([一二三四五六七八九十]+)\s*章\s*[-—–]?\s*([^\n]*)/);
    if (m) return { kind: 'chapter', n: cnNum(m[1]), name: compact(m[2]).replace(/习题.*$/, '') };
    if (/结语/.test(t)) return { kind: 'close', n: 0, name: '结语' };
    return null;
  }

  function lectureText() {
    const cloud = vuexCloud();
    const leaf = cloud && (cloud.leafInfo && (cloud.leafInfo.name || cloud.leafInfo.title) || cloud.leafName);
    const nodes = [
      leaf,
      document.querySelector('.learning-space-control-unit'),
      document.querySelector('.leaf-item.is-active .leaf-item-title, .leaf-item.is-active'),
      exerciseDoc().title,
      exerciseDoc().querySelector('.header-title, .exercise-title, .unit-title'),
    ];
    for (const n of nodes) {
      const t = typeof n === 'string' ? n : (n && n.innerText);
      if (t && UNIT_RE.test(t)) return t;
    }
    const blob = (document.body && document.body.innerText) || '';
    const m = blob.match(/第\s*[0-9一二三四五六七八九十]+\s*讲[^\n]{0,40}|第\s*[0-9一二三四五六七八九十]+\s*章[^\n]{0,40}|结语/);
    return m ? m[0] : '';
  }

  function pageContextText() {
    const bits = [document.title, lectureText()];
    try {
      const cloud = vuexCloud();
      if (cloud) {
        const leaf = cloud.leafInfo;
        if (leaf) bits.push(leaf.name, leaf.title, leaf.chapter_name);
        bits.push(cloud.leafName, cloud.classroomName, cloud.courseName);
        if (cloud.classroom) bits.push(cloud.classroom.name, cloud.classroom.course_name);
      }
    } catch (e) { /* ignore */ }
    ['.learning-space-control-unit', '.leaf-item.is-active', 'header'].forEach((sel) => {
      const el = document.querySelector(sel);
      if (el && el.innerText) bits.push(el.innerText.slice(0, 200));
    });
    bits.push(((document.body && document.body.innerText) || '').slice(0, 1800));
    return bits.filter(Boolean).join('\n');
  }

  function detectCourse() {
    const blob = pageContextText();
    const modern = /中国式现代化/.test(blob);
    const ethics = /工程伦理/.test(blob);
    const aiNamed = /人工智能安全|AI安全与伦理/.test(blob);
    if (modern && !ethics && !aiNamed) return 'modern';
    if (ethics && !modern && !aiNamed) return 'ethics';
    if (aiNamed && !modern && !ethics) return 'ai';
    const unit = parseUnit(lectureText()) || parseUnit(blob);
    if (ethics && aiNamed && !modern) {
      if (unit && unit.kind === 'chapter') return 'ai';
      if (unit && unit.kind === 'lecture') return 'ethics';
      return '';
    }
    if (modern && aiNamed && !ethics) {
      if (unit && unit.kind === 'chapter') return 'ai';
      if (unit && (unit.kind === 'lecture' || unit.kind === 'close')) return 'modern';
      return '';
    }
    if (modern && ethics) return '';
    if (unit && unit.kind === 'close') return 'modern';
    if (unit && unit.kind === 'chapter') return 'ai';
    // 工程伦理与中国式现代化都用「第N讲」。10 讲及以后只有工程伦理；1–9 讲没有课程名时不猜。
    if (unit && unit.kind === 'lecture' && unit.n > 9) return 'ethics';
    if (/人工智能/.test(blob) && !ethics && !modern) return 'ai';
    return '';
  }

  function vuexStore() {
    try {
      const app = exerciseDoc().querySelector('#app');
      const v = app && (app.__vue__ || app.__vue_app__);
      return (v && v.$store)
        || (v && v.config && v.config.globalProperties && v.config.globalProperties.$store)
        || null;
    } catch (e) { return null; }
  }

  function vuexCloud() {
    const store = vuexStore();
    return store && store.state && store.state.cloud;
  }

  function currentIndex() {
    const doc = exerciseDoc();
    const type = doc.querySelector('.item-type');
    const fromType = type && type.innerText.match(/^\s*(\d+)/);
    if (fromType) return Number(fromType[1]);
    const active = doc.querySelector('.subject-item.J_order.active, .J_order.active[data-order]');
    if (active) {
      const n = Number(active.dataset.order || active.innerText);
      if (n) return n;
    }
    const cloud = vuexCloud();
    const fromStore = cloud && cloud.problem && Number(cloud.problem.index);
    return fromStore || 0;
  }

  function matchByMeta(lectureRaw, index, course) {
    let lec = parseUnit(lectureRaw) || parseUnit(pageContextText());
    if (!lec && course) {
      const page = compact(pageContextText());
      const seen = new Set();
      for (const item of BANK) {
        if (item.c !== course || seen.has(item.lec)) continue;
        seen.add(item.lec);
        const name = compact(item.lec).replace(/^第\d+[讲章]/, '');
        if (name.length >= 6 && page.includes(name)) {
          lec = parseUnit(item.lec);
          break;
        }
      }
    }
    if (!lec || !index) return null;
    const hits = BANK.filter((item) => {
      if (course && item.c && item.c !== course) return false;
      const p = parseUnit(item.lec);
      if (!p || p.kind !== lec.kind || p.n !== lec.n || item.no !== index) return false;
      return true;
    });
    if (hits.length !== 1) return null;
    return { q: hits[0], score: 1 };
  }

  function lectureHint(course) {
    const lec = parseUnit(lectureText()) || parseUnit(pageContextText());
    if (!lec) return '';
    const hits = BANK.filter((q) => {
      if (course && q.c && q.c !== course) return false;
      const p = parseUnit(q.lec);
      return p && p.kind === lec.kind && p.n === lec.n;
    });
    if (!hits.length) return '';
    if (!course && new Set(hits.map((q) => q.c)).size !== 1) return '';
    return compact(hits[0].lec);
  }

  function pickCurrentText() {
    const items = visibleItems();
    if (items.length) return stemFromItem(items[0]);
    const fallback = exerciseDoc().querySelector('.problem-body, .item-body');
    if (fallback) return (fallback.innerText || '').replace(/\s+/g, ' ').trim();
    return '';
  }

  function typeLabel(q) {
    return q.type === 'multi' ? '多选' : q.type === 'judge' ? '判断' : q.type === 'fill' ? '填空' : '单选';
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function isImageText(t) {
    return /!\[[^\]]*\]\(|<img|rain-oplat\.xuetangx/i.test(t || '');
  }

  function splitFillAnswers(q, n) {
    const raw = String((q && q.ansT && q.ansT[0]) || (q && q.ans && q.ans.join('、')) || '').trim();
    if (!raw) return [];
    if (n === 1) return [raw];
    const parts = raw.split(/[、，,]+/).map((s) => s.trim()).filter(Boolean);
    if (!n) return parts;
    if (parts.length === n) return parts;
    if (parts.length > n) return parts.slice(0, n - 1).concat(parts.slice(n - 1).join('、'));
    return parts;
  }

  function blankInputs(doc) {
    return [...doc.querySelectorAll('input.blank-item-dynamic, input[placeholder="输入答案"]')]
      .filter((el) => (el.type === 'text' || el.type === '') && el.name !== 'verification_notes');
  }

  function setInputValue(el, value) {
    const view = el.ownerDocument.defaultView || exerciseWin();
    const desc = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new view.Event('input', { bubbles: true }));
    el.dispatchEvent(new view.Event('change', { bubbles: true }));
    const ch = Math.max(6, [...value].length);
    el.style.setProperty('width', (ch * 14 + 24) + 'px', 'important');
  }

  function fillBlanks(q) {
    if (!AUTO_FILL_BLANK || !isEnabled() || !q || q.type !== 'fill') return 0;
    const doc = exerciseDoc();
    const inputs = blankInputs(doc).filter((el) => !el.disabled && !el.readOnly);
    if (!inputs.length) return 0;
    const parts = splitFillAnswers(q, inputs.length);
    if (!parts.length) return 0;
    const fillKey = `${location.pathname}|${currentIndex()}|${parts.join('\0')}|${inputs.length}`;
    const already = inputs.every((el, i) => (el.value || '').trim() === (parts[i] || '').trim());
    if (already) {
      lastFilledKey = fillKey;
      return inputs.length;
    }
    if (lastFilledKey === fillKey) return 0;
    let n = 0;
    inputs.forEach((el, i) => {
      if (i >= parts.length) return;
      if ((el.value || '').trim() === parts[i]) return;
      setInputValue(el, parts[i]);
      n++;
    });
    lastFilledKey = fillKey;
    if (n) log('已填入空格', n, '/', inputs.length, '未提交');
    return n;
  }

  /* 选择题：写入 problem._answer（页面 el-radio / el-checkbox 的 v-model），不点选项、不点提交。
   * 页面会插入 data-risk-target="decoy" 的假选项，只认题目列表里的真实 input。 */
  function problemVm() {
    const nodes = exerciseDoc().querySelectorAll(
      '.list-unstyled-radio label.el-radio, .list-unstyled-checkbox label.el-checkbox'
    );
    for (const el of nodes) {
      if (el.closest && el.closest('[data-risk-target="decoy"]')) continue;
      let vm = el.__vue__;
      for (let i = 0; i < 8 && vm; i++) {
        if (typeof vm.refreshSubmitStatus === 'function' && vm.problem) return vm;
        vm = vm.$parent;
      }
    }
    return null;
  }

  function choiceInputs(doc) {
    return [...doc.querySelectorAll(
      '.list-unstyled-radio input.el-radio__original, .list-unstyled-checkbox input.el-checkbox__original'
    )].filter((el) => !(el.closest && el.closest('[data-risk-target="decoy"]')));
  }

  function sameAnswer(cur, next) {
    if (Array.isArray(next)) {
      const a = (Array.isArray(cur) ? cur : []).map(String).sort();
      const b = next.map(String).sort();
      return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return String(cur == null ? '' : cur) === String(next);
  }

  function selectChoices(q) {
    if (!AUTO_SELECT_CHOICE || !isEnabled() || !q || q.type === 'fill') return 0;
    const doc = exerciseDoc();
    const inputs = choiceInputs(doc);
    if (!inputs.length || inputs.every((el) => el.disabled)) return 0;
    const available = inputs.map((el) => el.value).filter((v) => v && v !== 'on');
    const mapped = [];
    for (const k of q.ans || []) {
      const hit = available.find((v) => v === String(k) || v.toUpperCase() === String(k).toUpperCase());
      if (!hit) return 0;
      mapped.push(hit);
    }
    if (!mapped.length) return 0;
    const vm = problemVm();
    if (!vm) return 0;
    const next = q.type === 'multi' ? mapped.slice() : mapped[0];
    const selectKey = `${location.pathname}|${currentIndex()}|${mapped.join('\0')}|${q.type}`;
    const cur = vm.problem._answer;
    if (sameAnswer(cur, next)) {
      lastSelectedKey = selectKey;
      return 0;
    }
    const empty = cur == null || cur === '' || (Array.isArray(cur) && cur.length === 0);
    if (lastSelectedKey === selectKey && !empty) return 0;
    if (selectAttemptKey !== selectKey) {
      selectAttemptKey = selectKey;
      selectAttempts = 0;
    }
    if (selectAttempts >= 3) return 0;
    selectAttempts += 1;
    try {
      vm.$set(vm.problem, '_answer', next);
      vm.$forceUpdate();
      vm.refreshSubmitStatus();
      if (vm.problem.user) vm.problem.user.is_right = null;
    } catch (e) {
      log('选中失败', e);
      return 0;
    }
    if (sameAnswer(vm.problem._answer, next)) lastSelectedKey = selectKey;
    log('已选中选项', Array.isArray(next) ? next.join('、') : next, '未提交');
    return mapped.length;
  }

  function answerHeadline(q) {
    if (q.type === 'judge') return q.ansT[0] || (q.ans[0] === 'true' ? '正确' : '错误');
    if (q.type === 'fill') return (q.ansT && q.ansT[0]) || q.ans.join('、');
    const keys = q.ans.join('、');
    const texts = (q.ansT || []).filter((t) => t && !isImageText(t));
    if (!texts.length) return keys;
    if (texts.every((t) => t.length <= 18)) return `${keys}　${texts.join('；')}`;
    return keys;
  }

  /* ---- 选项高亮（按选项正文匹配，兼容选项被打乱） ---- */
  function clearHits() {
    allDocs().forEach((doc) => {
      doc.querySelectorAll('.ykt-ans-hit').forEach((el) => el.classList.remove('ykt-ans-hit'));
      doc.querySelectorAll('.ykt-ans-tag').forEach((el) => el.remove());
    });
  }

  function optionNodes(root) {
    const scope = root || exerciseDoc();
    const nodes = [
      ...scope.querySelectorAll('.list-unstyled-radio > li, .list-unstyled-checkbox > li, .el-radio, .el-checkbox, label'),
    ];
    return nodes.filter((el) => {
      if (el.closest && el.closest('[data-risk-target="decoy"]')) return false;
      return (el.offsetWidth > 0 || el.offsetHeight > 0) && compact(el.innerText).length >= 1;
    });
  }

  function markOptions(q, root) {
    if (!root || !q || q.type === 'fill') return;
    const targets = (q.ansT || []).filter((t) => t && !isImageText(t)).map(compact).filter((t) => t.length >= 2);
    const keys = new Set((q.ans || []).map((k) => String(k).toUpperCase()));
    optionNodes(root).forEach((el) => {
      const raw = unify(el.innerText);
      const t = compact(raw);
      const letterM = raw.match(/^\s*([A-Ea-e]|true|false|正确|错误)/i);
      const letter = letterM ? letterM[1].toUpperCase() : '';
      let hit = targets.some((ans) => t.includes(ans) || (ans.length >= 8 && t.length >= 4 && ans.includes(t)));
      if (!hit && q.type === 'judge') {
        hit = q.ans[0] === 'true' ? /正确|^TRUE/i.test(raw) : /错误|^FALSE/i.test(raw);
      }
      if (!hit && letter && keys.has(letter)) {
        // 加密字体下选项正文对不上，退回按 A/B/C 标记（正文仍以面板为准）
        hit = true;
      }
      if (!hit) return;
      el.classList.add('ykt-ans-hit');
      if (!el.querySelector('.ykt-ans-tag')) {
        const tag = document.createElement('span');
        tag.className = 'ykt-ans-tag';
        tag.textContent = '参考';
        el.appendChild(tag);
      }
    });
  }

  /* ---- 面板 ---- */
  let panel;
  let toggleBtn;
  let bodyEl;
  let lastKey = '';
  let lastOn = null;
  let lastHit = null;
  let lastFilledKey = '';
  let lastSelectedKey = '';
  let selectAttemptKey = '';
  let selectAttempts = 0;
  let observedDoc = null;

  function toast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;padding:8px 14px;'
      + 'background:rgba(0,0,0,.75);color:#fff;font-size:13px;border-radius:6px;pointer-events:none';
    mount(el);
    setTimeout(() => el.remove(), 3500);
  }

  function mount(el) {
    const fs = document.fullscreenElement;
    const parent = (fs && fs.tagName !== 'VIDEO') ? fs : (document.body || document.documentElement);
    parent.appendChild(el);
  }

  function injectStyle(doc) {
    if (!doc || !doc.documentElement || doc.getElementById('ykt-ans-style')) return;
    const st = doc.createElement('style');
    st.id = 'ykt-ans-style';
    st.textContent = [
      '.ykt-ans-hit{outline:2px solid #1a7f37!important;border-radius:6px;position:relative;}',
      '.ykt-ans-tag{margin-left:8px;font-size:11px;color:#fff;background:#1a7f37;border-radius:4px;padding:1px 6px;vertical-align:middle;}',
      '.ykt-ans-chip{margin:6px 0 8px;padding:6px 10px;background:#ecf7ef;border:1px solid #b7e0c2;border-radius:6px;color:#14532d;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
    ].join('');
    (doc.head || doc.documentElement).appendChild(st);
  }

  function ensureStyle() {
    allDocs().forEach(injectStyle);
  }

  function setEnabled(on) {
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
    lastKey = '';
    lastFilledKey = '';
    lastSelectedKey = '';
    selectAttemptKey = '';
    selectAttempts = 0;
    lastHit = null;
    renderPanel();
    if (!on) {
      clearHits();
      document.querySelectorAll('.ykt-ans-chip').forEach((el) => el.remove());
    }
    toast(on ? '作业对答案：已开启' : '作业对答案：已关闭');
    log(on ? '已开启' : '已关闭');
  }

  function renderPanel() {
    if (!panel) return;
    const on = isEnabled();
    toggleBtn.textContent = on ? '对答案开' : '对答案关';
    toggleBtn.style.background = on ? '#1a7f37' : '#5c5c5c';
    bodyEl.style.display = on ? 'block' : 'none';
  }

  function buildPanel() {
    if (panel) return;
    ensureStyle();
    panel = document.createElement('div');
    panel.id = 'ykt-ans-panel';
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999999;width:320px;'
      + 'font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
      + 'background:rgba(20,20,20,.92);color:#fff;border-radius:10px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.25)';
    toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.title = '开关作业对答案（Alt+A）';
    toggleBtn.style.cssText = 'border:0;color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;font:13px/1.2 inherit';
    toggleBtn.addEventListener('click', () => setEnabled(!isEnabled()));
    bodyEl = document.createElement('div');
    bodyEl.style.cssText = 'margin-top:8px;';
    bodyEl.innerHTML = '<div style="opacity:.7">打开作业后自动对照题库</div>';
    panel.append(toggleBtn, bodyEl);
    mount(panel);
    renderPanel();
  }

  function hidePanel() {
    if (panel) panel.style.display = 'none';
  }

  function showPanel() {
    if (panel) panel.style.display = 'block';
  }

  function paintBody(hit, source, loading, index) {
    if (loading) {
      bodyEl.innerHTML = '<div style="opacity:.8">作业加载中…</div>';
      return;
    }
    if (!hit) {
      const where = index ? `当前第${index}题。` : '';
      bodyEl.innerHTML = `<div style="opacity:.8">${where}未匹配到题库。确认当前是工程伦理、人工智能安全与伦理或中国式现代化作业。</div>`;
      return;
    }
    const q = hit.q;
    const pct = Math.round(hit.score * 100);
    const extra = q.type === 'fill'
      ? ''
      : (q.ansT || []).filter((t) => t && t.length > 18 && !isImageText(t)).map((t) => `· ${esc(t)}`).join('<br>');
    const shown = index || q.no;
    const courseName = COURSE_LABEL[q.c] || '';
    bodyEl.innerHTML = [
      `<div style="opacity:.75;font-size:12px">${courseName ? esc(courseName) + ' · ' : ''}当前第${shown}题 · ${esc(q.lec)} · 题库第${q.no}题 · ${typeLabel(q)} · ${pct}%</div>`,
      `<div style="margin-top:6px;font-size:18px;font-weight:700;letter-spacing:.04em">${esc(answerHeadline(q))}</div>`,
      extra ? `<div style="margin-top:6px;opacity:.9">${extra}</div>` : '',
      `<div style="margin-top:8px;opacity:.55;font-size:12px">对照来源：${esc(source)} · ${
        q.type === 'fill'
          ? (AUTO_FILL_BLANK ? '空格已自动填入，未提交' : '只显示不提交')
          : (AUTO_SELECT_CHOICE ? '选项已自动选中，未提交' : '只显示不提交')
      }</div>`,
    ].join('');
  }

  function syncChips(hint) {
    const items = visibleItems();
    document.querySelectorAll('.ykt-ans-chip').forEach((el) => el.remove());
    if (items.length < 2) return;
    items.forEach((el) => {
      const text = stemFromItem(el);
      const hit = matchBank(text, hint, detectCourse());
      if (!hit) return;
      const chip = document.createElement('div');
      chip.className = 'ykt-ans-chip';
      chip.textContent = `参考答案 ${answerHeadline(hit.q)}（${hit.q.lec} 第${hit.q.no}题）`;
      el.insertBefore(chip, el.firstChild);
      markOptions(hit.q, el);
    });
  }

  function armFrameLoad() {
    const f = exerciseFrame();
    if (!f || f.__yktAnsLoad) return;
    f.__yktAnsLoad = true;
    f.addEventListener('load', () => {
      observedDoc = null;
      lastKey = '';
      tick();
    });
  }

  function armIframeWatch() {
    armFrameLoad();
    const doc = exerciseDoc();
    if (!doc || doc === document) return;
    if (observedDoc === doc) return;
    observedDoc = doc;
    let timer = 0;
    const kick = () => {
      clearTimeout(timer);
      timer = setTimeout(tick, 80);
    };
    const root = doc.querySelector('#app') || doc.body;
    if (root) {
      new MutationObserver(kick).observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }
    doc.addEventListener('click', (e) => {
      const el = e.target && e.target.closest && e.target.closest('.J_order, .subject-item, button, .el-button, a');
      if (el) kick();
    }, true);
    try {
      const store = vuexStore();
      if (store && typeof store.watch === 'function' && !store._yktAnsWatched) {
        store._yktAnsWatched = true;
        store.watch((s) => (s.cloud && s.cloud.problem && s.cloud.problem.index) || 0, kick);
      }
    } catch (e) { /* vuex 结构变动时仍靠轮询 */ }
    log('watching iframe');
  }

  function tick() {
    const onPage = isExercisePage();
    if (panel) {
      if (onPage) showPanel();
      else hidePanel();
    }
    if (!onPage || !isEnabled()) {
      if (lastOn) {
        clearHits();
        lastKey = '';
        lastHit = null;
        lastFilledKey = '';
        lastSelectedKey = '';
        selectAttemptKey = '';
        selectAttempts = 0;
      }
      lastOn = false;
      return;
    }
    lastOn = true;
    if (!panel && document.body) buildPanel();
    if (!panel) return;
    ensureStyle();
    armIframeWatch();

    if (live.url && live.url !== location.href) resetLive();

    const iframe = exerciseFrame();
    const doc = exerciseDoc();
    if (iframe && (!doc || doc === document || !doc.querySelector('.item-type, .problem-body, .container-problem'))) {
      const loadKey = location.href + '|loading';
      if (lastKey !== loadKey) {
        lastKey = loadKey;
        paintBody(null, '', true);
      }
      return;
    }

    const course = detectCourse();
    const hint = lectureHint(course);
    const lecRaw = lectureText();
    const index = currentIndex();
    const typeText = ((doc.querySelector('.item-type') || {}).innerText || '').replace(/\s+/g, ' ').trim();
    const domText = pickCurrentText();
    let source = '页面题干';
    let text = domText;

    if (live.problems.length) {
      const page = compact(domText);
      let bestLive = null;
      for (const p of live.problems) {
        const s = page.includes(compact(p.stem)) ? 1 : jaccard(grams(page, 2), grams(compact(p.stem), 2));
        if (!bestLive || s > bestLive.s) bestLive = { p, s };
      }
      if (bestLive && bestLive.s >= 0.35) {
        text = bestLive.p.stem;
        source = '作业接口';
      }
    }

    const key = `${location.pathname}|${course}|${index}|${typeText}|${compact(lecRaw).slice(0, 40)}|${compact(text).slice(0, 40)}`;
    if (key === lastKey) {
      if (lastHit) {
        fillBlanks(lastHit.q);
        selectChoices(lastHit.q);
      }
      return;
    }
    lastKey = key;

    clearHits();
    const stemHit = matchBank(text, hint, course);
    const metaHit = matchByMeta(lecRaw, index, course);
    // 加密字体时题干对不上，用「第N讲/章 + 题号」对照题库（本课作业顺序与题库一致）
    const hit = (stemHit && stemHit.score >= 0.75) ? stemHit : (metaHit || stemHit);
    lastHit = hit;
    if (hit === metaHit && metaHit) {
      const kind = (parseUnit(hit.q.lec) || {}).kind;
      source = kind === 'chapter' ? '章次+题号' : kind === 'close' ? '结语+题号' : '讲次+题号';
    }
    if (hit) {
      fillBlanks(hit.q);
      selectChoices(hit.q);
    }
    paintBody(hit, source, false, index);
    if (hit) {
      markOptions(hit.q, visibleItems()[0] || doc);
      log('命中', hit.q.lec, `#${hit.q.no}`, answerHeadline(hit.q), hit.score.toFixed(2), source, 'index', index);
    } else {
      log('未命中', { index, lecRaw: (lecRaw || '').slice(0, 40), text: (text || '').slice(0, 40) });
    }
    syncChips(hint);
  }

  document.addEventListener('fullscreenchange', () => { if (panel) mount(panel); });
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === 'a' || e.key === 'A')) {
      if (!isExercisePage()) return;
      e.preventDefault();
      e.stopPropagation();
      setEnabled(!isEnabled());
    }
  }, true);

  function start() {
    buildPanel();
    tick();
    setInterval(tick, POLL_INTERVAL);
    log('loaded', BANK.length, '题', isEnabled() ? '对答案开' : '对答案关');
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
