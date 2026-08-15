import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let application: ElectronApplication
let page: Page
let fakeBinDir: string
let wrapperPath: string

async function createFakeExecutable(): Promise<string> {
  fakeBinDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-desktop-e2e-'))
  wrapperPath = path.join(fakeBinDir, 'dsh')
  const fixture = path.resolve('tests/fixtures/fake-dsh-sidecar.mjs')
  await writeFile(wrapperPath, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`, 'utf8')
  await chmod(wrapperPath, 0o755)
  return wrapperPath
}

async function launchApplication(): Promise<void> {
  const executable = await createFakeExecutable()
  application = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      DSH_BIN: executable,
      DSH_DESKTOP_E2E: '1',
      NODE_ENV: 'test',
    },
    timeout: 30_000,
  })
  page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}

test.beforeAll(async () => {
  await launchApplication()
})

test.afterAll(async () => {
  await application?.close()
  if (fakeBinDir) await rm(fakeBinDir, { recursive: true, force: true })
})

test('starts the app-owned packaged server and renders only the custom UI', async () => {
  await expect(page).toHaveTitle('DSH Claude Desktop')
  expect(new URL(page.url()).hostname).toBe('127.0.0.1')
  expect(new URL(page.url()).searchParams.get('e2eFixture')).toBe('1')
  await expect(page.getByText('DSH Desktop')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Workspace' })).toHaveValue('fixture-workspace')
  await expect(page.getByRole('button', { name: 'Fixture Session', exact: true })).toBeVisible()
  await expect(page.locator('#official-ui-must-not-load')).toHaveCount(0)
  await expect(page.getByText('DeepSeek Harness')).toHaveCount(0)
})

test('renders fixture conversation and dispatches prompts without real API use', async () => {
  await page.getByRole('button', { name: 'Fixture Session', exact: true }).click()
  await expect(page.getByText('Fixture hello')).toBeVisible()
  await expect(page.getByText('Fixture response')).toBeVisible()
  await page.getByRole('textbox', { name: 'Message' }).fill('Smoke prompt')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('Smoke prompt')).toBeVisible()
  await expect(page.getByText('Echo: Smoke prompt')).toBeVisible()
  const prompts = await page.evaluate(async () => (await fetch('/api/test.prompts')).json())
  expect(prompts.items).toEqual([{ sessionId: 'fixture-session', content: 'Smoke prompt' }])
})

test('shows reconnecting then refetches the authoritative baseline', async () => {
  await expect.poll(async () => page.evaluate(async () => (await fetch('/api/test.events-ready')).json().then((value) => value.connected))).toBe(true)
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/test.reconnect', { method: 'POST' })
    return response.json()
  })
  expect(result.accepted).toBe(true)
  await expect(page.getByText('Baseline 2 loaded')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Harness connected')).toBeVisible()
})

test('keeps Node globals out of the sandboxed renderer', async () => {
  const globals = await page.evaluate(() => ({
    process: typeof (globalThis as { process?: unknown }).process,
    require: typeof (globalThis as { require?: unknown }).require,
    module: typeof (globalThis as { module?: unknown }).module,
    desktop: typeof window.desktop,
  }))
  expect(globals).toEqual({ process: 'undefined', require: 'undefined', module: 'undefined', desktop: 'object' })
})
