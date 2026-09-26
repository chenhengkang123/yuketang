# 雨课堂视频工具

三个互不冲突的浏览器工具，给[雨课堂](https://www.yuketang.cn)学习空间用：

| 工具 | 作用 | 目录 |
|---|---|---|
| [视频防暂停](yuketang-no-pause-extension/README.md) | 切标签页或最小化后视频继续播放 | `yuketang-no-pause-extension/` |
| [播完自动下一单元](yuketang-auto-next-extension/README.md) | 视频播完自动进入下一单元，作业等非视频单元可自动跳过 | `yuketang-auto-next-extension/` |
| [作业对答案](yuketang-answer-check-extension/README.md) | 打开作业后对照本地工程伦理题库，显示当前题参考答案 | `yuketang-answer-check-extension/` |

三个都是 Chrome 扩展，可以同时启用。

## 安装

克隆本仓库后，在 `chrome://extensions` 打开开发者模式，分别「加载已解压的扩展程序」：

- 防暂停：选择 `yuketang-no-pause-extension`
- 自动连播：选择 `yuketang-auto-next-extension`
- 作业对答案：选择 `yuketang-answer-check-extension`

加载后不要移动或删除对应文件夹。改完脚本后，在扩展页刷新该扩展，再刷新雨课堂页面。
