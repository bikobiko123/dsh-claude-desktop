import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const CANONICAL_CONVERSATION_CLIENT_SHA256 = '0f7927e6284159b9b4138df50a1d64755e6e3ff76064bb06309678392530a829'
const VENDORED_REGISTRAR_SHA256 = '10f253c869124cc88604191f8069d9a81dd51b1804edf9ee848029cb79c51490'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const root = resolve(import.meta.dirname, '..')
const vendorRoot = resolve(root, 'src/vendor/dsh-rc6-conversation-definitions')
const forbiddenRuntimePatterns = [
  /from\s+['"](?:react|react-dom|clsx|cosmokit|schemastery|shigma|shiki|katex)(?:\/[^'"]*)?['"]/,
  /from\s+['"]@deepseek-ai\/dsh-client-ui-/,
  /window\.__ModuleLoader__/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
]
const sourceFiles = [
  'assistant.ts', 'chat-snapshot-builder.ts', 'command.ts', 'common.ts', 'compaction.ts',
  'contracts.ts', 'fallback.ts', 'inbox.ts', 'message.ts', 'metrics.ts', 'register.ts',
  'retry.ts', 'runtime-helpers.ts', 'tool.ts', 'turn-error.ts', 'turn-max-tokens.ts', 'turn-tail.ts',
]

const vendorSources = new Map()
for (const name of sourceFiles) {
  const source = await readFile(resolve(vendorRoot, name), 'utf8')
  vendorSources.set(name, source)
  for (const pattern of forbiddenRuntimePatterns) {
    if (pattern.test(source)) throw new Error(`Forbidden registrar dependency in ${name}: ${pattern}`)
  }
}

const vendoredFingerprint = createHash('sha256')
for (const name of [...sourceFiles].sort()) {
  vendoredFingerprint.update(`${name}\0`)
  vendoredFingerprint.update(vendorSources.get(name))
  vendoredFingerprint.update('\0')
}
if (vendoredFingerprint.digest('hex') !== VENDORED_REGISTRAR_SHA256) {
  throw new Error('Vendored rc.6 registrar source drifted; reconcile it against the canonical artifact and update the reviewed fingerprint.')
}

const canonicalArtifact = process.env.DSH_RC6_CONVERSATION_CLIENT_ARTIFACT
if (canonicalArtifact) {
  const canonicalHash = sha256(await readFile(resolve(canonicalArtifact)))
  if (canonicalHash !== CANONICAL_CONVERSATION_CLIENT_SHA256) {
    throw new Error(`Canonical rc.6 conversation artifact drifted: expected ${CANONICAL_CONVERSATION_CLIENT_SHA256}, found ${canonicalHash}`)
  }
}

const packageJson = JSON.parse(await readFile(resolve(root, 'node_modules/@deepseek-ai/dsh-client-runtime/package.json'), 'utf8'))
if (packageJson.version !== '0.1.0-rc.6') throw new Error(`Expected dsh-client-runtime 0.1.0-rc.6, found ${packageJson.version}`)

const cordisPackage = JSON.parse(await readFile(resolve(root, 'node_modules/@deepseek-ai/cordis/package.json'), 'utf8'))
if (cordisPackage.version !== '4.0.1') throw new Error(`Expected cordis 4.0.1, found ${cordisPackage.version}`)

const registrationSource = await readFile(resolve(vendorRoot, 'register.ts'), 'utf8')
const bootstrapSource = await readFile(resolve(root, 'src/shared/rc6/bootstrap.ts'), 'utf8')
const contractsSource = await readFile(resolve(root, 'src/shared/rc6/contracts.ts'), 'utf8')
if (!bootstrapSource.includes('assertDshRc6RegistrarCompatibility(graph, entries)')) {
  throw new Error('Bootstrap must verify the host graph before loading or configuring registrar helpers.')
}
if (bootstrapSource.indexOf('assertDshRc6RegistrarCompatibility(graph, entries)') > bootstrapSource.indexOf('configureConversationRuntimeHelpers(')) {
  throw new Error('Registrar compatibility verification must precede runtime helper configuration.')
}
if (!contractsSource.includes('DSH_RC6_COMPATIBLE_BOOT_FINGERPRINT')) {
  throw new Error('Missing pinned rc.6 boot graph compatibility fingerprint.')
}
const ordinaryRegistrations = [...registrationSource.matchAll(/register(?:InboxConversationNodes|MessageConversationNode|AssistantConversationNode|ToolConversationNode|CommandConversationNode|CompactionConversationNode|RetryConversationNode|TurnErrorConversationNode|TurnMaxTokensConversationNode|TurnTailConversationNode)\(ctx\)/g)]
if (ordinaryRegistrations.length !== 10) throw new Error(`Expected 10 registrar calls producing 11 ordinary definitions, found ${ordinaryRegistrations.length}`)
if (!registrationSource.includes('registerUnknownConversationFallback(ctx)')) throw new Error('Missing sole unknown-surface fallback registration.')
if (!registrationSource.includes('registerChatConversationView(ctx)')) throw new Error('Missing chat view registration.')

const declarations = await readFile(resolve(root, 'node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/index.d.ts'), 'utf8')
const requiredRuntimeSymbols = [
  'emptyAssistantBlock', 'toAssistantBlock', 'toAssistantBlocks', 'isTokenDelta',
  'isAppendSurfaceEvent', 'isReplacementSurfaceEvent', 'contextProvenance',
  'contextForm', 'displayFailureMessage',
]
for (const symbol of requiredRuntimeSymbols) {
  const exported = new RegExp(`export\\s+\\{[^}]*\\b${symbol}\\b[^}]*\\}`, 's').test(declarations)
  if (!exported) throw new Error(`Missing required public runtime helper declaration ${symbol}`)
}

const notices = await readFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
for (const required of [
  '@deepseek-ai/dsh-client-ui-conversation@0.1.0-rc.6',
  'sha512-pKDKZYTRvO9pBTyHvVOtPDuTzNfCHwy7GmeIaRLjyCORLPM3uv0BuMc1qIHVI6LcK54l+cRGIuSSGah3bO/0vw==',
  'Copyright (c) 2026 DeepSeek',
]) {
  if (!notices.includes(required)) throw new Error(`THIRD_PARTY_NOTICES.md is missing ${required}`)
}

console.log('Conversation registrar license/import/runtime-symbol gates passed.')
