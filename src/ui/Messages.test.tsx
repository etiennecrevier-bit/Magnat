import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { postcardIdSchema } from '../content/schema.ts'
import { createInitialState } from '../engine/clock.ts'
import type { GameState } from '../engine/types.ts'
import {
  createMessageStack,
  startMessageStack,
  streetMessages,
} from './messageStack.ts'
import type { Message } from './messageTriggers.ts'
import Messages, { MessagesView } from './Messages.tsx'
import { createGameStore } from './store.ts'

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

/** `game` with every postcard of Réal's shown, so only the game's messages come. */
const SENT_ALL = (game: GameState): GameState => ({
  ...game,
  postcardsShown: postcardIdSchema.options,
})

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
        '<article id="message-card-8" class="message message--exhausted" tabindex="-1"><p class="message__from" id="message-8">Vous <span class="message__day">3 juin</span></p><p class="message__text">Mon café a besoin d’un café.</p><button type="button" class="toggle message__close" aria-describedby="message-8">Fermer</button></article>' +
        '<article id="message-card-7" class="message message--landlord" tabindex="-1"><p class="message__from" id="message-7">Votre propriétaire <span class="message__day">1er juin</span></p><p class="message__text">Le loyer est en retard.</p><button type="button" class="toggle message__close" aria-describedby="message-7">Fermer</button></article>' +
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

describe('the message stack', () => {
  it('keeps the newest first, at most three, and drops the one dismissed', () => {
    const stack = createMessageStack()
    for (const id of [1, 2, 3, 4]) stack.getState().receive({ ...RENT, id })
    expect(stack.getState().messages.map(({ id }) => id)).toEqual([4, 3, 2])
    stack.getState().dismiss(3)
    expect(stack.getState().messages.map(({ id }) => id)).toEqual([4, 2])
  })

  it('fills from the game, and empties as a new game starts it again', () => {
    const START = SENT_ALL(createInitialState(42))
    const game = createGameStore({ ...START, day: 31 })
    const stack = createMessageStack()
    stack.getState().receive(RENT)
    let stop = startMessageStack(game, stack)
    expect(stack.getState().messages).toEqual([])
    // A rent left unpaid on day 31 calls for the landlord.
    game.setState({
      game: {
        ...START,
        day: 32,
        personal: { ...START.personal, unpaidRents: [31] },
      },
    })
    expect(stack.getState().messages.map(({ kind }) => kind)).toEqual([
      'landlord',
    ])
    stop()
    // Started again for the same game, as React replays an effect, it
    // keeps them; for a new game, it starts empty.
    stop = startMessageStack(game, stack)
    expect(stack.getState().messages).toHaveLength(1)
    stop()
    game.getState().startGame(START)
    stop = startMessageStack(game, stack)
    expect(stack.getState().messages).toEqual([])
    stop()
  })
  // #232: the street shows a message for 3 game days, then it folds into
  // the « N messages » chip: still in the stack, which the chip counts.
  it('takes a message off the street 3 days on, and keeps it for the chip', () => {
    const START = SENT_ALL(createInitialState(42))
    const game = createGameStore({ ...START, day: 31 })
    const stack = createMessageStack()
    const stop = startMessageStack(game, stack)
    const rentUnpaid = { ...START.personal, unpaidRents: [31] }
    const playTo = (day: number) =>
      game.setState({ game: { ...START, day, personal: rentUnpaid } })
    const street = () =>
      render(
        streetMessages(stack.getState().messages, game.getState().game.day),
      )
    playTo(32)
    expect(street()).toContain('message--landlord')
    playTo(33)
    expect(street()).toContain('message--landlord')
    // Eight days on, with no « Fermer » pressed.
    playTo(40)
    expect(street()).toBe(render([]))
    expect(stack.getState().messages.map(({ kind }) => kind)).toEqual([
      'landlord',
    ])
    stop()
  })

  it('shows a message again for 3 days from the day the chip brings it back', () => {
    const messages = [RENT]
    expect(streetMessages(messages, 33)).toEqual([RENT])
    expect(streetMessages(messages, 34)).toEqual([])
    expect(streetMessages(messages, 40, 40)).toEqual([RENT])
    expect(streetMessages(messages, 42, 40)).toEqual([RENT])
    expect(streetMessages(messages, 43, 40)).toEqual([])
  })
})

describe('a postcard from Réal (#239)', () => {
  const CARD: Message = {
    id: 9,
    kind: 'postcard',
    from: 'Réal, Fort Lauderdale',
    text: 'La ville est à toi. Clique sur Ville.',
    day: 33,
    postcard: { id: 'ville', target: 'ville' },
  }

  it('shows his portrait, the sender, the day, the sentence, the stamp and « Merci! »', () => {
    const html = renderToStaticMarkup(
      <MessagesView
        messages={[CARD]}
        onDismiss={() => {}}
        postcard={{ portrait: '/real.png', thanks: 'Merci!' }}
      />,
    )
    expect(html).toContain(
      '<article id="message-card-9" class="message message--postcard" tabindex="-1">' +
        '<img class="message__portrait" src="/real.png" alt="" width="44" height="44"/>' +
        '<p class="message__from" id="message-9">Réal, Fort Lauderdale <span class="message__day">3 juin</span></p>' +
        '<p class="message__text">La ville est à toi. Clique sur Ville.</p>' +
        '<span class="message__stamp"><svg class="stamp"',
    )
    expect(html).toMatch(/<svg class="stamp"[^>]*aria-hidden="true"/)
    expect(html).toContain(
      '<button type="button" class="toggle message__close" aria-describedby="message-9">Merci!</button></article>',
    )
  })

  it('shows the silhouette while Réal has no portrait, and the content’s « Merci! » by default', () => {
    const html = render([CARD])
    expect(html).toContain('class="message__portrait message__silhouette"')
    expect(html).toContain('>Merci!</button>')
  })

  it('is put away with « Merci! »', () => {
    const dismissed: number[] = []
    const view = MessagesView({
      messages: [CARD, RENT],
      onDismiss: (id) => dismissed.push(id),
    })
    const [card] = view.props.children as {
      props: { children: { props?: { onClick?: () => void } }[] }
    }[]
    card!.props.children
      .find((child) => child?.props?.onClick)
      ?.props?.onClick?.()
    expect(dismissed).toEqual([CARD.id])
  })
})
