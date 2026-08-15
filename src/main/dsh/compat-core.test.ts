import { describe, expect, it } from 'vitest'
import { assertSupportedDshVersion, SUPPORTED_DSH_VERSION } from './compat-core.mjs'

describe('assertSupportedDshVersion', () => {
  it('accepts the exact compatible version', () => {
    expect(assertSupportedDshVersion(` ${SUPPORTED_DSH_VERSION}\n`, '/tmp/dsh')).toBe(SUPPORTED_DSH_VERSION)
  })

  it.each([
    ['wrong', '0.1.0-rc.5'],
    ['missing', ''],
    ['malformed', 'DeepSeek Harness 0.1.0-rc.6'],
    ['multiple lines', `${SUPPORTED_DSH_VERSION}\nextra`],
  ])('rejects %s version output', (_label, output) => {
    expect(() => assertSupportedDshVersion(output, '/tmp/dsh')).toThrow(/requires exactly 0\.1\.0-rc\.6/)
  })
})
