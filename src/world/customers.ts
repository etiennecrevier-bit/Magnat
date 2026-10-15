import { Container, Graphics, Text } from 'pixi.js'
import type { AssetManifest } from '../content/assets.ts'
import type { CustomerLines } from '../content/lines.ts'
import type { Avatar, EnergyContent, WalkIns } from '../content/schema.ts'
import { fatigueOf, type Fatigue } from '../engine/energy.ts'
import type { GameState } from '../engine/types.ts'
import { bobOf, createCrowd, type Customer, type Span } from './crowd.ts'
import type { CrowdSettings } from './crowdSettings.ts'
import {
  cardOf,
  customerAt,
  nextOnScreen,
  type Box,
  type CustomerCard,
  type Point,
  type Target,
} from './customerCard.ts'
import {
  avatarPose,
  createSpillClock,
  createYawns,
  type AvatarPose,
} from './fatigue.ts'
import { TITLE_FONT, TITLE_FONT_FAMILY } from './fonts.ts'
import {
  drawAvatar,
  drawBubble,
  drawCustomer,
  drawPickMark,
  drawSpill,
  pickLook,
} from './people.ts'
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
  /**
   * Opens the card of the customer drawn at `point` on the page, or closes
   * the card when no one is there. Returns whether a card is open.
   */
  pickAt: (point: Point) => boolean
  /** Whether a customer is drawn at `point` on the page. */
  isOver: (point: Point) => boolean
  /**
   * Opens the card of the next customer standing within `span`, in the order
   * they came, back to the first after the last. Returns false, with the
   * card closed, when no one stands within it.
   */
  pickNext: (span: Span) => boolean
  /** Closes the card. */
  unpick: () => void
  /** The open card, and where its customer is drawn; null when none is. */
  picked: () => Picked | null
  /** Takes everything down. */
  destroy: () => void
}

/** The card the player opened, and where its customer is drawn on the page. */
export interface Picked {
  readonly card: CustomerCard
  readonly box: Box
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
  /** What customers say when the player picks them. */
  readonly lines: CustomerLines
  /** Where the owner's fatigue starts, which the avatar shows. */
  readonly energy: EnergyContent
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
 *
 * The avatar shows the owner's fatigue on the morning of `game.day` (see
 * `avatarPose`): a tired one reaches slower and yawns, an exhausted one
 * also slumps, with dark circles under the eyes. A customer with a botched
 * unit leaves a spill on the counter, which fades out. Yawns go on at ×10,
 * where no one walks; the spill goes with the customers.
 *
 * The player can pick one customer at a time, which rings their feet and
 * opens their card (see `cardOf`), with a line picked the first time. The
 * card closes once they walk off the screen or the street clears.
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
  let fatigue: Fatigue = 'rested'
  let avatar: ReturnType<typeof startAvatar> | null = null
  const showAvatar = (kind: Avatar, open: boolean) => {
    if (avatar?.kind !== kind) {
      avatar?.destroy()
      avatar = startAvatar(kind, style, settings, random)
      if (truckLayer !== null) {
        const at = counter === null ? -1 : truckLayer.getChildIndex(counter)
        if (at < 0) truckLayer.addChild(avatar.root)
        else truckLayer.addChildAt(avatar.root, at)
      }
    }
    avatar.setFatigue(fatigue)
    avatar.root.visible = open
    if (!open) avatar.rest()
  }

  // The spill sits on the counter, in front of it and of the avatar.
  const spill = drawSpill(settings.fatigue.spill, style)
  spill.visible = false
  truckLayer?.addChild(spill)
  const spillClock = createSpillClock(settings.fatigue.spill)
  const showSpill = (opacity: number) => {
    spill.alpha = opacity
    spill.visible = opacity > 0
  }
  const dropSpill = () => {
    spillClock.hide()
    showSpill(0)
  }

  let replay: Replay | null = null
  let open = false
  const views = new Map<number, CustomerView>()

  // The customer whose card is open.
  let pickedId: number | null = null
  const pick = (id: number | null) => {
    if (pickedId !== null) {
      const before = views.get(pickedId)
      if (before !== undefined) before.mark.visible = false
    }
    pickedId = id
    if (id === null) return
    const view = views.get(id)
    const customer = crowd.customers.find((c) => c.id === id)
    if (view === undefined || customer === undefined) {
      pickedId = null
      return
    }
    view.mark.visible = true
    view.card ??= cardOf(customer.visit, setup.lines, random)
  }
  /** Everyone drawn on the street, where they are drawn on the page. */
  const targets = (): Target[] =>
    crowd.customers.flatMap((c) => {
      const view = views.get(c.id)
      if (view === undefined) return []
      return [{ id: c.id, box: boxOf(view.figure), depth: c.y }]
    })

  /**
   * Moves each customer's drawing to where they are; drops those gone, and
   * closes the card of a customer who has walked off `span`.
   */
  const sync = (span: Span) => {
    const present = new Set<number>()
    for (const c of crowd.customers) {
      const view = views.get(c.id)
      if (view === undefined) continue
      present.add(c.id)
      view.root.position.set(c.x, c.y - bobOf(c.walked, settings.bob))
      view.root.zIndex = c.y
      view.figure.scale.x = c.facing
      view.bubble.visible = c.bubble
      const offScreen = c.x < span.left || c.x > span.right
      if (c.id === pickedId && c.phase === 'leaving' && offScreen) pick(null)
    }
    for (const [id, view] of views) {
      if (present.has(id)) continue
      if (id === pickedId) pick(null)
      view.root.destroy({ children: true })
      views.delete(id)
    }
  }

  return {
    root,
    onGame: (game) => {
      open = opensToday(game)
      fatigue = fatigueOf(game.energy, setup.energy)
      showAvatar(game.profile.avatar, open)
      if (!open) {
        crowd.dismiss()
        dropSpill()
      }
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
        avatar?.idle(deltaMs)
        dropSpill()
        tally.root.visible = replay !== null
        sync(span)
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
          drawPickMark(look.height, style),
          look.height,
        )
        views.set(c.id, view)
        root.addChild(view.root)
      }
      const arrived = crowd.update(deltaMs, walking.pace, span)
      showSpill(spillClock.update(deltaMs * walking.pace))
      if (open) {
        // The avatar reaches for every unit made, botched ones included.
        if (arrived.some((a) => a.kind === 'served' || botched(a.customer)))
          avatar?.serve()
        if (arrived.some((a) => botched(a.customer))) {
          spillClock.show()
          showSpill(1)
        }
      }
      avatar?.update(deltaMs * walking.pace)
      avatar?.idle(deltaMs)
      sync(span)
    },
    pickAt: (point) => {
      pick(customerAt(point, targets(), settings.pickMargin))
      return pickedId !== null
    },
    isOver: (point) =>
      customerAt(point, targets(), settings.pickMargin) !== null,
    pickNext: (span) => {
      const shown = crowd.customers.filter((c) => views.has(c.id))
      pick(nextOnScreen(shown, pickedId, span))
      return pickedId !== null
    },
    unpick: () => pick(null),
    picked: () => {
      const view = pickedId === null ? undefined : views.get(pickedId)
      if (view === undefined || view.card === null) return null
      return { card: view.card, box: boxOf(view.figure) }
    },
    destroy: () => {
      avatar?.destroy()
      avatar = null
      spill.destroy()
      pickedId = null
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
  /** The ring at their feet while their card is open. */
  readonly mark: Container
  /** Their card, from the first time the player picks them. */
  card: CustomerCard | null
}

function createCustomerView(
  figure: Container,
  bubble: Container,
  mark: Container,
  height: number,
): CustomerView {
  figure.label = 'figure'
  bubble.y = -height - 6
  bubble.visible = false
  mark.visible = false
  const root = new Container({
    label: 'customer',
    children: [mark, figure, bubble],
  })
  return { root, figure, bubble, mark, card: null }
}

/** Whether the owner botched a unit for `customer`. */
function botched({ visit }: Customer): boolean {
  return visit.botched > 0
}

/** Where `node` is drawn on the page: the stage's pixels are the page's. */
function boxOf(node: Container): Box {
  const { minX, minY, maxX, maxY } = node.getBounds()
  return { left: minX, top: minY, right: maxX, bottom: maxY }
}

/**
 * The avatar behind the counter: the arm that reaches for each sale, and
 * the owner's fatigue, which `setFatigue` shows.
 */
function startAvatar(
  kind: Avatar,
  style: PlaceholderStyle,
  settings: CrowdSettings,
  random: () => number,
) {
  const look = settings.fatigue
  const art = drawAvatar(
    kind,
    style,
    settings.avatar,
    settings.looks.trousers,
    look.circlesColor,
  )
  art.root.position.set(settings.avatar.x, settings.avatar.feetY)
  const yawns = createYawns(look.yawn, random)
  let fatigue: Fatigue | null = null
  let current: AvatarPose = avatarPose('rested', settings.reachMs, look)
  // Time left in the current reach; 0 when the arm hangs down.
  let reachLeftMs = 0
  const pose = () => {
    const t = reachLeftMs > 0 ? 1 - reachLeftMs / current.reachMs : 0
    art.arm.rotation = Math.sin(Math.PI * t) * REACH_ANGLE
  }
  const yawn = (yawning: boolean) => {
    art.yawn.visible = yawning
    // The eyes all but close while the mouth is open.
    art.eyes.scale.y = yawning ? YAWN_EYES : 1
  }
  return {
    kind,
    root: art.root,
    arm: art.arm,
    serve: () => {
      reachLeftMs = current.reachMs
      pose()
    },
    update: (deltaMs: number) => {
      if (reachLeftMs <= 0 || deltaMs <= 0) return
      reachLeftMs = Math.max(0, reachLeftMs - deltaMs)
      pose()
    },
    /** Moves the yawns on by `deltaMs`, whether or not anyone walks. */
    idle: (deltaMs: number) => {
      if (current.yawns) yawn(yawns.update(deltaMs))
    },
    rest: () => {
      reachLeftMs = 0
      pose()
    },
    setFatigue: (next: Fatigue) => {
      if (next === fatigue) return
      fatigue = next
      // A reach under way finishes in the same share of the new time.
      const share = reachLeftMs > 0 ? reachLeftMs / current.reachMs : 0
      current = avatarPose(next, settings.reachMs, look)
      reachLeftMs = share * current.reachMs
      const { slump } = look
      art.upper.y = current.slumped ? slump.bodyDrop : 0
      art.face.y = art.face.pivot.y + (current.slumped ? slump.headDrop : 0)
      art.face.rotation = current.slumped ? slump.tiltRadians : 0
      art.circles.visible = current.circles
      yawns.reset()
      yawn(false)
    },
    destroy: () => art.root.destroy({ children: true }),
  }
}

/** How open the eyes stay during a yawn, as a share of their height. */
const YAWN_EYES = 0.3

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
