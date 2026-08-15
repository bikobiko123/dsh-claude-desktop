import { execFile } from 'node:child_process'
import { assertSupportedDshVersion, SUPPORTED_DSH_VERSION } from './compat-core.mjs'

export { SUPPORTED_DSH_VERSION }

export interface DshCompatibilityOptions {
  readonly execFile?: typeof execFile
  readonly timeoutMs?: number
}

export interface DshCompatibilityResult {
  readonly executable: string
  readonly version: string
}

/**
 * Validate the resolved executable without invoking a shell. This is deliberately
 * main-process safe and fail-closed: callers must await it before spawning DSH.
 */
export async function checkDshCompatibility(
  executable: string,
  options: DshCompatibilityOptions = {},
): Promise<DshCompatibilityResult> {
  const execFileImpl = options.execFile ?? execFile
  let stdout: string
  try {
    stdout = await new Promise<string>((resolve, reject) => {
      execFileImpl(executable, ['--version'], {
        encoding: 'utf8',
        timeout: options.timeoutMs ?? 10_000,
        windowsHide: true,
        shell: false,
      }, (error, result) => {
        if (error) reject(error)
        else resolve(result)
      })
    })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(
      `Unable to verify DeepSeek Harness at ${JSON.stringify(executable)}. ` +
      `Run ${JSON.stringify(`${executable} --version`)} directly and ensure it is installed and executable. ${detail}`,
    )
  }

  const actual = stdout.trim()
  assertSupportedDshVersion(actual, executable)
  return { executable, version: actual }
}

export const assertDshCompatibility = checkDshCompatibility
