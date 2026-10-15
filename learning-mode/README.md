# learning-mode · DSH 学习模式插件

把 DSH 变成一个**可中断、可回溯、可恢复**的结构化学习界面：侧边栏「学习模式」面板把 `learning/` 知识库里的步骤文件连续预览，并在面板里完成主线推进、回学与断点提问。

设计文档：[learning-mode-plugin-design-v0.2.md](../learning-mode-plugin-design-v0.2.md)（M1/M2/M3 已实施并验证）

## 当前状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 导航骨架 | 侧边栏入口、三栏面板、连续预览、导航状态机、重启恢复 | ✅ 已实施并在 GUI 验证 |
| M2 主线教学 | Host 半区：`state/learning-state.json` 所有权、学习协议注入、`learning_control` 工具、逐步教学链路 | ✅ 已实施（47 项测试通过），待 GUI 复验 |
| M3 提问与回顾 | 断点提问走 subagent + 标注写回 + 面板线程；Peek 升级提问；面板→Host 命令通道 | ✅ 已实施（190 项测试通过），待 GUI 复验 |
| M4 文献导入 | 协议第 8 条：先出 DAG 草案等确认，落盘后由 `learning_control{action:"ingest_commit"}` 校验 id、建索引并置主线 | ✅ 已实施（覆盖全新主题 / 指定起点 / 重复 id / 缺 id） |

## 构建与公式渲染

`client.js` 是**生成物**：`build.mjs` 把 vendor 的 KaTeX 与面板源码拼成一个文件（浏览器里两者同处一个脚本）。

```powershell
node learning-mode/build.mjs           # 生成 client.js
node learning-mode/build.mjs --check   # 校验生成物是否最新（提交前）
```

- `src/client.js` —— 面板源码（唯一手改处）
- `vendor/katex.min.js` —— KaTeX 0.16.22（MIT，见 `vendor/katex.LICENSE`）
- `client.js` —— 生成物，banner 记录两份源码的 sha256

为什么自带 KaTeX：Web 外壳的客户端模块基座只登记 React / react-dom / cordis / store / slots / primitives / dockkit（**没有数学渲染键**），而插件规范明令不得 import 宿主 UI 包——所以渲染器由插件自带。CSS 与字体沿用外壳已全局加载的那套 KaTeX 样式（前端 dist 里带 KaTeX 字体），插件不重复引入，避免覆盖 `@font-face` 路径。

渲染行为：`$$…$$` 走 KaTeX display 模式，行内 `$…$` 走 inline 模式；KaTeX 缺失或公式报错时自动回退为等宽 TeX 原文（`throwOnError: false` + 兜底）。

### 渲染器容错（不同会话产出的格式不一）

面板不假设单一模板，以下写法都能渲染：

| 输入 | 处理 |
|---|---|
| 锚点独占一行 / 行内 `<a id="X"></a>` | 都抽出来做 👁/⁉ 芯片；行内锚点还会清掉它留下的空括号 |
| `$$…$$` / `\[…\]` / ```math 围栏 | KaTeX display（大号、居中） |
| 整行只有一个 `\(…\)` 或 `$…$` | **提升为块级 display**（与 `$$` 同款），不再当行内小公式 |
| 行内 `$…$` / `\(…\)`（混在句子里） | KaTeX inline（小号、随文） |
| **缩进块**（4 空格） | 像数学 → 公式块；像代码 → 等宽块 |
| 缩进块里的 **Unicode 数学**（`∂ρ̂/∂t`、`χ_VV(ω)`、`∫_{t₀}^{t}`） | 先**尽力试 KaTeX**：能解析就直接用（裸 `_` 变成真下标、字体正确）；解析失败才回退为衬线纯文本（1.18em、居中） |
| `**粗体**` `*斜体*` `` `code` `` `[链接](url)` | 原生元素渲染；`snake_case` 不会被误判成斜体 |

另外每个步骤卡片头部都有「⁉ 提问本步」按钮：即使某个步骤文件完全没有锚点，也能整步提问。`ingest_commit` 会报告两类内容问题：**缺锚点**的步骤、以及**用纯文本/Unicode 写公式**（未用 `$$`/`\[`/`\(` 分隔符）的步骤——后者渲染只能尽力而为，建议让 agent 改写成 LaTeX。

M3 之后的权责：**Host 半区是学习状态的唯一写者**（`state/learning-state.json` + `questions/` + `state/pending/`，原子写 + `state_version` 乐观锁）；面板只是它的投影——按钮点击经 `remote.commands.execute('/learn …')` 交给 Host，面板再跟随状态文件版本自动刷新（3 秒轮询 + 手动「刷新」）。面板自己的 localStorage 只记住窗口内的滚动/速览位置，不再是权威。

## M2 用法（对话即学习）

在会话里（工作目录含 `learning/`）用自然语言驱动，协议会引导 agent 只讲当前一步：

| 你说 | agent 的动作 | 效果 |
|---|---|---|
| 「继续 / 下一步」 | `learning_control({action:"next"})` | 主线推进一格，只读该步文件讲解 |
| 「回学 S02」 | `learning_control({action:"back", step_id:"S02"})` | 压入回学帧，主线不动 |
| 「回到上一层」 | `learning_control({action:"return"})` | 弹出一层 |
| 「回主线」 | `learning_control({action:"resume"})` | 清栈恢复主线，衔接一句 |
| 「S02 我懂了」 | `learning_control({action:"set_status", ...})` | 由代码改写步骤 frontmatter 的 `status` |
| 「S02-EQ-01 为什么…」 | 只读该步文件作答 + 写回 `> [!question]` / `[!answer]` | 问答沉淀回知识库 |

`learning_control` 的 action：`status | next | back | return | resume | goto | set_status | ask | answer | branches | ingest_commit | answer_detail | ingest_request`（详见 [index.js](index.js)）。模型不能直接改 `state/learning-state.json`——协议禁止，且该文件由核心模块原子写入（[lib/core.js](lib/core.js)）。

## M5 用法（阅读标记 / 简短回答 / 统一导入）

### 点击 = 标记，不唤醒 agent

- **点步骤行或预览卡片** → 只标记"我在读这里"（📌，存 localStorage，按会话+主题隔离），不动主线游标、不开分支、**不唤醒 agent**。
- **空格键** → 平滑滚回标记处并闪一下高亮（像扒带软件的 A/B 回位）。在输入框/文本域里按空格不受影响。
- 只有**明确的按钮**才会唤醒 agent：下一步、回学此步、⁉ 提问、＋ 详细回答、导入文献。

### 简短回答 + 按需展开

- 提问默认走**简短回答**：协议要求 2–4 句结论 + 必要公式（≤200 字），完整推导留到需要时。
- 分支卡片上的「＋ 详细回答」→ `answer_detail`（**wake-only**：不建新分支、不动状态）→ agent 补充完整推导链条/依据/边界/出处，并以 `> [!answer] Qxxx · 详细` **追加**到标注区——简短版保留不动，`questions/` 也不被重写。

### 统一导入入口

- 面板「导入文献」→ 粘贴文献绝对路径 → `ingest_request` → agent 收到 `[LEARN-INGEST]`，按协议第 8 条：**先出步骤 DAG 草案等确认** → 落盘 → `ingest_commit`。
- 在聊天里直接给路径（如「导入 E:\...\ch13.pdf」）走的是同一条规则，两条入口行为一致。
- **导入时可选模型**：路径框左侧的下拉来自会话级模型目录（`ctx.modelDirectories.directoryFor(sessionId)`，与 composer 模型控件、`/model` 弹窗共用同一份），提交时经 `directory.select({provider, model})` 切换——**只有本次导入需要换模型时才会切换**；沿用当前模型则不动。目录不可用（如已寻址的 subagent 会话）时不显示下拉，按当前模型导入。

## M3 用法（断点提问与回顾）

### 面板按钮 = Host 命令

侧边栏面板顶部按钮（下一步 / 回学 / 返回上一层 / 回主线）不再只动本地游标：它们调用 Host 注册的 `learn` 命令（`remote.commands.execute(sessionId, '/learn {json}', [])`），由同一套状态机改状态，并对需要新讲解的动作用 `agent.followup` 唤醒教学 agent：

| 面板动作 | 载荷 | Host 行为 |
|---|---|---|
| 下一步 | `{"action":"next"}` | 推进主线 + `[LEARN-NEXT]` 唤醒 agent 讲新一步 |
| 回学此步 | `{"action":"back","step_id":"S03"}` | 压回学帧 + `[LEARN-REVIEW]` 重讲，主线不动 |
| 返回上一层 | `{"action":"return"}` | 弹一层，**纯导航不调模型** |
| 回主线 | `{"action":"resume"}` | 清栈；未答完的分支自动 `deferred`，**不调模型** |

命令行也可直接用：`/learn {"action":"next"}`、`/learn {"action":"goto","step_id":"S02"}`。

### 断点提问全链路（v0.2 §4.3）

1. 预览里点锚点旁的 **⁉**（Peek 浮层里也可以一键「提问」升级），写问题并提交。
2. Host 建分支 `Qxxx`、压 `question` 导航帧、把问题 callout 写进步骤文件「标注」区、写 `questions/Qxxx-*.md`。
3. Host 组装 **ContextPackage**（锚点小节 + 本步结论/直觉 + 一跳依赖摘要 + 出处，≤6000 tokens，含预算明细）写入 `state/pending/Qxxx.md`。
4. Host 用 `agent.followup` 发 `[LEARN-ASK]`，要求 agent 用 **subagent** 作答：subagent 的 prompt 只含包文件路径与问题本身，不携带会话历史。
5. 答案经 `learning_control({action:"answer", branch_id, text, source_refs})` 由**代码**写回（步骤文件 `[!answer]` callout + `questions/Qxxx.md` 重写为 `resolved`）。
6. 面板 3 秒内自动跟随状态版本刷新，右栏「问答线程」显示问题、状态与答案；点「定位」跳到对应步骤/锚点。

幂等与并发：面板每次提交带稳定的 `request_id`，重放（超时重试、连点）不会重复建分支、不会二次唤醒；`expected_state_version` 乐观锁保证旧回答/迟到请求不会覆盖更新的游标。

`learn` 命令不可用时（例如组合里没有 `commands` 服务），面板退回本地记录模式并在顶部提示，按钮仍可用本地状态机——不会白屏。

## 目录

```text
learning-mode/                  # bundle 包（本目录）
├── package.json                # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml            # 向 profile 插入 learning-mode 行
├── index.js                    # Host 半区：学习协议段 + learning_control 工具
├── lib/core.js                 # 纯核心：状态文件、状态机、步骤状态改写（无 DSH 依赖）
├── client.js                   # Client 半区：面板 + 解析 + 导航
├── locale/{zh,en}.json         # 插件展示元信息
└── icon.svg
```

## 知识库格式（工作区内）

```text
learning/
└── <topic>/
    ├── index.md                 # MOC：步骤路线与依赖
    ├── steps/S01-*.md           # 一步一文件（frontmatter + 结论/推导/直觉/标注）
    ├── questions/Qxxx-*.md      # 一次提问的完整记录（Host 写：问题 + 回答 + status）
    └── state/
        ├── learning-state.json  # 游标 / 焦点 / 导航栈 / 分支表（Host 原子写）
        └── pending/Qxxx.md      # 该次提问的上下文包（唯一的 subagent 输入）
```

步骤文件模板：

```markdown
---
id: S07
title: 位置编码的引入
type: derivation            # definition | assumption | derivation | result
depends_on: ["S01", "S04"]
status: 在读                 # 未读 | 在读 | 存疑 | 已懂
source_refs: ["DOC-001#p7"]
content_status: draft
revision: 1
---

# S07 · 位置编码的引入

## 结论
（一句话核心结论，Peek 卡片默认显示这一节）

## 推导
<a id="S07-EQ-01"></a>
$$
...
$$

## 标注
> [!question] Q003
> 为什么用正弦而不是可学习的位置向量？

> [!answer] Q003
> ...
```

锚点（`<a id="...">`）紧挨着它标注的公式块或标题，面板会在预览里渲染成带 👁（Peek）和 ⁉（提问）的锚点行。

示例知识库：`../learning/attention-demo/`（4 步，含 Peek 与问答标注样例）。

## 安装

Desktop 的 profile 由应用独占管理，安装 = 让 profile 能解析到本包并选中它：

1. 把本包链接进 profile 的 `node_modules`：

```powershell
$profileDir = "$env:USERPROFILE\.dsh\profiles\desktop"
New-Item -ItemType Directory -Force -Path "$profileDir\node_modules\@local" | Out-Null
New-Item -ItemType Junction -Path "$profileDir\node_modules\@local\learning-mode" `
  -Target "C:\Users\diacletia\Documents\deepseek-harness\default-workspace\learning-mode"
```

2. 在 `<profileDir>\package.json` 中登记依赖与组合包：

```json
{
  "dependencies": {
    "@local/learning-mode": "link:../../../Documents/deepseek-harness/default-workspace/learning-mode"
  },
  "dsh": { "profile": { "bundles": ["...", "@local/learning-mode"] } }
}
```

3. 重启 DeepSeek Desktop（新 bundle 首次组合需要重新组合 Loader 树），在侧边栏底部点「学习模式」。

> 注：`profiles\desktop` 当前是 `profiles\default` 的 junction，两个名字指向同一目录。
> 有 `plugin_manager` 工具或 GUI 插件页时，用「添加插件 → 本地绝对路径」安装是官方路径，无需手动改 profile。

## 验证

```powershell
# 构建物是否最新（client.js = vendor/katex.min.js + src/client.js）
node learning-mode/build.mjs --check

# 语法
node --check learning-mode/src/client.js
node --check learning-mode/index.js

# 解析器 + 导航状态机 + 问答文稿解析（纯逻辑，无需浏览器）
node dsh-probe/test-learning-mode.js

# slot 接线（用桩加载源码，断言注册到 sidebar.panellist / main / main.learning 与命令通道）
node dsh-probe/test-learning-mode-wiring.js

# 工作区文件条目映射（type/kind 回归）
node dsh-probe/test-learning-mode-face.mjs

# 公式渲染（KaTeX 可用 / 缺失两条路径 + 行内切分）
node dsh-probe/test-learning-mode-math.mjs

# Host 半区（核心状态机、问答分支、ContextPackage、乐观锁、learn 命令、唤醒三态、ingest_commit）
node dsh-probe/test-learning-mode-host.mjs
```

三套测试共 190 项断言（41 + 17 + 132），全部通过。

> 改了 Host 半区（`index.js` / `lib/core.js`）之后需要**重启 DeepSeek Desktop**：新 bundle 首次安装可以走 HMR，但替换已安装包的 Host 模块要重启才会加载新的模块代（见 DSH `references/host-plugin.md`）。仅改 `client.js` 时，若 `pnpm run dev:web` 在跑则会自动重载。

界面验收（M1）：

- 侧边栏出现「学习模式」图标，点击进入三栏面板；
- 左栏列出主题与步骤（状态点颜色区别未读/在读/存疑/已懂）；
- 中栏连续预览全部步骤，当前主线步骤高亮，锚点行有 👁 / ⁉；
- 顶栏显示 `主线 S02 · 2/4 ｜ 焦点 ｜ 栈 0`，按钮：下一步 / 回学此步 / 返回上一层 / 回主线；
- 回学某步后主线游标不动，返回上一层逐层还原，回主线一次清栈；
- 刷新页面后位置不丢（localStorage）。

界面验收（M3）：

- 点 ⁉ 提问并提交后，顶栏出现「已唤醒 agent」，聊天里出现 `[LEARN-ASK]` 触发的作答，右栏「问答线程」先显示 `Qxxx · 待答`、作答后变 `已答` 并显示答案正文；
- 步骤文件的「标注」区出现 `> [!question] Qxxx` 与 `> [!answer] Qxxx`，`learning/<主题>/questions/Qxxx-*.md` 与 `state/pending/Qxxx.md` 落盘；
- 提问期间点「下一步」应被拒绝并给出「先 return/resume」的提示（问题分支里主线不动）；
- 连续两次提交同一请求（同 `request_id`）只产生一个分支、只唤醒一次；
- 「返回上一层」逐层还原，「回主线」清栈且未答完的分支变 `deferred`；
- 演示库 `learning/attention-demo/` 自带一条已答线程（Q002），面板应与 S04 标注区一致。

## 设计要点

- **知识存储唯一**：Markdown 步骤文件是知识的唯一权威，面板只是它的投影。
- **导航状态机在代码里**：`advance / pushReview / popLayer / resumeMain / pushQuestion` 是纯函数，模型只能请求转换（M2 起经 `learning_control`，M3 起面板经 `learn` 命令走同一套函数），判定权不在模型。
- **浏览不改主线**：点击目录/Peek 只移动焦点指示，只有「下一步」推进游标。
- **面板不写文件**：Client 只读工作区（`remote.workspaceFiles`），所有写操作经 `remote.commands.execute('/learn …')` 回到 Host 控制器；通道不可用时面板明确降级为本地记录，而不是猜测 Host 状态。
- **一次调用可审计**：提问的上下文由 Host 组装成 `state/pending/Qxxx.md`（含预算明细），subagent 只读该文件——主线上下文不因提问而变长。
