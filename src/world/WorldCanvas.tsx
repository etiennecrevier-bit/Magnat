import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import { settingsStore } from '../ui/settings.ts'
import { gameStore } from '../ui/store.ts'
import { startCity } from './city.ts'
import { CITY, worldPicks } from './cityPicker.ts'
import { MOOD_COLORS, MOOD_WORDS, quoted } from './customerCard.ts'
import { ASSETS } from './manifest.ts'
import { mountWorld, worldOptions } from './mountWorld.ts'
import { openLater } from './openLater.ts'
import {
  listenForPicks,
  NO_MARKS,
  PICKER,
  type OpenCard,
  type StreetMarks,
} from './picker.ts'
import { PIXI_LOADERS, startStreet, STREET_CROWD } from './street.ts'
import type { WorldLink } from './streetSpots.ts'
import { gatedScenes, gateWorld } from './worldGate.ts'
import { startWorld } from './worldView.ts'
import './WorldCanvas.css'

/**
 * The world, drawn behind the panels, which screen readers skip: the street
 * or the city, the city while « Ville » is open (see `startWorld`). While the
 * street runs, the button that picks a customer from the keyboard, hidden
 * until it has focus, and the card of the customer the player picked, over
 * the panels. A click on a building of the city, or on a spot of the
 * street, reports its link to `onOpen`, which opens it; without one, as
 * before a game starts, nothing opens, and the street marks nothing. Over
 * the world and under the panels, the street's marks: the spot under the
 * pointer, outlined with its label, and the legend while it shows. It
 * draws only while something moves on it, and once on each change (see
 * `gateWorld`): on the start menu, while `playing` is false, it stands
 * still.
 */
export default function WorldCanvas({
  onOpen = null,
  playing = true,
}: {
  onOpen?: ((link: WorldLink) => void) | null
  /** Whether a game is played: on the start menu, the world stands still. */
  playing?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The world starts once; it asks for the latest at each press.
  const opener = useRef(onOpen)
  useEffect(() => {
    opener.current = onOpen
  }, [onOpen])
  // And whether it moves, which it asks at each change (see `gateWorld`).
  const played = useRef(playing)
  const invalidate = useRef<(() => void) | null>(null)
  useEffect(() => {
    played.current = playing
    invalidate.current?.()
  }, [playing])
  const { live, open, said, marks } = useSyncExternalStore(
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
    const options = worldOptions(window, settingsStore.getState().visualEffects)
    const unmount = mountWorld(world, options, async (app) => {
      // Draws only while something moves, and a frame on each change.
      const gate = gateWorld(app, {
        game: gameStore,
        settings: settingsStore,
        playing: () => played.current,
        picks: PICKER.subscribe,
      })
      invalidate.current = gate?.invalidate ?? null
      const stopWorld = await startWorld(
        app,
        gatedScenes(gate, {
          street: (scene) =>
            startStreet(
              scene,
              gameStore,
              PIXI_LOADERS,
              ASSETS,
              STREET_CROWD,
              PICKER,
              settingsStore,
              () => openLater(opener),
            ),
          city: (scene) =>
            startCity(scene, { onOpen: () => openLater(opener) }),
        }),
      )
      return () => {
        invalidate.current = null
        gate?.stop()
        return stopWorld()
      }
    })
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
      {marks !== NO_MARKS && <StreetMarksView marks={marks} />}
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
 * The street's marks, over the world and under the panels. Presses go
 * through them to the street. Screen readers skip them, as they skip the
 * world: the dock reaches every panel a spot opens.
 */
function StreetMarksView({ marks }: { marks: StreetMarks }) {
  const { spot, legend } = marks
  return (
    <div className="world-marks" aria-hidden="true">
      {spot !== null && (
        <div
          className="street-spot"
          style={{
            left: spot.left,
            top: spot.top,
            width: spot.width,
            height: spot.height,
          }}
        >
          <p
            className={
              spot.below
                ? 'street-spot__label street-spot__label--below'
                : 'street-spot__label'
            }
          >
            {spot.label}
            <span className="street-spot__detail">{` · ${spot.detail}`}</span>
          </p>
        </div>
      )}
      {legend !== null && (
        <p
          className="street-legend"
          style={{ left: legend.at.x, top: legend.at.y }}
        >
          {legend.text}
        </p>
      )}
    </div>
  )
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
