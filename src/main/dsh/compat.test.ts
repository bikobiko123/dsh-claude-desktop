import { describe, expect, it, vi } from 'vitest'
import { checkDshCompatibility } from './compat.js'

describe('checkDshCompatibility', () => {
  it('executes the selected binary directly and accepts only exact rc.6 output', async () => {
    const execFile = vi.fn((_file, _args, _options, callback) => callback(null, '0.1.0-rc.6\n', ''))
    await expect(checkDshCompatibility('/opt/dsh', { execFile: execFile as never })).resolves.toEqual({
      executable: '/opt/dsh',
      version: '0.1.0-rc.6',
    })
    expect(execFile).toHaveBeenCalledWith('/opt/dsh', ['--version'], expect.objectContaining({ shell: false }), expect.any(Function))
  })

  it('rejects runtime drift before a caller may spawn the sidecar', async () => {
    const execFile = vi.fn((_file, _args, _options, callback) => callback(null, '0.1.0-rc.7\n', ''))
    await expect(checkDshCompatibility('/opt/dsh', { execFile: execFile as never }))
      .rejects.toThrow('requires exactly 0.1.0-rc.6')
  })
})
