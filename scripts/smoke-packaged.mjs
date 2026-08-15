#!/usr/bin/env node

import { listPackage } from '@electron/asar'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(process.argv[2] || 'release')

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function listDirectories(parent) {
  if (!(await exists(parent))) return []
  const entries = await readdir(parent, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(parent, entry.name))
}

async function findUnpackedRoots() {
  const directCandidates = [
    path.join(root, 'mac-arm64', 'DSH Desktop.app', 'Contents', 'Resources'),
    path.join(root, 'mac', 'DSH Desktop.app', 'Contents', 'Resources'),
    path.join(root, 'win-unpacked', 'resources'),
  ]
  const roots = []
  for (const candidate of directCandidates) if (await exists(candidate)) roots.push(candidate)

  for (const directory of await listDirectories(root)) {
    if (!directory.endsWith('.app')) continue
    const resources = path.join(directory, 'Contents', 'Resources')
    if (await exists(resources)) roots.push(resources)
  }
  return [...new Set(roots)]
}

async function validateResources(resources) {
  const appAsar = path.join(resources, 'app.asar')
  const unpackedApp = path.join(resources, 'app')
  const appRoot = (await exists(appAsar)) ? appAsar : unpackedApp
  if (!(await exists(appRoot))) throw new Error(`Missing packaged application payload below ${resources}`)

  const metadata = await stat(appRoot)
  if (metadata.size === 0) throw new Error(`Packaged application payload is empty: ${appRoot}`)

  const requiredEntries = [
    '/package.json',
    '/dist/main/index.js',
    '/dist/preload/index.cjs',
    '/dist/renderer/index.html',
  ]
  if (appRoot === appAsar) {
    const entries = new Set(listPackage(appAsar))
    for (const entry of requiredEntries) {
      if (!entries.has(entry)) throw new Error(`Missing required ASAR entry ${entry} in ${appAsar}`)
    }
    const forbiddenFiles = [
      /^\/(?:dsh|deepseek-harness)(?:\.exe)?$/i,
      /^\/resources\/(?:dsh|deepseek-harness)(?:\.exe)?$/i,
      /^\/bin\/(?:dsh|deepseek-harness)(?:\.exe)?$/i,
    ]
    for (const entry of entries) {
      if (forbiddenFiles.some((pattern) => pattern.test(entry))) {
        throw new Error(`DSH runtime must remain external, but ASAR contains ${entry}`)
      }
    }
  } else {
    for (const entry of requiredEntries) {
      if (!(await exists(path.join(unpackedApp, entry.slice(1))))) throw new Error(`Missing required packaged file ${entry}`)
    }
  }

  const externalDshNames = ['dsh', 'dsh.exe', 'deepseek-harness', 'deepseek-harness.exe']
  for (const name of externalDshNames) {
    if (await exists(path.join(resources, name))) throw new Error(`DSH runtime must remain external, but found ${name} in ${resources}`)
  }

  return { resources, appRoot, bytes: metadata.size }
}

async function main() {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  if (packageJson.main !== 'dist/main/index.js') throw new Error(`Unexpected package main entry: ${packageJson.main}`)

  const roots = await findUnpackedRoots()
  if (roots.length === 0) throw new Error(`No unpacked macOS or Windows application found under ${root}`)

  const results = []
  for (const resources of roots) results.push(await validateResources(resources))
  for (const result of results) console.log(`Packaged structure OK: ${result.appRoot} (${result.bytes} bytes)`)
  console.log(`Inspected ${results.length} unpacked application output(s); no bundled DSH executable detected.`)
}

main().catch((error) => {
  console.error(`[smoke-packaged] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
