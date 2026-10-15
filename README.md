# 学习模式（Learning Mode）· DSH 插件 / 整合包

DSH 侧边栏「学习模式」插件：把 `learning/` 知识库切成带锚点的步骤文件，连续预览、断点提问、
回溯导航、阅读标记与文献导入。

- 包名：`dsh-learning-mode` ｜ 版本：`0.1.1` ｜ 形态：profile（含 vendored 依赖内嵌，装时无需联网取包）
- 插件坐标：`@local/learning-mode`
- 目标 profile 名：`learning`
- **仅通过本仓库 / Release 分发**：未打 `dsh-pack` 话题，不参与 dspack 市场收录

## 安装（三选一）

**1. 便携包（推荐）**：解压 `portable/learning-mode-0.1.1.zip`，按其中 `INSTALL.md` 用图形界面「添加插件 → 本地绝对路径」或 `install.ps1` / `install.sh` 安装。

**2. 本整合包（PackForge，本地文件安装）**：在装了 `@dsh-packforge/dsh-pack-plugin` 的设备上，用其设置面板「安装 .dspack」选择 `release/dsh-learning-mode-0.1.1.dspack`（会先按 sha256 + size 校验）。

**3. 从源码**：把仓库克隆到目标设备，进入 `learning-mode/` 后按 `INSTALL.md` 的脚本安装。

## 安装后

**完全退出并重启** DeepSeek Desktop（Host 半区代码在重启后加载）。侧边栏底部出现「学习模式」图标。

第一次使用：点「导入文献」粘贴文献绝对路径 → agent 先给出步骤 DAG 草案 → 你确认后落盘建索引；
之后在新建会话里说「继续」，agent 只讲当前一步。

## 内容

```text
learning-mode/                 插件包（可直接被 profile 解析）
install.ps1 / install.sh       安装脚本
INSTALL.md                     三种安装方式与验证
portable/                      便携包（解压即装）
release/                       .dspack + sha256 侧车（本地文件安装）
manifest.json                  pack manifest v5（.dspack 容器用；未打 dsh-pack 话题，不进市场）
CHANGELOG.md / PUBLISH.md      变更记录与发布清单
```
