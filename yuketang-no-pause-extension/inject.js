/* 雨课堂视频防暂停 —— 主世界注入脚本（document_start） */
(function () {
  'use strict';

  /* ========== 配置 ========== */
  const AUTO_RESUME = true;        // 真实后台中视频若仍被暂停，自动恢复播放
  const RESUME_INTERVAL = 1500;    // 自动恢复检测间隔(ms)
  const DEBUG = false;             // true 时在控制台输出日志
  /* ========================== */

  const log = (...a) => { if (DEBUG) console.log('[雨课堂防暂停]', ...a); };

  // 先保存真实的可见性取值（之后伪装前），供自动恢复逻辑判断“是否真的在后台”
  const docProto = Document.prototype;
  const realHiddenDesc = Object.getOwnPropertyDescriptor(docProto, 'hidden');
  const reallyHidden = () => {
    try { return realHiddenDesc ? !!realHiddenDesc.get.call(document) : false; }
    catch (e) { return false; }
  };

  // ---- 1. 伪装页面可见性：雨课堂的 winTriggerHidden 会读 document.hidden 决定是否暂停 ----
  const spoofGetter = (obj, prop, value) => {
    try { Object.defineProperty(obj, prop, { get: () => value, configurable: true }); }
    catch (e) { log('spoof fail', prop, e); }
  };
  spoofGetter(docProto, 'hidden', false);
  spoofGetter(docProto, 'webkitHidden', false);
  spoofGetter(docProto, 'mozHidden', false);
  spoofGetter(docProto, 'msHidden', false);
  spoofGetter(docProto, 'visibilityState', 'visible');
  spoofGetter(docProto, 'webkitVisibilityState', 'visible');
  try { docProto.hasFocus = () => true; } catch (e) {}

  // ---- 2. 拒收可见性事件的监听注册（覆盖 jQuery 等库，它们底层也走 addEventListener）----
  const BLOCKED_EVENTS = new Set([
    'visibilitychange', 'webkitvisibilitychange',
    'mozvisibilitychange', 'msvisibilitychange',
  ]);
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (BLOCKED_EVENTS.has(type)) { log('blocked listener:', type); return; }
    return origAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    if (BLOCKED_EVENTS.has(type)) return;
    return origRemove.call(this, type, listener, options);
  };

  // ---- 3. 吞掉 window.onblur/onfocus/onpagehide/onpageshow 与 document.onfocusin/onfocusout 的属性赋值 ----
  // 雨课堂 winTriggerHidden 通过 window.onblur = r 注册，blur/pagehide 时不看 document.hidden 直接暂停
  // 注意：Chrome 中 window 实例自带 on* 访问器（会遮蔽 Window.prototype 上的同名描述符），
  // 所以必须同时挂在 window 实例和 Window.prototype 上
  const swallowProp = (obj, prop) => {
    try {
      Object.defineProperty(obj, prop, {
        get() { return null; },
        set() { log('swallowed handler:', prop); },
        configurable: true,
      });
    } catch (e) { log('swallow fail', prop, e); }
  };
  ['onblur', 'onfocus', 'onpagehide', 'onpageshow'].forEach(p => {
    swallowProp(Window.prototype, p);
    swallowProp(window, p);
  });
  ['onfocusin', 'onfocusout', 'onvisibilitychange'].forEach(p => swallowProp(Document.prototype, p));

  // ---- 4. 捕获阶段兜底：即便有用其它方式注册成功的，也拦下这些事件 ----
  // 注意用 origAdd 注册，绕开上面第 2 步的拦截
  const stopEvent = (e) => { e.stopImmediatePropagation(); log('stopped event:', e.type); };
  ['visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'msvisibilitychange']
    .forEach(ev => origAdd.call(document, ev, stopEvent, true));
  ['blur', 'focusout', 'pagehide', 'freeze']
    .forEach(ev => origAdd.call(window, ev, stopEvent, true));

  // ---- 5. 自动恢复：真实处于后台时，若视频仍被暂停（如心跳看门狗），自动重新播放 ----
  // 只在“真实后台”时恢复：用户在前台手动点暂停不会被干扰
  if (AUTO_RESUME) {
    setInterval(() => {
      if (!reallyHidden()) return;
      document.querySelectorAll('video').forEach(v => {
        if (v.paused && !v.ended && v.currentTime > 0 && v.readyState > 1) {
          v.play().then(() => log('auto-resumed')).catch(() => {});
        }
      });
    }, RESUME_INTERVAL);
  }

  log('loaded');
})();
