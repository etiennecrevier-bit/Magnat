import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Proves the engine/finance guardrails in eslint.config.js stay wired up:
// each forbidden snippet is flagged in src/engine/ and src/finance/, and the
// same code is left alone in src/ui/.

const eslint = new ESLint({
  cwd: fileURLToPath(new URL('..', import.meta.url)),
})

const GUARDRAIL_RULES = [
  'no-restricted-imports',
  'no-restricted-properties',
  'no-restricted-globals',
  'no-restricted-syntax',
]

const FORBIDDEN: { code: string; rule: string }[] = [
  { code: "import { useState } from 'react'", rule: 'no-restricted-imports' },
  {
    code: "import type { ReactNode } from 'react'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import { createRoot } from 'react-dom/client'",
    rule: 'no-restricted-imports',
  },
  { code: "import { create } from 'zustand'", rule: 'no-restricted-imports' },
  {
    code: "import { Screen } from '../ui/Screen'",
    rule: 'no-restricted-imports',
  },
  {
    code: "export { Screen } from '../../ui/Screen'",
    rule: 'no-restricted-imports',
  },
  { code: "export * from '../ui'", rule: 'no-restricted-imports' },
  { code: 'Math.random()', rule: 'no-restricted-properties' },
  { code: 'const { random } = Math', rule: 'no-restricted-properties' },
  { code: 'Date.now()', rule: 'no-restricted-properties' },
  { code: 'performance.now()', rule: 'no-restricted-properties' },
  {
    code: 'crypto.getRandomValues(new Uint8Array(4))',
    rule: 'no-restricted-properties',
  },
  { code: 'crypto.randomUUID()', rule: 'no-restricted-properties' },
  { code: "window.alert('x')", rule: 'no-restricted-globals' },
  { code: 'document.title', rule: 'no-restricted-globals' },
  { code: 'globalThis.Math.random()', rule: 'no-restricted-globals' },
  { code: 'globalThis.Date.now()', rule: 'no-restricted-globals' },
  { code: 'new Date()', rule: 'no-restricted-syntax' },
  { code: 'Date()', rule: 'no-restricted-syntax' },
  { code: "import('react')", rule: 'no-restricted-syntax' },
  { code: "import('../ui/Screen')", rule: 'no-restricted-syntax' },
]

const ALLOWED = [
  "import { next } from './rng'",
  "import { guide } from './guide'",
  "import prices from '../content/prices.json'",
  'Math.floor(1.5)',
]

async function lint(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath })
  const messages = result?.messages ?? []
  expect(messages.filter((m) => m.fatal)).toEqual([])
  return messages
    .map((m) => m.ruleId)
    .filter((id) => GUARDRAIL_RULES.includes(id ?? ''))
}

describe.each(['src/engine/probe.ts', 'src/finance/probe.ts'])(
  'guardrails in %s',
  (filePath) => {
    it.each(FORBIDDEN)('flags $code', async ({ code, rule }) => {
      expect(await lint(code, filePath)).toContain(rule)
    })

    it.each(ALLOWED)('allows %s', async (code) => {
      expect(await lint(code, filePath)).toEqual([])
    })
  },
)

describe('guardrails in src/ui/probe.ts', () => {
  it.each(FORBIDDEN)('allows $code', async ({ code }) => {
    expect(await lint(code, 'src/ui/probe.ts')).toEqual([])
  })
})
