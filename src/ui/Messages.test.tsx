import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Message } from './messageTriggers.ts'
import Messages, { MessagesView } from './Messages.tsx'

const RENT: Message = {
  id: 7,
  kind: 'landlord',
  from: 'Votre propriétaire',
  text: 'Le loyer est en retard.',
  day: 31,
}

const TIRED: Message = {
  id: 8,
  kind: 'exhausted',
  from: 'Vous',
  text: 'Mon café a besoin d’un café.',
  day: 33,
}

function render(messages: readonly Message[]) {
  return renderToStaticMarkup(
    <MessagesView messages={messages} onDismiss={() => {}} />,
  )
}

describe('MessagesView', () => {
  it('keeps an empty log on the page while there is no message', () => {
    expect(render([])).toBe(
      '<section class="messages" role="log" aria-label="Messages"></section>',
    )
  })

  it('shows each message with its sender, its day, its text and Fermer, in order', () => {
    const html = render([TIRED, RENT])
    expect(html).toBe(
      '<section class="messages" role="log" aria-label="Messages">' +
        '<article class="message message--exhausted"><p class="message__from" id="message-8">Vous <span class="message__day">3 juin</span></p><p class="message__text">Mon café a besoin d’un café.</p><button type="button" class="toggle message__close" aria-describedby="message-8">Fermer</button></article>' +
        '<article class="message message--landlord"><p class="message__from" id="message-7">Votre propriétaire <span class="message__day">1er juin</span></p><p class="message__text">Le loyer est en retard.</p><button type="button" class="toggle message__close" aria-describedby="message-7">Fermer</button></article>' +
        '</section>',
    )
  })

  it('dismisses the message whose Fermer is pressed', () => {
    const dismissed: number[] = []
    const view = MessagesView({
      messages: [TIRED, RENT],
      onDismiss: (id) => dismissed.push(id),
    })
    const articles = view.props.children as {
      props: { children: { props: { onClick?: () => void } }[] }
    }[]
    articles[1]!.props.children[2]!.props.onClick?.()
    expect(dismissed).toEqual([RENT.id])
  })
})

describe('Messages', () => {
  it('starts with no message', () => {
    expect(renderToStaticMarkup(<Messages />)).toBe(render([]))
  })
})
