import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import { startCity } from './city.ts'
import { CITY, worldPicks, type CityLink } from './cityPicker.ts'
import { MOOD_COLORS, MOOD_WORDS, quoted } from './customerCard.ts'
import { ASSETS } from './manifest.ts'
import { mountWorld, worldOptions } from './mountWorld.ts'
import { listenForPicks, PICKER, type OpenCard } from './picker.ts'
import { startStreet } from './street.ts'
import { startWorld } from './worldView.ts'
import './WorldCanvas.css'

/**
 * The world, drawn behind the panels, which screen readers skip: the street
 * or the city, the city while « Ville » is open (see `startWorld`). While the
 * street runs, the button that picks a customer from the keyboard, hidden
 * until it has focus, and the card of the customer the player picked, over
 * the panels. A click on a building of the city reports its link to
 * `onOpen`, which opens it; without one, as before a game starts, the
 * buildings open nothing.
 */
export default function WorldCanvas({
  onOpen = null,
}: {
  onOpen?: ((link: CityLink) => void) | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The world starts once; it asks for the latest at each press.
  const opener = useRef(onOpen)
  useEffect(() => {
    opener.current = onOpen
  }, [onOpen])
  const { live, open, said } = useSyncExternalStore(
    PICKER.subscribe,
    PICKER.view,
    PICKER.view,
  )

  useEffect(() => {
    const world = ref.current
    if (world === null) return
    const stopListening = listenForPicks(
      window,
      world,
      worldPicks(PICKER, CITY),
      (pointing) => world.classList.toggle('world--pointing', pointing),
    )
    const unmount = mountWorld(world, worldOptions(window), (app) =>
      startWorld(app, {
        street: (scene) => startStreet(scene),
        city: (scene) => startCity(scene, { onOpen: () => openLater(opener) }),
      }),
    )
    return () => {
      stopListening()
      unmount()
    }
  }, [])

  // The status line reads every card out; it only shows, beside the button,
  // when no card does: on an empty street.
  const status =
    open === null && said !== ''
      ? 'world-picker__status world-picker__status--shown'
      : 'world-picker__status'
  return (
    <>
      <div className="world" aria-hidden="true" ref={ref} />
      {live && (
        <div className="world-picker" data-world-control="">
          <button
            type="button"
            className="world-picker__button"
            onClick={() => PICKER.next()}
          >
            Écouter un client
          </button>
          <p className={status} role="status">
            {said}
          </p>
        </div>
      )}
      {open !== null && <CustomerCardView open={open} />}
    </>
  )
}

/**
 * Opens a building's link once the press that clicked it is over: the
 * press moves the focus after its listeners run, so a panel opened in one
 * would lose the focus it gives « Fermer ». Null while nothing opens links.
 */
function openLater(opener: {
  readonly current: ((link: CityLink) => void) | null
}): ((link: CityLink) => void) | null {
  if (opener.current === null) return null
  return (link) => {
    window.setTimeout(() => opener.current?.(link), 0)
  }
}

/**
 * The open card, beside its customer and over the panels. Screen readers
 * skip it: the status line reads out the same words.
 */
function CustomerCardView({ open }: { open: OpenCard }) {
  const { card, place } = open
  const style = {
    left: place.left,
    bottom: place.bottom,
    width: place.width,
    '--mood-color': ASSETS.palette[MOOD_COLORS[card.mood]],
  } as CSSProperties
  return (
    <div
      className="customer-card"
      data-world-control=""
      aria-hidden="true"
      style={style}
    >
      <p className="customer-card__name">{card.name}</p>
      <p className="customer-card__mood">{MOOD_WORDS[card.mood]}</p>
      <p className="customer-card__line">{quoted(card.line)}</p>
    </div>
  )
}
