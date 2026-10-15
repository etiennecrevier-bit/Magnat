import type { AssetManifest } from '../content/assets.ts'
import type { AvatarFatigue } from '../content/avatarFatigue.ts'
import { ASSETS, AVATAR_FATIGUE } from './manifest.ts'

// How the street's customers look and move. These numbers only change what
// the world draws, never the game, so they live here with the world rather
// than in src/content/: the card that added them was held to src/world/, an
// exception to CLAUDE.md rule 5 that a content card may undo by moving them
// into assets.json. Positions and lengths are logical pixels of the
// 1440 × 900 design, except the card's and the pick's, which are CSS pixels
// of the page; times are milliseconds. How fatigue shows on the avatar came
// with a card that could edit src/content/, so it lives there instead, in
// avatarFatigue.json, and who fans themselves in a heat wave with another,
// in assets.json.

/** How the crowd replays yesterday's visits at one game speed. */
export interface SpeedCrowd {
  /** The chance each visit is kept when it comes up in the replay. */
  readonly keepChance: number
  /** The real time between two arrivals, at least this, give or take `jitterMs`. */
  readonly minGapMs: number
  /** How much `minGapMs` varies each time, below it as much as above. */
  readonly jitterMs: number
  /** No one new comes while this many customers are on screen. */
  readonly maxOnScreen: number
  /** How fast customers walk and get served: 1 is the normal pace. */
  readonly pace: number
}

/** A range of numbers, both ends included. */
export interface Range {
  readonly min: number
  readonly max: number
}

export interface CrowdSettings {
  /**
   * Each game speed of pacing.json that shows customers walking. A speed
   * above 0 with no entry shows the day's tally instead.
   */
  readonly speeds: Readonly<Record<number, SpeedCrowd | undefined>>
  /** How fast customers walk at the normal pace, per second. */
  readonly walkSpeed: number
  /** How long a customer who buys stays at the counter. */
  readonly serveMs: number
  /** How long a customer who buys nothing looks at the counter. */
  readonly lookMs: number
  /** How long the mood bubble shows once a customer leaves the counter. */
  readonly bubbleMs: number
  /** How long the avatar's arm reaches across the counter for a sale. */
  readonly reachMs: number
  /** Where customers' feet stand in line, in front of the truck. */
  readonly groundY: number
  /** How much nearer the viewer customers walk when they pass the line. */
  readonly laneOffset: number
  /** How far from their spot in line customers step out of the lane. */
  readonly mergeDistance: number
  /** The spot in front of the counter, where the line starts. */
  readonly counterX: number
  /** The room each customer takes in line. */
  readonly slotSpacing: number
  /** How far past the edge of the screen customers come and go. */
  readonly edgeMargin: number
  /** How far a step lifts a walker, and how long a step is. */
  readonly bob: { readonly height: number; readonly stride: number }
  /**
   * Where the avatar stands, behind the counter that hides their legs, and
   * their colours: the profile only picks the hair.
   */
  readonly avatar: {
    readonly x: number
    readonly feetY: number
    readonly height: number
    readonly skin: string
    readonly hair: string
  }
  /**
   * How the owner's fatigue shows: the avatar's slower reach, yawns, slump
   * and dark circles, and the spill a botched unit leaves on the counter.
   */
  readonly fatigue: AvatarFatigue
  /** Who fans themselves, and when: as in a heat wave. */
  readonly fans: AssetManifest['fans']
  /** The badge that counts the day's customers at speeds with no walking. */
  readonly tally: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
    readonly fontSize: number
  }
  /** The card beside a customer the player picks, in CSS pixels. */
  readonly card: {
    /** Its width, unless the page is narrower. */
    readonly width: number
    /** The room between it and its customer. */
    readonly gap: number
    /** The least room between it and the page's edges. */
    readonly margin: number
  }
  /**
   * How far outside a customer's drawing a press still picks them, in CSS
   * pixels: they keep walking while the player aims.
   */
  readonly pickMargin: number
  /** What customers look like; each one draws from these at random. */
  readonly looks: {
    /** A customer's height from their feet to the top of their head. */
    readonly height: Range
    /** A child's height, beside the adult they come with. */
    readonly childHeight: Range
    readonly skinTones: readonly string[]
    readonly clothes: readonly string[]
    /** The chic customer's long coat. */
    readonly coat: string
    /** The bargain hunter's reusable bag. */
    readonly tote: string
    /** The office worker's laptop bag. */
    readonly laptopBag: string
    /** Everyone's trousers. */
    readonly trousers: string
    /** The chance a weekday customer shows an office cue. */
    readonly officeChance: number
    /** The chance a weekend customer comes with a child. */
    readonly familyChance: number
  }
}

/** The street's crowd. */
export const CROWD: CrowdSettings = {
  speeds: {
    1: {
      keepChance: 0.08,
      minGapMs: 900,
      jitterMs: 300,
      maxOnScreen: 10,
      pace: 1,
    },
    3: {
      keepChance: 0.02,
      minGapMs: 1100,
      jitterMs: 400,
      maxOnScreen: 5,
      pace: 2.5,
    },
  },
  walkSpeed: 170,
  serveMs: 2000,
  lookMs: 1000,
  bubbleMs: 1600,
  reachMs: 500,
  groundY: 772,
  laneOffset: 34,
  mergeDistance: 40,
  counterX: 860,
  slotSpacing: 56,
  edgeMargin: 60,
  bob: { height: 3, stride: 28 },
  avatar: { x: 982, feetY: 694, height: 150, skin: '#C98E62', hair: '#3B2A20' },
  fatigue: AVATAR_FATIGUE,
  fans: ASSETS.fans,
  tally: { x: 420, y: 724, width: 330, height: 96, fontSize: 30 },
  card: { width: 260, gap: 10, margin: 8 },
  pickMargin: 8,
  looks: {
    height: { min: 132, max: 166 },
    childHeight: { min: 78, max: 96 },
    skinTones: [
      '#F5D6B8',
      '#E6B48C',
      '#C98E62',
      '#A86B43',
      '#7C4B2C',
      '#4F2F1E',
    ],
    clothes: [
      '#5B8C47',
      '#C06A43',
      '#7A7436',
      '#6E7F8C',
      '#D9A441',
      '#A34E5C',
      '#4F7A78',
    ],
    coat: '#7A5C44',
    tote: '#8FB573',
    laptopBag: '#3F4448',
    trousers: '#4A4039',
    officeChance: 0.35,
    familyChance: 0.3,
  },
}
