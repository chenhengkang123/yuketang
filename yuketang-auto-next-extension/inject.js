/* 雨课堂视频播完自动下一单元 —— 内容脚本（document_idle）
 * 注：本脚本只读 DOM、调用 click()/play()，不补丁原型，
 * 因此不需要防暂停脚本那样的 world:"MAIN" + document_start。
 */
(function () {
  'use strict';

  /* ========== 配置 ========== */
  const POLL_INTERVAL = 1000;    // 轮询间隔(ms)
  const END_GRACE = 5;           // 距结尾多少秒视为播完(ended 事件的兜底；雨课堂有时差几秒就停住)
  const NEXT_DELAY = 1500;       // 播完后延迟多久点下一单元(ms)，给完成上报留时间
  const NAV_RETRY_DELAY = 3000;  // 点击后等待跳转的时间(ms)，超时重试点下一单元
  const NAV_MAX_RETRIES = 3;     // 最多重试次数(首次打开页面时按钮可能尚未就绪)，仍不跳转才视为已是最后单元
  const SKIP_NON_VIDEO = true;   // true: 作业等非视频单元自动跳过；false: 停下等人工处理
  const MAX_NON_VIDEO_HOPS = 10; // 连续跳过非视频单元的上限，防失控
  const AUTO_PLAY = true;        // 自动进入的新视频单元若未自动播放，尝试 play()
  const DEBUG = true;            // 控制台输出 [雨课堂自动连播] 日志
  /* ========================== */

  const ENABLED_KEY = 'yuketang-auto-next';          // localStorage，'0' 为关，缺省为开
  const STOP_AFTER_KEY = 'yuketang-auto-next-stop';  // sessionStorage，'1' 为本集播完后停止

  const log = (...a) => { if (DEBUG) console.log('[雨课堂自动连播]', ...a); };

  const isVideoUnit = () => location.pathname.includes('/video/');
  const isEnabled = () => localStorage.getItem(ENABLED_KEY) !== '0';
  const stopAfterArmed = () => sessionStorage.getItem(STOP_AFTER_KEY) === '1';

  // 状态：学习空间是 SPA，切单元不刷新页面，全部靠轮询 URL 驱动
  const state = {
    lastUrl: location.href, // 上次看到的 URL，用于检测 SPA 跳转
    firedUrl: null,         // 已对哪个 URL 触发过"播完点下一单元"，防重复
    chain: false,           // 是否处于脚本自己发起的连播链中(区分用户手动打开的作业页)
    navPending: false,      // 已安排/正在等待跳转，防止轮询重复点下一单元
    playUrl: null,          // 自动播放重试计数对应的 URL
    playTries: 0,           // 当前 URL 已尝试自动播放次数(最多 3 次，避免和手动暂停打架)
    hops: 0,                // 连播链中连续经过的非视频单元数
    navTimer: null,         // 等待跳转的超时定时器
    navRetries: 0,          // 点击后未跳转的已重试次数
  };

  function toast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;padding:8px 14px;'
      + 'background:rgba(0,0,0,.75);color:#fff;font-size:13px;border-radius:6px;pointer-events:none';
    mount(el);
    setTimeout(() => el.remove(), 4000);
  }

  function mount(el) {
    const fs = document.fullscreenElement;
    const parent = (fs && fs.tagName !== 'VIDEO') ? fs : (document.body || document.documentElement);
    parent.appendChild(el);
  }

  let panel;
  let toggleBtn;
  let stopBtn;

  function renderPanel() {
    if (!panel) return;
    const on = isEnabled();
    const armed = on && stopAfterArmed();
    toggleBtn.textContent = on ? '连播开' : '连播关';
    toggleBtn.style.background = on ? '#1a7f37' : '#5c5c5c';
    stopBtn.hidden = !on;
    stopBtn.textContent = armed ? '本集后停 · 已预约' : '本集后停';
    stopBtn.style.background = armed ? '#9a6700' : '#3a3a3a';
  }

  function setEnabled(on) {
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
    if (!on) sessionStorage.removeItem(STOP_AFTER_KEY);
    renderPanel();
    log(on ? '连播已开启' : '连播已关闭');
    toast(on ? '自动连播：已开启' : '自动连播：已关闭');
  }

  function setStopAfter(on) {
    if (on) sessionStorage.setItem(STOP_AFTER_KEY, '1');
    else sessionStorage.removeItem(STOP_AFTER_KEY);
    renderPanel();
    if (on) {
      log('本集播完后停止');
      toast('自动连播：本集播完后停止');
    }
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:999999;display:flex;gap:6px;'
      + 'font:13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    const btnCss = 'border:0;color:#fff;padding:7px 12px;border-radius:6px;cursor:pointer';
    toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.title = '开关自动连播（Alt+N）';
    toggleBtn.style.cssText = btnCss;
    toggleBtn.addEventListener('click', () => setEnabled(!isEnabled()));
    stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.title = '当前视频播完后停在这一集';
    stopBtn.style.cssText = btnCss;
    stopBtn.addEventListener('click', () => setStopAfter(!stopAfterArmed()));
    panel.append(toggleBtn, stopBtn);
    mount(panel);
    renderPanel();
  }

  document.addEventListener('fullscreenchange', () => { if (panel) mount(panel); });
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      e.stopPropagation();
      setEnabled(!isEnabled());
    }
  }, true);

  // 下一单元：优先点页面右上角 ">" 箭头(.unit-arrow.arrow-reverse，上一个是不带 arrow-reverse 的同款图标)；
  // 兜底用侧边栏目录中当前高亮项(.leaf-item.is-active)的下一个 .leaf-item。
  // 首次打开页面时 DOM 里可能先渲染出占位/隐藏元素，只点可见的。
  const clickable = (el) => !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0));

  function clickNextUnit() {
    const arrow = [...document.querySelectorAll('.learning-space-control-unit .unit-arrow.arrow-reverse, .control-right .unit-arrow.arrow-reverse')]
      .find(clickable);
    if (arrow) { arrow.click(); return 'arrow'; }
    const leaves = [...document.querySelectorAll('.leaf-item')].filter(clickable);
    const cur = leaves.findIndex(el => el.classList.contains('is-active'));
    if (cur >= 0 && leaves[cur + 1]) { leaves[cur + 1].click(); return 'sidebar'; }
    return null;
  }

  function goNext(reason) {
    if (!isEnabled()) {
      state.chain = false;
      state.navPending = false;
      return;
    }
    state.navRetries = 0;
    attemptNav(reason);
  }

  function attemptNav(reason) {
    const from = location.pathname;
    const how = clickNextUnit();
    if (!how) {
      state.chain = false;
      state.navPending = false;
      log('未找到下一单元入口');
      toast('自动连播：未找到下一单元');
      return;
    }
    state.chain = true;
    if (state.navRetries === 0) {
      log(`已点下一单元(${how})，原因：${reason}`);
      toast('自动连播：进入下一单元');
    } else {
      log(`点击后未跳转，重试点下一单元(${state.navRetries}/${NAV_MAX_RETRIES})`);
    }
    clearTimeout(state.navTimer);
    state.navTimer = setTimeout(() => {
      if (location.pathname !== from) return; // 已跳转，交给轮询重置状态
      if (isEnabled() && state.navRetries < NAV_MAX_RETRIES) {
        state.navRetries++;
        attemptNav(reason);
        return;
      }
      state.chain = false;
      state.navPending = false;
      log('多次点击后仍未跳转，可能已是最后一个单元');
      toast('自动连播：已是最后一个单元');
    }, NAV_RETRY_DELAY);
  }

  setInterval(() => {
    // SPA 跳转检测：URL 变了就重置每页状态
    if (location.href !== state.lastUrl) {
      clearTimeout(state.navTimer);
      log('页面切换:', location.pathname);
      state.lastUrl = location.href;
      state.firedUrl = null;
      state.navPending = false;
      state.navRetries = 0;
      if (isVideoUnit()) state.hops = 0;
    }

    if (!isEnabled()) return;
    if (state.navPending) return; // 已安排点下一单元，等待跳转生效

    if (isVideoUnit()) {
      const v = document.querySelector('video');
      if (!v) return;

      // 连播进入的新视频若没自动播，补 play()；最多重试 3 次(之后用户手动暂停不受打扰)
      if (AUTO_PLAY && state.chain && v.paused && !v.ended && v.readyState > 1) {
        if (state.playUrl !== state.lastUrl) { state.playUrl = state.lastUrl; state.playTries = 0; }
        if (state.playTries < 3) {
          state.playTries++;
          v.play().then(() => log('自动播放成功')).catch(e => log('自动播放被拒:', e.message));
        }
      }

      if (state.firedUrl === state.lastUrl) return;
      const nearEnd = v.duration > 0 && v.duration - v.currentTime <= END_GRACE;
      if (v.ended || nearEnd) {
        state.firedUrl = state.lastUrl;
        if (stopAfterArmed()) {
          sessionStorage.removeItem(STOP_AFTER_KEY);
          renderPanel();
          log('本集已播完，按预约停止连播');
          toast('自动连播：本集已播完，已停止');
          return;
        }
        state.navPending = true;
        log(`视频播完(ended=${v.ended}, ${v.currentTime.toFixed(1)}/${v.duration.toFixed(1)}s)`);
        setTimeout(() => goNext('视频播完'), NEXT_DELAY);
      }
    } else {
      // 非视频单元(作业 /exercise/ 等)：只有处于连播链中才处理，用户手动打开的作业页绝不动
      if (!state.chain) return;
      if (!SKIP_NON_VIDEO) {
        state.chain = false;
        log('下一单元不是视频，停止连播:', location.pathname);
        toast('自动连播：下一单元是作业等非视频内容，已停止');
        return;
      }
      if (state.hops >= MAX_NON_VIDEO_HOPS) {
        state.chain = false;
        log('连续跳过非视频单元已达上限，停止');
        toast('自动连播：连续跳过过多非视频单元，已停止');
        return;
      }
      state.hops++;
      state.navPending = true;
      log('非视频单元，跳过:', location.pathname);
      setTimeout(() => goNext('跳过非视频单元'), NEXT_DELAY);
    }
  }, POLL_INTERVAL);

  buildPanel();
  log('loaded', isEnabled() ? '连播开' : '连播关');
})();
