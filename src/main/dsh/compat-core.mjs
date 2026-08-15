export const SUPPORTED_DSH_VERSION = '0.1.0-rc.6'

/** Validate the complete trimmed output of `dsh --version`. */
export function assertSupportedDshVersion(stdout, executable = 'dsh') {
  const actual = typeof stdout === 'string' ? stdout.trim() : ''
  if (!actual || actual.includes('\n') || actual !== SUPPORTED_DSH_VERSION) {
    const displayed = actual || '<missing>'
    throw new Error(
      `Incompatible DeepSeek Harness at ${JSON.stringify(executable)}: ` +
      `reported ${JSON.stringify(displayed)}, but this application requires exactly ${SUPPORTED_DSH_VERSION}. ` +
      `Install/select DSH ${SUPPORTED_DSH_VERSION} and set DSH_BIN to that executable.`,
    )
  }
  return actual
}
