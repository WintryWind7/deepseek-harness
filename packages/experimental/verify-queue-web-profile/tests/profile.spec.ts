/** The experimental Web bundle must carry a parseable verify-queue layer. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import '../src/index.ts'

describe('verify-queue Web profile bundle', () => {
  it('declares a private parseable layer containing the service and drawer', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: unknown
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBe(true)
    expect(manifest.publishConfig).toBeUndefined()
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toEqual({
      '@deepseek-ai/dsh-experimental-verify-queue': 'workspace:^',
      '@deepseek-ai/dsh-experimental-client-ui-verify-queue': 'workspace:^',
    })

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as { insert?: { id?: string; name?: string; disabled?: boolean }[] }[]
    expect(parsed.flatMap(patch => patch.insert ?? [])).toEqual([
      { id: 'verify-queue', name: '@deepseek-ai/dsh-experimental-verify-queue' },
      {
        id: 'ui-verify-queue',
        name: '@deepseek-ai/dsh-experimental-client-ui-verify-queue',
        disabled: true,
      },
    ])
  })
})
