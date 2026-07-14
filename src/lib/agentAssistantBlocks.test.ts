import { describe, expect, it } from 'vitest'
import type { AgentRound, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import {
  getAgentAssistantBlocks,
  getAgentAssistantCopyContent,
  getRoundTaskSlots,
  type AgentAssistantBlock,
} from './agentAssistantBlocks'

const round = (patch: Partial<AgentRound> = {}): AgentRound => ({
  id: patch.id ?? 'round-1',
  index: patch.index ?? 1,
  parentRoundId: patch.parentRoundId ?? null,
  userMessageId: patch.userMessageId ?? 'user-1',
  prompt: patch.prompt ?? 'prompt',
  inputImageIds: patch.inputImageIds ?? [],
  outputTaskIds: patch.outputTaskIds ?? [],
  status: patch.status ?? 'done',
  error: patch.error ?? null,
  createdAt: patch.createdAt ?? 1,
  finishedAt: patch.finishedAt ?? 2,
  ...(patch.responseOutput ? { responseOutput: patch.responseOutput } : {}),
})

const task = (id: string, patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id,
  prompt: patch.prompt ?? 'prompt',
  params: patch.params ?? { ...DEFAULT_PARAMS },
  inputImageIds: patch.inputImageIds ?? [],
  maskTargetImageId: patch.maskTargetImageId ?? null,
  maskImageId: patch.maskImageId ?? null,
  outputImages: patch.outputImages ?? [],
  status: patch.status ?? 'done',
  error: patch.error ?? null,
  createdAt: patch.createdAt ?? 1,
  finishedAt: patch.finishedAt ?? 2,
  elapsed: patch.elapsed ?? 1,
  ...(patch.agentToolCallId ? { agentToolCallId: patch.agentToolCallId } : {}),
  ...(patch.agentBatchCallId ? { agentBatchCallId: patch.agentBatchCallId } : {}),
})

describe('agent assistant blocks', () => {
  it('preserves response output order', () => {
    const imageTask = task('task-1', { agentToolCallId: 'image-1' })
    const currentRound = round({
      outputTaskIds: [imageTask.id],
      responseOutput: [
        { type: 'web_search_call', id: 'search-1', status: 'completed', action: { type: 'search' } },
        { type: 'message', id: 'message-1', content: [{ text: '搜索结果' }] },
        { type: 'image_generation_call', id: 'image-1' },
        { type: 'message', id: 'message-2', content: [{ text: '生成完成' }] },
      ],
    })

    const blocks = getAgentAssistantBlocks(currentRound, getRoundTaskSlots(currentRound, [imageTask]), [imageTask], true)

    expect(blocks.map((block) => block.type)).toEqual(['web-search', 'text', 'image-task', 'text'])
    expect(blocks.filter((block) => block.type === 'text').map((block) => block.content)).toEqual(['搜索结果', '生成完成'])
  })

  it('keeps deleted task placeholders in round slot order', () => {
    const liveTask = task('task-live')
    const currentRound = round({ outputTaskIds: ['task-deleted', liveTask.id] })
    const slots = getRoundTaskSlots(currentRound, [liveTask])

    expect(slots).toEqual([
      { taskId: 'task-deleted', task: null },
      { taskId: liveTask.id, task: liveTask },
    ])
    expect(getAgentAssistantBlocks(currentRound, slots, [liveTask], true).map((block) =>
      block.type === 'image-task' ? block.task.id : block.type === 'deleted-image-task' ? block.taskId : block.type,
    )).toEqual(['text', 'task-deleted', 'task-live'])
  })

  it('keeps a deleted generate_image task between surrounding text', () => {
    const currentRound = round({
      outputTaskIds: ['task-deleted'],
      responseOutput: [
        { type: 'message', id: 'message-before', content: [{ text: '生成前' }] },
        { type: 'function_call', name: 'generate_image', call_id: 'image-call-1', arguments: '{}' },
        { type: 'function_call_output', call_id: 'image-call-1', output: '{}' },
        { type: 'message', id: 'message-after', content: [{ text: '生成后' }] },
      ],
    })

    const blocks = getAgentAssistantBlocks(currentRound, getRoundTaskSlots(currentRound, []), [], true)

    expect(blocks.map((block) => block.type)).toEqual(['text', 'deleted-image-task', 'text'])
    expect(blocks.filter((block) => block.type === 'text').map((block) => block.content)).toEqual(['生成前', '生成后'])
    expect(blocks.find((block) => block.type === 'deleted-image-task')).toMatchObject({ taskId: 'task-deleted' })
  })

  it('groups consecutive searches and gives every rendered block a stable unique key', () => {
    const currentRound = round({
      responseOutput: [
        { type: 'web_search_call', id: 'search-1', status: 'completed', action: { type: 'search' } },
        { type: 'web_search_call', id: 'search-2', status: 'completed', action: { type: 'open_page' } },
        { type: 'message', id: 'duplicate-id', content: [{ text: '中间文本' }] },
        { type: 'web_search_call', id: 'search-3', status: 'completed', action: { type: 'search' } },
        { type: 'message', id: 'duplicate-id', content: [{ text: '末尾文本' }] },
      ],
    })

    const blocks = getAgentAssistantBlocks(currentRound, [], [], true)
    const keys = blocks.map((block) => block.key)

    expect(blocks.map((block) => block.type)).toEqual(['web-search', 'text', 'web-search', 'text'])
    expect(new Set(keys).size).toBe(keys.length)
    expect(getAgentAssistantBlocks(currentRound, [], [], true).map((block) => block.key)).toEqual(keys)
  })

  it('appends unmatched tasks and de-duplicates repeated calls and task slots', () => {
    const matchedTask = task('task-matched', { agentToolCallId: 'image-call-1' })
    const unmatchedTask = task('task-unmatched', { agentToolCallId: 'missing-call' })
    const currentRound = round({
      outputTaskIds: [matchedTask.id, matchedTask.id, unmatchedTask.id],
      responseOutput: [
        { type: 'function_call', name: 'generate_image', call_id: 'image-call-1', arguments: '{}' },
        { type: 'function_call', name: 'generate_image', call_id: 'image-call-1', arguments: '{}' },
        { type: 'message', content: [{ text: '完成' }] },
      ],
    })
    const tasks = [matchedTask, unmatchedTask]

    const blocks = getAgentAssistantBlocks(currentRound, getRoundTaskSlots(currentRound, tasks), tasks, true)

    expect(blocks.map((block) => block.type === 'image-task' ? block.task.id : block.type)).toEqual([
      matchedTask.id,
      'text',
      unmatchedTask.id,
    ])
  })

  it('projects batch tasks in round slot order', () => {
    const firstTask = task('task-first', { agentBatchCallId: 'batch-1' })
    const secondTask = task('task-second', { agentBatchCallId: 'batch-1' })
    const currentRound = round({
      outputTaskIds: [secondTask.id, firstTask.id],
      responseOutput: [{ type: 'function_call', name: 'generate_image_batch', call_id: 'batch-1' }],
    })
    const tasks = [firstTask, secondTask]

    const blocks = getAgentAssistantBlocks(currentRound, getRoundTaskSlots(currentRound, tasks), tasks, false)

    expect(blocks.map((block) => block.type === 'image-task' ? block.task.id : block.type)).toEqual([
      secondTask.id,
      firstTask.id,
    ])
  })

  it('marks running web searches as stopped when the round is interrupted', () => {
    const output = [{ type: 'web_search_call', id: 'search-1', status: 'in_progress', action: { type: 'search' } }]
    const runningBlocks = getAgentAssistantBlocks(round({ status: 'running', finishedAt: null, responseOutput: output }), [], [], false)
    const stoppedBlocks = getAgentAssistantBlocks(round({ status: 'error', error: '已停止生成。', responseOutput: output }), [], [], false)

    expect(runningBlocks[0]).toMatchObject({ type: 'web-search', status: { text: '正在搜索网页', completed: false } })
    expect(stoppedBlocks[0]).toMatchObject({ type: 'web-search', status: { text: '已停止搜索网页', completed: true } })
  })

  it('shows interrupted batch parameter collection as stopped', () => {
    const currentRound = round({
      status: 'error',
      error: '已停止生成。',
      responseOutput: [{ type: 'function_call', name: 'generate_image_batch', call_id: 'batch-1' }],
    })

    expect(getAgentAssistantBlocks(currentRound, [], [], false)[0]).toMatchObject({
      type: 'batch-params',
      status: { text: '已停止填写并发图像生成参数', completed: true },
    })
  })

  it('copies ordered block text while retaining the fallback for text-only output', () => {
    const mixedBlocks: AgentAssistantBlock[] = [
      { type: 'text', key: 'text:1', content: ' 第一段 ' },
      { type: 'image-task', key: 'image:1', task: task('task-1') },
      { type: 'text', key: 'text:2', content: '第二段' },
    ]

    expect(getAgentAssistantCopyContent('回退文本', mixedBlocks)).toBe('第一段\n\n第二段')
    expect(getAgentAssistantCopyContent('保留原始格式', [{ type: 'text', key: 'text:fallback' }])).toBe('保留原始格式')
  })
})
