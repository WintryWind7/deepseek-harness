import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import VerifyQueue from '../src/index.ts'
import { apply } from '../src/tool.ts'

const exec = promisify(execFile)

interface ToolArgs {
  title: string
  commits?: string[]
}

interface ToolExec {
  agent?: { session: { header: { id: string; cwd?: string } } }
}

interface ToolResult {
  title: string
  status: string
}

interface RegisteredTool {
  execute: (args: ToolArgs, exec: ToolExec) => Promise<ToolResult>
  output?: {
    render?: (args: ToolArgs, value: ToolResult) => Array<{ type: string; text: string }>
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return stdout.trim()
}

describe('verify_queue_record', () => {
  it('records the session HEAD through the tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verify-queue-tool-'))
    await git(root, ['init'])
    await git(root, ['config', 'user.email', 'verify@example.com'])
    await git(root, ['config', 'user.name', 'Verify Queue'])
    await writeFile(join(root, 'README.md'), 'one\n', 'utf8')
    await git(root, ['add', 'README.md'])
    await git(root, ['commit', '-m', 'first'])
    if (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') {
      await git(root, ['branch', '-M', 'main'])
    }
    const ctx = new Context()
    await ctx.plugin(VerifyQueue)
    let tool: RegisteredTool | undefined
    ctx.provide('tools', {
      register: (defined: RegisteredTool) => {
        tool = defined
        return () => {}
      },
    } as never)
    apply(ctx)
    if (tool === undefined) throw new Error('verify_queue_record was not registered')
    const registered = tool
    await expect(registered.execute({ title: 'x' }, { agent: undefined })).rejects.toThrow('owning agent session')
    await expect(registered.execute({ title: 'x' }, { agent: { session: { header: { id: 's1' } } } }))
      .rejects.toThrow('workspace cwd')
    await expect(registered.execute({ title: 'x' }, { agent: { session: { header: { id: 's1', cwd: '  ' } } } }))
      .rejects.toThrow('workspace cwd')
    const head = await git(root, ['rev-parse', 'HEAD'])
    await registered.execute(
      { title: 'nav', commits: [head] },
      { agent: { session: { header: { id: 's1', cwd: root } } } },
    )
    const result = await registered.execute(
      { title: 'nav2' },
      { agent: { session: { header: { id: 's1', cwd: root } } } },
    )
    expect(result.title).toBe('nav2')
    expect(result.status).toBe('on-main')
    const rendered = registered.output?.render?.({ title: 'nav2' }, result)
    expect(rendered?.[0]?.text).toContain('nav2')
    ctx.verifyQueue.record = (async () => ({
      id: 'ghost',
      view: { workspacePath: root, ui: { open: false, pinned: false }, rows: [] },
    })) as typeof ctx.verifyQueue.record
    await expect(registered.execute(
      { title: 'ghost' },
      { agent: { session: { header: { id: 's1', cwd: root } } } },
    )).rejects.toThrow('did not persist')
  })
})
