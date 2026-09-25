# 雨课堂视频防暂停（yuketang-no-pause）

阻止[雨课堂](https://www.yuketang.cn)视频在**切换浏览器标签页**或**最小化窗口**时自动暂停。视频在后台持续播放，学习进度心跳照常上报。

只提供 Chrome 扩展。

## 原理

雨课堂播放器（xt_video_player）通过两层机制暂停后台视频：

1. **可见性检测**（`winTriggerHidden`）：用 jQuery 监听 `visibilitychange`，并直接给 `window.onblur / onpagehide / onfocusout` 等属性赋值。切标签页或最小化时触发暂停，其中 blur/pagehide 路径**不读 `document.hidden`，无条件暂停**。
2. **心跳看门狗**：每次心跳对比 `video.currentTime`，进度连续 10 个周期不前进就强制暂停。

本工具在页面任何脚本运行之前（`document_start` / 主世界）注入，做四层防御：

- 伪装可见性：`document.hidden` / `visibilityState`（含 webkit/moz/ms 前缀）恒为「可见」，`document.hasFocus()` 恒为 `true`
- 拒收注册：包装 `EventTarget.prototype.addEventListener`，丢弃所有 `visibilitychange` 类监听（jQuery 底层也走这里）
- 吞掉属性赋值：在 **window 实例 + Window.prototype** 两层拦截 `onblur / onfocus / onpagehide / onpageshow` 赋值（Chrome 的 window 实例自带 on* 访问器，会遮蔽原型上的描述符，必须双层处理）
- 捕获阶段兜底 + 自动恢复：`stopImmediatePropagation` 拦下漏网事件；真实处于后台时若视频仍被暂停（如看门狗），1.5s 内自动恢复播放（前台手动暂停不受干扰）

## 安装

1. 下载本仓库（Code → Download ZIP 后解压，或 `git clone`）
2. 打开 Chrome，地址栏输入 `chrome://extensions`
3. 打开右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择 `yuketang-no-pause-extension` 文件夹
5. **刷新**已打开的雨课堂页面（之后新开的页面自动生效）

> 若 Chrome 启动时提示「是否停用开发者模式扩展程序」，选择「保留」。
> 扩展按文件夹路径引用，加载后不要移动/删除该文件夹。

## 兼容性

| 环境 | 支持 |
|---|---|
| Windows / macOS / Linux Chrome、Edge | ✓ |
| QQ浏览器、360 等 Chromium 内核 | ✓ |
| Firefox、手机、雨课堂 APP | — |

## 实测验证

在雨课堂真实课程视频页（`yuketang.cn/ai-workspace/.../video/...`）验证：

| 场景 | 结果 |
|---|---|
| 未打补丁切后台 | 视频立即暂停，进度冻结 |
| 打补丁后切后台 15s+ | 持续有声播放，后台进度随真实时间精确前进 |

## 说明

- 脚本会让雨课堂服务端认为页面始终处于前台，请按课程要求合理使用，仅供学习研究。
- 若雨课堂未来改版导致失效，欢迎提 Issue。
