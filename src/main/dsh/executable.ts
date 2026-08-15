import { access } from 'node:fs/promises'
import path from 'node:path'
import { constants } from 'node:fs'
import { delimiter } from 'node:path'

export interface ResolveDshExecutableOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly access?: typeof access
}

function executableNames(platform: NodeJS.Platform): readonly string[] {
  return platform === 'win32' ? ['dsh.exe', 'dsh.cmd', 'dsh.bat', 'dsh'] : ['dsh']
}

async function isExecutable(candidate: string, accessImpl: typeof access, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await accessImpl(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Resolve an explicit DSH_BIN first, then search PATH without invoking a shell. */
export async function resolveDshExecutable(options: ResolveDshExecutableOptions = {}): Promise<string> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const accessImpl = options.access ?? access
  const explicit = env.DSH_BIN?.trim()
  if (explicit) {
    const candidate = path.resolve(explicit)
    if (await isExecutable(candidate, accessImpl, platform)) return candidate
    throw new Error(`DSH_BIN does not point to an executable file: ${candidate}`)
  }

  const searchPath = env.PATH ?? env.Path ?? env.path ?? ''
  for (const directory of searchPath.split(delimiter).filter(Boolean)) {
    for (const name of executableNames(platform)) {
      const candidate = path.resolve(directory, name)
      if (await isExecutable(candidate, accessImpl, platform)) return candidate
    }
  }
  throw new Error('DeepSeek Harness executable was not found. Set DSH_BIN or add dsh to PATH.')
}
