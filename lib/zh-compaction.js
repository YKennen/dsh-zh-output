/**
 * 中文上下文压缩引擎。
 *
 * 继承官方 `@deepseek-ai/dsh-compaction-basic` 的 `BasicCompactionEngine`，
 * 只覆盖 `summarize` 这一个钩子：把官方硬编码的英文摘要指令换成中文，让
 * 压缩生成的 checkpoint 摘要使用中文。其余压缩行为（阈值、保留比例、token
 * 计量、surface region、事件落盘等）完全复用官方实现，因此与官方压缩的
 * 行为完全一致，仅摘要语言不同。
 *
 * 使用方式：在 agent preset 的 compaction 组里，用本插件替换官方
 * `@deepseek-ai/dsh-compaction-basic` 一行即可。它注册同名 `compaction`
 * 服务，因此必须放在 `isolate: { compaction: true }` 的领域内（官方 preset
 * 本来就是这样配置的），不会与其他 preset 的压缩实例冲突。
 *
 * @module dsh-zh-compaction
 */

import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import { BlockAssembler, createUserMessage, contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'

/**
 * 中文压缩摘要指令。结构与官方 `COMPACTION_INSTRUCTION` 一一对应，
 * 仅把自然语言换成中文，并明确要求用中文书写；文件路径、命令、错误字符串、
 * 标识符、数值、函数签名等非自然语言内容照旧原样保留。
 */
const ZH_COMPACTION_INSTRUCTION = [
  '你现在作为这个 AI 编码助手的上下文压缩引擎。把上面的对话浓缩成一个结构化的检查点，让另一个模型能够在不丢失关键上下文的情况下继续工作。',
  '',
  '严格输出下面的 Markdown 结构：保留每个小节，保持顺序。用简洁的要点而非段落。空的小节写"(无)"——绝不能省略小节。',
  '',
  '## 主要请求与意图',
  '- [用户最初和演进的目标；措辞重要时逐字引用]',
  '',
  '## 关键技术概念',
  '- [涉及的技术、框架、模式与约定]',
  '',
  '## 文件与代码',
  '- [精确路径：为什么重要、关键改动或片段]',
  '',
  '## 错误与修复',
  '- [错误：如何解决，以及相关的用户反馈]',
  '',
  '## 待办任务',
  '- [明确要求但尚未完成的工作]',
  '',
  '## 当前工作',
  '- [此检查点时正在进行的精确工作]',
  '',
  '## 下一步',
  '- [紧接最近请求的单个下一步动作，或"(无)"]',
  '',
  '## 关键上下文',
  '- [决策及其理由、约束、用户偏好、未决问题、继续所需的数据]',
  '',
  '规则：',
  '- 用简洁的中文书写。精确保留文件路径、命令、错误字符串、标识符、数值、函数签名和语法片段。',
  '- 忠实记录用户反馈和明确指示，尤其是更正。',
  '- 不要提及这次摘要请求，也不要提及上下文已被压缩。',
  '- 只输出检查点文本：不要调用任何工具或做任何其他动作。',
  '- 如果对话中已存在 <compacted-summary> 块，那是先前的检查点。不要逐字照搬：保留仍然为真的事实，丢弃过时的，并把更新的信息合并进同一结构下的单一摘要。',
].join('\n')

/**
 * 把流式终态映射为失败错误（与官方 `finishError` 一致）。
 * @param {object} finish - `BlockAssembler.finish` 的终态。
 * @returns {Error|undefined} 终态为 error/aborted/max-tokens 时返回错误，否则 undefined。
 */
function finishError(finish) {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message)
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens': {
      const error = new Error('summarization truncated at the token cap (incomplete checkpoint)')
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/**
 * 中文压缩引擎：复用官方的 region/retention/落盘逻辑，仅把摘要改用中文指令生成。
 */
export class ZhCompactionEngine extends BasicCompactionEngine {
  /**
   * 覆盖官方的 `summarize` 钩子，用中文指令做一次性摘要。
   * 目标模型与 token 上限的解析规则（configured → 会话路由 → agent options，
   * 以及 modelPolicies 覆盖）与官方 `summarizeWithLlm` 保持一致。
   * @param {import('@deepseek-ai/dsh-compaction-basic/src/summarizer.ts').SummarizationInput} input - 重放的会话前缀。
   * @param {import('@deepseek-ai/dsh-agent').Agent} agent - 提供路由与 session 的 agent。
   * @param {AbortSignal} [signal] - 取消信号。
   * @returns {Promise<object>} 与官方 `SummaryResult` 相同的摘要结果信封。
   */
  async summarize(input, agent, signal) {
    // 1) 会话使用的 provider/model（用于匹配 modelPolicies）。
    const routed = agent.session.requestHeader()?.config
    const conversation = (routed !== undefined && routed.provider.length > 0 && routed.model.length > 0)
      ? { provider: routed.provider, model: routed.model }
      : (agent.options.provider !== undefined && agent.options.provider.length > 0
          && agent.options.model !== undefined && agent.options.model.length > 0)
        ? { provider: agent.options.provider, model: agent.options.model }
        : undefined

    // 2) 合并 modelPolicies 覆盖，得到摘要调用要用的 provider/model/maxTokens。
    const override = conversation === undefined
      ? undefined
      : this.config.modelPolicies.find(policy => policy.provider === conversation.provider && policy.model === conversation.model)
    const summarizationProvider = override?.summarizationProvider ?? this.config.summarizationProvider
    const summarizationModel = override?.summarizationModel ?? this.config.summarizationModel
    const maxTokens = override?.maxTokens ?? this.config.maxTokens

    // 3) 摘要调用的最终目标：显式配置的摘要模型 → 会话路由 → agent options。
    const latest = agent.session.requestHeader()?.config
    const configured = summarizationProvider.length === 0
      ? undefined
      : { provider: summarizationProvider, model: summarizationModel }
    const agentTarget = (agent.options.provider !== undefined && agent.options.provider.length > 0
      && agent.options.model !== undefined && agent.options.model.length > 0)
      ? { provider: agent.options.provider, model: agent.options.model }
      : undefined
    const target = configured ?? latest ?? agentTarget
    if (target === undefined) {
      throw new Error(
        'no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields',
      )
    }

    // 4) 用中文指令做一次性流式摘要。
    const assembler = new BlockAssembler()
    const messages = [
      ...input.messages,
      createUserMessage({
        content: [{ type: 'text', text: ZH_COMPACTION_INSTRUCTION }],
        source: { kind: 'plugin', plugin: 'dsh-zh-compaction' },
      }),
    ]
    const options = {
      provider: target.provider,
      model: target.model,
      messages,
      ...input.system === undefined ? {} : { system: input.system },
      ...input.tools === undefined ? {} : { tools: [...input.tools] },
      maxTokens,
      sessionId: agent.session.id,
      purpose: 'compaction',
      ...signal === undefined ? {} : { signal },
    }
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk)

    const error = finishError(assembler.finish)
    if (error !== undefined) throw error

    const rawOutput = assembler.blocks()
    if (contentHasImage(rawOutput)) {
      throw new LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
    }
    const summary = rawOutput.filter((block) => block.type === 'text')
    if (!summary.some((block) => block.text.trim().length > 0)) {
      throw new Error('summarization produced no text summary content')
    }

    return {
      summary,
      rawOutput,
      llmStreamCall: true,
      provider: options.provider,
      model: options.model,
      maxTokens,
      ...assembler.usage === undefined ? {} : { usage: assembler.usage },
    }
  }
}

export default ZhCompactionEngine
