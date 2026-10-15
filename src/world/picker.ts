import {
  saying,
  type CardPlace,
  type CustomerCard,
  type Point,
} from './customerCard.ts'

// The bridge between the page, where the player presses and types, and the
// street, which knows where its customers are drawn. Either side can come
// and go: a press before the street starts, or after it stops, does nothing.

/** What the street does when the page picks: the street's side. */
export interface PickTarget {
  /**
   * Opens the card of the customer drawn at `point` on the page, or closes
   * the card when no one is there.
   */
  pickAt: (point: Point) => void
  /** Whether a customer is drawn at `point` on the page. */
  isOver: (point: Point) => boolean
  /** Opens the card of the next customer on screen; false when no one is. */
  pickNext: () => boolean
  /** Closes the card. */
  unpick: () => void
}

/** The card the player opened, and where it sits on the page. */
export interface OpenCard {
  readonly card: CustomerCard
  readonly place: CardPlace
}

/** What the page shows of the picker. */
export interface PickerView {
  /**
   * Whether a street holds the picker. Without one, as when the world cannot
   * start, there is no one to pick and the page shows no picker.
   */
  readonly live: boolean
  /** The card open beside a customer; null when none is. */
  readonly open: OpenCard | null
  /**
   * What the status line reads out: the open card, or that no one is on the
   * street, or nothing.
   */
  readonly said: string
}

/** A street's hold on the picker, from `connect`. */
export interface PickerConnection {
  /** Shows `open`, or no card. Ignored while another street holds the picker. */
  show: (open: OpenCard | null) => void
  /** Lets go of the picker; the second time does nothing. */
  disconnect: () => void
}

export interface Picker {
  view: () => PickerView
  /** Calls `listener` each time the view changes; returns the unsubscriber. */
  subscribe: (listener: () => void) => () => void
  /** The player pressed the street at `point`. */
  at: (point: Point) => void
  /** Whether a customer is drawn at `point`, to show a pointer over them. */
  over: (point: Point) => boolean
  /** Opens the next customer's card; says so when no one is there. */
  next: () => void
  /** Closes the card. */
  close: () => void
  /**
   * Hands the picker to `street`. The latest street to connect holds it;
   * when it lets go, the one before it, if still connected, holds it again,
   * so a street that stops late never cuts off the one that replaced it.
   */
  connect: (street: PickTarget) => PickerConnection
}

/** What the status line says when the player asks for a card on an empty street. */
export const NOBODY_THERE = "Personne dans la rue pour l'instant."

export function createPicker(): Picker {
  const streets: { readonly target: PickTarget }[] = []
  const holder = () => streets.at(-1)
  let view: PickerView = { live: false, open: null, said: '' }
  const listeners = new Set<() => void>()
  const set = (next: PickerView) => {
    if (
      next.live === view.live &&
      next.open === view.open &&
      next.said === view.said
    ) {
      return
    }
    view = next
    for (const listener of [...listeners]) listener()
  }
  /** No card and nothing said, with a street holding the picker or not. */
  const closed = (): PickerView => ({
    live: streets.length > 0,
    open: null,
    said: '',
  })

  return {
    view: () => view,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    at: (point) => holder()?.target.pickAt(point),
    over: (point) => holder()?.target.isOver(point) ?? false,
    next: () => {
      if (holder()?.target.pickNext() !== true) {
        set({ ...closed(), said: NOBODY_THERE })
      }
    },
    close: () => {
      holder()?.target.unpick()
      set(closed())
    },
    connect: (target) => {
      const link = { target }
      streets.push(link)
      set(closed())
      return {
        show: (open) => {
          if (holder() === link) set(shown(view, open))
        },
        disconnect: () => {
          const at = streets.indexOf(link)
          if (at < 0) return
          streets.splice(at, 1)
          if (at === streets.length) set(closed())
        },
      }
    },
  }
}

/** `view` once the street shows `open`: a new card is read out, a moved one is not. */
function shown(view: PickerView, open: OpenCard | null): PickerView {
  const before = view.open
  if (open === null) return before === null ? view : { ...view, open, said: '' }
  if (before?.card === open.card) {
    return samePlace(before.place, open.place) ? view : { ...view, open }
  }
  return { ...view, open, said: saying(open.card) }
}

function samePlace(a: CardPlace, b: CardPlace): boolean {
  return (
    a.left === b.left &&
    a.bottom === b.bottom &&
    a.width === b.width &&
    a.side === b.side
  )
}

/** The picker the page and the street share, as `gameStore` is the game's. */
export const PICKER: Picker = createPicker()

/** Where a press lands: on the street, on the world's own controls, or on the rest of the page. */
export type Landing = 'street' | 'control' | 'page'

/** The world's own controls, a press on which neither picks nor closes. */
const WORLD_CONTROL = '[data-world-control]'

/**
 * Where a press on `target` lands, with `world` the layer the street is drawn
 * in. The layer sits under the page, so a press beside the panels lands on
 * the canvas or on an element that holds the layer (`html`, `body`, the
 * app's root): those are the street.
 */
export function whereLands(target: unknown, world: unknown): Landing {
  if (closest(target, WORLD_CONTROL)) return 'control'
  if (contains(world, target) || contains(target, world)) return 'street'
  return 'page'
}

/** The parts of a pointer event the picker reads, so tests can fake one. */
export interface PointerLike {
  readonly button: number
  readonly isPrimary: boolean
  readonly clientX: number
  readonly clientY: number
  readonly target: unknown
}

/** The parts of a key event the picker reads, so tests can fake one. */
export interface KeyLike {
  readonly key: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly target: unknown
}

/**
 * Whether `event` closes the card: Escape, without a modifier, unless it
 * belongs to a text field or to an open dialog, which closes on it.
 */
export function isCloseKey(event: KeyLike): boolean {
  return (
    event.key === 'Escape' &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !isEditable(event.target) &&
    !closest(event.target, 'dialog')
  )
}

/** The page the picker listens to: the window, or a test's fake. */
export interface PickPage {
  addEventListener(
    type: 'pointerdown' | 'pointermove',
    listener: (event: PointerLike) => void,
  ): void
  addEventListener(type: 'keydown', listener: (event: KeyLike) => void): void
  removeEventListener(
    type: 'pointerdown' | 'pointermove',
    listener: (event: PointerLike) => void,
  ): void
  removeEventListener(type: 'keydown', listener: (event: KeyLike) => void): void
}

/**
 * Listens on `page` for the player picking customers on the street drawn in
 * `world`. A primary press on the street picks the customer there, or
 * closes the card when no one is; a press anywhere else on the page closes
 * it; a press on the world's own controls does neither. Escape closes it
 * (see `isCloseKey`). Moving over a customer calls `onPointing(true)`, and
 * anywhere else `onPointing(false)`. Returns the function that stops
 * listening.
 */
export function listenForPicks(
  page: PickPage,
  world: unknown,
  picker: Picker,
  onPointing: (pointing: boolean) => void,
): () => void {
  const pointAt = (event: PointerLike) => ({
    x: event.clientX,
    y: event.clientY,
  })
  const press = (event: PointerLike) => {
    if (event.button !== 0 || !event.isPrimary) return
    const landing = whereLands(event.target, world)
    if (landing === 'street') picker.at(pointAt(event))
    else if (landing === 'page') picker.close()
  }
  const move = (event: PointerLike) => {
    onPointing(
      whereLands(event.target, world) === 'street' &&
        picker.over(pointAt(event)),
    )
  }
  const key = (event: KeyLike) => {
    if (isCloseKey(event)) picker.close()
  }
  page.addEventListener('pointerdown', press)
  page.addEventListener('pointermove', move)
  page.addEventListener('keydown', key)
  return () => {
    page.removeEventListener('pointerdown', press)
    page.removeEventListener('pointermove', move)
    page.removeEventListener('keydown', key)
    onPointing(false)
  }
}

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isEditable(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false
  const { tagName, isContentEditable } = target as {
    tagName?: unknown
    isContentEditable?: unknown
  }
  if (isContentEditable === true) return true
  return typeof tagName === 'string' && TEXT_ENTRY_TAGS.has(tagName)
}

/** Whether `target` is, or sits inside, an element matching `selectors`. */
function closest(target: unknown, selectors: string): boolean {
  if (typeof target !== 'object' || target === null) return false
  const { closest: find } = target as { closest?: unknown }
  if (typeof find !== 'function') return false
  return find.call(target, selectors) !== null
}

/** Whether `node` is `other` or holds it. Both must be page nodes. */
function contains(node: unknown, other: unknown): boolean {
  if (!isNode(node) || !isNode(other)) return false
  const { contains: holds } = node as { contains?: unknown }
  if (typeof holds !== 'function') return false
  return holds.call(node, other) === true
}

function isNode(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { nodeType?: unknown }).nodeType === 'number'
}
