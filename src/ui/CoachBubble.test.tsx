import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TUTORIAL } from '../engine/tutorial.ts'
import { CoachBubbleView } from './CoachBubble.tsx'
import { stepView, type StepView } from './tutorialFlow.ts'
import { newTutorialGame } from './store.ts'

const { coach } = TUTORIAL

function render(
  view: StepView,
  {
    portrait = null,
    confirming = false,
  }: { portrait?: string | null; confirming?: boolean } = {},
) {
  return renderToStaticMarkup(
    <CoachBubbleView
      view={view}
      portrait={portrait}
      confirming={confirming}
      onButton={() => {}}
      onSkip={() => {}}
      onConfirmSkip={() => {}}
      onCancelSkip={() => {}}
    />,
  )
}

const first = stepView(newTutorialGame())!
const game = newTutorialGame()
const opening = stepView({
  ...game,
  tutorial: { ...game.tutorial!, step: 'ouvrirCamion' },
})!

/** Each button's text, in order. */
const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(([, text]) => text)

describe('CoachBubbleView', () => {
  it('is a dialog that is not modal, named by Réal and described by his text', () => {
    const html = render(first)
    const [, nameId] = /aria-labelledby="([^"]+)"/.exec(html)!
    const [, textId] = /aria-describedby="([^"]+)"/.exec(html)!
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="false"')
    expect(html).toContain(
      `<p id="${nameId}" class="coach__name">${coach.name}</p>`,
    )
    expect(html).toContain(`id="${textId}" class="coach__text">`)
  })

  it('shows the silhouette without a portrait, and the portrait with one, 64 px', () => {
    expect(render(first)).toMatch(
      /<svg class="coach__portrait coach__silhouette"[^>]*width="64"/,
    )
    expect(render(first, { portrait: '/real.png' })).toContain(
      '<img class="coach__portrait" src="/real.png" alt="" width="64" height="64"/>',
    )
  })

  it('has the step’s one button, then « Passer la visite »; none where the gesture is elsewhere', () => {
    expect(buttons(render(first))).toEqual(['Allons-y', coach.skip.link])
    expect(buttons(render(opening))).toEqual([coach.skip.link])
  })

  it('asks once to confirm « Passer la visite », in place of the buttons', () => {
    const html = render(first, { confirming: true })
    expect(html).toContain(coach.skip.confirm.replace(/'/g, '&#x27;'))
    expect(buttons(html)).toEqual([coach.skip.yes, coach.skip.no])
  })

  it('takes every text from tutorial.json', () => {
    for (const step of TUTORIAL.steps) {
      const view = {
        ...first,
        id: step.id,
        text: step.text,
        button: step.button ?? null,
      }
      const html = render(view)
      expect(html).toContain(step.text.replace(/'/g, '&#x27;'))
      if (step.button !== undefined) {
        expect(html).toContain(step.button.replace(/'/g, '&#x27;'))
      }
    }
  })
})

describe('CoachBubbleView on a screen that cannot hover', () => {
  it('says the touch words where the step has them, its text elsewhere', () => {
    const step = TUTORIAL.steps.find(({ id }) => id === 'tropCher')!
    const view = { ...first, text: step.text, touchText: step.touchText! }
    const touched = renderToStaticMarkup(
      <CoachBubbleView
        view={view}
        touch
        portrait={null}
        confirming={false}
        onButton={() => {}}
        onSkip={() => {}}
        onConfirmSkip={() => {}}
        onCancelSkip={() => {}}
      />,
    )
    expect(touched).toContain('Touche-le pour voir.')
    expect(touched).not.toContain('souris')
    expect(render(view)).toContain('souris')
    expect(buttons(render({ ...first }))).toContain('Allons-y')
  })
})
