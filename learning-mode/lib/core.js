/**
 * Learning Mode — pure core (no DSH runtime imports).
 *
 * Owns everything that must not depend on the model's judgement:
 *   - the `learning/<topic>/` knowledge-base layout (topic resolution, step listing);
 *   - the authoritative navigation state (`state/learning-state.json`, atomic writes);
 *   - the navigation state machine (advance / review frames / return / resume / goto);
 *   - code-owned step status rewrites in step frontmatter;
 *   - question branches (ask): frame push, ContextPackage assembly, callout and
 *     `questions/*.md` write-back, deferred marking, request-id idempotency.
 *
 * `index.js` wraps this in the `learning_control` agent tool; the Client panel only
 * reads the state file. Keeping this module dependency-free lets it be unit-tested
 * outside the Harness.
 */
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const KB_DIR = 'learning';
export const STEPS_DIR = 'steps';
export const STATE_DIR = 'state';
export const STATE_FILE = 'learning-state.json';
export const QUESTIONS_DIR = 'questions';
export const PENDING_DIR = 'pending';
export const SCHEMA_VERSION = 1;

/** ContextPackage budget (v0.2 §4.3): the ask detour must stay small by construction. */
export const PACKAGE_BUDGET_TOKENS = 6000;

/** Step statuses are soft labels the learner (or the agent on their behalf) sets. */
export const STATUSES = ['未读', '在读', '存疑', '已懂'];

/* ------------------------------------------------------------------ *
 * Frontmatter / step listing
 * ------------------------------------------------------------------ */

/** Numeric ordinal used to order `S01-*.md` style step files. */
export function ordinal(name) {
  const match = /(\d+)/.exec(String(name ?? ''));
  return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Minimal YAML subset parser: scalars, quoted strings, inline arrays, booleans, null. */
export function parseFrontmatter(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== '---') return { fm: {}, endLine: -1 };
  const endLine = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endLine < 0) return { fm: {}, endLine: -1 };
  const fm = {};
  for (let i = 1; i < endLine; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0 || line.trim().startsWith('#')) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (match === null) continue;
    const raw = match[2].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      fm[match[1]] = raw.slice(1, -1).split(',').map(stripQuotes).filter((part) => part.length > 0);
    } else if (raw === 'null' || raw === '~') {
      fm[match[1]] = null;
    } else if (raw === 'true') {
      fm[match[1]] = true;
    } else if (raw === 'false') {
      fm[match[1]] = false;
    } else {
      fm[match[1]] = stripQuotes(raw);
    }
  }
  return { fm, endLine };
}

/** List the topics that actually hold a `state/` directory. */
export async function listTopics(cwd) {
  const root = join(cwd, KB_DIR);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

/** Steps of one topic, ordered by file ordinal. */
export async function listSteps(cwd, topic) {
  const dir = join(cwd, KB_DIR, topic, STEPS_DIR);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    return [];
  }
  const files = entries
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => ordinal(left) - ordinal(right));
  const steps = [];
  for (const file of files) {
    let text = '';
    try {
      text = await readFile(join(dir, file), 'utf8');
    } catch (error) {
      continue;
    }
    const { fm } = parseFrontmatter(text);
    steps.push({
      id: typeof fm.id === 'string' && fm.id.length > 0 ? fm.id : file.replace(/\.md$/i, ''),
      title: typeof fm.title === 'string' ? fm.title : file,
      status: typeof fm.status === 'string' ? fm.status : '未读',
      type: typeof fm.type === 'string' ? fm.type : 'derivation',
      file,
      relPath: [KB_DIR, topic, STEPS_DIR, file].join('/'),
    });
  }
  return steps;
}

/** One step by id (or undefined). */
export function findStep(steps, stepId) {
  return steps.find((step) => step.id === stepId);
}

export function stepIds(steps) {
  return steps.map((step) => step.id);
}

/* ------------------------------------------------------------------ *
 * State file
 * ------------------------------------------------------------------ */

export function statePath(cwd, topic) {
  return join(cwd, KB_DIR, topic, STATE_DIR, STATE_FILE);
}

export function initialState(topic, steps) {
  return {
    schema_version: SCHEMA_VERSION,
    topic,
    state_version: 1,
    updated_at: new Date().toISOString(),
    main_cursor: { step_id: steps[0]?.id ?? null, anchor_id: null, reveal_level: 'step' },
    focus: { kind: 'main' },
    navigation_stack: [],
    review_cursor: null,
    branches: {},
  };
}

/** Read the authoritative state; `exists: false` when the topic has none yet. */
export async function readState(cwd, topic) {
  try {
    const text = await readFile(statePath(cwd, topic), 'utf8');
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return { exists: false };
    return { exists: true, state: normalize(parsed, topic) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false };
    throw new Error(`learning-state.json 无法解析：${error.message}`);
  }
}

function normalize(state, topic) {
  const focus = state.focus !== null && typeof state.focus === 'object' && typeof state.focus.kind === 'string'
    ? state.focus
    : { kind: 'main' };
  return {
    schema_version: SCHEMA_VERSION,
    topic,
    state_version: Number.isInteger(state.state_version) ? state.state_version : 1,
    updated_at: typeof state.updated_at === 'string' ? state.updated_at : new Date().toISOString(),
    main_cursor: state.main_cursor !== null && typeof state.main_cursor === 'object'
      ? {
          step_id: typeof state.main_cursor.step_id === 'string' ? state.main_cursor.step_id : null,
          anchor_id: typeof state.main_cursor.anchor_id === 'string' ? state.main_cursor.anchor_id : null,
          reveal_level: typeof state.main_cursor.reveal_level === 'string' ? state.main_cursor.reveal_level : 'step',
        }
      : { step_id: null, anchor_id: null, reveal_level: 'step' },
    focus,
    navigation_stack: Array.isArray(state.navigation_stack) ? state.navigation_stack : [],
    review_cursor: typeof state.review_cursor === 'string' ? state.review_cursor : null,
    branches: state.branches !== null && typeof state.branches === 'object' && !Array.isArray(state.branches)
      ? state.branches
      : {},
  };
}

/** Atomic write: temp file then rename, so a crash never leaves a half state file. */
export async function writeState(cwd, topic, state, { bump = true } = {}) {
  const target = statePath(cwd, topic);
  await mkdir(join(cwd, KB_DIR, topic, STATE_DIR), { recursive: true });
  const next = {
    ...state,
    schema_version: SCHEMA_VERSION,
    topic,
    state_version: (Number.isInteger(state.state_version) ? state.state_version : 0) + (bump ? 1 : 0),
    updated_at: new Date().toISOString(),
  };
  const temp = `${target}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(temp, target);
  return next;
}

/**
 * Optimistic lock (v0.2 §2.3): commit only if the file version still matches the
 * version the caller read. A conflict returns `{ ok: false }` instead of writing,
 * so a late/duplicate request can never clobber a newer cursor.
 */
export async function writeStateIfVersion(cwd, topic, state, expectedVersion) {
  const current = await readState(cwd, topic);
  const currentVersion = current.exists ? current.state.state_version : 0;
  if (Number.isInteger(expectedVersion) && expectedVersion !== currentVersion) {
    return { ok: false, conflict: true, currentVersion, current: current.exists ? current.state : null };
  }
  const written = await writeState(cwd, topic, state);
  return { ok: true, conflict: false, state: written, currentVersion };
}

/* ------------------------------------------------------------------ *
 * Navigation state machine (v0.2 §4.6)
 * ------------------------------------------------------------------ */

function indexOfStep(steps, stepId) {
  const ids = stepIds(steps);
  const index = ids.indexOf(stepId);
  return index < 0 ? 0 : index;
}

/** Peek is a UI overlay and never touches the state file. */
export function advance(state, steps) {
  const ids = stepIds(steps);
  if (ids.length === 0) return state;
  /* A question branch is a detour: the learner is on it, so neither the mainline
   * nor a review cursor may move. The caller surfaces the rejection. */
  if (topFrame(state)?.kind === 'question') return state;
  if (state.navigation_stack.length > 0) {
    const from = state.review_cursor ?? state.main_cursor.step_id ?? ids[0];
    const next = ids[Math.min(indexOfStep(steps, from) + 1, ids.length - 1)];
    return { ...state, review_cursor: next };
  }
  const next = ids[Math.min(indexOfStep(steps, state.main_cursor.step_id) + 1, ids.length - 1)];
  return { ...state, main_cursor: { ...state.main_cursor, step_id: next, anchor_id: null } };
}

export function pushReview(state, steps, stepId) {
  const target = stepId ?? state.main_cursor.step_id ?? stepIds(steps)[0] ?? null;
  if (target === null) return state;
  const frame = {
    frame_id: nextFrameId(state),
    kind: 'review',
    target_id: target,
    return_focus: state.focus,
  };
  return {
    ...state,
    navigation_stack: [...state.navigation_stack, frame],
    focus: { kind: 'review', target_id: target },
    review_cursor: target,
  };
}

export function popLayer(state) {
  if (state.navigation_stack.length === 0) return { ...state, focus: { kind: 'main' } };
  const frame = state.navigation_stack[state.navigation_stack.length - 1];
  const focus = frame.return_focus !== null && typeof frame.return_focus === 'object' ? frame.return_focus : { kind: 'main' };
  const navigation_stack = state.navigation_stack.slice(0, -1);
  /* Leaving an unanswered question defers it; a resolved branch keeps its status. */
  const branches = frame.kind === 'question' && typeof frame.target_id === 'string'
    ? deferBranch(state.branches, frame.target_id)
    : state.branches;
  return {
    ...state,
    navigation_stack,
    focus,
    review_cursor: focus.kind === 'review' ? (focus.target_id ?? null) : null,
    branches,
  };
}

export function resumeMain(state) {
  let branches = state.branches ?? {};
  for (const id of Object.keys(branches)) branches = deferBranch(branches, id);
  return { ...state, navigation_stack: [], focus: { kind: 'main' }, review_cursor: null, branches };
}

export function gotoStep(state, steps, stepId) {
  if (findStep(steps, stepId) === undefined) throw new Error(`未知步骤 "${stepId}"`);
  return {
    ...state,
    main_cursor: { ...state.main_cursor, step_id: stepId, anchor_id: null },
    navigation_stack: [],
    focus: { kind: 'main' },
    review_cursor: null,
  };
}

/** The step the learner is actually looking at (branch > review > mainline). */
export function focusStepId(state) {
  if (state.focus.kind === 'branch') {
    const branch = state.branches?.[state.focus.branch_id];
    if (branch !== null && branch !== undefined && typeof branch.step_id === 'string') return branch.step_id;
  }
  if (state.focus.kind === 'review') return state.review_cursor ?? state.main_cursor.step_id;
  return state.main_cursor.step_id;
}

/* ------------------------------------------------------------------ *
 * Question branches (v0.2 §4.3) — the ask detour
 * ------------------------------------------------------------------ */

export function topFrame(state) {
  const stack = Array.isArray(state.navigation_stack) ? state.navigation_stack : [];
  return stack.length === 0 ? null : stack[stack.length - 1];
}

function nextFrameId(state) {
  const n = (state.navigation_stack?.length ?? 0) + 1;
  return `F${String(n).padStart(3, '0')}-${Date.now().toString(36)}`;
}

/** The branch the focus points at, or null. */
export function focusedBranch(state) {
  const id = state.focus?.kind === 'branch' ? state.focus.branch_id : null;
  if (typeof id !== 'string' || id.length === 0) return null;
  const branch = state.branches?.[id];
  if (branch === null || branch === undefined) return null;
  return { ...branch, id: branch.id ?? id };
}

export function findBranch(state, branchId) {
  const branch = state.branches?.[branchId];
  if (branch === null || branch === undefined) return null;
  return { ...branch, id: branch.id ?? branchId };
}

/** Request-id idempotency: a retried ask must not open a second branch. */
export function branchByRequestId(state, requestId) {
  if (typeof requestId !== 'string' || requestId.length === 0) return null;
  for (const [id, branch] of Object.entries(state.branches ?? {})) {
    if (branch?.request_id === requestId) return { ...branch, id: branch.id ?? id };
  }
  return null;
}

/** Next free Qxxx id: max numeric suffix over known branches and question files, +1. */
export function nextBranchId(state, existingFiles = []) {
  let max = 0;
  const scan = (value) => {
    const match = /^Q(\d+)/.exec(String(value ?? ''));
    if (match !== null) max = Math.max(max, Number(match[1]));
  };
  for (const id of Object.keys(state.branches ?? {})) scan(id);
  for (const name of existingFiles) scan(name);
  return `Q${String(max + 1).padStart(3, '0')}`;
}

/** Leaving an unanswered question defers it; resolved questions are untouched. */
export function deferBranch(branches, branchId) {
  const current = branches?.[branchId];
  if (current === null || current === undefined) return branches ?? {};
  if (current.status !== 'open') return branches;
  return { ...branches, [branchId]: { ...current, status: 'deferred' } };
}

export function resolveBranch(state, branchId) {
  const branch = state.branches?.[branchId];
  if (branch === null || branch === undefined) throw new Error(`未知问题分支 "${branchId}"`);
  return {
    ...state,
    branches: {
      ...state.branches,
      [branchId]: { ...branch, status: 'resolved', answered_at: new Date().toISOString() },
    },
  };
}

/**
 * Enter a question branch: allocate an id, push an explicit `question` navigation
 * frame (with the return point) and focus the branch. Pure — the caller commits
 * the returned state atomically through `writeState`.
 */
export function pushQuestion(state, { branchId, stepId, anchorId = null, question, requestId = null, parent = null }) {
  const id = branchId ?? nextBranchId(state);
  const branch = {
    id,
    status: 'open',
    parent: typeof parent === 'string' && parent.length > 0 ? parent : null,
    step_id: stepId ?? state.main_cursor.step_id ?? null,
    anchor_id: typeof anchorId === 'string' && anchorId.length > 0 ? anchorId : null,
    question: String(question ?? '').trim(),
    request_id: typeof requestId === 'string' && requestId.length > 0 ? requestId : null,
    created_at: new Date().toISOString(),
    answered_at: null,
  };
  const frame = {
    frame_id: nextFrameId(state),
    kind: 'question',
    target_id: id,
    return_focus: state.focus ?? { kind: 'main' },
  };
  return {
    ...state,
    navigation_stack: [...(state.navigation_stack ?? []), frame],
    focus: { kind: 'branch', branch_id: id },
    branches: { ...(state.branches ?? {}), [id]: branch },
  };
}

/* ------------------------------------------------------------------ *
 * Knowledge-base paths for questions and pending packages
 * ------------------------------------------------------------------ */

export function questionsDir(cwd, topic) {
  return join(cwd, KB_DIR, topic, QUESTIONS_DIR);
}

export function pendingDir(cwd, topic) {
  return join(cwd, KB_DIR, topic, STATE_DIR, PENDING_DIR);
}

export function questionRelPath(topic, fileName) {
  return [KB_DIR, topic, QUESTIONS_DIR, fileName].join('/');
}

export function pendingRelPath(topic, branchId) {
  return [KB_DIR, topic, STATE_DIR, PENDING_DIR, `${branchId}.md`].join('/');
}

/** File name for a question: `Q003-<slug>.md`, stable per branch. */
export function questionFileName(branchId, question) {
  const cleaned = String(question ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\/:*?"<>|#[\](){}]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  const slug = Array.from(cleaned).slice(0, 24).join('').replace(/[.-]+$/g, '');
  return `${branchId}-${slug.length === 0 ? 'question' : slug}.md`;
}

export async function listQuestionFiles(cwd, topic) {
  try {
    const entries = await readdir(questionsDir(cwd, topic), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && /^Q\d+.*\.md$/i.test(entry.name)).map((entry) => entry.name).sort();
  } catch (error) {
    return [];
  }
}

/** Branch ids already present as callouts in step files (hand-written ones included). */
export async function listCalloutBranchIds(cwd, topic, steps) {
  const ids = new Set();
  for (const step of steps) {
    let text = '';
    try {
      text = await readFile(join(cwd, KB_DIR, topic, STEPS_DIR, step.file), 'utf8');
    } catch (error) {
      continue;
    }
    for (const match of text.matchAll(/^>\s*\[!\w+\]\s*(Q\d+)/gm)) ids.add(match[1]);
  }
  return [...ids];
}

/**
 * Steps whose files carry no `<a id="…">` breakpoint marker at all.
 * The panel turns each anchor into a Peek/Ask chip, so an anchor-less step can
 * only be asked about as a whole — worth reporting at ingestion time.
 */
export async function stepsWithoutAnchors(cwd, topic, steps) {
  const missing = [];
  for (const step of steps) {
    let text = '';
    try {
      text = await readFile(join(cwd, KB_DIR, topic, STEPS_DIR, step.file), 'utf8');
    } catch (error) {
      continue;
    }
    if (!/<a\s+id="/.test(text)) missing.push(step.id);
  }
  return missing;
}

/**
 * Steps whose formulas are plain text / Unicode notation rather than LaTeX.
 * The panel renders those best-effort (KaTeX whenever it happens to parse them),
 * but correct sub/superscripts and the math font are only guaranteed for real
 * `$$…$$` LaTeX — so ingestion reports them.
 */
export async function stepsWithPlainMath(cwd, topic, steps) {
  const flagged = [];
  for (const step of steps) {
    let text = '';
    try {
      text = await readFile(join(cwd, KB_DIR, topic, STEPS_DIR, step.file), 'utf8');
    } catch (error) {
      continue;
    }
    if (/\$\$|\\\[|\\\(/.test(text)) continue; // already uses math delimiters
    const indented = text.split(/\r?\n/).filter((line) => /^(?: {4,}|\t)\S/.test(line));
    if (indented.some((line) => /[_^]|∂|∫|⟨|ħ|∇/.test(line))) flagged.push(step.id);
  }
  return flagged;
}

/** The step file that owns an anchor (`<a id="X">`). */
export async function findAnchorStep(cwd, topic, steps, anchorId) {
  if (typeof anchorId !== 'string' || anchorId.length === 0) return null;
  const needle = `id="${anchorId}"`;
  for (const step of steps) {
    let text = '';
    try {
      text = await readFile(join(cwd, KB_DIR, topic, STEPS_DIR, step.file), 'utf8');
    } catch (error) {
      continue;
    }
    if (text.includes(needle)) return step;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Write-back: callouts in the step file + `questions/Qxxx.md`
 * ------------------------------------------------------------------ */

function toList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.length > 0);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

/**
 * Append a `> [!question] Qxxx` / `> [!answer] Qxxx` callout to the step's
 * 「标注」 section (created when missing). Idempotent: an existing callout for the
 * same branch and kind is left alone.
 */
export async function appendCallout(cwd, topic, stepFile, options) {
  const { branchId, kind, text, stamp = null, sourceRefs = [] } = options;
  const path = join(cwd, KB_DIR, topic, STEPS_DIR, stepFile);
  const original = await readFile(path, 'utf8');
  const lines = original.split(/\r?\n/);
  const header = `> [!${kind}] ${branchId}${stamp === null ? '' : ` · ${stamp}`}`;
  /* Idempotency is per exact header, not per branch: a「详细」answer must be able
   * to follow the short one for the same branch. */
  if (lines.some((line) => line.trim() === header)) return { path, header, appended: false };

  const block = [header];
  for (const line of String(text ?? '').split(/\r?\n/)) block.push(line.length === 0 ? '>' : `> ${line}`);
  if (kind === 'answer' && sourceRefs.length > 0) block.push('>', `> 出处：${sourceRefs.join('、')}`);

  const body = lines.slice();
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  const headingIndex = body.findIndex((line) => /^##\s+标注\s*$/.test(line.trim()));
  if (headingIndex < 0) {
    body.push('', '## 标注', '', ...block);
  } else {
    let insertAt = body.length;
    for (let i = headingIndex + 1; i < body.length; i += 1) {
      if (/^##\s+/.test(body[i])) { insertAt = i; break; }
    }
    while (insertAt > headingIndex + 1 && body[insertAt - 1].trim() === '') insertAt -= 1;
    body.splice(insertAt, 0, '', ...block);
  }
  await writeFile(path, `${body.join('\n')}\n`, 'utf8');
  return { path, header, appended: true };
}

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  return String(value);
}

function renderCallout(kind, branchId, text, extra = []) {
  const lines = [`> [!${kind}] ${branchId}`];
  for (const line of String(text ?? '').split(/\r?\n/)) lines.push(line.length === 0 ? '>' : `> ${line}`);
  if (extra.length > 0) lines.push('>', ...extra.map((line) => `> ${line}`));
  return lines.join('\n');
}

/**
 * Write `questions/Qxxx-*.md` — the branch transcript the panel renders and the
 * Obsidian-visible record of one detour. Rewritten wholesale (Host is sole writer).
 */
export async function writeQuestionFile(cwd, topic, branch, options = {}) {
  const { step = null, answer = null, sourceRefs = [], fileName = null } = options;
  const dir = questionsDir(cwd, topic);
  await mkdir(dir, { recursive: true });
  const existing = await listQuestionFiles(cwd, topic);
  const name = fileName
    ?? existing.find((file) => file.startsWith(`${branch.id}-`))
    ?? questionFileName(branch.id, branch.question);
  const frontmatter = [
    '---',
    `id: ${yamlScalar(branch.id)}`,
    `step_id: ${yamlScalar(branch.step_id)}`,
    `anchor_id: ${yamlScalar(branch.anchor_id)}`,
    `parent: ${yamlScalar(branch.parent)}`,
    `status: ${yamlScalar(branch.status ?? 'open')}`,
    `created_at: ${yamlScalar(branch.created_at)}`,
    `answered_at: ${yamlScalar(branch.answered_at ?? null)}`,
    `request_id: ${yamlScalar(branch.request_id)}`,
    '---',
    '',
  ];
  const body = [`# ${branch.id} · ${branch.question}`, ''];
  if (step !== null) body.push(`- 步骤：[[${step.file.replace(/\.md$/i, '')}]]（${step.id} ${step.title}）`);
  if (branch.anchor_id) body.push(`- 锚点：\`${branch.anchor_id}\``);
  body.push(`- 状态：${branch.status ?? 'open'}`, '');
  body.push(renderCallout('question', branch.id, branch.question), '');
  if (typeof answer === 'string' && answer.trim().length > 0) {
    const extra = sourceRefs.length > 0 ? [`出处：${sourceRefs.join('、')}`] : [];
    body.push(renderCallout('answer', branch.id, answer, extra), '');
  }
  const relPath = questionRelPath(topic, name);
  await writeFile(join(dir, name), `${[...frontmatter, ...body].join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  return { relPath, fileName: name };
}

/* ------------------------------------------------------------------ *
 * ContextPackage (v0.2 §4.3) — the auditable ask budget
 * ------------------------------------------------------------------ */

/** Rough token estimate: CJK ≈ 1 token/char, ASCII ≈ 4 chars/token. */
export function estimateTokens(text) {
  let tokens = 0;
  for (const char of String(text ?? '')) {
    tokens += /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(char) ? 1 : 0.25;
  }
  return Math.round(tokens);
}

/** Split a step body into `## / ###` sections (frontmatter excluded). */
export function splitSections(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const { endLine } = parseFrontmatter(text);
  const sections = [];
  let current = { heading: null, lines: [] };
  for (let i = endLine < 0 ? 0 : endLine + 1; i < lines.length; i += 1) {
    const match = /^(#{2,3})\s+(.*)$/.exec(lines[i]);
    if (match !== null) {
      sections.push(current);
      current = { heading: match[2].trim(), lines: [] };
    } else {
      current.lines.push(lines[i]);
    }
  }
  sections.push(current);
  return sections.map((section) => ({ heading: section.heading, text: section.lines.join('\n').trim() })).filter((section) => section.heading !== null || section.text.length > 0);
}

function truncate(text, limit) {
  const value = String(text ?? '');
  return value.length <= limit ? value : `${value.slice(0, limit)}\n…（截断，全文见步骤文件）`;
}

/**
 * Assemble the ask ContextPackage: anchor section + step conclusion/intuition +
 * one-hop dependency summaries + sources, trimmed to `budgetTokens`, written to
 * `state/pending/<branchId>.md`. The file *is* the provenance and budget proof.
 */
export async function buildContextPackage(cwd, topic, options) {
  const { branchId, step, anchorId = null, question, steps = [], stateVersion = 0, budgetTokens = PACKAGE_BUDGET_TOKENS } = options;
  const stepPath = join(cwd, KB_DIR, topic, STEPS_DIR, step.file);
  const stepText = await readFile(stepPath, 'utf8');
  const { fm } = parseFrontmatter(stepText);
  const sections = splitSections(stepText);
  const anchorSection = (anchorId === null ? null : sections.find((section) => section.text.includes(anchorId)))
    ?? sections.find((section) => section.heading === '结论')
    ?? sections[0]
    ?? { heading: null, text: '' };

  const entries = [{
    title: `锚点所在小节（${step.id}${anchorSection.heading === null ? '' : ` · ${anchorSection.heading}`}）`,
    text: truncate(anchorSection.text, 4000),
    priority: 1,
  }];
  const conclusion = sections.find((section) => section.heading === '结论');
  if (conclusion !== undefined) entries.push({ title: '本步结论', text: truncate(conclusion.text, 1200), priority: 2 });
  const intuition = sections.find((section) => section.heading === '直觉');
  if (intuition !== undefined) entries.push({ title: '本步直觉', text: truncate(intuition.text, 1600), priority: 3 });

  for (const depId of toList(fm.depends_on)) {
    const dep = findStep(steps, String(depId).replace(/^\[\[|\]\]$/g, ''));
    if (dep === undefined || dep.id === step.id) continue;
    let depText = '';
    try {
      depText = await readFile(join(cwd, KB_DIR, topic, STEPS_DIR, dep.file), 'utf8');
    } catch (error) {
      continue;
    }
    const depSections = splitSections(depText);
    const depCore = depSections.find((section) => section.heading === '结论') ?? depSections.find((section) => section.text.length > 0);
    entries.push({
      title: `一跳依赖 · ${dep.id} ${dep.title}`,
      text: truncate(depCore?.text ?? '', 800),
      priority: 4,
    });
  }

  const sources = toList(fm.source_refs);
  if (sources.length > 0) {
    entries.push({ title: '出处（frontmatter source_refs）', text: sources.map((source) => `- ${source}`).join('\n'), priority: 5 });
  }
  entries.push({ title: '本步符号与约定', text: `- 步骤类型：${fm.type ?? '未标注'}\n- 依赖：${toList(fm.depends_on).join('、') || '无'}\n- 内容状态：${fm.content_status ?? 'draft'}`, priority: 6 });

  entries.sort((left, right) => left.priority - right.priority);
  const accounting = [];
  const included = [];
  let total = 0;
  for (const entry of entries) {
    const tokens = estimateTokens(entry.text);
    const fits = total + tokens <= budgetTokens;
    accounting.push({ title: entry.title, tokens, included: fits });
    if (fits) {
      included.push(entry);
      total += tokens;
    }
  }

  const header = [
    `# ContextPackage · ${branchId}`,
    '',
    `- 主题：${topic}`,
    `- 步骤：${step.id} ${step.title}（${step.relPath}）`,
    `- 锚点：${anchorId ?? '（未指定，取本步结论）'}`,
    `- 问题：${question}`,
    `- 生成时间：${new Date().toISOString()}`,
    `- 状态版本：state_version ${stateVersion}`,
    `- 预算：${budgetTokens} tokens（本包 ${total} tokens）`,
    '',
    '## 使用约束',
    '- 只读本文件作答；不要读取会话历史、整篇文献或其他步骤的全文。',
    '- 作答后调用 `learning_control({action:"answer", branch_id:"' + branchId + '", answer:"…"})` 写回，不要手改知识库文件。',
    '- 本文件不足以回答时明确指出缺口，不要臆造公式或出处。',
    '',
  ];
  for (const entry of included) header.push(`## ${entry.title}`, '', entry.text, '');
  header.push('## 预算明细', '', '| 小节 | tokens | 纳入 |', '|---|---|---|');
  for (const row of accounting) header.push(`| ${row.title} | ${row.tokens} | ${row.included ? '是' : '否（超预算）'} |`);
  header.push(`| 合计 | ${total} | / ${budgetTokens} |`, '');

  const dir = pendingDir(cwd, topic);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${branchId}.md`), `${header.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  return { relPath: pendingRelPath(topic, branchId), tokens: total, budgetTokens, accounting };
}

/* ------------------------------------------------------------------ *
 * Ask / answer orchestration (files + state, no DSH runtime)
 * ------------------------------------------------------------------ */

/**
 * Phase 1 of an ask — decide the branch and return the next state, without writing
 * any knowledge-base file (directory reads only). The caller commits `state`
 * atomically first, then calls `writeBranchArtifacts`, so a version conflict can
 * never leave a question file behind without its state entry.
 */
export async function openBranch(cwd, topic, state, steps, options) {
  const { anchorId = null, question, requestId = null, parent = null, stepId = null } = options;
  if (typeof question !== 'string' || question.trim().length === 0) throw new Error('提问需要 question 文本');

  const reused = branchByRequestId(state, requestId);
  if (reused !== null) {
    const existingFile = (await listQuestionFiles(cwd, topic)).find((file) => file.startsWith(`${reused.id}-`)) ?? null;
    return {
      reused: true,
      state,
      branch: reused,
      step: findStep(steps, reused.step_id) ?? null,
      questionRelPath: existingFile === null ? '' : questionRelPath(topic, existingFile),
      pendingPath: pendingRelPath(topic, reused.id),
    };
  }

  const byAnchor = anchorId === null ? null : await findAnchorStep(cwd, topic, steps, anchorId);
  const target = findStep(steps, stepId) ?? byAnchor ?? findStep(steps, focusStepId(state)) ?? steps[0];
  if (target === undefined) throw new Error(`主题 ${topic} 下没有可提问的步骤`);

  const files = await listQuestionFiles(cwd, topic);
  const callouts = await listCalloutBranchIds(cwd, topic, steps);
  const branchId = nextBranchId(state, [...files, ...callouts]);
  const next = pushQuestion(state, { branchId, stepId: target.id, anchorId, question: question.trim(), requestId, parent });
  return {
    reused: false,
    state: next,
    branch: next.branches[branchId],
    step: target,
    questionRelPath: questionRelPath(topic, questionFileName(branchId, question.trim())),
    pendingPath: pendingRelPath(topic, branchId),
  };
}

/** Phase 2 of an ask: question callout in the step file + `questions/` transcript. */
export async function writeBranchArtifacts(cwd, topic, { branch, step }) {
  const stamp = new Date().toISOString().slice(0, 10);
  await appendCallout(cwd, topic, step.file, { branchId: branch.id, kind: 'question', text: branch.question, stamp });
  const written = await writeQuestionFile(cwd, topic, branch, { step, answer: null });
  return { questionRelPath: written.relPath };
}

/** Convenience: open + write in one call (tests and single-shot callers). */
export async function beginBranch(cwd, topic, state, steps, options) {
  const opened = await openBranch(cwd, topic, state, steps, options);
  if (opened.reused) return opened;
  const written = await writeBranchArtifacts(cwd, topic, opened);
  return { ...opened, questionRelPath: written.questionRelPath };
}

/** Phase 1 of an answer: resolve the branch in state (pure). */
export function resolveAnswer(state, steps, branchId = null) {
  const id = branchId ?? focusedBranch(state)?.id ?? null;
  if (id === null) throw new Error('answer 需要 branch_id');
  const branch = findBranch(state, id);
  if (branch === null) throw new Error(`未知问题分支 "${id}"`);
  const step = findStep(steps, branch.step_id);
  if (step === undefined) throw new Error(`分支 ${id} 指向的步骤 "${branch.step_id}" 不存在`);
  const next = resolveBranch(state, id);
  return { state: next, branch: next.branches[id], step };
}

/**
 * Phase 2 of an answer: answer callout + rewritten `questions/` transcript.
 *
 * `mode: 'detail'` is the follow-up the learner requests from the panel: the step
 * file gets an extra callout marked「详细」and the short answer in `questions/`
 * stays untouched (a detail pass must never overwrite the short one).
 */
export async function writeAnswerArtifacts(cwd, topic, { branch, step, text, sourceRefs = [], mode = 'short' }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const detail = mode === 'detail';
  const callout = await appendCallout(cwd, topic, step.file, {
    branchId: branch.id,
    kind: 'answer',
    text,
    stamp: detail ? '详细' : stamp,
    sourceRefs,
  });
  if (detail) return { questionRelPath: null, callout, mode };
  const written = await writeQuestionFile(cwd, topic, branch, { step, answer: text, sourceRefs });
  return { questionRelPath: written.relPath, callout, mode };
}

/** Convenience: resolve + write in one call (tests and single-shot callers). */
export async function writeAnswer(cwd, topic, state, steps, options) {
  const { branchId = null, text, sourceRefs = [] } = options;
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error('answer 需要 text 文本');
  const resolved = resolveAnswer(state, steps, branchId);
  const artifacts = await writeAnswerArtifacts(cwd, topic, {
    branch: resolved.branch,
    step: resolved.step,
    text: text.trim(),
    sourceRefs,
  });
  return { ...artifacts, state: resolved.state, branch: resolved.branch, step: resolved.step };
}

/* ------------------------------------------------------------------ *
 * Topic resolution
 * ------------------------------------------------------------------ */

/**
 * Resolve which topic an action applies to.
 * Explicit request wins; otherwise the topic with the freshest state file.
 */
export async function resolveTopic(cwd, requested) {
  const topics = await listTopics(cwd);
  if (topics.length === 0) {
    return { topic: null, topics, reason: `工作目录下没有 ${KB_DIR}/ 知识库` };
  }
  if (typeof requested === 'string' && requested.length > 0) {
    if (!topics.includes(requested)) {
      return { topic: null, topics, reason: `未知主题 "${requested}"，可用主题：${topics.join('、')}` };
    }
    return { topic: requested, topics };
  }
  let best = null;
  for (const topic of topics) {
    let mtime = 0;
    try {
      mtime = (await stat(statePath(cwd, topic))).mtimeMs;
    } catch (error) {
      mtime = 0;
    }
    if (best === null || mtime > best.mtime) best = { topic, mtime };
  }
  return { topic: best.topic, topics };
}

/* ------------------------------------------------------------------ *
 * Code-owned step status rewrite
 * ------------------------------------------------------------------ */

/** Rewrite only the `status:` line inside a step's frontmatter. */
export async function setStepStatus(cwd, topic, stepId, status) {
  if (!STATUSES.includes(status)) throw new Error(`未知状态 "${status}"，只接受：${STATUSES.join('/')}`);
  const steps = await listSteps(cwd, topic);
  const step = findStep(steps, stepId);
  if (step === undefined) throw new Error(`未知步骤 "${stepId}"`);
  const path = join(cwd, KB_DIR, topic, STEPS_DIR, step.file);
  const text = await readFile(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const { endLine } = parseFrontmatter(text);
  if (endLine < 0) throw new Error(`${step.file} 没有 frontmatter，无法写入状态`);
  let replaced = false;
  for (let i = 1; i < endLine; i += 1) {
    if (/^status\s*:/.test(lines[i])) {
      lines[i] = `status: ${status}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) lines.splice(endLine, 0, `status: ${status}`);
  await writeFile(path, lines.join('\n'), 'utf8');
  return { ...step, status };
}

/* ------------------------------------------------------------------ *
 * Tool payload
 * ------------------------------------------------------------------ */

/** Human/agent-readable label for the current focus (main | review:X | branch:Qxxx). */
export function focusLabel(state) {
  const kind = state.focus?.kind ?? 'main';
  if (kind === 'main') return 'main';
  if (kind === 'branch') return `branch:${state.focus.branch_id ?? ''}`;
  return `${kind}:${state.focus.target_id ?? ''}`;
}

/** Compact projection handed back to the model after every action. */
export function summarize(state, steps, topic, extra = {}) {
  const ids = stepIds(steps);
  const cursor = state.main_cursor.step_id;
  const index = ids.indexOf(cursor);
  const current = findStep(steps, cursor);
  const focused = findStep(steps, focusStepId(state));
  const branch = focusedBranch(state);
  return {
    topic,
    position: `${index < 0 ? 0 : index + 1}/${ids.length}`,
    cursor: cursor ?? '',
    cursor_title: current?.title ?? '',
    step_path: current?.relPath ?? '',
    focus: focusLabel(state),
    focus_path: focused?.relPath ?? '',
    stack_depth: state.navigation_stack.length,
    state_version: state.state_version,
    branch_id: branch?.id ?? '',
    branch_status: branch?.status ?? '',
    question_path: extra.question_path ?? '',
    pending_path: extra.pending_path ?? '',
    rejected: extra.rejected === true,
    reused: extra.reused === true,
    steps: steps.map((step) => ({ id: step.id, title: step.title, status: step.status })),
    open_branches: Object.entries(state.branches ?? {}).map(([id, value]) => ({
      id,
      status: value?.status ?? 'open',
      step_id: value?.step_id ?? '',
      anchor_id: value?.anchor_id ?? '',
      question: value?.question ?? '',
    })),
  };
}

/** Panel-driven actions that wake the tutor agent through `agent.followup`. */
export const INJECTION_PREFIX = {
  next: '[LEARN-NEXT]',
  back: '[LEARN-REVIEW]',
  goto: '[LEARN-GOTO]',
  ask: '[LEARN-ASK]',
  answer_detail: '[LEARN-ASK-DETAIL]',
  ingest_request: '[LEARN-INGEST]',
};

/** The follow-up text injected when a panel/command action must wake the agent. */
export function injectionText(action, message) {
  const prefix = INJECTION_PREFIX[action];
  return prefix === undefined ? null : `${prefix} ${message}`;
}

export function actionMessage(action, summary, extra) {
  const head = `主题 ${summary.topic}：主线 ${summary.cursor}（${summary.position}）「${summary.cursor_title}」`;
  switch (action) {
    case 'status':
      return `${head}。焦点 ${summary.focus}，栈深 ${summary.stack_depth}。`;
    case 'next':
      return `${head}。请只读 ${summary.step_path}，讲这一步。`;
    case 'back':
      return `进入回学：${summary.focus_path}（主线仍是 ${summary.cursor}）。请只读该文件重讲，不要推进主线。`;
    case 'return':
      return `${head}。已返回上一层，焦点 ${summary.focus}，栈深 ${summary.stack_depth}。`;
    case 'resume':
      return `已回到主线 ${summary.cursor}（${summary.position}）「${summary.cursor_title}」。请衔接一句即可，不要重述前文。`;
    case 'goto':
      return `主线已设到 ${summary.cursor}（${summary.position}）「${summary.cursor_title}」。请只读 ${summary.step_path}。`;
    case 'set_status':
      return `已把 ${extra?.step_id ?? ''} 标记为「${extra?.status ?? ''}」。`;
    case 'ask':
      if (extra?.reused === true) {
        return `问题分支 ${summary.branch_id} 已存在（同一 request_id），沿用原分支与上下文包 ${summary.pending_path}，未重复建分支。`;
      }
      return `已建立问题分支 ${summary.branch_id}（锚点 ${extra?.anchor_id ?? ''}，步骤 ${extra?.step_id ?? ''}）。上下文包：${summary.pending_path}。`
        + `请用 subagent 工具作答：subagent 的 prompt 只含该包文件路径与问题本身，不要携带会话历史；`
        + `**默认给简短回答**：先给 2–4 句结论 + 必要公式（≤200 字），完整推导链条留到用户点「详细回答」时再展开；`
        + `拿到答案后调用 learning_control({action:"answer", branch_id:"${summary.branch_id}", answer:"…"}) 写回；主线只回 ≤3 行摘要 + 分支号。`;
    case 'answer_detail': {
      const branchId = extra?.branch_id ?? summary.branch_id ?? '';
      return `用户要求把分支 ${branchId} 的回答展开为**详细版**（步骤 ${extra?.step_id ?? ''}，锚点 ${extra?.anchor_id ?? ''}，上下文包 ${summary.pending_path}）。`
        + `请在已写回的简短回答基础上补充：完整推导链条与每一步的依据、成立条件与边界、必要的出处；不要重复简短版已说过的结论。`
        + `用 learning_control({action:"answer", branch_id:"${branchId}", mode:"detail", answer:"…"}) 写回（代码会以「详细」标注追加，不覆盖简短版）；主线只回 ≤3 行摘要。`;
    }
    case 'ingest_request':
      return `用户提交了一份学习材料：${extra?.path ?? '（未提供路径）'}。按学习模式协议第 8 条导入：`
        + `先只输出**步骤 DAG 草案**（编号 / 标题 / 一句话 / depends_on / 出处页码）等用户确认，不要直接落盘；`
        + `确认后写 learning/<topic>/steps/*.md、index.md 与 sources/，再调用 learning_control({action:"ingest_commit", topic:"<topic>"}) 建索引并把主线放到第一步。`;
    case 'answer':
      if (extra?.mode === 'detail') {
        return `已把**详细回答**追加到 ${extra?.step_id ?? ''} 的「标注」区（简短回答保留不动），分支 ${extra?.branch_id ?? summary.branch_id} 仍为 ${summary.branch_status}。`;
      }
      return `已把回答写回 ${extra?.step_id ?? ''} 的「标注」区与 ${summary.question_path}，分支 ${summary.branch_id} 标为 ${summary.branch_status}。`;
    case 'branches':
      return `${head}。问题分支 ${summary.open_branches.length} 个：${summary.open_branches.map((item) => `${item.id}(${item.status})`).join('、') || '无'}。`;
    case 'ingest_commit': {
      const withoutAnchors = extra?.without_anchors ?? [];
      const plainMath = extra?.plain_math ?? [];
      const warn = withoutAnchors.length > 0
        ? ` 注意：${withoutAnchors.join('、')} 没有 <a id="…"> 锚点，面板里只能整步提问；建议给关键公式补上独立一行的锚点。`
        : '';
      const mathWarn = plainMath.length > 0
        ? ` 另：${plainMath.join('、')} 的公式是纯文本/Unicode 记号（缩进块），下划线与上下标只能尽力渲染；建议改写为 $$ … $$ 的 LaTeX。`
        : '';
      return `主题 ${summary.topic} 的路线已建立：共 ${extra?.step_count ?? summary.steps.length} 步，主线置于 ${summary.cursor}「${summary.cursor_title}」。请从这一步开始逐步讲解。${warn}${mathWarn}`;
    }
    default:
      return head;
  }
}
