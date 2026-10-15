import { Container, Graphics, Text } from 'pixi.js'
import type { AssetManifest } from '../content/assets.ts'
import type { Avatar, WalkIns } from '../content/schema.ts'
import type { GameState } from '../engine/types.ts'
import { bobOf, createCrowd, type Span } from './crowd.ts'
import type { CrowdSettings } from './crowdSettings.ts'
import { TITLE_FONT, TITLE_FONT_FAMILY } from './fonts.ts'
import { drawAvatar, drawBubble, drawCustomer, pickLook } from './people.ts'
import type { PlaceholderStyle } from './placeholders.ts'
import {
  createDayClock,
  createSampler,
  replayOf,
  type Replay,
} from './replay.ts'
import { opensToday } from './truckView.ts'

/** The customers on the street, the avatar who serves them and the tally. */
export interface Customers {
  /** The customers and the tally, to add above the street's layers. */
  readonly root: Container
  /** Follows the game the store holds. */
  onGame: (game: GameState) => void
  /**
   * Moves everyone on by `deltaMs` real milliseconds at game `speed`, with
   * `span` of the street on screen.
   */
  frame: (deltaMs: number, speed: number, span: Span) => void
  /** Takes everything down. */
  destroy: () => void
}

/** What the customers need from the street and the game. */
export interface CustomersSetup {
  /** The street's root, holding `layer:truck` and its `counter`. */
  readonly street: Container
  readonly manifest: AssetManifest
  readonly crowd: CrowdSettings
  /** The opening hours yesterday's arrival minutes count from. */
  readonly walkIns: WalkIns
  /** A day's length at speed 1, in real milliseconds. */
  readonly msPerDay: number
  readonly random: () => number
}

/**
 * Replays the last day's visits on the street (see `replayOf`): a sample of
 * them walks up, waits in line, buys or not at the counter and leaves, while
 * the avatar serves behind the counter. Speeds with no crowd settings show
 * the day's tally instead, « 87 clients servis » and « 21 clients perdus ».
 * Pausing freezes everyone, the bubbles and the avatar's arm. On a day the
 * truck is closed, the avatar is gone and everyone still waiting walks off
 * without buying.
 */
export function startCustomers(setup: CustomersSetup): Customers {
  const { street, manifest, crowd: settings, random } = setup
  const style: PlaceholderStyle = {
    palette: manifest.palette,
    outline: manifest.outlineWidth,
  }
  const root = new Container({ label: 'customers', sortableChildren: true })
  const crowd = createCrowd(settings, random)
  const clock = createDayClock(setup.msPerDay)
  const sampler = createSampler(setup.walkIns, settings.speeds, random)
  const tally = drawTally(settings.tally, style)
  tally.root.visible = false
  root.addChild(tally.root)

  const truckLayer = street.getChildByLabel('layer:truck')
  const counter = truckLayer?.getChildByLabel('counter') ?? null
  let avatar: ReturnType<typeof startAvatar> | null = null
  const showAvatar = (kind: Avatar, open: boolean) => {
    if (avatar?.kind !== kind) {
      avatar?.destroy()
      avatar = startAvatar(kind, style, settings)
      if (truckLayer !== null) {
        const at = counter === null ? -1 : truckLayer.getChildIndex(counter)
        if (at < 0) truckLayer.addChild(avatar.root)
        else truckLayer.addChildAt(avatar.root, at)
      }
    }
    avatar.root.visible = open
    if (!open) avatar.rest()
  }

  let replay: Replay | null = null
  let open = false
  const views = new Map<number, CustomerView>()

  /** Moves each customer's drawing to where they are; drops those gone. */
  const sync = () => {
    const present = new Set<number>()
    for (const c of crowd.customers) {
      const view = views.get(c.id)
      if (view === undefined) continue
      present.add(c.id)
      view.root.position.set(c.x, c.y - bobOf(c.walked, settings.bob))
      view.root.zIndex = c.y
      view.figure.scale.x = c.facing
      view.bubble.visible = c.bubble
    }
    for (const [id, view] of views) {
      if (present.has(id)) continue
      view.root.destroy({ children: true })
      views.delete(id)
    }
  }

  return {
    root,
    onGame: (game) => {
      open = opensToday(game)
      showAvatar(game.profile.avatar, open)
      if (!open) crowd.dismiss()
      if (!clock.follow(game)) return
      replay = replayOf(game)
      sampler.start(replay?.visits ?? [])
      if (replay !== null) {
        tally.served.text = countText(
          replay.served,
          'client servi',
          'clients servis',
        )
        tally.lost.text = countText(
          replay.lost,
          'client perdu',
          'clients perdus',
        )
      }
    },
    frame: (deltaMs, speed, span) => {
      if (speed <= 0) return
      const progress = clock.elapse(deltaMs, speed)
      const walking = settings.speeds[speed]
      if (walking === undefined) {
        sampler.step(progress, deltaMs, crowd.customers.length, speed)
        crowd.clear()
        avatar?.rest()
        tally.root.visible = replay !== null
        sync()
        return
      }
      tally.root.visible = false
      const visit = sampler.step(
        progress,
        deltaMs,
        crowd.customers.length,
        speed,
      )
      if (visit !== null && open && replay !== null) {
        const c = crowd.spawn(visit, span)
        const look = pickLook(
          c.visit.segment,
          replay.dayType,
          settings.looks,
          random,
        )
        const view = createCustomerView(
          drawCustomer(look, style, settings.looks),
          drawBubble(c.mood, style),
          look.height,
        )
        views.set(c.id, view)
        root.addChild(view.root)
      }
      const served = crowd.update(deltaMs, walking.pace, span)
      if (served.length > 0 && open) avatar?.serve()
      avatar?.update(deltaMs * walking.pace)
      sync()
    },
    destroy: () => {
      avatar?.destroy()
      avatar = null
      views.clear()
      root.destroy({ children: true })
    },
  }
}

interface CustomerView {
  readonly root: Container
  /** The person, turned to face where they walk. */
  readonly figure: Container
  readonly bubble: Container
}

function createCustomerView(
  figure: Container,
  bubble: Container,
  height: number,
): CustomerView {
  figure.label = 'figure'
  bubble.y = -height - 6
  bubble.visible = false
  const root = new Container({ label: 'customer', children: [figure, bubble] })
  return { root, figure, bubble }
}

/** The avatar behind the counter, and the arm that reaches for each sale. */
function startAvatar(
  kind: Avatar,
  style: PlaceholderStyle,
  settings: CrowdSettings,
) {
  const art = drawAvatar(kind, style, settings.avatar, settings.looks.trousers)
  art.root.position.set(settings.avatar.x, settings.avatar.feetY)
  const { reachMs } = settings
  // Time left in the current reach; 0 when the arm hangs down.
  let reachLeftMs = 0
  const pose = () => {
    const t = reachLeftMs > 0 ? 1 - reachLeftMs / reachMs : 0
    art.arm.rotation = Math.sin(Math.PI * t) * REACH_ANGLE
  }
  return {
    kind,
    root: art.root,
    arm: art.arm,
    serve: () => {
      reachLeftMs = reachMs
      pose()
    },
    update: (deltaMs: number) => {
      if (reachLeftMs <= 0 || deltaMs <= 0) return
      reachLeftMs = Math.max(0, reachLeftMs - deltaMs)
      pose()
    },
    rest: () => {
      reachLeftMs = 0
      pose()
    },
    destroy: () => art.root.destroy({ children: true }),
  }
}

/** How far the arm turns at the height of a reach: across the counter. */
const REACH_ANGLE = Math.PI * 0.45

interface Tally {
  readonly root: Container
  readonly served: Text
  readonly lost: Text
}

/** The badge that counts the day's customers served and lost. */
function drawTally(
  settings: CrowdSettings['tally'],
  style: PlaceholderStyle,
): Tally {
  const { x, y, width, height, fontSize } = settings
  const { palette } = style
  const badge = new Container({ label: 'tally', x, y })
  badge.addChild(
    new Graphics()
      .roundRect(0, 0, width, height, 14)
      .fill(palette.cream)
      .stroke({ width: style.outline, color: palette.ink }),
  )
  const text = (label: string, color: string, row: number) =>
    badge.addChild(
      new Text({
        label,
        style: {
          fontFamily: TITLE_FONT_FAMILY,
          fontWeight: TITLE_FONT.weight,
          fontSize,
          fill: color,
        },
        anchor: { x: 0.5, y: 0.5 },
        position: { x: width / 2, y: (height * row) / 4 },
      }),
    )
  return {
    root: badge,
    served: text('served', palette.moneyGreen, 1),
    lost: text('lost', palette.dangerRed, 3),
  }
}

/** « 1 client servi », « 87 clients servis »: French counts 0 and 1 as one. */
export function countText(count: number, one: string, many: string): string {
  const number = new Intl.NumberFormat('fr-CA').format(count)
  return `${number} ${count < 2 ? one : many}`
}
