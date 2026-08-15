import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { resolveDshExecutable } from './executable.js'

describe('resolveDshExecutable', () => {
  it('prefers DSH_BIN and validates it directly', async () => {
    const access = vi.fn(async () => undefined)
    const resolved = await resolveDshExecutable({ env: { DSH_BIN: './custom-dsh', PATH: '/ignored' }, platform: 'darwin', access })
    expect(resolved).toBe(path.resolve('./custom-dsh'))
    expect(access).toHaveBeenCalledOnce()
  })

  it('searches PATH entries without invoking a shell', async () => {
    const access = vi.fn(async (candidate: string) => {
      if (candidate !== path.resolve('/second', 'dsh')) throw new Error('missing')
    })
    const resolved = await resolveDshExecutable({ env: { PATH: '/first:/second' }, platform: 'darwin', access: access as never })
    expect(resolved).toBe(path.resolve('/second', 'dsh'))
  })

  it('fails closed for an invalid explicit path', async () => {
    await expect(resolveDshExecutable({
      env: { DSH_BIN: '/missing/dsh', PATH: '/valid' },
      platform: 'darwin',
      access: vi.fn(async () => { throw new Error('missing') }),
    })).rejects.toThrow('DSH_BIN does not point to an executable file')
  })
})
