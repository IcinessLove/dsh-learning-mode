/**
 * Learning Mode — DSH Web Client module (M1).
 *
 * Registers:
 *   - a sidebar panel entry (`sidebar.panellist`) named 学习模式 / Learning Mode;
 *   - the matching main panel (`main` keyed slot, key = PANEL_ID);
 *   - a session-scoped body slot (`main.learning`) that owns the three columns.
 *
 * M1 scope: read the `learning/` knowledge base from the session workspace via
 * `remote.workspaceFiles`, render every step file as one continuous preview,
 * and run the deterministic navigation state machine (cursor / focus / stack /
 * peek) in the Client with localStorage persistence. Question capture is wired
 * locally; the agent-backed scoped Q&A lands with the Host half in M3.
 */
window.__ModuleLoader__.load({
  id: '@local/learning-mode',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo, useCallback } = React;

    const NS = 'learningMode';
    const PANEL_ID = 'learning-mode';
    const KB_ROOT = 'learning';
    const READ_LIMIT = 5000;

    const ZH = {
      title: '学习模式',
      subtitle: '结构化学习面板',
      empty: '这个工作区还没有 learning/ 知识库。',
      emptyHint: '建立 learning/<主题>/steps/S01-xxx.md 后点击刷新，面板会自动切分并连续预览。',
      noSession: '当前面板没有绑定会话，请先打开一个会话。',
      loading: '正在读取知识库…',
      refresh: '刷新',
      topics: '主题',
      steps: '步骤',
      next: '下一步',
      back: '回学此步',
      returnLayer: '返回上一层',
      resume: '回主线',
      mainline: '主线',
      focus: '焦点',
      stack: '栈',
      position: '位置',
      peek: '速览',
      close: '关闭',
      ask: '提问',
      askStep: '提问本步',
      askDetail: '详细回答',
      mark: '标记',
      markHint: '点步骤＝标记阅读位置（不唤醒 agent）；按空格回到标记处',
      returnToMark: '回到标记',
      importDoc: '导入文献',
      importPlaceholder: '粘贴文献绝对路径（PDF / Markdown）',
      importSubmit: '提交给 agent',
      importHint: 'agent 会先给出步骤 DAG 草案，等你确认后再落盘',
      modelLabel: '选择处理这次导入的模型',
      modelKeep: '（沿用当前模型）',
      modelUnavailable: '读取不到模型目录，将沿用当前模型；如需切换请在输入框的模型控件里选',
      modelBusy: '会话被其他 DSH 实例占用，模型切换失败；请关闭其他实例后重试',
      hostStale: 'Host 半区还没加载这个动作：请**完全退出并重启** DeepSeek Desktop（只刷新页面不够）。',
      askPlaceholder: '就这一步/这个公式提问…',
      submit: '提问',
      sending: '正在提交…',
      threads: '问答线程',
      threadsEmpty: '还没有问题分支。点锚点旁的 ⁉ 提问：Host 会建分支、组装上下文包并让 subagent 作答。',
      threadWaiting: '等待 subagent 作答…',
      answer: '回答',
      locate: '定位',
      hostOffline: '面板与 Host 的命令通道不可用，已退回本地记录模式。',
      drafts: '本地待提问',
      draftsEmpty: '还没有问题。点击预览里的 ⁉ 在锚点上提问。',
      draftPending: '仅记录在本地（Host 通道不可用）',
      draftDelete: '删除',
      stateOpen: '待答',
      stateResolved: '已答',
      stateDeferred: '已挂起',
      status: '状态',
      unread: '未读',
      reading: '在读',
      doubt: '存疑',
      understood: '已懂',
      deps: '依赖',
      source: '出处',
      noTopic: '没有可用的主题',
      openFailed: '读取失败',
      emptyTopic: '这个主题还没有步骤文件。',
      needAskTarget: '请先在预览里选择一个锚点。',
    };
    const EN = {
      title: 'Learning Mode',
      subtitle: 'Structured study panel',
      empty: 'This workspace has no learning/ knowledge base yet.',
      emptyHint: 'Create learning/<topic>/steps/S01-xxx.md and hit refresh; the panel splits and previews every step continuously.',
      noSession: 'This panel is not bound to a session yet. Open a session first.',
      loading: 'Reading knowledge base…',
      refresh: 'Refresh',
      topics: 'Topics',
      steps: 'Steps',
      next: 'Next step',
      back: 'Review this step',
      returnLayer: 'Up one layer',
      resume: 'Back to mainline',
      mainline: 'Mainline',
      focus: 'Focus',
      stack: 'Stack',
      position: 'Position',
      peek: 'Peek',
      close: 'Close',
      ask: 'Ask',
      askStep: 'Ask this step',
      askDetail: 'More detail',
      mark: 'Mark',
      markHint: 'Click a step to mark your reading position (no agent wake); press Space to jump back',
      returnToMark: 'Back to mark',
      importDoc: 'Import material',
      importPlaceholder: 'Paste an absolute path (PDF / Markdown)',
      importSubmit: 'Hand to the agent',
      importHint: 'The agent drafts the step DAG first and writes files only after you confirm',
      modelLabel: 'Model that handles this import',
      modelKeep: '(keep current model)',
      modelUnavailable: 'The model directory is unavailable; the current model will be used — switch it in the composer model control instead',
      modelBusy: 'Another DSH instance holds this session, so the model switch failed; close it and retry',
      hostStale: 'The Host half has not loaded this action yet: fully quit and restart DeepSeek Desktop (a page refresh is not enough).',
      askPlaceholder: 'Ask about this step or formula…',
      submit: 'Ask',
      sending: 'Submitting…',
      threads: 'Question threads',
      threadsEmpty: 'No question branch yet. Use ⁉ next to an anchor: the Host opens the branch, packs the context and has a subagent answer it.',
      threadWaiting: 'Waiting for the subagent…',
      answer: 'Answer',
      locate: 'Locate',
      hostOffline: 'The panel-to-Host command channel is unavailable; fell back to local capture.',
      drafts: 'Local questions',
      draftsEmpty: 'No questions yet. Use the ⁉ button on an anchor in the preview.',
      draftPending: 'Captured locally only (Host channel unavailable)',
      draftDelete: 'Delete',
      stateOpen: 'open',
      stateResolved: 'answered',
      stateDeferred: 'deferred',
      status: 'Status',
      unread: 'unread',
      reading: 'reading',
      doubt: 'doubt',
      understood: 'understood',
      deps: 'depends on',
      source: 'source',
      noTopic: 'No topic available',
      openFailed: 'Read failed',
      emptyTopic: 'This topic has no step files yet.',
      needAskTarget: 'Select an anchor in the preview first.',
    };

    /* ------------------------------------------------------------------ *
     * Markdown / frontmatter parsing (fixed template, no HTML injection)
     * ------------------------------------------------------------------ */

    function stripQuotes(value) {
      const trimmed = value.trim();
      if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
          return trimmed.slice(1, -1);
        }
      }
      return trimmed;
    }

    function parseScalar(value) {
      const raw = value.trim();
      if (raw.startsWith('[') && raw.endsWith(']')) {
        return raw
          .slice(1, -1)
          .split(',')
          .map((part) => stripQuotes(part))
          .filter((part) => part.length > 0);
      }
      if (raw === 'null' || raw === '~') return null;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return stripQuotes(raw);
    }

    function parseFrontmatter(text) {
      const lines = String(text ?? '').split(/\r?\n/);
      if (lines.length === 0 || lines[0].trim() !== '---') {
        return { fm: {}, body: lines, bodyStartLine: 0 };
      }
      let end = -1;
      for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].trim() === '---') {
          end = i;
          break;
        }
      }
      if (end < 0) return { fm: {}, body: lines, bodyStartLine: 0 };
      const fm = {};
      for (let i = 1; i < end; i += 1) {
        const line = lines[i];
        if (line.trim().length === 0 || line.trim().startsWith('#')) continue;
        const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
        if (!match) continue;
        fm[match[1]] = parseScalar(match[2]);
      }
      return { fm, body: lines.slice(end + 1), bodyStartLine: end + 1 };
    }

    /** `<a id="X"></a>` anywhere in a line — the panel treats it as a breakpoint marker. */
    const INLINE_ANCHOR = /<a\s+id="([^"]+)"\s*>\s*<\/a>/g;
    /** Cheap "this indented block is math, not code" test. */
    const MATH_HINT = /[\\^_{}]|∂|∇|∫|∑|∏|√|⟨|⟩|ħ|ℏ|ω|τ|ρ|ψ|φ|ϕ|χ|Δ|Ω|α|β|γ|σ|λ|μ|ν|π|≈|≤|≥|→|⇒/;

    /**
     * Pull `<a id="…">` markers out of one line.
     * @returns `{ text, anchors }` with the markers removed and empty parens tidied.
     */
    function extractAnchors(line) {
      const anchors = [];
      const text = String(line)
        .replace(INLINE_ANCHOR, (_match, id) => {
          anchors.push(id);
          return '';
        })
        .replace(/[（(]\s*[）)]/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
      return { text, anchors };
    }

    /**
     * Turn a step file body into a flat block list the preview renders.
     *
     * Tolerant on purpose: knowledge bases written by different sessions vary, so
     * anchors may sit on their own line or inline, display math may be `$$…$$`,
     * `\[…\]` or an indented block, and fenced blocks are honoured.
     */
    function parseBlocks(lines) {
      const blocks = [];
      let pendingAnchors = [];
      let paragraph = [];
      let paragraphAnchors = [];
      let listItems = [];
      let listAnchors = [];
      let callout = null;

      const flushParagraph = () => {
        if (paragraph.length === 0) return;
        blocks.push({ kind: 'p', text: paragraph.join(' '), anchorIds: paragraphAnchors });
        paragraph = [];
        paragraphAnchors = [];
      };
      const flushList = () => {
        if (listItems.length === 0) return;
        blocks.push({ kind: 'list', items: listItems, anchorIds: listAnchors });
        listItems = [];
        listAnchors = [];
      };
      const flushCallout = () => {
        if (callout === null) return;
        callout.text = callout.lines.join('\n').trim();
        delete callout.lines;
        blocks.push(callout);
        callout = null;
      };
      const flushAll = () => {
        flushParagraph();
        flushList();
        flushCallout();
      };

      for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i];
        const line = raw.replace(/\s+$/, '');
        let trimmed = line.trim();

        if (trimmed.length === 0) {
          flushAll();
          continue;
        }

        /* Fenced block: ```math / ```latex render as math, anything else as code. */
        const fence = /^```(\w*)\s*$/.exec(trimmed);
        if (fence) {
          flushAll();
          const info = (fence[1] ?? '').toLowerCase();
          const body = [];
          i += 1;
          while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
            body.push(lines[i]);
            i += 1;
          }
          const { text, anchors } = extractAnchors(body.join('\n'));
          const looksLikeCode = /^\s*(?:const|let|var|function|import|export|def |class |#include|<\w)/.test(text);
          const isMath = !looksLikeCode && MATH_HINT.test(text);
          /* Explicit fences mean LaTeX; an indented block may instead use Unicode
           * math notation (∂ρ̂/∂t), which KaTeX would render as an error. */
          blocks.push({
            kind: isMath ? 'math' : 'code',
            ...isMath ? { syntax: 'latex' } : {},
            text,
            anchorIds: [...pendingAnchors, ...anchors],
          });
          pendingAnchors = [];
          continue;
        }

        /* \[ … \] display math, single line or spanning lines. */
        if (trimmed.startsWith('\\[')) {
          flushAll();
          const body = [];
          let rest = trimmed.slice(2);
          while (!rest.includes('\\]') && i + 1 < lines.length) {
            body.push(rest);
            i += 1;
            rest = lines[i].trim();
          }
          const closing = rest.indexOf('\\]');
          body.push(closing >= 0 ? rest.slice(0, closing) : rest);
          const { text, anchors } = extractAnchors(body.join('\n'));
          blocks.push({ kind: 'math', syntax: 'latex', text, anchorIds: [...pendingAnchors, ...anchors] });
          pendingAnchors = [];
          continue;
        }

        /* A standalone anchor line attaches to the block that follows it. */
        const standalone = /^<a\s+id="([^"]+)"\s*>\s*<\/a>\s*$/.exec(trimmed);
        if (standalone) {
          flushAll();
          pendingAnchors.push(standalone[1]);
          continue;
        }

        /* Indented block: math when it reads like math, otherwise a code block. */
        if (/^(?: {4,}|\t)/.test(raw)) {
          flushAll();
          const body = [trimmed];
          while (i + 1 < lines.length && (/^(?: {4,}|\t)/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
            i += 1;
            if (lines[i].trim() !== '') body.push(lines[i].trim());
          }
          const { text, anchors } = extractAnchors(body.join('\n'));
          const looksLikeCode = /^\s*(?:const|let|var|function|import|export|def |class |#include|<\w)/.test(text);
          const isMath = !looksLikeCode && MATH_HINT.test(text);
          const isLatex = /\\[a-zA-Z[\]()]|\$\$|\\\(|\\\[/.test(text);
          blocks.push({
            kind: isMath ? 'math' : 'code',
            ...isMath ? { syntax: isLatex ? 'latex' : 'plain' } : {},
            text,
            anchorIds: [...pendingAnchors, ...anchors],
          });
          pendingAnchors = [];
          continue;
        }

        /* Everything below may carry inline anchors; strip them first. */
        const extracted = extractAnchors(trimmed);
        const inlineAnchors = extracted.anchors;
        trimmed = extracted.text;
        if (trimmed.length === 0) {
          pendingAnchors.push(...inlineAnchors);
          continue;
        }

        if (trimmed === '$$') {
          flushAll();
          const math = [];
          i += 1;
          while (i < lines.length && lines[i].trim() !== '$$') {
            math.push(lines[i]);
            i += 1;
          }
          const { text, anchors } = extractAnchors(math.join('\n'));
          blocks.push({ kind: 'math', syntax: 'latex', text, anchorIds: [...pendingAnchors, ...inlineAnchors, ...anchors] });
          pendingAnchors = [];
          continue;
        }

        /* A line that is exactly one math span is a display equation, not inline
         * math: `\(…\)` and `$…$` on their own line render like `$$…$$`. */
        const wholeLineMath = /^(?:\\\((.+)\\\)|\$\$([^$]+)\$\$|\$([^$]+)\$)$/.exec(trimmed);
        if (wholeLineMath) {
          flushAll();
          const tex = (wholeLineMath[1] ?? wholeLineMath[2] ?? wholeLineMath[3] ?? '').trim();
          blocks.push({ kind: 'math', syntax: 'latex', text: tex, anchorIds: [...pendingAnchors, ...inlineAnchors] });
          pendingAnchors = [];
          continue;
        }

        if (trimmed.startsWith('## ')) {
          flushAll();
          blocks.push({ kind: 'h2', text: trimmed.slice(3).trim(), anchorIds: [...pendingAnchors, ...inlineAnchors] });
          pendingAnchors = [];
          continue;
        }

        if (trimmed.startsWith('# ')) {
          flushAll();
          blocks.push({ kind: 'h1', text: trimmed.slice(2).trim(), anchorIds: [...pendingAnchors, ...inlineAnchors] });
          pendingAnchors = [];
          continue;
        }

        if (trimmed.startsWith('> [!')) {
          flushAll();
          const variantMatch = /^>\s*\[!(\w+)\](.*)$/.exec(trimmed);
          callout = {
            kind: 'callout',
            variant: (variantMatch?.[1] ?? 'note').toLowerCase(),
            title: (variantMatch?.[2] ?? '').trim(),
            lines: [],
            anchorIds: [...pendingAnchors, ...inlineAnchors],
          };
          pendingAnchors = [];
          continue;
        }

        if (callout !== null && trimmed.startsWith('>')) {
          const inner = extractAnchors(trimmed.replace(/^>\s?/, ''));
          callout.anchorIds.push(...inner.anchors);
          callout.lines.push(inner.text);
          continue;
        }

        if (callout !== null) {
          flushCallout();
        }

        const listMatch = /^[-*]\s+(.*)$/.exec(trimmed);
        if (listMatch) {
          flushParagraph();
          listItems.push(listMatch[1]);
          listAnchors.push(...pendingAnchors, ...inlineAnchors);
          pendingAnchors = [];
          continue;
        }

        flushList();
        paragraph.push(trimmed);
        paragraphAnchors.push(...pendingAnchors, ...inlineAnchors);
        pendingAnchors = [];
      }
      flushAll();
      return blocks;
    }

    function collectAnchors(blocks) {
      const anchors = [];
      for (const block of blocks) {
        for (const id of block.anchorIds ?? []) {
          if (!anchors.includes(id)) anchors.push(id);
        }
      }
      return anchors;
    }

    /** The 结论 / 一句话 section, used by the Peek card. */
    function conclusionText(blocks) {
      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i];
        if (block.kind === 'h2' && /(结论|一句话)/.test(block.text)) {
          const collected = [];
          for (let j = i + 1; j < blocks.length; j += 1) {
            if (blocks[j].kind === 'h2') break;
            if (blocks[j].kind === 'p') collected.push(blocks[j].text);
            if (blocks[j].kind === 'list') collected.push(blocks[j].items.join('；'));
          }
          if (collected.length > 0) return collected.join(' ');
        }
      }
      const firstParagraph = blocks.find((block) => block.kind === 'p');
      return firstParagraph === undefined ? '' : firstParagraph.text;
    }

    function stepOrdinal(id) {
      const match = /(\d+)/.exec(String(id ?? ''));
      return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
    }

    /**
     * One `questions/Qxxx-*.md` transcript → the panel's thread model. Host writes
     * these files; the panel never invents a branch.
     */
    function parseQuestionFile(text, fileName) {
      const parsed = parseFrontmatter(text);
      const blocks = parseBlocks(parsed.body);
      const gather = (variant) => blocks
        .filter((block) => block.kind === 'callout' && block.variant === variant)
        .map((block) => block.text)
        .filter((value) => typeof value === 'string' && value.length > 0)
        .join('\n\n');
      return {
        id: typeof parsed.fm.id === 'string'
          ? parsed.fm.id
          : (/^(Q\d+)/.exec(String(fileName ?? ''))?.[1] ?? String(fileName ?? '').replace(/\.md$/i, '')),
        status: typeof parsed.fm.status === 'string' ? parsed.fm.status : 'open',
        stepId: typeof parsed.fm.step_id === 'string' ? parsed.fm.step_id : '',
        anchorId: typeof parsed.fm.anchor_id === 'string' ? parsed.fm.anchor_id : '',
        parent: typeof parsed.fm.parent === 'string' ? parsed.fm.parent : null,
        createdAt: typeof parsed.fm.created_at === 'string' ? parsed.fm.created_at : '',
        question: gather('question'),
        answer: gather('answer'),
        fileName: String(fileName ?? ''),
      };
    }

    /* ------------------------------------------------------------------ *
     * Remote face: read-only workspace access + the Host command channel
     * ------------------------------------------------------------------ */

    /**
     * Flatten a model-directory snapshot into picker options.
     * The directory groups come from `ctx.modelDirectories.directoryFor(sessionId)`
     * (`{ groups: [{ id, name, models: [{ id, name }] }] }`).
     */
    function modelOptionsFrom(groups) {
      const options = [];
      for (const group of Array.isArray(groups) ? groups : []) {
        for (const model of Array.isArray(group?.models) ? group.models : []) {
          options.push({
            value: `${group.id}/${model.id}`,
            label: `${group.name ?? group.id} · ${model.name ?? model.id}`,
          });
        }
      }
      return options;
    }

    /**
     * Pin the topic on every panel-driven action. The Host falls back to the
     * freshest state file when `topic` is absent, so asking in one subject could
     * open the context package of whichever subject was written most recently.
     */
    function withTopic(payload, topic) {
      const base = payload !== null && typeof payload === 'object' ? payload : {};
      if (typeof topic !== 'string' || topic.length === 0) return base;
      return { ...base, topic };
    }

    function createFace(remote, sessionId, getCommands) {
      const call = async (method, path, extra, signal) => {
        try {
          const result = await remote.workspaceFiles[method](sessionId, path, ...extra, signal);
          if (result === undefined || result === null) return { ok: false, error: 'empty-remote-result' };
          return result.ok === true
            ? { ok: true, value: result.value }
            : { ok: false, error: formatRemoteError(result.error) };
        } catch (error) {
          return { ok: false, error: String(error?.message ?? error) };
        }
      };

      const list = async (path, signal) => {
        const result = await call('list', path, [], signal);
        if (!result.ok) return result;
        const entries = Array.isArray(result.value?.entries) ? result.value.entries : [];
        return {
          ok: true,
          value: entries.map((entry) => ({
            name: String(entry.name ?? entry.path ?? entry.absolutePath ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop(),
            /* The wire type is `type: 'file' | 'directory' | 'other'`
             * (WorkspaceDirectoryEntry). `kind` / `directory` stay only as
             * defensive fallbacks — reading `kind` alone classified every entry as
             * a file, which made the topic list come back empty. */
            kind: entry.type ?? entry.kind ?? (entry.directory === true ? 'directory' : 'file'),
          })),
        };
      };

      const read = async (path, signal) => {
        const result = await call('read', path, [{ offset: 1, limit: READ_LIMIT }], signal);
        if (!result.ok) return result;
        return { ok: true, value: String(result.value?.text ?? '') };
      };

      const readJson = async (path, signal) => {
        const result = await read(path, signal);
        if (!result.ok) return result;
        try {
          return { ok: true, value: JSON.parse(result.value) };
        } catch (error) {
          return { ok: false, error: `invalid-json: ${String(error?.message ?? error)}` };
        }
      };

      /**
       * Panel → Host. The `learn` command drives the very same state machine the
       * `learning_control` tool does, and wakes the tutor through agent.followup;
       * a panel button therefore never needs its own copy of the logic.
       */
      const send = async (action, payload = {}, signal) => {
        const commands = typeof getCommands === 'function' ? getCommands() : null;
        if (commands === null || commands === undefined || typeof commands.execute !== 'function') {
          return { ok: false, error: 'learning-mode/command-unavailable' };
        }
        try {
          const line = `/learn ${JSON.stringify({ action, ...payload })}`;
          const result = await commands.execute(sessionId, line, [], signal);
          if (result === undefined || result === null) return { ok: false, error: 'learning-mode/empty-remote-result' };
          if (result.ok !== true) return { ok: false, error: formatRemoteError(result.error) };
          if (result.value === undefined) return { ok: false, error: 'learning-mode/command-unknown' };
          const outcome = result.value.result;
          if (outcome !== null && outcome !== undefined && outcome.kind === 'error') {
            return { ok: false, error: String(outcome.text ?? 'learning-mode/command-error') };
          }
          return { ok: true, value: String(outcome?.text ?? '') };
        } catch (error) {
          return { ok: false, error: String(error?.message ?? error) };
        }
      };

      return { sessionId, list, read, readJson, send };
    }

    function formatRemoteError(error) {
      if (error === undefined || error === null) return 'unknown';
      if (typeof error === 'string') return error;
      return String(error.code ?? error.message ?? JSON.stringify(error));
    }

    /* ------------------------------------------------------------------ *
     * Navigation state machine (pure; the controller of v0.2 §4.6)
     * ------------------------------------------------------------------ */

    function emptyNav(stepIds) {
      return {
        cursor: { stepId: stepIds[0] ?? null, anchorId: null, revealLevel: 'step' },
        focus: { kind: 'main' },
        stack: [],
        peek: null,
        reviewCursor: null,
      };
    }

    function navKey(sessionId, topic) {
      return `learningMode:nav:${sessionId ?? 'none'}:${topic ?? 'none'}`;
    }

    /** Highest `state_version` this browser has adopted from the Host state file. */
    function navVersionKey(sessionId, topic) {
      return `learningMode:version:${sessionId ?? 'none'}:${topic ?? 'none'}`;
    }

    /**
     * The learner's reading mark. Purely local: marking never moves the mainline
     * cursor, never opens a question and never wakes the agent — it is the anchor
     * the Space key returns to after previewing ahead or looking back.
     */
    function markKey(sessionId, topic) {
      return `learningMode:mark:${sessionId ?? 'none'}:${topic ?? 'none'}`;
    }

    function loadMark(sessionId, topic) {
      try {
        const raw = window.localStorage.getItem(markKey(sessionId, topic));
        if (raw === null) return null;
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' && typeof parsed.stepId === 'string' ? parsed : null;
      } catch (error) {
        return null;
      }
    }

    function saveMark(sessionId, topic, mark) {
      try {
        window.localStorage.setItem(markKey(sessionId, topic), JSON.stringify(mark));
      } catch (error) {
        /* storage unavailable: the mark still works for this mount */
      }
    }

    function loadNav(sessionId, topic, stepIds) {
      try {
        const raw = window.localStorage.getItem(navKey(sessionId, topic));
        if (raw === null) return emptyNav(stepIds);
        const parsed = JSON.parse(raw);
        const known = new Set(stepIds);
        const cursor = parsed?.cursor?.stepId;
        return {
          cursor: {
            stepId: known.has(cursor) ? cursor : (stepIds[0] ?? null),
            anchorId: parsed?.cursor?.anchorId ?? null,
            revealLevel: parsed?.cursor?.revealLevel ?? 'step',
          },
          focus: parsed?.focus?.kind === 'review' || parsed?.focus?.kind === 'question'
            ? parsed.focus
            : { kind: 'main' },
          stack: Array.isArray(parsed?.stack) ? parsed.stack : [],
          peek: parsed?.peek ?? null,
          reviewCursor: parsed?.reviewCursor ?? null,
        };
      } catch (error) {
        return emptyNav(stepIds);
      }
    }

    function saveNav(sessionId, topic, nav) {
      try {
        window.localStorage.setItem(navKey(sessionId, topic), JSON.stringify(nav));
      } catch (error) {
        /* storage unavailable: navigation still works in memory */
      }
    }

    function advance(nav, stepIds, current) {
      if (nav.focus.kind === 'review') {
        const order = stepIds;
        const index = order.indexOf(nav.reviewCursor ?? order[0]);
        const nextId = order[Math.min(index + 1, order.length - 1)];
        return { ...nav, reviewCursor: nextId };
      }
      if (nav.focus.kind !== 'main') return nav;
      const index = stepIds.indexOf(current);
      const nextId = stepIds[Math.min(index + 1, stepIds.length - 1)];
      return { ...nav, cursor: { ...nav.cursor, stepId: nextId, anchorId: null }, peek: null };
    }

    function pushReview(nav, stepId) {
      const frame = {
        frameId: `F${Date.now().toString(36)}`,
        kind: 'review',
        targetId: stepId,
        returnFocus: nav.focus,
      };
      return { ...nav, stack: [...nav.stack, frame], focus: { kind: 'review', targetId: stepId }, reviewCursor: stepId, peek: null };
    }

    function popLayer(nav, stepIds) {
      if (nav.stack.length === 0) return { ...nav, focus: { kind: 'main' }, peek: null };
      const stack = nav.stack.slice(0, -1);
      const frame = nav.stack[nav.stack.length - 1];
      const focus = frame.returnFocus ?? { kind: 'main' };
      const next = { ...nav, stack, focus, peek: null };
      if (focus.kind !== 'review') next.reviewCursor = null;
      return next;
    }

    function resumeMain(nav) {
      return { ...nav, stack: [], focus: { kind: 'main' }, peek: null, reviewCursor: null };
    }

    function focusStepId(nav) {
      if (nav.focus.kind === 'review') return nav.reviewCursor ?? nav.cursor.stepId;
      if (nav.peek !== null && nav.peek !== undefined) return nav.peek.stepId;
      return nav.cursor.stepId;
    }

    /* ------------------------------------------------------------------ *
     * Draft questions (M1: captured locally; M3 hands them to a subagent)
     * ------------------------------------------------------------------ */

    function draftsKey(sessionId) {
      return `learningMode:drafts:${sessionId ?? 'none'}`;
    }

    function loadDrafts(sessionId) {
      try {
        const raw = window.localStorage.getItem(draftsKey(sessionId));
        const parsed = raw === null ? [] : JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }

    function saveDrafts(sessionId, drafts) {
      try {
        window.localStorage.setItem(draftsKey(sessionId), JSON.stringify(drafts));
      } catch (error) {
        /* ignore */
      }
    }

    /* ------------------------------------------------------------------ *
     * Styles (theme tokens with fallbacks; no host package imports)
     * ------------------------------------------------------------------ */

    const CSS = `
.lm-root { display:flex; flex-direction:column; height:100%; min-height:0; color:inherit; font-size:13px; }
.lm-bar { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); flex-wrap:wrap; }
.lm-title { font-weight:600; margin-right:4px; }
.lm-chip { padding:1px 6px; border-radius:6px; background:var(--dsw-alias-bg-secondary, rgba(128,128,128,.10)); white-space:nowrap; }
.lm-chip.mono { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; }
.lm-btn { border:1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); background:var(--dsw-alias-bg-secondary, rgba(128,128,128,.08)); color:inherit; border-radius:6px; padding:3px 9px; cursor:pointer; font-size:12px; }
.lm-btn:hover { background:var(--dsw-alias-bg-tertiary, rgba(128,128,128,.18)); }
.lm-btn.primary { border-color:var(--dsw-alias-brand-primary, #4c8dff); color:var(--dsw-alias-brand-primary, #4c8dff); }
.lm-btn:disabled { opacity:.45; cursor:default; }
.lm-cols { display:flex; flex:1 1 auto; min-height:0; }
.lm-col { overflow:auto; padding:10px 12px; min-height:0; }
.lm-col.left { width:230px; flex:0 0 230px; border-right:1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); }
.lm-col.center { flex:1 1 auto; }
.lm-col.right { width:300px; flex:0 0 300px; border-left:1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); }
.lm-section-title { font-size:11px; text-transform:uppercase; letter-spacing:.06em; opacity:.6; margin:4px 0 8px; }
.lm-topic { display:block; width:100%; text-align:left; padding:5px 8px; border-radius:6px; border:1px solid transparent; background:transparent; color:inherit; cursor:pointer; }
.lm-topic.active { background:var(--dsw-alias-bg-secondary, rgba(128,128,128,.12)); border-color:var(--dsw-alias-border-secondary, rgba(128,128,128,.3)); }
.lm-step-row { display:flex; align-items:flex-start; gap:6px; padding:5px 6px; border-radius:6px; cursor:pointer; }
.lm-step-row:hover { background:var(--dsw-alias-bg-secondary, rgba(128,128,128,.10)); }
.lm-step-row.active { background:var(--dsw-alias-bg-secondary, rgba(128,128,128,.16)); }
.lm-dot { width:7px; height:7px; border-radius:50%; margin-top:5px; flex:0 0 auto; background:rgba(128,128,128,.6); }
.lm-dot.doubt { background:#e0a83c; }
.lm-dot.understood { background:#3fae72; }
.lm-dot.reading { background:#4c8dff; }
.lm-step-id { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; opacity:.75; }
.lm-step-title { flex:1 1 auto; }
.lm-card { border:1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); border-radius:10px; margin:0 0 18px; padding:12px 14px; }
.lm-card.current { border-color:var(--dsw-alias-brand-primary, #4c8dff); box-shadow:0 0 0 1px var(--dsw-alias-brand-primary, #4c8dff) inset; }
.lm-card-head { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; margin-bottom:6px; }
.lm-card-title { font-size:15px; font-weight:600; }
.lm-meta { font-size:11px; opacity:.7; }
.lm-h2 { font-size:13px; font-weight:600; margin:12px 0 4px; }
.lm-p { margin:4px 0; line-height:1.6; }
.lm-math { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--dsw-alias-bg-secondary, rgba(128,128,128,.09)); padding:8px 10px; border-radius:8px; margin:6px 0; white-space:pre-wrap; overflow-x:auto; }
.lm-math-block { margin:8px 0; overflow-x:auto; }
.lm-math-plain { font-family:"Cambria Math","Latin Modern Math",ui-serif,Georgia,serif; font-size:1.18em; line-height:1.85; text-align:center; white-space:pre-wrap; margin:12px 0; padding:2px 8px; overflow-x:auto; }
.lm-math-block .katex-display { margin:0; }
.lm-callout { border-left:3px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.5)); padding:6px 10px; margin:6px 0; border-radius:0 8px 8px 0; background:var(--dsw-alias-bg-secondary, rgba(128,128,128,.07)); }
.lm-callout.question { border-left-color:#e0a83c; }
.lm-callout.answer { border-left-color:#3fae72; }
.lm-callout-title { font-size:11px; opacity:.7; margin-bottom:2px; }
.lm-anchor-row { display:flex; align-items:center; gap:6px; margin:6px 0 2px; }
.lm-anchor { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:10px; opacity:.65; }
.lm-anchor-chip { display:inline-flex; align-items:center; gap:3px; margin-right:8px; padding:1px 5px; border:1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.28)); border-radius:6px; background:var(--dsw-alias-bg-secondary, rgba(128,128,128,.06)); }
.lm-inline-code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.92em; padding:0 3px; border-radius:4px; background:var(--dsw-alias-bg-secondary, rgba(128,128,128,.12)); }
.lm-p strong, .lm-callout strong { font-weight:650; }
.lm-p em, .lm-callout em { font-style:italic; }
.lm-p a, .lm-callout a { color:var(--dsw-alias-brand-primary, #4c8dff); text-decoration:none; }
.lm-p a:hover, .lm-callout a:hover { text-decoration:underline; }
.lm-mini { border:1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.3)); background:transparent; color:inherit; border-radius:5px; padding:0 5px; cursor:pointer; font-size:11px; line-height:16px; }
.lm-mini:hover { background:var(--dsw-alias-bg-secondary, rgba(128,128,128,.15)); }
.lm-mark-chip { cursor:pointer; border:1px solid var(--dsw-alias-brand-primary, #4c8dff); color:var(--dsw-alias-brand-primary, #4c8dff); }
.lm-step-row.marked { box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary, #4c8dff); }
.lm-card.marked { border-left:3px solid var(--dsw-alias-brand-primary, #4c8dff); }
.lm-card.flash { animation:lm-flash 900ms ease-out 1; }
@keyframes lm-flash { 0% { background:var(--dsw-alias-bg-tertiary, rgba(128,128,128,.22)); } 100% { background:transparent; } }
.lm-import { gap:8px; }
.lm-input { flex:1 1 auto; min-width:240px; border-radius:6px; border:1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); background:transparent; color:inherit; padding:3px 8px; font:inherit; }
.lm-select { border-radius:6px; border:1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); background:var(--dsw-alias-bg-base, transparent); color:inherit; padding:3px 6px; font:inherit; max-width:280px; }
.lm-empty { opacity:.7; line-height:1.7; }
.lm-textarea { width:100%; min-height:56px; resize:vertical; border-radius:8px; border:1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); background:transparent; color:inherit; padding:6px 8px; font:inherit; }
.lm-draft { border:1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); border-radius:8px; padding:8px 10px; margin-bottom:8px; }
.lm-draft-q { margin:2px 0 4px; }
.lm-link { color:var(--dsw-alias-brand-primary, #4c8dff); cursor:pointer; text-decoration:none; background:none; border:none; padding:0; font:inherit; }
.lm-error { color:#d9534f; }
`;

    /* ------------------------------------------------------------------ *
     * Components
     * ------------------------------------------------------------------ */

    function PanelIcon({ size, active }) {
      const dimension = size ?? 18;
      return h('svg', {
        width: dimension,
        height: dimension,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        style: { display: 'block', opacity: active === false ? 0.85 : 1 },
        'aria-hidden': true,
      },
        h('path', { d: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z' }),
        h('path', { d: 'M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z' }),
        h('path', { d: 'M7 8.5h1.5M7 12h1.5M15.5 8.5H17M15.5 12H17' }),
      );
    }

    /** `main` slot shell: renders the session-scoped learning body. */
    function LearningPanel({ renderSlot }) {
      return h('div', { className: 'lm-root' }, h(LmBoundary, null, renderSlot('main.learning', {})));
    }

    /**
     * Keeps a render crash visible. The slot framework abdicates a crashed entry
     * (the panel would simply go blank), so the boundary turns any throw below it
     * into readable text on screen — the browser console is not always reachable.
     */
    class LmBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      componentDidCatch(error, info) {
        try {
          console.error('[learning-mode] panel render crashed', error, info);
        } catch (ignored) {
          /* console may be unavailable */
        }
      }

      render() {
        if (this.state.error !== null) {
          const message = String(this.state.error?.message ?? this.state.error);
          return h('div', { className: 'lm-col center' },
            h('div', { className: 'lm-empty lm-error' }, `面板渲染出错：${message}`),
            h('div', { className: 'lm-meta' }, '把这段文字发给 agent 即可定位。'),
          );
        }
        return this.props.children;
      }
    }

    function StatusDot({ status }) {
      const map = { 在读: 'reading', reading: 'reading', 存疑: 'doubt', doubt: 'doubt', 已懂: 'understood', understood: 'understood' };
      const cls = map[status] ?? '';
      return h('span', { className: `lm-dot ${cls}` });
    }

    /* ------------------------------------------------------------------ *
     * Math rendering — vendored KaTeX (see vendor/ and build.mjs)
     *
     * The shell's module table has no math key and the plugin rules forbid
     * importing host UI packages, so the served bundle carries its own KaTeX.
     * Only styles come from the shell: its global KaTeX CSS (shipped with the
     * frontend fonts) already styles `.katex` markup.
     * ------------------------------------------------------------------ */

    /** The vendored UMD build assigns itself to globalThis.katex; both live in client.js. */
    const katex = (typeof globalThis !== 'undefined' && globalThis.katex) || null;

    /**
     * TeX → KaTeX HTML, or null when KaTeX is unavailable, the input is broken, or
     * KaTeX only produced its error span. Returning null lets callers fall back to
     * plain text instead of showing a red error — and lets Unicode-flavoured math
     * (∂ρ̂/∂t, χ_VV) render properly whenever KaTeX happens to accept it.
     */
    function mathHtml(tex, displayMode) {
      if (katex === null || typeof tex !== 'string' || tex.trim().length === 0) return null;
      try {
        const html = katex.renderToString(tex, { displayMode, throwOnError: false, strict: false, output: 'html' });
        return html.includes('katex-error') ? null : html;
      } catch (error) {
        return null;
      }
    }

    /**
     * Split one text run into inline segments: math (`$…$`, `\(…\)`), bold,
     * italic, code and links. `$$…$$` is its own block kind; `\$` escapes a dollar.
     * @param text - the raw run.
     * @returns `[{ kind, text, href? }]`.
     */
    function splitInline(text) {
      const source = String(text ?? '');
      const parts = [];
      const pattern = /(\\\$|\$[^$\n]+?\$|\\\([^)]*?\\\)|\*\*[^*]+?\*\*|__[^_]+?__|`[^`\n]+?`|\[[^\]\n]+?\]\([^)\s]+?\)|\*[^*\n]+?\*|(?<![\w])_[^_\n]+?_(?![\w]))/g;
      let last = 0;
      let match = pattern.exec(source);
      while (match !== null) {
        if (match.index > last) parts.push({ kind: 'text', text: source.slice(last, match.index) });
        const token = match[0];
        if (token === '\\$') {
          parts.push({ kind: 'text', text: '$' });
        } else if (token.startsWith('$') || token.startsWith('\\(')) {
          const body = token.startsWith('$')
            ? (token.startsWith('$$') ? token.slice(2, -2) : token.slice(1, -1))
            : token.slice(2, -2);
          parts.push({ kind: 'math', text: body });
        } else if (token.startsWith('**') || token.startsWith('__')) {
          parts.push({ kind: 'bold', text: token.slice(2, -2) });
        } else if (token.startsWith('`')) {
          parts.push({ kind: 'code', text: token.slice(1, -1) });
        } else if (token.startsWith('[')) {
          const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
          parts.push({ kind: 'link', text: link?.[1] ?? token, href: link?.[2] ?? '#' });
        } else {
          parts.push({ kind: 'italic', text: token.slice(1, -1) });
        }
        last = match.index + token.length;
        match = pattern.exec(source);
      }
      if (last < source.length) parts.push({ kind: 'text', text: source.slice(last) });
      return parts;
    }

    /** Kept for the math tests: the math-only projection of {@link splitInline}. */
    function splitInlineMath(text) {
      return splitInline(String(text)).filter((part) => part.kind === 'text' || part.kind === 'math');
    }

    /**
     * Render one text run: inline math through KaTeX, markdown emphasis/code/links
     * through plain elements. Unknown or broken math degrades to inline code.
     */
    function renderInline(text) {
      const parts = splitInline(text);
      if (parts.length === 1 && parts[0].kind === 'text') return parts[0].text;
      return parts.map((part, index) => {
        if (part.kind === 'text') return part.text;
        if (part.kind === 'bold') return h('strong', { key: index }, renderInline(part.text));
        if (part.kind === 'italic') return h('em', { key: index }, renderInline(part.text));
        if (part.kind === 'code') return h('code', { key: index, className: 'lm-inline-code' }, part.text);
        if (part.kind === 'link') {
          return h('a', { key: index, className: 'lm-link', href: part.href, target: '_blank', rel: 'noreferrer' }, part.text);
        }
        const html = mathHtml(part.text, false);
        return html === null
          ? h('code', { key: index, className: 'lm-inline-code' }, `$${part.text}$`)
          : h('span', { key: index, dangerouslySetInnerHTML: { __html: html } });
      });
    }

    /** Back-compat alias used by older call sites and tests. */
    const withInlineMath = renderInline;

    /** One chip row per block: every anchor is a Peek / Ask breakpoint. */
    function AnchorRow({ ids, onAsk, onPeek, currentAnchor }) {
      if (ids === undefined || ids.length === 0) return null;
      return h('div', { className: 'lm-anchor-row' }, ids.map((id) => h('span', { key: id, className: 'lm-anchor-chip' },
        h('span', { className: `lm-anchor${currentAnchor === id ? ' lm-anchor-current' : ''}` }, id),
        h('button', { className: 'lm-mini', title: 'Peek', onClick: () => onPeek(id) }, '👁'),
        h('button', { className: 'lm-mini', title: 'Ask here', onClick: () => onAsk(id) }, '⁉'),
      )));
    }

    function Callout({ block, onAsk, onPeek, currentAnchor }) {
      return h('div', { className: `lm-callout ${block.variant}` },
        h(AnchorRow, { ids: block.anchorIds, onAsk, onPeek, currentAnchor }),
        block.title ? h('div', { className: 'lm-callout-title' }, block.title) : null,
        h('div', { style: { whiteSpace: 'pre-wrap' } }, renderInline(block.text)),
      );
    }

    function Blocks({ blocks, onAsk, onPeek, currentAnchor }) {
      const anchorsOf = (block) => block.anchorIds ?? [];
      return h(React.Fragment, null, blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        const row = h(AnchorRow, { ids: anchorsOf(block), onAsk, onPeek, currentAnchor });
        if (block.kind === 'h1') {
          return h('div', { key }, row, h('div', { className: 'lm-card-title' }, block.text));
        }
        if (block.kind === 'h2') {
          return h('div', { key }, row, h('div', { className: 'lm-h2' }, renderInline(block.text)));
        }
        if (block.kind === 'math') {
          /* Best effort: try KaTeX even for Unicode-flavoured blocks — it accepts
           * most of them, which turns bare `_`/`^` into real sub/superscripts and
           * brings the math font back. Fall back to plain text (Unicode) or raw TeX
           * only when KaTeX cannot parse the block. */
          const html = mathHtml(block.text, true);
          if (html !== null) {
            return h('div', { key }, row, h('div', { className: 'lm-math-block', dangerouslySetInnerHTML: { __html: html } }));
          }
          return h('div', { key }, row,
            block.syntax === 'plain'
              ? h('div', { className: 'lm-math-plain' }, block.text)
              : h('pre', { className: 'lm-math' }, block.text));
        }
        if (block.kind === 'code') {
          return h('div', { key }, row, h('pre', { className: 'lm-math' }, block.text));
        }
        if (block.kind === 'callout') return h(Callout, { key, block, onAsk, onPeek, currentAnchor });
        if (block.kind === 'list') {
          return h('div', { key },
            row,
            h('ul', { style: { margin: '4px 0', paddingLeft: 18 } },
              block.items.map((item, itemIndex) => h('li', { key: itemIndex, className: 'lm-p' }, renderInline(item)))));
        }
        return h('div', { key }, row, h('div', { className: 'lm-p' }, renderInline(block.text)));
      }));
    }

    function LearningBody(props) {
      const { face, renderSlot } = props;
      const t = typeof props.t === 'function' ? props.t : (key) => ZH[key] ?? key;

      /* The workspace-files service only promises relative-path resolution for
       * read/stat; `list` needs a real path. Build every KB path from the Session
       * cwd — the same source the shipped workspace-files tab uses — and keep the
       * bare relative root as a fallback when the hook is unavailable. */
      const sessionCwd = typeof props.useSessions === 'function'
        ? props.useSessions((sessions) => sessions?.byId?.[face?.sessionId]?.cwd)
        : undefined;
      const kbRoot = typeof sessionCwd === 'string' && sessionCwd.length > 0
        ? `${sessionCwd.replace(/[\\/]+$/, '')}/${KB_ROOT}`
        : KB_ROOT;

      const [phase, setPhase] = useState('idle');
      const [topics, setTopics] = useState([]);
      const [rootProbe, setRootProbe] = useState(null);
      const [topic, setTopic] = useState(null);
      const [steps, setSteps] = useState([]);
      const [nav, setNav] = useState(() => emptyNav([]));
      const [threads, setThreads] = useState([]);
      const [drafts, setDrafts] = useState(() => loadDrafts(face?.sessionId));
      const [askTarget, setAskTarget] = useState(null);
      const [askText, setAskText] = useState('');
      const [sending, setSending] = useState(false);
      const [hostNotice, setHostNotice] = useState('');
      const [error, setError] = useState(null);
      const previewRef = useRef(null);
      const [scrollTick, setScrollTick] = useState(0);
      const [reloadTick, setReloadTick] = useState(0);
      const [threadTick, setThreadTick] = useState(0);
      const [mark, setMark] = useState(null);
      const [flashTick, setFlashTick] = useState(0);
      const [importOpen, setImportOpen] = useState(false);
      const [importPath, setImportPath] = useState('');
      const [modelOptions, setModelOptions] = useState([]);
      const [modelPick, setModelPick] = useState('');
      const [modelCurrent, setModelCurrent] = useState(null);
      const [modelError, setModelError] = useState('');
      const forceAdoptRef = useRef(false);

      const statusLabel = useCallback((status) => {
        if (status === 'resolved') return t('stateResolved');
        if (status === 'deferred') return t('stateDeferred');
        return t('stateOpen');
      }, [t]);

      const stepIds = useMemo(() => steps.map((step) => step.fm.id), [steps]);

      /* ---- load topic list ---- */
      const refreshTopics = useCallback(async () => {
        if (face === undefined || face === null) return;
        setPhase('loading');
        setError(null);
        const controller = new AbortController();
        const result = await face.list(kbRoot, controller.signal);
        if (!result.ok) {
          setTopics([]);
          setPhase(result.error === 'workspace-file/not-found' ? 'empty' : 'failed');
          if (result.error !== 'workspace-file/not-found') setError(result.error);
          /* Diagnostic: when the KB root is missing, show the Session cwd and what
           * it actually contains — the usual cause is a different workspace root. */
          const probeTarget = typeof sessionCwd === 'string' && sessionCwd.length > 0 ? sessionCwd : '.';
          const probe = await face.list(probeTarget, controller.signal);
          setRootProbe(probe.ok
            ? `查找路径：${kbRoot} ｜ 工作区根 ${probeTarget} 下有：${probe.value.map((entry) => `${entry.name}${entry.kind === 'directory' ? '/' : ''}`).join('、') || '（空）'}`
            : `查找路径：${kbRoot} ｜ 列举 ${probeTarget} 失败：${probe.error}`);
          return;
        }
        setRootProbe(null);
        const found = result.value.filter((entry) => entry.kind === 'directory').map((entry) => entry.name);
        setTopics(found);
        setPhase(found.length === 0 ? 'empty' : 'ready');
        setTopic((current) => (current !== null && found.includes(current) ? current : (found[0] ?? null)));
      }, [face, kbRoot]);

      /* ---- load one topic ---- */
      const loadTopic = useCallback(async (topicName) => {
        if (face === undefined || face === null || topicName === null) return;
        setPhase('loading');
        setError(null);
        const controller = new AbortController();
        const base = `${kbRoot}/${topicName}`;
        const listed = await face.list(`${base}/steps`, controller.signal);
        if (!listed.ok) {
          setSteps([]);
          setPhase('failed');
          setError(listed.error);
          return;
        }
        const files = listed.value
          .filter((entry) => entry.kind === 'file' && /\.md$/i.test(entry.name))
          .map((entry) => entry.name)
          .sort((a, b) => stepOrdinal(a) - stepOrdinal(b));
        const loaded = [];
        for (const file of files) {
          const read = await face.read(`${base}/steps/${file}`, controller.signal);
          if (!read.ok) continue;
          const parsed = parseFrontmatter(read.value);
          const blocks = parseBlocks(parsed.body);
          loaded.push({
            file,
            fm: parsed.fm,
            blocks,
            anchors: collectAnchors(blocks),
            conclusion: conclusionText(blocks),
          });
        }
        setSteps(loaded);
        setPhase('ready');
      }, [face, kbRoot]);

      useEffect(() => {
        setPhase('idle');
        setTopics([]);
        setTopic(null);
        setSteps([]);
        setThreads([]);
        refreshTopics();
      }, [refreshTopics]);

      useEffect(() => {
        if (topic !== null) loadTopic(topic);
      }, [topic, loadTopic]);

      /* ---- question threads: Host-written `questions/Qxxx-*.md` ---- */
      const loadThreads = useCallback(async (topicName) => {
        if (face === undefined || face === null || topicName === null) return;
        const controller = new AbortController();
        const listed = await face.list(`${kbRoot}/${topicName}/questions`, controller.signal);
        if (!listed.ok) {
          setThreads([]);
          return;
        }
        const files = listed.value
          .filter((entry) => entry.kind === 'file' && /^Q\d+.*\.md$/i.test(entry.name))
          .map((entry) => entry.name)
          .sort();
        const loaded = [];
        for (const file of files) {
          const read = await face.read(`${kbRoot}/${topicName}/questions/${file}`, controller.signal);
          if (!read.ok) continue;
          loaded.push(parseQuestionFile(read.value, file));
        }
        setThreads(loaded);
      }, [face, kbRoot]);

      useEffect(() => {
        if (topic !== null) loadThreads(topic);
      }, [topic, loadThreads, threadTick]);

      /* A Host write (ask/answer/next from either channel) bumps the state version;
       * this re-reads steps, threads and the cursor in one go. */
      useEffect(() => {
        if (topic === null || reloadTick === 0) return;
        loadTopic(topic);
        loadThreads(topic);
      }, [reloadTick]);

      /* ---- navigation persistence + follow the Host cursor ---- *
       * The Host half (`learning_control`) owns the mainline cursor in
       * state/learning-state.json. This panel adopts it whenever that file has
       * advanced past the version we last saw (or when the user hits refresh),
       * and otherwise keeps its own UI-local position: review frames and Peek
       * never touch the state file. */
      useEffect(() => {
        if (topic === null || stepIds.length === 0) return;
        let cancelled = false;
        setNav(loadNav(face.sessionId, topic, stepIds));
        (async () => {
          const seeded = await face.readJson(`${kbRoot}/${topic}/state/learning-state.json`);
          if (cancelled || !seeded.ok) return;
          const hostCursor = seeded.value?.main_cursor?.step_id;
          const version = Number(seeded.value?.state_version ?? 0);
          if (typeof hostCursor !== 'string' || !stepIds.includes(hostCursor)) return;
          const force = forceAdoptRef.current;
          forceAdoptRef.current = false;
          const adopted = Number(window.localStorage.getItem(navVersionKey(face.sessionId, topic)) ?? 0);
          const hasLocal = window.localStorage.getItem(navKey(face.sessionId, topic)) !== null;
          if (hasLocal && !force && !(version > adopted)) return;
          try {
            window.localStorage.setItem(navVersionKey(face.sessionId, topic), String(version));
          } catch (error) {
            /* storage unavailable */
          }
          setNav((current) => ({
            ...current,
            cursor: { ...current.cursor, stepId: hostCursor, anchorId: seeded.value?.main_cursor?.anchor_id ?? null },
          }));
        })();
        return () => { cancelled = true; };
      }, [topic, stepIds, face, reloadTick]);

      useEffect(() => {
        if (topic === null) return;
        saveNav(face.sessionId, topic, nav);
      }, [nav, topic, face]);

      /* ---- reading mark + Space return ---------------------------------- *
       * Marking is local state: clicking a step records where the learner is,
       * and Space scrolls the continuous preview back to it. Nothing here talks
       * to the Host, so browsing never wakes the tutor. */
      useEffect(() => {
        if (topic === null) return;
        setMark(loadMark(face.sessionId, topic));
      }, [topic, face]);

      const scrollToStep = useCallback((stepId) => {
        const node = previewRef.current?.querySelector(`[data-step="${stepId}"]`);
        if (node === undefined || node === null) return false;
        node.scrollIntoView({ block: 'start', behavior: 'smooth' });
        setFlashTick((tick) => tick + 1);
        return true;
      }, []);

      const markStep = useCallback((stepId, anchorId = null) => {
        if (typeof stepId !== 'string' || stepId.length === 0) return;
        const next = { stepId, anchorId, at: new Date().toISOString() };
        setMark(next);
        saveMark(face.sessionId, topic, next);
        scrollToStep(stepId);
      }, [face, topic, scrollToStep]);

      const returnToMark = useCallback(() => {
        if (mark === null) return;
        scrollToStep(mark.stepId);
      }, [mark, scrollToStep]);

      useEffect(() => {
        if (topic === null || mark === null) return undefined;
        const onKeyDown = (event) => {
          if (event.code !== 'Space' && event.key !== ' ') return;
          const target = event.target;
          if (target instanceof HTMLElement) {
            const tag = target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
          }
          event.preventDefault();
          scrollToStep(mark.stepId);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [topic, mark, scrollToStep]);

      /* ---- live follow: the Host writes, the panel projects ----
       * Polling one small JSON file keeps the panel honest for both channels:
       * a chat-driven `learning_control` call and a panel-driven `learn` command
       * both land as a version bump here. */
      useEffect(() => {
        if (topic === null || phase !== 'ready' || typeof window === 'undefined') return undefined;
        const timer = window.setInterval(async () => {
          const seeded = await face.readJson(`${kbRoot}/${topic}/state/learning-state.json`);
          if (!seeded.ok) return;
          const version = Number(seeded.value?.state_version ?? 0);
          const adopted = Number(window.localStorage.getItem(navVersionKey(face.sessionId, topic)) ?? 0);
          if (version > adopted) {
            forceAdoptRef.current = true;
            setReloadTick((tick) => tick + 1);
          }
        }, 3000);
        return () => window.clearInterval(timer);
      }, [topic, phase, face]);

      useEffect(() => {
        if (scrollTick === 0) return;
        const id = focusStepId(nav);
        const node = previewRef.current?.querySelector(`[data-step="${id}"]`);
        if (node !== undefined && node !== null) node.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, [scrollTick, nav]);

      const commit = useCallback((next) => {
        setNav(next);
        setScrollTick((tick) => tick + 1);
      }, []);

      /**
       * Host-first action. The panel does not own the state machine any more: it
       * asks the Host (same code the agent tool uses) and then re-reads the files.
       * Only a dead channel falls back to the panel-local transitions below.
       */
      const runHost = useCallback(async (action, payload = {}) => {
        if (face === undefined || face === null) return false;
        const result = await face.send(action, withTopic(payload, topic));
        if (result.ok) {
          setHostNotice(result.value);
          setError(null);
          forceAdoptRef.current = true;
          setReloadTick((tick) => tick + 1);
          setThreadTick((tick) => tick + 1);
          return true;
        }
        setHostNotice('');
        /* A stale Host half reports actions it does not know yet; a page refresh
         * reloads the Client only, so say what actually fixes it. */
        const raw = String(result.error ?? '');
        setError(result.error === 'learning-mode/command-unavailable'
          ? t('hostOffline')
          : (raw.includes('未知 action') ? `${raw} ｜ ${t('hostStale')}` : result.error));
        return false;
      }, [face, t, topic]);

      /* Panel → Host for the unified import entry. Declared after `runHost`: a
       * dependency array is evaluated during render, so referencing it earlier
       * would throw a temporal-dead-zone error and blank the whole panel. */
      const modelDirectory = useCallback(() => {
        const service = typeof props.models === 'function' ? props.models() : null;
        const sessionApi = typeof props.sessions === 'function' ? props.sessions() : null;
        if (service === null || typeof service.directoryFor !== 'function') return null;
        if (typeof sessionApi?.subagentAddress === 'function' && sessionApi.subagentAddress(face.sessionId) !== undefined) return null;
        try {
          return service.directoryFor(face.sessionId);
        } catch (error) {
          return null;
        }
      }, [props, face]);

      const loadModels = useCallback(async () => {
        const directory = modelDirectory();
        if (directory === null) {
          setModelOptions([]);
          setModelCurrent(null);
          return;
        }
        try {
          await directory.load?.();
          const snapshot = directory.store?.getSnapshot?.() ?? {};
          setModelOptions(modelOptionsFrom(snapshot.groups ?? directory.groups));
          setModelCurrent(snapshot.current ?? directory.current ?? null);
          setModelError('');
        } catch (error) {
          setModelOptions([]);
          setModelError(String(error?.message ?? error));
        }
      }, [modelDirectory]);

      useEffect(() => {
        if (importOpen) loadModels();
      }, [importOpen, loadModels]);

      const submitImport = useCallback(async () => {
        const path = importPath.trim();
        if (path.length === 0) return;
        /* A chosen model is applied through the same session directory the composer
         * and `/model` use, so the import runs on the model the learner picked. */
        if (modelPick !== '') {
          const current = modelCurrent === null ? '' : `${modelCurrent.provider}/${modelCurrent.model}`;
          if (modelPick !== current) {
            const directory = modelDirectory();
            if (directory === null) {
              setModelError(t('modelUnavailable'));
              return;
            }
            const separator = modelPick.indexOf('/');
            const provider = modelPick.slice(0, separator);
            const model = modelPick.slice(separator + 1);
            try {
              const result = await directory.select({ provider, model });
              if (result !== undefined && result !== null && result.ok === false) {
                setModelError(result.error?.code === 'session/writer-held' ? t('modelBusy') : String(result.error?.message ?? result.error?.code ?? 'select failed'));
                return;
              }
            } catch (error) {
              setModelError(String(error?.message ?? error));
              return;
            }
            setModelCurrent({ provider, model });
          }
        }
        const sent = await runHost('ingest_request', { path });
        if (sent) {
          setImportPath('');
          setImportOpen(false);
          setModelError('');
        }
      }, [importPath, modelPick, modelCurrent, modelDirectory, runHost, t]);

      const onNext = useCallback(async () => {
        if (await runHost('next')) return;
        commit(advance(nav, stepIds, nav.cursor.stepId));
      }, [runHost, commit, nav, stepIds]);
      const onBack = useCallback(async (stepId) => {
        const target = stepId ?? nav.cursor.stepId;
        if (await runHost('back', { step_id: target })) return;
        commit(pushReview(nav, target));
      }, [runHost, commit, nav]);
      const onReturn = useCallback(async () => {
        if (await runHost('return')) return;
        commit(popLayer(nav, stepIds));
      }, [runHost, commit, nav, stepIds]);
      const onResume = useCallback(async () => {
        if (await runHost('resume')) return;
        commit(resumeMain(nav));
      }, [runHost, commit, nav]);
      const onPeek = useCallback((anchorId) => {
        const owner = steps.find((step) => step.anchors.includes(anchorId));
        commit({ ...nav, peek: { stepId: owner?.fm.id ?? nav.cursor.stepId, anchorId } });
      }, [nav, steps, commit]);
      /**
       * Open the ask composer. `anchorId === null` asks about the whole step —
       * the fallback that keeps every step a breakpoint even when the file carries
       * no `<a id>` markers.
       */
      const onAsk = useCallback((anchorId) => {
        const owner = anchorId === undefined || anchorId === null
          ? steps.find((step) => step.fm.id === (nav.peek?.stepId ?? nav.cursor.stepId)) ?? steps[0]
          : steps.find((step) => step.anchors.includes(anchorId));
        if (owner === undefined) {
          setError(t('needAskTarget'));
          return;
        }
        setAskTarget({ anchorId: anchorId ?? null, stepId: owner.fm.id });
        setAskText('');
        setError(null);
      }, [steps, nav, t]);

      const submitAsk = useCallback(async () => {
        if (askTarget === null) return;
        const text = askText.trim();
        if (text.length === 0) return;
        setSending(true);
        try {
          /* Stable per submission: a retry (timeout, second click) must reuse the
           * same branch instead of opening a duplicate question. */
          const requestId = `lm-${String(face?.sessionId ?? 'none').slice(0, 12)}-${Date.now().toString(36)}`;
          const accepted = await runHost('ask', {
            anchor_id: askTarget.anchorId,
            step_id: askTarget.stepId,
            question: text,
            request_id: requestId,
          });
          if (!accepted) {
            const next = [...drafts, {
              id: `Q${String(drafts.length + 1).padStart(3, '0')}`,
              stepId: askTarget.stepId,
              anchorId: askTarget.anchorId,
              question: text,
              createdAt: new Date().toISOString(),
              status: 'draft',
            }];
            setDrafts(next);
            saveDrafts(face.sessionId, next);
          }
          setAskTarget(null);
          setAskText('');
        } finally {
          setSending(false);
        }
      }, [askTarget, askText, drafts, face, runHost]);

      const removeDraft = useCallback((id) => {
        const next = drafts.filter((draft) => draft.id !== id);
        setDrafts(next);
        saveDrafts(face.sessionId, next);
      }, [drafts, face]);

      const currentStepId = focusStepId(nav);
      const cursorIndex = stepIds.indexOf(nav.cursor.stepId);
      const peekStep = nav.peek === null || nav.peek === undefined
        ? null
        : steps.find((step) => step.fm.id === nav.peek.stepId) ?? null;

      /* ---- header bar ---- */
      const bar = h('div', { className: 'lm-bar' },
        h('span', { className: 'lm-title' }, t('title')),
        topic !== null ? h('span', { className: 'lm-chip mono' }, topic) : null,
        h('span', { className: 'lm-chip mono' }, `${t('mainline')} ${nav.cursor.stepId ?? '—'} · ${cursorIndex >= 0 ? cursorIndex + 1 : 0}/${stepIds.length}`),
        h('span', { className: 'lm-chip mono' }, nav.focus.kind === 'main' ? 'main' : `${nav.focus.kind}:${nav.focus.targetId ?? currentStepId ?? '—'}`),
        h('span', { className: 'lm-chip mono' }, `${t('stack')} ${nav.stack.length}`),
        h('span', { className: 'lm-chip mono', title: '诊断：读取阶段 / 步骤数 / 分支数 / 会话 / 错误' },
          `phase=${phase} steps=${steps.length} q=${Array.isArray(threads) ? threads.length : 0} sid=${String(face?.sessionId ?? '—')}${error ? ` err=${String(error).slice(0, 60)}` : ''}`),
        mark !== null
          ? h('span', {
              className: 'lm-chip mono lm-mark-chip',
              title: `${t('markHint')}（${t('returnToMark')}）`,
              onClick: returnToMark,
            }, `📌 ${mark.stepId}`)
          : null,
        h('span', { style: { flex: 1 } }),
        h('button', { className: 'lm-btn primary', onClick: onNext, disabled: stepIds.length === 0 }, t('next')),
        h('button', { className: 'lm-btn', onClick: () => onBack(nav.cursor.stepId), disabled: stepIds.length === 0 }, t('back')),
        h('button', { className: 'lm-btn', onClick: onReturn, disabled: nav.stack.length === 0 }, t('returnLayer')),
        h('button', { className: 'lm-btn', onClick: onResume, disabled: nav.stack.length === 0 && nav.focus.kind === 'main' }, t('resume')),
        h('button', { className: 'lm-btn', onClick: () => setImportOpen((open) => !open) }, t('importDoc')),
        h('button', {
          className: 'lm-btn',
          onClick: () => { forceAdoptRef.current = true; setReloadTick((tick) => tick + 1); refreshTopics(); },
        }, t('refresh')),
      );

      const importRow = importOpen
        ? h('div', { className: 'lm-bar lm-import' },
            modelOptions.length > 0
              ? h('select', {
                  className: 'lm-select',
                  value: modelPick,
                  title: t('modelLabel'),
                  onChange: (event) => setModelPick(event.target.value),
                }, [
                  h('option', { key: '__keep', value: '' }, t('modelKeep')),
                  ...modelOptions.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
                ])
              : null,
            h('input', {
              className: 'lm-input',
              value: importPath,
              placeholder: t('importPlaceholder'),
              onChange: (event) => setImportPath(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') submitImport(); },
            }),
            h('button', { className: 'lm-btn primary', onClick: submitImport, disabled: importPath.trim().length === 0 }, t('importSubmit')),
            h('span', { className: modelError.length > 0 ? 'lm-meta lm-error' : 'lm-meta' }, modelError.length > 0 ? modelError : t('importHint')),
          )
        : null;

      /* ---- left column: topics + step catalogue ---- */
      const left = h('div', { className: 'lm-col left' },
        h('div', { className: 'lm-section-title' }, t('topics')),
        topics.length === 0
          ? h('div', { className: 'lm-empty' }, t('noTopic'))
          : topics.map((name) => h('button', {
              key: name,
              className: `lm-topic${name === topic ? ' active' : ''}`,
              onClick: () => setTopic(name),
            }, name)),
        h('div', { className: 'lm-section-title', style: { marginTop: 14 } }, t('steps')),
        steps.length === 0
          ? h('div', { className: 'lm-empty' }, t('emptyTopic'))
          : steps.map((step) => h('div', {
              key: step.fm.id ?? step.file,
              className: `lm-step-row${step.fm.id === currentStepId ? ' active' : ''}${mark?.stepId === step.fm.id ? ' marked' : ''}`,
              title: t('markHint'),
              onClick: () => markStep(step.fm.id),
            },
              h(StatusDot, { status: step.fm.status }),
              h('span', { className: 'lm-step-id' }, step.fm.id ?? '?'),
              h('span', { className: 'lm-step-title' }, step.fm.title ?? step.file),
              h('button', {
                className: 'lm-mini',
                title: t('back'),
                onClick: (event) => { event.stopPropagation(); onBack(step.fm.id); },
              }, '↩'),
            )),
      );

      /* ---- center column: continuous preview ---- */
      let center;
      if (phase === 'idle' || phase === 'loading') {
        center = h('div', { className: 'lm-col center' }, h('div', { className: 'lm-empty' }, t('loading')));
      } else if (phase === 'empty') {
        center = h('div', { className: 'lm-col center' },
          h('div', { className: 'lm-empty' }, t('empty'), h('div', null, t('emptyHint')),
            rootProbe !== null ? h('div', { className: 'lm-meta', style: { marginTop: 8 } }, rootProbe) : null));
      } else if (phase === 'failed') {
        center = h('div', { className: 'lm-col center' },
          h('div', { className: 'lm-empty lm-error' }, `${t('openFailed')}: ${error ?? ''}`));
      } else {
        center = h('div', { className: 'lm-col center', ref: previewRef },
          steps.map((step) => {
            const isCurrent = step.fm.id === currentStepId;
            const deps = Array.isArray(step.fm.depends_on) ? step.fm.depends_on : (step.fm.depends_on ? [step.fm.depends_on] : []);
            const sources = Array.isArray(step.fm.source_refs) ? step.fm.source_refs : (step.fm.source_refs ? [step.fm.source_refs] : []);
            return h('div', {
              key: step.fm.id ?? step.file,
              className: `lm-card${isCurrent ? ' current' : ''}${mark?.stepId === step.fm.id ? ' marked' : ''}${flashTick > 0 && mark?.stepId === step.fm.id ? ' flash' : ''}`,
              'data-step': step.fm.id,
              onClick: () => markStep(step.fm.id),
            },
              h('div', { className: 'lm-card-head' },
                h(StatusDot, { status: step.fm.status }),
                h('span', { className: 'lm-card-title' }, `${step.fm.id ?? '?'} · ${step.fm.title ?? step.file}`),
                step.fm.type ? h('span', { className: 'lm-meta' }, step.fm.type) : null,
                step.fm.content_status ? h('span', { className: 'lm-meta' }, step.fm.content_status) : null,
                h('span', { style: { flex: 1 } }),
                h('button', {
                  className: 'lm-mini',
                  title: t('ask'),
                  onClick: () => onAsk(null),
                }, `⁉ ${t('askStep')}`),
              ),
              h('div', { className: 'lm-meta' },
                deps.length > 0 ? `${t('deps')}: ${deps.join(', ')}` : null,
                sources.length > 0 ? ` ｜ ${t('source')}: ${sources.join(', ')}` : null,
              ),
              h(Blocks, { blocks: step.blocks, onAsk, onPeek, currentAnchor: nav.peek?.anchorId ?? null }),
            );
          }),
        );
      }

      /* ---- right column: peek + ask + drafts ---- */
      const right = h('div', { className: 'lm-col right' },
        peekStep !== null
          ? h('div', { className: 'lm-card' },
              h('div', { className: 'lm-card-head' },
                h('span', { className: 'lm-card-title' }, t('peek')),
                h('span', { className: 'lm-chip mono' }, nav.peek.anchorId ?? peekStep.fm.id),
                h('span', { style: { flex: 1 } }),
                h('button', { className: 'lm-btn', onClick: () => commit({ ...nav, peek: null }) }, t('close')),
              ),
              h('div', { className: 'lm-p' }, withInlineMath(peekStep.conclusion || '（该步骤暂无结论段落）')),
              h('button', {
                className: 'lm-btn primary',
                style: { marginTop: 8 },
                onClick: () => onAsk(nav.peek.anchorId),
              }, t('ask')),
            )
          : null,
        askTarget !== null
          ? h('div', { className: 'lm-card' },
              h('div', { className: 'lm-card-head' },
                h('span', { className: 'lm-card-title' }, t('ask')),
                h('span', { className: 'lm-chip mono' }, `${askTarget.stepId ?? '?'} ${askTarget.anchorId ?? ''}`),
              ),
              h('textarea', {
                className: 'lm-textarea',
                value: askText,
                placeholder: t('askPlaceholder'),
                onChange: (event) => setAskText(event.target.value),
              }),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
                h('button', { className: 'lm-btn primary', onClick: submitAsk, disabled: sending }, sending ? t('sending') : t('submit')),
                h('button', { className: 'lm-btn', onClick: () => setAskTarget(null) }, t('close')),
              ),
            )
          : null,
        h('div', { className: 'lm-section-title', style: { marginTop: 14 } }, t('threads')),
        threads.length === 0
          ? h('div', { className: 'lm-empty' }, t('threadsEmpty'))
          : threads.slice().reverse().map((thread) => h('div', { key: thread.id, className: 'lm-draft' },
              h('div', { className: 'lm-meta' },
                `${thread.id} · ${thread.stepId.length > 0 ? thread.stepId : '?'}${thread.anchorId.length > 0 ? ` · ${thread.anchorId}` : ''} · ${statusLabel(thread.status)}`),
              h('div', { className: 'lm-draft-q' }, thread.question.length > 0 ? thread.question : '—'),
              thread.answer.length > 0
                ? h('div', { className: 'lm-callout answer' },
                    h('div', { className: 'lm-callout-title' }, t('answer')),
                    h('div', { style: { whiteSpace: 'pre-wrap' } }, thread.answer))
                : h('div', { className: 'lm-meta' }, t('threadWaiting')),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 4 } },
                h('button', {
                  className: 'lm-mini',
                  onClick: () => commit({
                    ...nav,
                    peek: { stepId: thread.stepId.length > 0 ? thread.stepId : nav.cursor.stepId, anchorId: thread.anchorId.length > 0 ? thread.anchorId : null },
                  }),
                }, t('locate')),
                /* The short answer is the default; this asks the tutor to expand the
                 * same branch (wake-only, no new branch, short answer kept). */
                thread.answer.length > 0
                  ? h('button', {
                      className: 'lm-mini',
                      title: t('askDetail'),
                      disabled: sending,
                      onClick: () => runHost('answer_detail', { branch_id: thread.id }),
                    }, `＋ ${t('askDetail')}`)
                  : null,
                thread.anchorId.length > 0
                  ? h('button', { className: 'lm-mini', title: t('ask'), onClick: () => onAsk(thread.anchorId) }, '⁉')
                  : null,
              ),
            )),
        h('div', { className: 'lm-section-title', style: { marginTop: 14 } }, t('drafts')),
        drafts.length === 0
          ? h('div', { className: 'lm-empty' }, t('draftsEmpty'))
          : drafts.map((draft) => h('div', { key: draft.id, className: 'lm-draft' },
              h('div', { className: 'lm-meta' }, `${draft.id} · ${draft.stepId ?? '?'}${draft.anchorId ? ` · ${draft.anchorId}` : ''}`),
              h('div', { className: 'lm-draft-q' }, draft.question),
              h('div', { className: 'lm-meta' }, t('draftPending')),
              h('button', { className: 'lm-btn', style: { marginTop: 4 }, onClick: () => removeDraft(draft.id) }, t('draftDelete')),
            )),
      );

      const notice = error !== null
        ? h('div', { className: 'lm-bar lm-error' }, String(error))
        : (hostNotice.length > 0 ? h('div', { className: 'lm-bar lm-meta' }, hostNotice) : null);

      return h('div', { className: 'lm-root' },
        h('style', null, CSS),
        bar,
        importRow,
        notice,
        h(LmBoundary, null, h('div', { className: 'lm-cols' }, left, center, right)),
      );
    }

    /* ------------------------------------------------------------------ *
     * Plugin body
     * ------------------------------------------------------------------ */

    const inject = ['slots', 'locale', 'remote', 'remote.workspaceFiles'];

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'learning-mode: dictionaries');

      /* The Host command channel (M3): `remote.commands` carries panel actions into
       * the Host `learn` command, which runs the same state machine the agent tool
       * runs. A nested injection keeps the panel working when the composition has
       * no commands service — its buttons then degrade to panel-local mode. */
      let commandsRemote = null;
      /* Optional services: the model picker rides on the same session directory the
       * composer and `/model` use. A composition without them simply has no picker. */
      let modelDirectories = null;
      let sessionsService = null;
      if (typeof ctx.inject === 'function') {
        ctx.inject(['modelDirectories', 'sessions'], (scope) => {
          modelDirectories = scope.modelDirectories ?? null;
          sessionsService = scope.sessions ?? null;
          return () => { modelDirectories = null; sessionsService = null; };
        });
      }
      if (typeof ctx.inject === 'function') {
        ctx.inject(['remote.commands'], (scope) => {
          commandsRemote = scope.remote.commands;
          return () => { commandsRemote = null; };
        });
      }

      /* Sidebar entry: an icon row in the global panel list. */
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        label: () => t('title'),
      }, PanelIcon)), 'learning-mode: sidebar entry');

      /* Main panel: the shell renders the keyed entry matching the active panel id. */
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        children: { 'main.learning': { kind: 'single', scope: 'session' } },
      }, LearningPanel)), 'learning-mode: main panel');

      /* Session-scoped body: gets sessionId, owns the three columns. */
      ctx.effect(() => ctx.slots.inject('main.learning', () => ctx.slots.register({
        name: 'main.learning',
        locale: NS,
        inject: (sessionId) => ({
          face: createFace(ctx.remote, sessionId, () => commandsRemote),
          commands: () => commandsRemote,
          models: () => modelDirectories,
          sessions: () => sessionsService,
        }),
      }, LearningBody)), 'learning-mode: body');
    }

    return { inject, apply };
  },
});
