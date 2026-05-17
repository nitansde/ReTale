import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'

const ROOT = process.cwd()
const MAIN_REPO_ROOT = process.cwd()

process.emitWarning = () => {}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const relativePath = specifier.slice(2)
      const candidates = [
        path.join(ROOT, `${relativePath}.ts`),
        path.join(ROOT, `${relativePath}.tsx`),
        path.join(ROOT, relativePath, 'index.ts'),
        path.join(ROOT, relativePath, 'index.tsx'),
      ]
      const match = candidates.find((candidate) => fs.existsSync(candidate))
      if (match) {
        return {
          shortCircuit: true,
          url: pathToFileURL(match).href,
        }
      }
    }

    return nextResolve(specifier, context)
  },
})

function parseArgs(argv) {
  const positionals = []
  const options = {
    context: null,
    user: null,
    char: null,
    out: null,
    warnings: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    const key = token.slice(2)
    if (!(key in options)) {
      throw new Error(`Unknown option: ${token}`)
    }

    const nextValue = argv[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for option: ${token}`)
    }

    options[key] = nextValue
    index += 1
  }

  if (positionals.length !== 1) {
    throw new Error('Usage: node scripts/process-sillytavern-preset-macros.mjs <preset.json> [--context context.json] [--user NAME] [--char NAME] [--out output.json] [--warnings warnings.json]')
  }

  return {
    presetPath: positionals[0],
    ...options,
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function resolveReadablePath(inputPath) {
  const resolvedPath = path.resolve(ROOT, inputPath)
  if (fs.existsSync(resolvedPath)) {
    return resolvedPath
  }

  if (!path.isAbsolute(inputPath)) {
    const fallbackPath = path.join(MAIN_REPO_ROOT, inputPath)
    if (fs.existsSync(fallbackPath)) {
      return fallbackPath
    }
  }

  return resolvedPath
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function normalizeContext(rawContext, overrides) {
  const runtimeValues = {
    ...(rawContext.runtimeValues ?? {}),
  }
  const userName = overrides.user ?? runtimeValues.user ?? runtimeValues.userName ?? null
  const charName = overrides.char ?? runtimeValues.char ?? runtimeValues.charName ?? runtimeValues.characterName ?? runtimeValues.assistantName ?? null

  if (userName) {
    runtimeValues.user = userName
    runtimeValues.userName = userName
    runtimeValues.lastusermessage = `${userName} says hello to ${charName ?? 'the group'}.`
    runtimeValues.lastUserMessage = `${userName} says hello to ${charName ?? 'the group'}.`
  }

  if (charName) {
    runtimeValues.char = charName
    runtimeValues.charName = charName
    runtimeValues.character = charName
    runtimeValues.characterName = charName
    runtimeValues.assistant = charName
    runtimeValues.assistantName = charName
    runtimeValues.bot = charName
    runtimeValues.lastcharmessage = `${charName} answers quietly.`
    runtimeValues.lastCharMessage = `${charName} answers quietly.`
  }

  return {
    now: rawContext.now ? new Date(rawContext.now) : undefined,
    seed: typeof rawContext.seed === 'number' ? rawContext.seed : 0,
    runtimeValues,
    localVariables: rawContext.localVariables ?? {},
    globalVariables: rawContext.globalVariables ?? {},
  }
}

async function main() {
  const [
    { registerPresetCompatCoreMacroBuiltins },
    { createPresetCompatEnvMacroBuiltins },
    { createPresetCompatRandomTimeMacroBuiltins },
    { registerPresetCompatVariableMacroBuiltins },
    { createPresetCompatMacroContext },
    { processPresetCompatMacroJson },
    { createPresetCompatMacroRegistry },
  ] = await Promise.all([
    import('@/lib/preset-compat/macro-builtins-core'),
    import('@/lib/preset-compat/macro-builtins-env'),
    import('@/lib/preset-compat/macro-builtins-random-time'),
    import('@/lib/preset-compat/macro-builtins-variables'),
    import('@/lib/preset-compat/macro-context'),
    import('@/lib/preset-compat/macro-processor'),
    import('@/lib/preset-compat/macro-registry'),
  ])

  const args = parseArgs(process.argv.slice(2))
  const presetPath = resolveReadablePath(args.presetPath)
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : null
  const warningsPath = args.warnings ? path.resolve(process.cwd(), args.warnings) : null

  const input = readJson(presetPath)
  const rawContext = args.context ? readJson(resolveReadablePath(args.context)) : {}
  const contextConfig = normalizeContext(rawContext, { user: args.user, char: args.char })
  const context = createPresetCompatMacroContext({
    surfaceId: 'rewrite',
    phase: 'cli-fixture-processing',
    seed: contextConfig.seed,
    now: contextConfig.now,
    runtimeValues: contextConfig.runtimeValues,
    localVariables: contextConfig.localVariables,
    globalVariables: contextConfig.globalVariables,
  })
  const registry = createPresetCompatMacroRegistry([
    ...registerPresetCompatCoreMacroBuiltins(),
    ...registerPresetCompatVariableMacroBuiltins(),
    ...createPresetCompatEnvMacroBuiltins(),
    ...createPresetCompatRandomTimeMacroBuiltins(),
  ])
  const processed = processPresetCompatMacroJson(input, { context, registry })
  const processedJson = JSON.stringify(processed, null, 2)
  const warningsJson = JSON.stringify(context.diagnostics, null, 2)

  if (outPath) {
    ensureParentDirectory(outPath)
    fs.writeFileSync(outPath, processedJson)
  } else {
    process.stdout.write(processedJson)
  }

  if (warningsPath) {
    ensureParentDirectory(warningsPath)
    fs.writeFileSync(warningsPath, warningsJson)
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
