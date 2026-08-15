#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { assertSupportedDshVersion } from '../src/main/dsh/compat-core.mjs'

const execFileAsync = promisify(execFile)

export function parseArgs(argv, env = process.env) {
  const result = { binary: env.DSH_BIN || 'dsh', quiet: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--binary') {
      const next = argv[index + 1]
      if (!next) throw new Error('--binary requires a path or command name')
      result.binary = next
      index += 1
    } else if (value === '--quiet') result.quiet = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  return result
}

export async function checkDshCommand(options) {
  let stdout
  try {
    ;({ stdout } = await execFileAsync(options.binary, ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      shell: false,
    }))
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Unable to execute ${JSON.stringify(options.binary)} --version: ${detail}`)
  }
  return assertSupportedDshVersion(stdout, options.binary)
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const actual = await checkDshCommand(options)
  if (!options.quiet) console.log(`Compatible DeepSeek Harness detected: ${actual}`)
}

const isDirectExecution = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isDirectExecution) {
  main().catch((error) => {
    console.error(`[check-dsh-compat] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
