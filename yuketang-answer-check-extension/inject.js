/* 雨课堂作业对答案 —— 主世界内容脚本（document_start）
 * 只读 DOM / 拦截作业接口回包、对照本地题库展示参考答案，
 * 不点击选项、不调用提交接口。
 */
(function () {
  'use strict';

  /* ========== 配置 ========== */
  const POLL_INTERVAL = 400;     // 轮询间隔(ms)，切题不换 URL，靠题号/DOM 判断
  const MATCH_THRESHOLD = 0.42;  // 2-gram Jaccard 下限；子串命中视为 1
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

  function matchBank(text, hintLec) {
    const page = compact(text);
    if (page.length < 8) return null;
    let best = null;
    for (const q of BANK) {
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

  function parseLecture(s) {
    const m = String(s || '').match(/第\s*0*(\d+)\s*讲\s*([^\n]*)/);
    if (!m) return null;
    return { n: Number(m[1]), name: compact(m[2]).replace(/习题.*$/, '') };
  }

  function lectureText() {
    const cloud = vuexCloud();
    const leaf = cloud && (cloud.leafInfo && (cloud.leafInfo.name || cloud.leafInfo.title) || cloud.leafName);
    const nodes = [
      leaf,
      document.querySelector('.learning-space-control-unit'),
      document.querySelector('.leaf-item.is-active, .leaf-item-title'),
      exerciseDoc().title,
      exerciseDoc().querySelector('.header-title, .exercise-title, .unit-title'),
    ];
    for (const n of nodes) {
      const t = typeof n === 'string' ? n : (n && n.innerText);
      if (t && /第\s*0*\d+\s*讲/.test(t)) return t;
    }
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

  function matchByMeta(lectureRaw, index) {
    const lec = parseLecture(lectureRaw);
    if (!lec || !index) return null;
    const q = BANK.find((item) => {
      const p = parseLecture(item.lec);
      return p && p.n === lec.n && item.no === index;
    });
    return q ? { q, score: 1 } : null;
  }

  function lectureHint() {
    const lec = parseLecture(lectureText());
    if (!lec) return '';
    const hit = BANK.find((q) => {
      const p = parseLecture(q.lec);
      return p && p.n === lec.n;
    });
    return hit ? compact(hit.lec) : '';
  }

  function pickCurrentText() {
    const items = visibleItems();
    if (items.length) return stemFromItem(items[0]);
    const fallback = exerciseDoc().querySelector('.problem-body, .item-body');
    if (fallback) return (fallback.innerText || '').replace(/\s+/g, ' ').trim();
    return '';
  }

  function typeLabel(q) {
    return q.type === 'multi' ? '多选' : q.type === 'judge' ? '判断' : '单选';
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function isImageText(t) {
    return /!\[[^\]]*\]\(|<img|rain-oplat\.xuetangx/i.test(t || '');
  }

  function answerHeadline(q) {
    if (q.type === 'judge') return q.ansT[0] || (q.ans[0] === 'true' ? '正确' : '错误');
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
    return nodes.filter((el) => (el.offsetWidth > 0 || el.offsetHeight > 0) && compact(el.innerText).length >= 1);
  }

  function markOptions(q, root) {
    if (!root) return;
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
      bodyEl.innerHTML = `<div style="opacity:.8">${where}未匹配到题库。确认当前是工程伦理作业。</div>`;
      return;
    }
    const q = hit.q;
    const pct = Math.round(hit.score * 100);
    const extra = (q.ansT || []).filter((t) => t && t.length > 18 && !isImageText(t)).map((t) => `· ${esc(t)}`).join('<br>');
    const shown = index || q.no;
    bodyEl.innerHTML = [
      `<div style="opacity:.75;font-size:12px">当前第${shown}题 · ${esc(q.lec)} · 题库第${q.no}题 · ${typeLabel(q)} · ${pct}%</div>`,
      `<div style="margin-top:6px;font-size:18px;font-weight:700;letter-spacing:.04em">${esc(answerHeadline(q))}</div>`,
      extra ? `<div style="margin-top:6px;opacity:.9">${extra}</div>` : '',
      `<div style="margin-top:8px;opacity:.55;font-size:12px">对照来源：${esc(source)} · 只显示不提交</div>`,
    ].join('');
  }

  function syncChips(hint) {
    const items = visibleItems();
    document.querySelectorAll('.ykt-ans-chip').forEach((el) => el.remove());
    if (items.length < 2) return;
    items.forEach((el) => {
      const text = stemFromItem(el);
      const hit = matchBank(text, hint);
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
      if (lastOn) { clearHits(); lastKey = ''; }
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

    const hint = lectureHint();
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

    const key = `${location.pathname}|${index}|${typeText}|${compact(lecRaw).slice(0, 40)}|${compact(text).slice(0, 40)}`;
    if (key === lastKey) return;
    lastKey = key;

    clearHits();
    const stemHit = matchBank(text, hint);
    const metaHit = matchByMeta(lecRaw, index);
    // 加密字体时题干对不上，用「第N讲 + 题号」对照题库（本课作业顺序与题库一致）
    const hit = (stemHit && stemHit.score >= 0.75) ? stemHit : (metaHit || stemHit);
    if (hit === metaHit && metaHit) source = '讲次+题号';
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
