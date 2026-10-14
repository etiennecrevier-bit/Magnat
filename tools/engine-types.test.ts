import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Proves tsconfig.engine.json keeps engine and finance code off the browser:
// `npm run typecheck` builds it, and browser globals that ESLint does not ban
// fail to compile in src/engine/ and src/finance/ while plain ES2023 passes.

const root = fileURLToPath(new URL('..', import.meta.url))
const FOLDERS = ['src/engine', 'src/finance']

const FORBIDDEN = [
  { name: 'localStorage', code: "localStorage.getItem('save')" },
  { name: 'fetch', code: "fetch('/save')" },
  { name: 'setTimeout', code: 'setTimeout(() => {}, 0)' },
  { name: 'requestAnimationFrame', code: 'requestAnimationFrame(() => {})' },
  { name: 'navigator', code: 'navigator.language' },
  { name: 'self', code: 'self.location' },
]

const ALLOWED =
  'Math.floor(1.5) + new Map<string, number>().size + ([1, 2].at(-1) ?? 0)'

// Probe files for a scratch copy of the project, keyed by path. The config
// must pick up the first set and leave the second to the other configs.
const INSIDE: Record<string, string> = {}
for (const folder of FOLDERS) {
  INSIDE[`${folder}/allowed.ts`] = ALLOWED
  for (const { name, code } of FORBIDDEN) INSIDE[`${folder}/${name}.ts`] = code
}
const OUTSIDE: Record<string, string> = {
  'src/engine/probe.test.ts': "localStorage.getItem('save')",
  'src/ui/probe.ts': "localStorage.getItem('save')",
}

function toPosix(from: string, file: string) {
  return relative(from, file).split(sep).join('/')
}

function message(diagnostic: ts.Diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
}

function parseConfig(file: string) {
  const parsed = ts.getParsedCommandLineOfConfigFile(file, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(`${file}: ${message(diagnostic)}`)
    },
  })
  const [error] = parsed?.errors ?? []
  if (!parsed || error) {
    throw new Error(`${file}: ${error ? message(error) : 'unreadable'}`)
  }
  return parsed
}

// Compiles the probes with the real tsconfig.engine.json and returns each
// compiled file's error messages. The scratch project sits under
// node_modules/.tmp so it resolves the same packages and @types as the repo.
function compileProbes() {
  const tmp = resolve(root, 'node_modules/.tmp')
  mkdirSync(tmp, { recursive: true })
  const dir = mkdtempSync(resolve(tmp, 'engine-types-'))
  try {
    for (const config of ['tsconfig.app.json', 'tsconfig.engine.json']) {
      copyFileSync(resolve(root, config), resolve(dir, config))
    }
    for (const [file, code] of Object.entries({ ...INSIDE, ...OUTSIDE })) {
      mkdirSync(dirname(resolve(dir, file)), { recursive: true })
      writeFileSync(resolve(dir, file), `export const probe = ${code}\n`)
    }
    const { fileNames, options } = parseConfig(
      resolve(dir, 'tsconfig.engine.json'),
    )
    const program = ts.createProgram(fileNames, options)
    const errors = new Map<string, string[]>()
    for (const fileName of fileNames) {
      const sourceFile = program.getSourceFile(fileName)
      const diagnostics = [
        ...program.getSyntacticDiagnostics(sourceFile),
        ...program.getSemanticDiagnostics(sourceFile),
      ]
      errors.set(toPosix(dir, fileName), diagnostics.map(message))
    }
    return errors
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('tsconfig.engine.json', () => {
  const config = parseConfig(resolve(root, 'tsconfig.engine.json'))

  it('is built by npm run typecheck', () => {
    const { config: solution } = ts.readConfigFile(
      resolve(root, 'tsconfig.json'),
      ts.sys.readFile,
    ) as { config: { references?: { path: string }[] } }
    const references = (solution.references ?? []).map(({ path }) =>
      resolve(root, path),
    )
    expect(references).toContain(resolve(root, 'tsconfig.engine.json'))
  })

  it('has no DOM library', () => {
    expect(config.options.lib).toBeDefined()
    expect(config.options.lib?.filter((lib) => /dom/i.test(lib))).toEqual([])
  })

  it('checks engine code but not its tests', () => {
    const files = config.fileNames.map((file) => toPosix(root, file))
    expect(files).toContain('src/engine/clock.ts')
    expect(files.filter((file) => /\.test\.tsx?$/.test(file))).toEqual([])
  })
})

describe('browser globals under tsconfig.engine.json', () => {
  const errors = compileProbes()

  it('covers src/engine and src/finance, but not tests or src/ui', () => {
    expect([...errors.keys()].sort()).toEqual(Object.keys(INSIDE).sort())
  })

  describe.each(FOLDERS)('in %s', (folder) => {
    it.each(FORBIDDEN)('rejects $name', ({ name }) => {
      expect(errors.get(`${folder}/${name}.ts`)).toContainEqual(
        expect.stringMatching(new RegExp(`^Cannot find name '${name}'`)),
      )
    })

    it('compiles plain ES2023', () => {
      expect(errors.get(`${folder}/allowed.ts`)).toEqual([])
    })
  })
})
