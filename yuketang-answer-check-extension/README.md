# 雨课堂作业对答案（yuketang-answer-check）

在[雨课堂](https://www.yuketang.cn)学习空间作业页（`/exercise/`）自动对照本地题库，把当前题的参考答案显示在右下角，方便核对。

只提供 Chrome 扩展。选择题（含判断）会自动选中正确选项，填空题会写入空格。脚本**不会点提交**。

题库已打进扩展的 `bank.js`：

- [TonyYu02/BUAA-Engineering-Ethics](https://github.com/TonyYu02/BUAA-Engineering-Ethics)（15 讲共 303 题，单选/多选/判断）
- [taotaoboom/buaa_AI-Security-and-Ethics](https://github.com/taotaoboom/buaa_AI-Security-and-Ethics)（6 章共 280 题，多为填空）
- [pridezzh/buaa-chinese-modernization](https://github.com/pridezzh/buaa-chinese-modernization)（9 讲 + 结语共 370 题，单选/多选/判断）

打开作业时按课程名区分（工程伦理 / 人工智能安全与伦理 / 中国式现代化）。工程伦理和中国式现代化按「第 N 讲 + 题号」对照，人工智能安全与伦理按「第 N 章 + 题号」对照；第 10 讲及以后只有工程伦理。

> 可与 [视频防暂停](../yuketang-no-pause-extension)、[播完自动下一单元](../yuketang-auto-next-extension) 同时启用。对答案面板在右下角，连播开关在左下角，互不挡住。

## 原理

1. **题在哪**：学习空间作业是外层壳 + 同源 iframe（`.exercise-iframe`，地址 `/v2/web/iframe-exercise/...`）。脚本从 iframe 里读当前题。
2. **题干为什么对不上字**：雨课堂用加密字体（`exam-data-decrypt-font`），DOM 里是乱码，屏幕上才是正常汉字。所以不能只靠题干字符串。
3. **怎么对上**：明文还在 —— 标题「第一讲：习题」（中文数字）/「第1章 … 习题」/「结语：习题」和题号「4.单选题」。用 **讲次、章次或结语 + 题号** 对照对应课程题库（本课作业顺序与题库一致）。题干若能对上（未加密时）仍优先用题干。
4. **怎么展示**：右下角浮层显示参考答案；选择题能对上的选项加绿框，并把正确选项写入当前题的本地答案（单选、多选、判断，和页面选项共用的那个字段）。填空题会把参考答案写入 `input.blank-item-dynamic` 空格。两种都**不会点提交**。页面插入的假选项（`data-risk-target="decoy"`）会被跳过。选项被打乱时以选项上的 A/B/C 键为准，面板里仍显示选项正文。

切题不刷新页面（SPA），脚本约 0.4 秒轮询一次题号，并监听 iframe DOM。控制台有 `[雨课堂对答案]` 日志。

右下角按钮可随时关掉，记在 `localStorage`（`yuketang-answer-check`，`'0'` 为关，缺省开）。快捷键 `Alt+A`。

## 安装

1. 打开 Chrome / Edge，地址栏输入 `chrome://extensions`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `yuketang-answer-check-extension` 文件夹
4. **刷新**已打开的雨课堂作业页（之后新开的页面自动生效）

> 扩展按文件夹路径引用，加载后不要移动/删除该文件夹。改完脚本后在扩展页点一次刷新，再刷新雨课堂页面。

## 更新题库

若 `BUAA-Engineering-Ethics/题库.txt`、`BUAA-AI-Security-and-Ethics/题库.txt` 或 `BUAA-Chinese-Modernization/题库.txt` 有更新：

```bash
python3 yuketang-answer-check-extension/build-bank.py
```

会重写 `bank.js`（三门课合计）。扩展页刷新该扩展后再刷新作业页。

## 配置

`inject.js` 顶部：

| 配置 | 默认 | 说明 |
|---|---|---|
| `MATCH_THRESHOLD` | `0.42` | 模糊匹配下限；题干子串命中视为满分 |
| `POLL_INTERVAL` | `400` | 切题检测间隔(ms) |
| `AUTO_FILL_BLANK` | `true` | 填空题自动写入空格，不点提交 |
| `AUTO_SELECT_CHOICE` | `true` | 选择题自动选中正确选项，不点提交 |
| `DEBUG` | `true` | 控制台日志开关 |

## 兼容性

| 环境 | 支持 |
|---|---|
| 学习空间作业 `/ai-workspace/.../exercise/` | ✓ |
| 云作业 `/v2/web/cloud/student/exercise` | 尽量兼容（选择器有兜底） |
| Windows / macOS / Linux Chrome、Edge | ✓ |
| Firefox、手机、雨课堂 APP | — |

## 说明

- 仅对照本地题库做复习核对，请按课程要求独立作答。
- 雨课堂若给题干套了新的加密字体，题库里的「编码问题」副本对不上时，面板会提示未匹配；把控制台 `[雨课堂对答案]` 日志留下来便于排查。
- 若雨课堂改版导致失效，欢迎提 Issue。
