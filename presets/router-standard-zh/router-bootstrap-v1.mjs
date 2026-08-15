/**
 * router-bootstrap: task-aware reasoning-mode router with a continuous
 * react↔spec axis.
 *
 * Reads the session's first user message, classifies the task into a
 * continuous mode in [0,1] (0 = spec plan-first, 1 = react doer), and on the
 * first model request injects the matching persona and first-turn core tool
 * set. After the first durable tool/call the full preset catalog is exposed
 * and nothing is touched again; the mode derives from durable session events,
 * so resume/reload keeps it.
 *
 * The agent can read and tune its own routing through `dev_router_status` and
 * `dev_router_mode` (self-optimization loop) — mode accepts band names
 * (spec/spec-lean/balanced/react-lean/react), 0-100 numbers, or 0.0-1.0.
 *
 * Zero external imports on purpose: relative preset rows resolve bare
 * specifiers from the user home, where `@deepseek-ai/*` is not installed.
 * The router tools therefore inline a minimal schema compiler instead of
 * importing `defineTool` from `@deepseek-ai/dsh-tools`.
 */

import {
  applyPersona, bandFor, bandOf, coreFor, parseMode, personaFor, sessionMode, testinessFor, clamp01,
  isComplexTask,
} from './router-core.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'router-bootstrap'

/** Prompt assembly, the tools registry, and the LLM route must exist. */
export const inject = ['systemPrompt', 'tools', 'llm']

/** Minimal spec → JSON Schema compiler (subset of defineTool's work). */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec || {})) {
    const prop = { type: meta.type }
    if (Array.isArray(meta.enum)) prop.enum = meta.enum
    if (meta.description) prop.description = meta.description
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

export function apply(ctx, config) {
  const overrides = new Map() // session id -> explicit mode (number 0..1)
  const agents = new Map() // session id -> Agent (live handle, in-process only)
  const firstUserText = new Map() // session id -> first REAL user message text (issue #3 fix)

  // ── 路由模式（v0.2.0 命名，用户定义）───────────────────────────────────────
  // standard（默认，新）: RL 接口还原——首轮只有 RL 训练句 + shell/str_replace_editor，
  //   模型"想一段、做一段"（实测 25 步 / 24 工具调用 / 产出文件）。
  // spec（旧）: 深度思考优先——分类 persona（w7/REACT/SPEC）+ 保留全部 sections，
  //   模型首轮长思维链（101K 推理 0 行动是其特征，不是缺陷）。
  const routerMode = config.routerMode === 'spec' ? 'spec' : 'standard'
  const RL_PERSONA = '你是一名乐于助人的软件工程师助手。\n\n【语言铁律 · 最高优先级】你的全部思考过程与所有输出（对话正文、说明、注释、报告、总结，以及工具调用参数中的自然语言）必须始终使用中文；仅代码、命令、标识符、URL、文件路径、日志原文等非自然语言内容可保留原样。无论用户使用何种语言提问，你都只用中文思考并用中文作答。此约束优先于任何其他关于输出语言或风格的指令。'

  /** spec 路由模式的首轮工具面（旧行为；weak 也走 default 面）。 */
  function legacyCore(mode) {
    switch (bandOf(mode)) {
      case 'spec': return ['read', 'edit', 'glob', 'grep']
      default: return ['read', 'write', 'edit']
    }
  }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    const session = agent.session
    agents.set(session.id, agent)

    // issue #3 fix: the first assembly happens before the first user/message
    // event lands in session.events, so sessionMode() saw an empty transcript
    // and injected the WEAK band on the path-committing first request. Use the
    // live text captured by the session/event listener (or inbox pending) so
    // the first request carries the REAL classification.
    const mode = overrides.get(session.id) ?? firstUserText.get(session.id) ?? sessionMode(session)
    const modelId = agent.options?.model

    // ── 模式分派 ──
    // standard（RL 接口还原）: 首轮 system = 只有 RL 训练句；身份/Web 定位/工具引导/
    // 规则 sections 全部移除（minimal 的 complete:true 语义，实测 46 字符 system →
    // 25 步迭代工作流）。
    // spec（深度思考优先）: 分类 persona + 保留全部 sections（首轮超长思维链是特征）。
    const planSection = (assembled.sections || []).find((s) => /plan/i.test(s.name))
    let sections
    let core
    let persona
    if (routerMode === 'standard') {
      persona = RL_PERSONA
      sections = planSection
        ? [planSection, { name: 'router-persona', text: persona, order: 0 }]
        : [{ name: 'router-persona', text: persona, order: 0 }]
      core = new Set(['str_replace_editor']) // RL shape: shell + editor
    } else {
      persona = personaFor(mode, modelId)
      sections = applyPersona(assembled.sections, persona) // keep all other sections
      core = new Set(legacyCore(mode))
    }

    if (session.events.some((event) => event.type === 'tool/call')) {
      return { ...assembled, sections, contexts: [] } // promoted: full catalog
    }

    const available = new Set(assembled.tools.map((tool) => tool.name))
    const shell = available.has('pwsh') ? 'pwsh' : available.has('bash') ? 'bash' : null
    if (shell === null) {
      throw new Error(`${name}: no platform shell in catalog`)
    }
    core.add(shell)

    return {
      ...assembled,
      sections,
      contexts: [],
      tools: assembled.tools.filter((tool) => core.has(tool.name)),
    }
  })

  // ── near-field routing guidance for weak mode (P14/P16/P17/P19/P20) ─────
  // Every REAL user message in a weak-mode session gets ONE fixed guidance
  // message appended to the inbox right after it (near field, cache-neutral).
  // v19: depth-adaptive — SIMPLE tasks get the fast-convergence guide;
  // COMPLEX tasks get the deep-exploration guide (depth-first, information-
  // driven stop signal). The persona carries no hard converge anchor
  // (P27: information-driven convergence beats step-driven; user feedback:
  // flash was over-confident / too shallow on complex tasks).
  const GUIDE_WEAK =
    '\n路由：现在先判定任务类型（构建或修复），然后采用匹配的风格——构建：直接产出；修复：先检查。先深入思考，再动手执行。'
  const GUIDE_DEEP =
    '\n路由：现在先判定任务类型（构建或修复），然后采用匹配的风格——构建：直接产出；修复：先检查。深入思考架构、边界情况与集成点。不要在环境或工具上浪费推理。当信息完备时再产出。每个推理块以决策或信息需求结尾。'

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'user/message') return
    const data = event.data ?? {}
    if (data.source?.kind !== 'user') return // only real user messages
    const text = extractText(data)
    if (!firstUserText.has(session.id) && text.trim()) {
      firstUserText.set(session.id, text.trim()) // issue #3: capture BEFORE assembly
    }
    const agent = ctx.get('agent')
    const target = agent !== undefined && agent.session === session ? agent : [...agents.values()].find((a) => a.session === session)
    if (target === undefined || target.inbox === undefined) return
    const mode = overrides.get(session.id) ?? firstUserText.get(session.id) ?? sessionMode(session)
    if (bandOf(mode) !== 'weak') return // strong modes need no guidance
    if (!text.trim()) return
    const guide = isComplexTask(text) ? GUIDE_DEEP : GUIDE_WEAK
    try {
      target.inbox.append('next-step', {
        id: `router-guide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        source: { kind: 'plugin', plugin: 'router-bootstrap' },
        content: [{ type: 'text', text: guide }],
      })
    } catch { /* duplicate/ordering races: skip */ }
  })

  // ── router visibility & tuning (agent self-optimization) ────────────────
  const registerTool = (tool) => {
    ctx.effect(() => ctx.tools.register({
      ...tool,
      parameters: toJsonSchema(tool.parameters),
      // output.schema is already a plain JSON Schema; keep it as-is
    }))
  }

  const modeSpec = {
    mode: {
      type: 'string',
      required: true,
      description: '波段名（spec / weak / mixed / react）、0-100 数字、0.0-1.0 数字，或 auto 清除覆盖',
    },
  }

  function fmtMode(mode) {
    return typeof mode === 'string' ? mode : mode.toFixed(2)
  }

  registerTool({
    name: 'dev_router_status',
    description: '显示本会话的推理模式路由：模式、波段、人设、首轮核心工具、测试抑制，以及是否启用了覆盖。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute() {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const mode = overrides.get(session.id) ?? sessionMode(session)
      const modelId = currentAgent()?.options?.model
      return [
        `router-mode=${routerMode} (standard=RL接口还原 / spec=深度思考优先)`,
        `mode=${fmtMode(mode)} (band=${bandFor(mode)})`,
        `persona=${personaFor(mode, modelId).replace(/\n/g, ' / ')}`,
        `core=[${coreFor(mode).join(', ')}]`,
        `testiness=${testinessFor(mode)}`,
        `override=${overrides.has(session.id) ? 'yes' : 'no'}`,
      ].join('\n')
    },
  })

  registerTool({
    name: 'dev_router_mode',
    description: '设置本会话的推理模式：spec（先规划）/ weak（内部路由，模型按任务自行决定）/ mixed（过渡，陷阱）/ react（实干）。接受波段名、0-100 数字或 0.0-1.0；用 auto 恢复任务分类。下一次请求生效。',
    parameters: modeSpec,
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute(args) {
      const parsed = parseMode(args.mode)
      if (parsed === null) return `invalid mode "${args.mode}": use spec/weak/mixed/react, 0-100, 0.0-1.0, or auto`
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      if (parsed === 'auto') overrides.delete(session.id)
      else overrides.set(session.id, parsed === 'weak' ? 'weak' : clamp01(parsed))
      const current = overrides.get(session.id) ?? sessionMode(session)
      return `mode=${fmtMode(current)} (band=${bandFor(current)}) — next request applies`
    },
  })

  // ── mode-isolated subagent: run a task in a DIFFERENT reasoning mode,
  //    without touching this session's trajectory (P6 showed tail persona
  //    is ineffective; DSH's native subagent inherits this persona, so the
  //    only working isolation is a fresh LLM call with its own system). ──
  registerTool({
    name: 'dev_mode_subagent',
    description: '在本会话之外的另一种推理模式下运行一个任务，使用全新隔离上下文（自带系统提示）。当前会话轨迹不受影响。模式：spec（先规划）/ weak（内部路由）/ react（实干）/ balanced。返回子智能体的回答文本。',
    parameters: {
      mode: { type: 'string', required: true, description: 'spec / weak / react / balanced（或 0-100）' },
      task: { type: 'string', required: true, description: '交给模式隔离子智能体的任务' },
      maxTokens: { type: 'number', description: '输出上限（默认 1024）' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) {
      const parsed = parseMode(args.mode)
      if (parsed === null || parsed === 'auto') return `invalid mode "${args.mode}"`
      const session = currentSession()
      const agent = session === undefined ? undefined : [...agents.values()].find((a) => a.session === session)
      if (agent === undefined || agent.options === undefined) return 'no agent route available'
      const { provider, model } = agent.options
      if (!provider || !model) return 'agent route missing provider/model'

      const persona = personaFor(parsed, model)
      const maxTokens = Number(args.maxTokens || 1024)
      let text = ''
      let reasoningChars = 0
      try {
        const stream = ctx.llm.stream({
          provider,
          model,
          system: persona,
          messages: [{ role: 'user', content: [{ type: 'text', text: String(args.task) }] }],
          maxTokens,
        })
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') text += chunk.text
          else if (chunk.type === 'reasoning-delta') reasoningChars += chunk.text.length
        }
      } catch (error) {
        return `subagent error: ${error && error.message ? error.message : String(error)}`
      }
      const head = text.slice(0, 3000)
      return `[mode-subagent ${bandFor(parsed)} | reasoning ${reasoningChars} chars]\n${head}${text.length > 3000 ? '\n…(truncated)' : ''}`
    },
  })

  function currentSession() {
    const agent = ctx.get('agent')
    if (agent !== undefined && agent.session !== undefined) return agent.session
    const last = [...agents.values()].at(-1)
    return last?.session
  }

  function currentAgent() {
    const session = currentSession()
    return session === undefined ? undefined : [...agents.values()].find((a) => a.session === session)
  }
}
