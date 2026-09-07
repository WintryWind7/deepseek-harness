/**
 * Model-facing tool so worktree-dev can put a committed fix on the verify queue.
 * @module @deepseek-ai/dsh-experimental-verify-queue/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'

/** Cordis plugin name. */
export const name = 'tool-verify-queue'
/** Host verify-queue service plus the tool registry. */
export const inject = ['verifyQueue', 'tools']

const DESCRIPTION
  = 'Record one committed worktree fix on the project verify queue so it can later '
    + 'be checked against main and accepted on the running app. Call this only after '
    + 'the fix is committed on this session\'s worktree branch. title is a short '
    + 'reminder of what to look at (the bug or UI change). Omit commits to record '
    + 'this worktree HEAD. Do not record planning work, uncommitted edits, or '
    + 'screenshot-only sessions.'

/**
 * Register `verify_queue_record`.
 * @param ctx - context carrying verifyQueue and tools.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'verify_queue_record',
    description: DESCRIPTION,
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Short reminder of the user-visible change to check after it reaches main.',
      },
      commits: {
        type: 'array',
        description: 'Commit SHAs or refs to require on main. Defaults to this worktree HEAD.',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          commits: {
            type: 'array',
            required: true,
            items: { type: 'string' },
          },
          status: { type: 'string', required: true, enum: ['recorded', 'on-main', 'verified'] },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Verify queue: ${value.title} (${value.status})`,
      }],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('verify_queue_record requires an owning agent session')
      const cwd = agent.session.header.cwd
      if (typeof cwd !== 'string' || cwd.trim() === '') {
        throw new Error('verify_queue_record requires a session workspace cwd')
      }
      const { id, view } = await ctx.verifyQueue.record(cwd, {
        title: args.title,
        sessionId: agent.session.header.id,
        commits: args.commits ?? [],
      })
      const row = view.rows.find(entry => entry.item.id === id)
      if (row === undefined) throw new Error('verify_queue_record did not persist an item')
      return {
        id: row.item.id,
        title: row.item.title,
        commits: [...row.item.commits],
        status: row.status,
      }
    },
  }))
}
