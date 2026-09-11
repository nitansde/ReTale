import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fs.realpathSync.native(process.cwd())

function isPathInsideRoot(filePath) {
  const relativePath = path.relative(ROOT, filePath)
  return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath))
}

function resolveTrustedLocalFile(candidatePath) {
  const resolvedPath = path.resolve(candidatePath)
  if (!isPathInsideRoot(resolvedPath) || resolvedPath.split(path.sep).includes('node_modules') || !fs.existsSync(resolvedPath)) {
    return null
  }

  const realPath = fs.realpathSync.native(resolvedPath)
  return isPathInsideRoot(realPath) ? realPath : null
}

export async function registerTypeScriptHooks() {
  const importedTypeScript = await import('typescript')
  const typescript = importedTypeScript.default ?? importedTypeScript
  const compilerOptions = {
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2023,
    moduleResolution: typescript.ModuleResolutionKind.Bundler,
    jsx: typescript.JsxEmit.ReactJSX,
    inlineSourceMap: true,
    inlineSources: true,
    isolatedModules: true,
  }

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) {
        const relativePath = specifier.slice(2)
        const candidates = [
          path.resolve(ROOT, `${relativePath}.ts`),
          path.resolve(ROOT, `${relativePath}.tsx`),
          path.resolve(ROOT, relativePath, 'index.ts'),
          path.resolve(ROOT, relativePath, 'index.tsx'),
        ]
        const match = candidates.map(resolveTrustedLocalFile).find(Boolean)
        if (match) {
          return {
            shortCircuit: true,
            url: pathToFileURL(match).href,
          }
        }
      }

      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (!url.startsWith('file:')) {
        return nextLoad(url, context)
      }

      const filePath = fileURLToPath(url)
      if (!/\.tsx?$/u.test(filePath)) {
        return nextLoad(url, context)
      }

      const trustedFilePath = resolveTrustedLocalFile(filePath)
      if (!trustedFilePath) {
        return nextLoad(url, context)
      }

      const result = typescript.transpileModule(fs.readFileSync(trustedFilePath, 'utf8'), {
        compilerOptions,
        fileName: trustedFilePath,
        reportDiagnostics: true,
      })
      const errors = result.diagnostics?.filter((diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error) ?? []
      if (errors.length) {
        throw new Error(typescript.formatDiagnosticsWithColorAndContext(errors, {
          getCanonicalFileName: (fileName) => fileName,
          getCurrentDirectory: () => ROOT,
          getNewLine: () => '\n',
        }))
      }

      return {
        format: 'module',
        source: result.outputText,
        shortCircuit: true,
      }
    },
  })
}
