import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config.ts'

// Keeps the Cloudflare deploy in line with issue #4: wrangler.jsonc describes
// an assets-only Worker that serves Vite's build output as a single-page app,
// `npm run deploy` builds before deploying, and nothing targets Vercel.

const root = fileURLToPath(new URL('..', import.meta.url))

interface WranglerConfig {
  name?: string
  main?: string
  compatibility_date?: string
  assets?: { directory?: string; not_found_handling?: string }
  preview_urls?: boolean
}

interface PackageJson {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function read(file: string) {
  return readFileSync(resolve(root, file), 'utf8')
}

// wrangler.jsonc allows comments and trailing commas, which JSON.parse
// rejects; TypeScript's tsconfig parser reads the same dialect.
function readJsonc(file: string): unknown {
  const { config, error } = ts.parseConfigFileTextToJson(file, read(file))
  if (error) {
    const message = ts.flattenDiagnosticMessageText(error.messageText, '\n')
    throw new Error(`${file}: ${message}`)
  }
  return config
}

const wrangler = readJsonc('wrangler.jsonc') as WranglerConfig
const pkg = JSON.parse(read('package.json')) as PackageJson
const packages = { ...pkg.dependencies, ...pkg.devDependencies }

describe('wrangler.jsonc', () => {
  it('deploys the Worker named magnat', () => {
    expect(wrangler.name).toBe('magnat')
  })

  it('has no Worker script, only static assets', () => {
    expect(wrangler).not.toHaveProperty('main')
  })

  it('pins a compatibility date', () => {
    expect(wrangler.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('serves the Vite build output', () => {
    const outDir = viteConfig.build?.outDir ?? 'dist'
    expect(wrangler.assets?.directory).toBeDefined()
    expect(resolve(root, wrangler.assets?.directory ?? '')).toBe(
      resolve(root, outDir),
    )
  })

  it('falls back to index.html for unknown paths', () => {
    expect(wrangler.assets?.not_found_handling).toBe('single-page-application')
  })

  it('turns on preview URLs', () => {
    expect(wrangler.preview_urls).toBe(true)
  })
})

describe('package.json', () => {
  it('builds before deploying', () => {
    expect(pkg.scripts?.deploy).toBe('npm run build && wrangler deploy')
  })

  // Per-branch preview URLs need Wrangler 4.21 or later.
  it('requires wrangler 4.21 or later', () => {
    const range = packages.wrangler ?? ''
    const [, major, minor] = /^[\^~>=]*(\d+)\.(\d+)\./.exec(range) ?? []
    const atLeast =
      Number(major) > 4 || (Number(major) === 4 && Number(minor) >= 21)
    expect(atLeast, `wrangler ${range}`).toBe(true)
  })
})

describe('no Vercel configuration', () => {
  it.each(['vercel.json', '.vercel'])('has no %s', (file) => {
    expect(existsSync(resolve(root, file))).toBe(false)
  })

  it('has no Vercel packages', () => {
    expect(
      Object.keys(packages).filter(
        (name) => name === 'vercel' || name.startsWith('@vercel/'),
      ),
    ).toEqual([])
  })
})
