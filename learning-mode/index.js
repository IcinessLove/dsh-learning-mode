/**
 * Learning Mode — Host half (M2 mainline + M3 ask detour).
 *
 * Registers:
 *   1. a system-prompt section with the learning-mode protocol, so the agent
 *      teaches from the knowledge base one step at a time instead of dumping a
 *      whole derivation, and answers breakpoint questions in a clean subagent;
 *   2. the `learning_control` tool, the only sanctioned way to move the mainline
 *      cursor, enter a review/question frame, return, resume, change a step's
 *      status, or write a question/answer back into the knowledge base.
 *
 * The deterministic part lives in `./lib/core.js`: the tool never lets the model
 * touch `state/learning-state.json` by hand, question branches are opened and
 * committed in code (optimistic lock + atomic write), and the ContextPackage that
 * a subagent reads is assembled and budgeted by code.
 *
 * M3 adds the panel channel: the `learn` slash command is the one host-side entry
 * point the Client panel calls (`remote.commands.execute`), and it wakes the tutor
 * with `agent.followup` for the actions that need new prose (next / back / goto /
 * ask). "One operation, two callers" (v0.2 §3): the same state machine answers the
 * agent tool and the panel button.
 *
 * The Client panel (./client.js) only reads the files this half writes.
 */
import { defineTool } from './lib/define-tool.js';
import { logEvent } from './lib/log.js';
import * as core from './lib/core.js';

export const name = 'learning-mode';
export const inject = ['tools'];

/** Actions that must produce new teaching prose, i.e. that wake the agent. */
const WAKE_ACTIONS = new Set(['next', 'back', 'goto', 'ask', 'answer_detail', 'ingest_request']);

const PROTOCOL = `[学习模式]
当会话工作目录下存在 learning/<topic>/ 知识库时，你处于学习模式，按下面的协议工作。

知识库结构：
- learning/<topic>/index.md：路线总览（MOC）
- learning/<topic>/steps/S01-*.md：一个步骤一个文件。**模板必须遵守**：
  · frontmatter：id（S01）/ title / type（definition|assumption|derivation|result）/ depends_on（["S01"]）/ status（未读|在读|存疑|已懂）/ source_refs（["DOC-x#p12"]）/ content_status（draft|reviewed）/ revision（1）
  · 正文四节：## 结论 / ## 推导 / ## 直觉 / ## 标注
  · 公式：块级用 $$ … $$，行内用 $…$；**每个关键公式的上一行放独立锚点** \`<a id="S07-EQ-01"></a>\`（面板靠它生成 👁 Peek / ⁉ 提问断点）。不要用缩进纯文本写公式，也不要把锚点塞在句子中间。
  · 公式一律写 **LaTeX**：\`\\partial\`、\`\\hat{H}\`、\`\\hbar\`、\`\\int_{t_0}^{t}\`、\`\\chi^{(3)}\`。**不要**用 Unicode 记号（∂、ρ̂、ħ、₀）或裸 \`_\`/\`^\` 写公式——那样下划线与上下标只能尽力渲染，字体也不对。
- learning/<topic>/questions/Qxxx-*.md：一次断点提问的完整记录（由代码写入）
- learning/<topic>/state/learning-state.json：主线游标、焦点与导航栈，由 learning_control 维护，不要手改
- learning/<topic>/state/pending/Qxxx.md：某次提问的上下文包（唯一允许 subagent 读取的材料）

规则：
1. 开始讲解前先调用 learning_control({action:"status"}) 取当前位置与 step_path；只读该步骤文件，必要时再读它 depends_on 指向的文件。不要一次加载整个主题或整篇文献。
2. 一次只讲一步：本步目标、必要公式、变换理由、成立条件、与下一步的衔接。讲完停下等用户确认；不要连续输出后续步骤，也不要重述前文来制造连贯感。
3. 用户说「继续 / 下一步」时，调用 learning_control({action:"next"})，然后只讲返回的 step_path 指的那一步。在问题分支里 next 会被拒绝——先 return 或 resume。
4. 断点提问（用户在聊天里就某个锚点提问）：
   a. 调 learning_control({action:"ask", anchor_id:"<锚点>", question:"<原话>", request_id:"<可选稳定 id>"})；
   b. 拿返回的 pending_path，用 subagent 工具作答：subagent 的 prompt 只含该包文件路径与问题本身，不要携带会话历史、不要粘贴对话；
   c. 拿到答案后调 learning_control({action:"answer", branch_id:"<分支号>", answer:"<答案>", source_refs:[...]}) 写回；
   d. 主线只回 ≤3 行摘要 + 分支号，不要复述整段答案。
   e. **默认给简短回答**：2–4 句结论 + 必要公式（≤200 字）；完整推导链条留到用户点「详细回答」时再展开。
   f. 收到 [LEARN-ASK-DETAIL] 时：在简短回答的基础上补充完整推导链条、每步依据、成立条件与边界、必要出处，然后调 learning_control({action:"answer", branch_id:"<分支号>", mode:"detail", answer:"<详细答案>"}) 写回（代码会以「详细」标注追加，不覆盖简短版）；主线仍只回 ≤3 行。
   若收到 [LEARN-ASK] 开头的注入指令，按 b–d 执行，不要重新建分支。
5. 一切游标、回学、返回、回主线、提问分支与步骤状态的变更，只能通过 learning_control 发起；它由代码判定，可能拒绝。不要直接编辑 state/learning-state.json，也不要手改步骤文件的标注区。
6. 引用结论或公式时带上锚点 ID；无法核对的推导保持草稿状态并说明。
7. 侧边栏「学习模式」面板与聊天共用同一套状态机：面板按钮会让 Host 以 [LEARN-NEXT] / [LEARN-REVIEW] / [LEARN-GOTO] / [LEARN-ASK] / [LEARN-ASK-DETAIL] / [LEARN-INGEST] 开头的消息唤醒你。收到这类消息时按对应规则继续，不要重复建分支、不要回问面板点没点。**注意**：面板里点击/滚动/标记阅读位置都不会唤醒你——只有明确的按钮（下一步、回学、提问、详细回答、导入）才会。
8. 文献导入（用户把文献/题目交给你时，无论他在聊天里给路径还是从面板「导入文献」提交）：先只输出**步骤 DAG 草案**（编号、标题、一句话、depends_on、出处页码）等用户确认，不要直接落盘；确认后写 learning/<topic>/steps/*.md、index.md 与 sources/，再调用 learning_control({action:"ingest_commit", topic:"<topic>"})，由代码校验 id、建立索引并把主线放到第一步。收到 [LEARN-INGEST] 时按本条执行。`;

const PARAMETERS = {
  action: {
    type: 'string',
    required: true,
    enum: ['status', 'next', 'back', 'return', 'resume', 'goto', 'set_status', 'ask', 'answer', 'branches', 'ingest_commit', 'answer_detail', 'ingest_request'],
    description: 'status(读当前位置) | next(推进主线；回学中则推进回学；问题分支中会被拒绝) | back(压入回学帧，可选 step_id) | return(弹出一层) | resume(回主线并清栈) | goto(显式重设主线，需 step_id) | set_status(改步骤状态，需 step_id 与 status) | ask(开一个断点提问分支，需 question，建议 anchor_id 与 request_id) | answer(把答案写回步骤标注区与 questions/，需 branch_id 与 answer；mode:"detail" 表示详细版，只追加「详细」标注) | answer_detail(用户点「详细回答」：把某分支展开为详细版，需 branch_id) | branches(列出问题分支) | ingest_commit(文献导入落盘后建立索引并把主线置于第一步，需 topic；可选 step_id 作起点，步骤文件必须带唯一 id) | ingest_request(用户从面板提交文献路径：唤醒 agent 按协议第 8 条先出 DAG 草案，需 path)',
  },
  topic: {
    type: 'string',
    description: '主题目录名（learning/<topic>）。省略时取 state 文件最新的主题。',
  },
  step_id: {
    type: 'string',
    description: '步骤 ID（如 S02），用于 back / goto / set_status；ask 时可指定问题所属步骤。',
  },
  status: {
    type: 'string',
    enum: [...core.STATUSES],
    description: `步骤状态：${core.STATUSES.join(' / ')}，仅 set_status 使用。`,
  },
  anchor_id: {
    type: 'string',
    description: '锚点 ID（如 S02-EQ-01）。ask 时用它定位提问的公式/小节；其他动作可记录当前关注点。',
  },
  question: {
    type: 'string',
    description: 'ask 使用：用户的原话问题。',
  },
  request_id: {
    type: 'string',
    description: 'ask 使用：稳定请求 id。重放（超时重试、重复点击）不会重复建分支。',
  },
  parent_branch: {
    type: 'string',
    description: 'ask 使用：父分支号（如 Q001），表示这是分支内的追问；顶层提问省略。',
  },
  branch_id: {
    type: 'string',
    description: 'answer 使用：要写回的问题分支号（如 Q003）。省略时取当前焦点分支。',
  },
  answer: {
    type: 'string',
    description: 'answer 使用：答案正文（Markdown）。由代码写入步骤标注区与 questions/ 文件。',
  },
  mode: {
    type: 'string',
    enum: ['short', 'detail'],
    description: 'answer 使用：short（默认，简短回答，写回 questions/ 与标注区）或 detail（详细版，只追加「详细」标注，不覆盖简短版）。',
  },
  path: {
    type: 'string',
    description: 'ingest_request 使用：用户提交的学习材料路径（PDF/Markdown 的绝对路径）。',
  },
  source_refs: {
    type: 'array',
    items: { type: 'string' },
    description: 'answer 使用：答案的出处列表（如 ["DOC-001#p7"]）。',
  },
  expected_state_version: {
    type: 'integer',
    description: '可选乐观锁：只有状态文件仍是该版本时才提交；不匹配则本次动作不生效。',
  },
};

const BRANCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    status: { type: 'string', required: true },
    step_id: { type: 'string', required: true },
    anchor_id: { type: 'string', required: true },
    question: { type: 'string', required: true },
  },
};

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true },
    topic: { type: 'string', required: true },
    position: { type: 'string', required: true },
    cursor: { type: 'string', required: true },
    cursor_title: { type: 'string', required: true },
    step_path: { type: 'string', required: true },
    focus: { type: 'string', required: true },
    focus_path: { type: 'string', required: true },
    stack_depth: { type: 'integer', required: true },
    state_version: { type: 'integer', required: true },
    branch_id: { type: 'string', required: true },
    branch_status: { type: 'string', required: true },
    question_path: { type: 'string', required: true },
    pending_path: { type: 'string', required: true },
    rejected: { type: 'boolean', required: true },
    reused: { type: 'boolean', required: true },
    message: { type: 'string', required: true },
    steps: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      },
    },
    open_branches: { type: 'array', required: true, items: BRANCH_SCHEMA },
  },
};

function rejectedResult(state, steps, topic, action, message, extra = {}) {
  const summary = core.summarize(state, steps, topic, { ...extra, rejected: true });
  return { ...summary, action, message };
}

/**
 * The whole state machine, independent of who called it (agent tool or panel).
 * Throws only for malformed input; refusals come back as `rejected: true`.
 */
export async function runLearningAction(args, cwd) {
  const resolved = await core.resolveTopic(cwd, args.topic);
  if (resolved.topic === null) throw new Error(resolved.reason);
  const topic = resolved.topic;

  let steps = await core.listSteps(cwd, topic);
  if (steps.length === 0) {
    throw new Error(`主题 ${topic} 下没有步骤文件（${core.KB_DIR}/${topic}/${core.STEPS_DIR}/*.md）`);
  }

  const read = await core.readState(cwd, topic);
  let state = read.exists ? read.state : core.initialState(topic, steps);
  let extra = {};
  let pendingArtifacts = null;
  let answerArtifacts = null;

  switch (args.action) {
    case 'status':
      break;
    case 'ingest_commit': {
      /* Ingestion commit: the agent has already written the step files (plus
       * index.md / sources/) after the learner approved the DAG draft. This action
       * is the code-owned part — it validates the ids, normalises the state file
       * and puts the mainline on the entry step. */
      const ids = steps.map((step) => step.id);
      const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
      if (duplicates.length > 0) {
        throw new Error(`步骤 id 重复：${duplicates.join('、')}；每个步骤文件 frontmatter 的 id 必须唯一`);
      }
      const placeholder = steps.filter((step) => step.id === step.file.replace(/\.md$/i, ''));
      if (placeholder.length > 0) {
        throw new Error(`这些步骤文件缺少 frontmatter id：${placeholder.map((step) => step.file).join('、')}`);
      }
      const startId = typeof args.step_id === 'string' && args.step_id.length > 0
        ? args.step_id
        : (read.exists ? state.main_cursor.step_id : steps[0].id);
      state = core.gotoStep(read.exists ? state : core.initialState(topic, steps), steps, startId ?? steps[0].id);
      extra = {
        step_count: steps.length,
        without_anchors: await core.stepsWithoutAnchors(cwd, topic, steps),
        plain_math: await core.stepsWithPlainMath(cwd, topic, steps),
      };
      break;
    }
    case 'next': {
      const frame = core.topFrame(state);
      if (frame?.kind === 'question') {
        const branchId = core.focusedBranch(state)?.id ?? '';
        return rejectedResult(state, steps, topic, args.action,
          `当前在问题分支 ${branchId} 里，next 不会推进主线。请先 learning_control({action:"return"}) 回上一层，或 {action:"resume"} 回主线。`,
          { pending_path: core.pendingRelPath(topic, branchId) });
      }
      state = core.advance(state, steps);
      break;
    }
    case 'back':
      state = core.pushReview(state, steps, args.step_id);
      break;
    case 'return':
      state = core.popLayer(state);
      break;
    case 'resume':
      state = core.resumeMain(state);
      break;
    case 'goto':
      if (typeof args.step_id !== 'string' || args.step_id.length === 0) {
        throw new Error('goto 需要 step_id');
      }
      state = core.gotoStep(state, steps, args.step_id);
      break;
    case 'set_status': {
      const target = typeof args.step_id === 'string' && args.step_id.length > 0 ? args.step_id : state.main_cursor.step_id;
      if (typeof target !== 'string' || target.length === 0) throw new Error('set_status 需要 step_id');
      const status = args.status ?? '已懂';
      const updated = await core.setStepStatus(cwd, topic, target, status);
      extra = { step_id: updated.id, status: updated.status };
      steps = await core.listSteps(cwd, topic);
      break;
    }
    case 'ask': {
      const opened = await core.openBranch(cwd, topic, state, steps, {
        anchorId: typeof args.anchor_id === 'string' && args.anchor_id.length > 0 ? args.anchor_id : null,
        question: args.question,
        requestId: typeof args.request_id === 'string' && args.request_id.length > 0 ? args.request_id : null,
        parent: typeof args.parent_branch === 'string' && args.parent_branch.length > 0 ? args.parent_branch : null,
        stepId: typeof args.step_id === 'string' && args.step_id.length > 0 ? args.step_id : null,
      });
      state = opened.state;
      extra = {
        branch_id: opened.branch.id,
        anchor_id: opened.branch.anchor_id ?? '',
        step_id: opened.branch.step_id ?? '',
        question_path: opened.questionRelPath,
        pending_path: opened.pendingPath,
        reused: opened.reused,
      };
      if (opened.reused) extra.skipCommit = true;
      else pendingArtifacts = opened;
      break;
    }
    case 'answer': {
      const text = typeof args.answer === 'string' ? args.answer.trim() : '';
      if (text.length === 0) throw new Error('answer 需要 answer 文本');
      const sourceRefs = Array.isArray(args.source_refs) ? args.source_refs.filter((item) => typeof item === 'string') : [];
      const mode = args.mode === 'detail' ? 'detail' : 'short';
      const resolvedAnswer = core.resolveAnswer(state, steps, typeof args.branch_id === 'string' && args.branch_id.length > 0 ? args.branch_id : null);
      state = resolvedAnswer.state;
      extra = { branch_id: resolvedAnswer.branch.id, step_id: resolvedAnswer.step.id, question_path: '', mode };
      answerArtifacts = { ...resolvedAnswer, text, sourceRefs, mode };
      break;
    }
    case 'answer_detail': {
      /* Wake-only: the agent expands an existing branch; no state transition and no
       * new branch — the learner asks for depth, not for a new detour. */
      const branchId = typeof args.branch_id === 'string' && args.branch_id.length > 0
        ? args.branch_id
        : (core.focusedBranch(state)?.id ?? '');
      if (branchId.length === 0) throw new Error('answer_detail 需要 branch_id');
      const branch = state.branches[branchId];
      if (branch === undefined) throw new Error(`未知问题分支 ${branchId}`);
      extra = {
        branch_id: branchId,
        step_id: branch.step_id ?? '',
        anchor_id: branch.anchor_id ?? '',
        pending_path: core.pendingRelPath(topic, branchId),
        skipCommit: true,
      };
      break;
    }
    case 'ingest_request': {
      /* Wake-only: the learner hands over a document from the panel; the agent runs
       * protocol rule 8 (draft DAG → user confirms → write files → ingest_commit). */
      const path = typeof args.path === 'string' ? args.path.trim() : '';
      if (path.length === 0) throw new Error('ingest_request 需要 path');
      extra = { path, skipCommit: true };
      break;
    }
    case 'branches':
      extra = { skipCommit: true };
      break;
    default:
      throw new Error(`未知 action ${JSON.stringify(args.action)}`);
  }

  if (typeof args.anchor_id === 'string' && args.anchor_id.length > 0 && args.action !== 'ask' && args.action !== 'answer') {
    state = { ...state, main_cursor: { ...state.main_cursor, anchor_id: args.anchor_id } };
  }

  /* Commit first, write knowledge-base files second (v0.2 §2.3): a version
   * conflict or a crash can never leave a question file without its state entry. */
  let committed = state;
  const shouldCommit = extra.skipCommit !== true;
  if (shouldCommit) {
    if (Number.isInteger(args.expected_state_version)) {
      const guarded = await core.writeStateIfVersion(cwd, topic, state, args.expected_state_version);
      if (!guarded.ok) {
        const currentSteps = await core.listSteps(cwd, topic);
        const current = guarded.current ?? state;
        return rejectedResult(current, currentSteps, topic, args.action,
          `状态版本冲突：期望 state_version ${args.expected_state_version}，实际 ${guarded.currentVersion}。本次 ${args.action} 未生效，请重新读取状态后再试。`,
          { question_path: extra.question_path ?? '', pending_path: extra.pending_path ?? '' });
      }
      committed = guarded.state;
    } else {
      committed = await core.writeState(cwd, topic, state);
    }
  }

  if (pendingArtifacts !== null) {
    const written = await core.writeBranchArtifacts(cwd, topic, { branch: pendingArtifacts.branch, step: pendingArtifacts.step });
    const contextPackage = await core.buildContextPackage(cwd, topic, {
      branchId: pendingArtifacts.branch.id,
      step: pendingArtifacts.step,
      anchorId: pendingArtifacts.branch.anchor_id,
      question: pendingArtifacts.branch.question,
      steps,
      stateVersion: committed.state_version,
    });
    extra = {
      ...extra,
      question_path: written.questionRelPath,
      pending_path: contextPackage.relPath,
      package_tokens: contextPackage.tokens,
    };
  }

  if (answerArtifacts !== null) {
    const written = await core.writeAnswerArtifacts(cwd, topic, {
      branch: answerArtifacts.branch,
      step: answerArtifacts.step,
      text: answerArtifacts.text,
      sourceRefs: answerArtifacts.sourceRefs,
      mode: answerArtifacts.mode,
    });
    extra = { ...extra, question_path: written.questionRelPath ?? '' };
  }

  const summary = core.summarize(committed, steps, topic, {
    question_path: extra.question_path ?? '',
    pending_path: extra.pending_path ?? '',
    reused: extra.reused === true,
  });
  return { ...summary, action: args.action, message: core.actionMessage(args.action, summary, extra) };
}

/* ------------------------------------------------------------------ *
 * Panel channel: the `learn` command (v0.2 §3 "one operation, two callers")
 * ------------------------------------------------------------------ */

/** The panel/chat payload is JSON so one command can carry every action. */
export function parseLearnPayload(rawInput) {
  const text = String(rawInput ?? '').trim();
  if (text.length === 0) throw new Error('需要 JSON 载荷，例如 {"action":"next"}');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`载荷不是合法 JSON（${error.message}）`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('载荷必须是 JSON 对象');
  if (typeof parsed.action !== 'string' || parsed.action.length === 0) throw new Error('载荷必须含 action 字段');
  return parsed;
}

/**
 * Build the inbox message `agent.followup` expects. The canonical helper lives in
 * `@deepseek-ai/dsh-llm`; it is used when resolvable, otherwise the identical plain
 * shape (role/content/source) is built here so the panel channel keeps working.
 */
async function buildFollowupMessage(text) {
  const content = [{ type: 'text', text }];
  try {
    const llm = await import('@deepseek-ai/dsh-llm');
    if (typeof llm?.createUserMessage === 'function') {
      return llm.createUserMessage({ content, source: { kind: 'user' } });
    }
  } catch (error) {
    /* fall through to the plain shape */
  }
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    role: 'user',
    content,
    source: { kind: 'user' },
  };
}

/**
 * Wake the tutor for one panel/command action.
 *
 * `agent.followup(input)` is `send(input, 'next-turn', true)` in the loop: the
 * message is spliced into the Session inbox and the driver is woken, but a Session
 * that is already mid-turn only admits it at the next turn boundary. The status is
 * reported so the panel can say which of the two happened instead of just waiting.
 *
 * @returns `'sent'` (idle target), `'queued'` (busy target, delivered next turn),
 *   or `'unavailable'` when the agent cannot be woken at all.
 */
export async function wakeAgent(agent, text) {
  if (agent === null || agent === undefined || typeof agent.followup !== 'function') return 'unavailable';
  const busy = agent.status === 'running';
  try {
    agent.followup(await buildFollowupMessage(text));
    return busy ? 'queued' : 'sent';
  } catch (error) {
    return 'unavailable';
  }
}

/** One-line receipt the panel shows for a panel-driven action. */
export function receiptText(result, woken) {
  const branch = result.branch_id.length > 0 ? `｜分支 ${result.branch_id}（${result.branch_status}）` : '';
  const wake = result.reused === true
    ? '｜请求重放，未重复唤醒'
    : (woken === null || woken === undefined
      ? ''
      : (woken === 'sent'
        ? '｜已唤醒 agent 作答'
        : (woken === 'queued'
          ? '｜已排入当前会话的下一轮（该会话正忙，回答会在其当前回合结束后开始）'
          : '｜未能唤醒 agent，请在聊天里发任一消息继续')));
  return `学习模式：位置 ${result.cursor} ${result.position}，焦点 ${result.focus}，栈深 ${result.stack_depth}${branch}${wake}`;
}

export function apply(ctx) {
  void logEvent('apply.start', {
    hasTools: typeof ctx.get === 'function' ? ctx.get('tools') !== undefined : null,
    hasSystemPrompt: typeof ctx.get === 'function' ? ctx.get('systemPrompt') !== undefined : null,
  });

  /* Optional service: attach the protocol when the prompt registry is present,
   * instead of gating the whole plugin (and its tool) on it. */
  ctx.inject(['systemPrompt'], (promptCtx) => {
    try {
      promptCtx.systemPrompt.section({ name: 'learning-mode:protocol', order: 1500, text: PROTOCOL });
      void logEvent('prompt.section.registered', { order: 1500 });
    } catch (error) {
      void logEvent('prompt.section.failed', { message: String(error?.message ?? error) });
    }
  });

  const tool = defineTool({
    name: 'learning_control',
    description: '学习模式控制器：读取或推进 learning/<topic>/ 的结构化学习路线，开断点提问分支并把答案写回知识库。游标、导航栈与问答落盘都由代码维护；一切位置与状态变更都必须经由此工具，不要手改 state/learning-state.json 或步骤文件的标注区。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const agent = exec?.agent;
      if (agent === undefined || agent === null) throw new Error('learning_control 需要一个 agent 会话');
      const cwd = agent.session?.header?.cwd;
      if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('无法解析会话工作目录（cwd）');
      return runLearningAction(args, cwd);
    },
  });

  try {
    ctx.tools.register(tool);
    void logEvent('tool.registered', { name: tool.name });
  } catch (error) {
    void logEvent('tool.register.failed', { message: String(error?.message ?? error) });
    throw error;
  }

  /* Client panel entry point: `remote.commands.execute(sessionId, '/learn {json}')`.
   * Nested injection keeps the plugin alive on a composition without `commands`. */
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.effect(() => {
      try {
        return commandCtx.commands.register({
          name: 'learn',
          description: '学习模式：推进主线 / 回学 / 返回 / 回主线 / 开断点提问分支（侧边栏面板与聊天共用，载荷为 JSON）',
          input: { hint: '{"action":"next"}' },
          async handler(invocation) {
            let payload;
            try {
              payload = parseLearnPayload(invocation.rawInput);
            } catch (error) {
              return { kind: 'error', text: `learn：${error.message}` };
            }
            const agent = invocation.agent;
            const cwd = agent?.session?.header?.cwd;
            if (typeof cwd !== 'string' || cwd.length === 0) {
              return { kind: 'error', text: 'learn：无法解析会话工作目录（cwd）' };
            }
            try {
              const result = await runLearningAction(payload, cwd);
              if (result.rejected === true) return { kind: 'error', text: result.message };
              const injection = core.injectionText(result.action, result.message);
              /* A replayed request must not re-ask the same question: the branch is
               * already open with its ContextPackage, so no second wake-up. */
              let woken = null;
              if (injection !== null && result.reused !== true) woken = await wakeAgent(agent, injection);
              return { kind: 'success', text: receiptText(result, woken) };
            } catch (error) {
              return { kind: 'error', text: `learn：${error?.message ?? String(error)}` };
            }
          },
        });
      } catch (error) {
        /* A name clash must not take the whole panel down: the buttons degrade to
         * panel-local mode and report the missing channel. */
        commandCtx.logger?.warn?.(`learning-mode: learn 命令注册失败（可能重名）：${String(error?.message ?? error)}`);
        return () => {};
      }
    }, 'learning-mode: learn command');
  });
}
