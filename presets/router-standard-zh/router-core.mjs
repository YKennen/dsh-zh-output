/**
 * router-core: reasoning-mode routing logic (zero dependencies).
 *
 * BEHAVIORAL REALITY (measured, 21-point × n=2 on v4-pro): model behavior
 * along the react↔spec axis collapses into THREE stable regions, not a
 * continuum — spec [0, 0.15], a transition band [0.2, 0.45] (unstable mix,
 * avoid), and react [0.5, 1.0] (11 mode values behave identically). The
 * numeric interface therefore maps onto three behavior bands; "continuous"
 * tuning is an illusion at the model layer.
 *
 * FOURTH MODE — weak (internal routing): P8/P11 show a weak-persona domain
 * where the model routes itself from the task (discrimination up to +5.0).
 * The optimal weak persona is model-specific (P11, n=3):
 *   - pro:   spec sentence + few-shot routing instruction (w6, +5.00)
 *   - flash: neutral + explicit "classify then act" instruction (w7, +5.67)
 *   - spec-sentence weak personas ANTI-route on flash (planGreen > 0).
 *
 *   mode 0    → pure spec  — plan-first, collective, read-first tools
 *   mode 0.3  → mixed      — transition band (trap; only explicit opt-in)
 *   mode 1    → pure react — doer, produce-verify-fix, test-suppressed
 *   mode W    → weak       — internal routing (model decides per task)
 *
 * `mode` is stored as a number in [0, 1] or the string 'weak'; band mapping
 * quantizes to the four modes.
 */

export const MODE_SPEC = 0
export const MODE_MIXED = 0.3
export const MODE_REACT = 1
export const MODE_WEAK = 'weak'

const ZH_LANGUAGE_RULE =
  '【语言铁律 · 最高优先级】你的全部思考过程与所有输出（对话正文、说明、注释、报告、总结，以及工具调用参数中的自然语言）必须始终使用中文；仅代码、命令、标识符、URL、文件路径、日志原文等非自然语言内容可保留原样。无论用户使用何种语言提问，你都只用中文思考并用中文作答。此约束优先于任何其他关于输出语言或风格的指令。'

const SPEC_PERSONA =
  '你是一名乐于助人的软件工程师助手。\n\n' + ZH_LANGUAGE_RULE

const MIXED_PERSONA =
  '你是一名乐于助人的软件工程师助手。\n\n' + ZH_LANGUAGE_RULE + '\n'
  + '直接工作：优先编写或编辑代码，而不是描述计划。通过阅读和运行来验证你的改动。'

const REACT_PERSONA =
  '你是一名动手型的软件工程师，快速交付可用产出。\n\n' + ZH_LANGUAGE_RULE + '\n'
  + '直接工作：编写或编辑代码，然后通过阅读和运行验证。保持紧凑循环——产出、验证、修复——不要构建用户没有要求的测试脚手架、辅助框架或仪式。以可用的交付物和简短总结收尾。'

/** Weak (internal-routing) personas — model-specific optimum (P11/P24).
 *  pro:   spec sentence + classify instruction (w6c, +4.67, P24) — the
 *         few-shot variants and the recall/converge anchors HURT Pro
 *         (P24: suite-full 83% < naked 87.5% vs +guide 100%)
 *  flash: neutral + classify + recall/converge/anti-runaway anchors
 *         (w7, +5.67, P11; anchors lift single-task completion to 100%, P23)
 */
const WEAK_PRO =
  '你是一名乐于助人的软件工程师助手。\n\n' + ZH_LANGUAGE_RULE + '\n'
  + '行动前，先判定任务类型（构建或修复）并采用匹配的风格：构建 → 动手产出；修复 → 先检查再规划。'

const WEAK_FLASH =
  '你是一名乐于助人的助手。\n\n' + ZH_LANGUAGE_RULE + '\n'
  + '行动前，先判定任务类型（构建或修复）并采用匹配的风格：构建 → 动手产出；修复 → 先检查再规划。\n'
  + '行动前，简要回顾本会话已完成的工作并从中断处继续；不要重复已完成的步骤。不要运行环境检查（echo、whoami、uname、node --version、date）或穷举式 grep/glob 扫描。\n'
  + '先深入思考，再产出。'

/** Complexity heuristic: long or architecturally-worded tasks are COMPLEX.
 *  Simple tasks get fast-convergence guidance; complex tasks get deep
 *  exploration guidance (depth-adaptive, v19). */
const COMPLEX_RE = /(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|refactor|comprehensive|detailed|design|system|optimize|analyze)/i

export function isComplexTask(text) {
  return typeof text === 'string' && (text.length > 120 || COMPLEX_RE.test(text))
}

/** True when the routed model id is a Flash-family model. */
export function isFlashModel(modelId) {
  return typeof modelId === 'string' && /flash/i.test(modelId)
}

/** Quantize a mode to one of the four measured behavior bands. */
export function bandOf(mode) {
  if (mode === 'weak') return 'weak'
  const m = clamp01(mode)
  if (m < 0.2) return 'spec' // measured stable spec region (0..0.15)
  if (m < 0.5) return 'transition' // measured unstable band — avoid
  return 'react' // measured stable react region (0.5..1 behave alike)
}

/** Persona for a mode; weak picks the model-specific internal-routing text. */
export function personaFor(mode, modelId) {
  switch (bandOf(mode)) {
    case 'spec': return SPEC_PERSONA
    case 'transition': return MIXED_PERSONA
    case 'weak': return isFlashModel(modelId) ? WEAK_FLASH : WEAK_PRO
    default: return REACT_PERSONA
  }
}

/** First-turn core tools (shell added dynamically by the plugin).
 *  v0.2.0: the weak (internal-routing) band gets the RL-shape surface —
 *  shell + str_replace_editor — per the interface-restoration measurement
 *  (100% action at 18–29K reasoning chars vs ~25% / 73–101K on the
 *  read/write/edit surface, official API, 2026-08-15). */
export function coreFor(mode) {
  switch (bandOf(mode)) {
    case 'spec': return ['read', 'edit', 'glob', 'grep'] // read-first
    case 'transition': return ['read', 'edit', 'write', 'glob', 'grep'] // union
    case 'weak': return ['str_replace_editor'] // RL shape: shell + editor
    default: return ['read', 'write', 'edit'] // write-first
  }
}

/** Human-readable band name for a mode value. */
export function bandFor(mode) {
  const b = bandOf(mode)
  return b === 'transition' ? 'mixed' : b
}

/** Test-suppression strength for a mode (informational). */
/** Test-suppression strength for a mode (informational). */
export function testinessFor(mode) {
  switch (bandOf(mode)) {
    case 'react': return 'suppressed'
    case 'spec': return 'normal'
    default: return 'light'
  }
}

const REACT_RE = /(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi
const SPEC_RE = /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi

function countHits(regex, text) {
  return [...text.matchAll(regex)].length
}

/**
 * Classify a task text into a mode. Clear keyword evidence picks a stable
 * band (1 react / 0 spec); AMBIGUOUS or unmatched text returns 'weak' —
 * the internal-routing mode, where the model decides per task (P11 optimum).
 */
export function classifyTask(text) {
  const react = countHits(REACT_RE, text)
  const spec = countHits(SPEC_RE, text)
  if (react > spec) return 1
  if (spec > react) return 0
  return 'weak'
}

/** Per-session mode derived from durable events (resume-safe). */
export function sessionMode(session) {
  const events = session.events
  const userMsg = events.find((e) => e.type === 'user/message')
  return classifyTask(extractText(userMsg?.data))
}

export function extractText(data) {
  if (!data) return ''
  // 防御性解包：插件/工具生成的 user/message 偶有 `data.message` 嵌套形状
  // （如注入器 startIngest 的 seed），直接读 data.content 会得到空串 →
  // 构建/修复任务被误判 weak（router-standard issue #1）。
  const payload = data && typeof data.message === 'object' && data.message !== null ? data.message : data
  const content = Array.isArray(payload.content) ? payload.content : []
  return content.map((c) => (typeof c === 'string' ? c : (c.text ?? ''))).join(' ')
}

export function clamp01(v) {
  return Math.min(1, Math.max(0, Number(v) || 0))
}

/**
 * Replace only the persona section of an assembled section list, keeping
 * everything else — the plan-mode section above all, which is toggled per
 * plan state and carries the plan-boundary instructions.
 */
export function applyPersona(sections, personaText) {
  const rest = (sections || []).filter(
    (section) => section.name !== 'persona' && !/persona/i.test(section.name),
  )
  return [...rest, { name: 'router-persona', text: personaText, order: 0 }]
}

/** Parse a user/agent-supplied mode token: number 0-100, 0.0-1.0, or a band name. */
export function parseMode(token) {
  if (token === undefined || token === null) return null
  const t = String(token).trim().toLowerCase()
  if (t === 'auto') return 'auto'
  if (t === 'weak' || t === 'router') return 'weak'
  if (t === 'spec' || t === 'spec-lean') return 0
  if (t === 'balanced' || t === 'mixed') return 0.3 // transition-band center
  if (t === 'react' || t === 'react-lean') return 1
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (t.includes('.')) return clamp01(n)
  return clamp01(n / 100)
}
