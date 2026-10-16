import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { startChallenge, tick } from '../src/engine/clock.ts'
import { playDay } from '../src/engine/day.ts'
import { applyDecision } from '../src/engine/decisions.ts'
import { applyEffect, startOfDay } from '../src/engine/effects.ts'
import { drawEvent, resolveEvent } from '../src/engine/events.ts'
import { postEntry } from '../src/finance/journal.ts'

// Proves the guardrails in eslint.config.js stay wired up: each forbidden
// snippet is flagged in src/engine/ and src/finance/, nothing there or in
// src/content/ imports src/world/, the world never imports what changes the
// game, and the same code is left alone in src/ui/.

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

// Every way into src/world/; engine, finance and content take none of them.
const WORLD_IMPORTS: { code: string; rule: string }[] = [
  {
    code: "import WorldCanvas from '../world/WorldCanvas'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import type { WorldApp } from '../world/mountWorld'",
    rule: 'no-restricted-imports',
  },
  { code: "export * from '../../world'", rule: 'no-restricted-imports' },
  { code: "import '../world/WorldCanvas.css'", rule: 'no-restricted-imports' },
  { code: "import('../world/WorldCanvas')", rule: 'no-restricted-syntax' },
]

const CONTENT_ALLOWED = [
  "import { z } from 'zod'",
  "import { cents } from '../engine/money.ts'",
  "import pacing from './pacing.json'",
]

/**
 * The functions that change the game, as eslint.config.js names them. The
 * imports above stop typechecking when one of them is renamed or moved.
 */
const GAME_CHANGERS = {
  postEntry,
  applyDecision,
  tick,
  playDay,
  drawEvent,
  resolveEvent,
  applyEffect,
  startOfDay,
  startChallenge,
}

const WORLD_FORBIDDEN: { code: string; rule: string }[] = [
  {
    code: "import { postEntry } from '../finance/journal.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import { applyDecision } from '../engine/decisions.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import { tick } from '../engine/clock.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import { playDay } from '../../engine/day.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import { drawEvent } from '../engine/events.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import { resolveEvent } from '../../engine/events.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import { applyEffect } from '../engine/effects.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import { startOfDay } from '../engine/effects.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "export { resolveEvent as choose } from '../engine/events.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import { tick as nextDay } from '../engine/clock.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import { startChallenge } from '../engine/clock.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "import * as clock from '../engine/clock.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "export { tick } from '../engine/clock.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: "export * from '../engine/clock.ts'",
    rule: 'no-restricted-imports',
  },
  {
    code: 'gameStore.getState().advance(1)',
    rule: 'no-restricted-properties',
  },
  {
    code: 'const { advance } = gameStore.getState()',
    rule: 'no-restricted-properties',
  },
  { code: 'useGame((s) => s.advance)', rule: 'no-restricted-properties' },
  {
    code: 'gameStore.setState({ game })',
    rule: 'no-restricted-properties',
  },
  {
    code: 'gameStore.getState().startGame(game)',
    rule: 'no-restricted-properties',
  },
  { code: 'useGame((s) => s.startGame)', rule: 'no-restricted-properties' },
  { code: "import('../engine/clock.ts')", rule: 'no-restricted-syntax' },
]

const WORLD_ALLOWED = [
  "import { Application, Graphics } from 'pixi.js'",
  "import * as PIXI from 'pixi.js'",
  "import { useEffect } from 'react'",
  "import type { GameState } from '../engine/types.ts'",
  "import { toCalendar } from '../engine/clock.ts'",
  "import { balance } from '../finance/journal.ts'",
  "import { gameStore, useGame } from '../ui/store.ts'",
  "import { NO_EVENTS, noEvents } from '../engine/events.ts'",
  "import { whenDue } from '../engine/effects.ts'",
  'gameStore.getState().game',
  'Math.random()',
  'window.innerWidth',
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

describe.each([
  'src/engine/probe.ts',
  'src/finance/probe.ts',
  'src/content/probe.ts',
])('the world from %s', (filePath) => {
  it.each(WORLD_IMPORTS)('flags $code', async ({ code, rule }) => {
    expect(await lint(code, filePath)).toContain(rule)
  })
})

describe('guardrails in src/content/probe.ts', () => {
  it.each(CONTENT_ALLOWED)('allows %s', async (code) => {
    expect(await lint(code, 'src/content/probe.ts')).toEqual([])
  })
})

describe.each(['src/world/probe.ts', 'src/world/scene/probe.ts'])(
  'guardrails in %s',
  (filePath) => {
    it.each(WORLD_FORBIDDEN)('flags $code', async ({ code, rule }) => {
      expect(await lint(code, filePath)).toContain(rule)
    })

    it.each(WORLD_ALLOWED)('allows %s', async (code) => {
      expect(await lint(code, filePath)).toEqual([])
    })
  },
)

describe('guardrails in src/world/probe.test.ts', () => {
  it.each(WORLD_FORBIDDEN)('allows $code', async ({ code }) => {
    expect(await lint(code, 'src/world/probe.test.ts')).toEqual([])
  })
})

describe('guardrails in src/ui/probe.ts', () => {
  it.each([...FORBIDDEN, ...WORLD_IMPORTS, ...WORLD_FORBIDDEN])(
    'allows $code',
    async ({ code }) => {
      expect(await lint(code, 'src/ui/probe.ts')).toEqual([])
    },
  )
})

describe('the functions that change the game', () => {
  it('are the ones the world may not import, and exist under those names', async () => {
    const config = await eslint.calculateConfigForFile('src/world/probe.ts')
    const [, { patterns }] = config.rules['no-restricted-imports']
    expect(
      patterns.flatMap(
        (pattern: { importNames?: string[] }) => pattern.importNames ?? [],
      ),
    ).toEqual(Object.keys(GAME_CHANGERS))
    for (const change of Object.values(GAME_CHANGERS)) {
      expect(change).toBeTypeOf('function')
    }
  })
})
