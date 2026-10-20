import { describe, expect, it } from 'vitest'
import { setUpOrUndo } from './teardown.ts'

describe('setUpOrUndo', () => {
  it('takes down what was set up, the last first, once', () => {
    const done: string[] = []
    const takeDown = setUpOrUndo((undo) => {
      undo(() => done.push('scene'))
      undo(() => done.push('picker'))
      undo(() => done.push('ticker'))
    })
    expect(done).toEqual([])
    takeDown()
    takeDown()
    expect(done).toEqual(['ticker', 'picker', 'scene'])
  })

  it('takes down what was set up before a step that throws, then throws on', () => {
    const done: string[] = []
    const error = new Error('No stage')
    expect(() =>
      setUpOrUndo((undo) => {
        undo(() => done.push('scene'))
        undo(() => done.push('picker'))
        throw error
      }),
    ).toThrow(error)
    expect(done).toEqual(['picker', 'scene'])
  })
})
