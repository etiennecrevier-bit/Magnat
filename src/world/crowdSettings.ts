import type { AssetManifest } from '../content/assets.ts'
import type { AvatarFatigue } from '../content/avatarFatigue.ts'
import type { GradientStop } from './noise.ts'
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
  /** Where customers' feet stand in line, on the sidewalk left of the truck. */
  readonly groundY: number
  /**
   * How much nearer the viewer customers walk when they pass the line: in
   * the road, in front of the truck.
   */
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
   * The employee at the truck (#208), who stands still on the sidewalk on
   * open days while one works at it: where their feet are, which way they
   * face, and their colours. The staff's shirt is the city's, mustard.
   */
  readonly employee: {
    readonly x: number
    readonly feetY: number
    readonly facing: 1 | -1
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
  /**
   * The badge that counts the day's customers at speeds with no walking.
   * It stands above the truck's sign and the festival's banner, right of
   * the panels' card: the card covers the page up to 688 px
   * (WorldCanvas.css), which is x 780 of the design in a 1280 × 720 window.
   */
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
    /** The colours of hair and caps, and the chance one wears a cap. */
    readonly hair: {
      readonly colors: readonly string[]
      readonly capChance: number
    }
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
  /** How everyone's body takes the light, and the shadows at their feet. */
  readonly figure: FigureLight
}

/**
 * The light on a person, from `person()` in the design reference's
 * `rue.py` (#197): how much of the sun or slate each part mixes in, the
 * gradients over the torso and the head, and the two soft shadows on the
 * ground.
 */
export interface FigureLight {
  /** How much slate the parts away from the sun mix in. */
  readonly shade: {
    readonly arm: number
    readonly hand: number
    readonly leg: number
  }
  /** How much sun the parts toward it mix in. */
  readonly lit: {
    /** The arm hanging toward the sun. */
    readonly arm: number
    /** That arm bent to hold something. */
    readonly bentArm: number
    /** The cap's lit edge, and the hair's lit stroke. */
    readonly capEdge: number
    readonly hairEdge: number
    /** The avatar's hairline. */
    readonly ownerHairEdge: number
  }
  /**
   * The side gradient over a torso, from the sun's side to the other, each
   * stop in the sun's or the slate's colour.
   */
  readonly side: readonly FigureStop[]
  /**
   * The light over a head: out from a centre toward the sun, as shares of
   * its box, to `radius`.
   */
  readonly round: {
    readonly centre: { readonly x: number; readonly y: number }
    readonly radius: number
    readonly stops: readonly FigureStop[]
  }
  /** A cup's colour and its band's. */
  readonly cup: { readonly color: string; readonly band: string }
  /**
   * The shadows of someone standing, in slate: a spot under their feet and
   * a longer one reaching to the lower right, each `dx`, `dy` from their
   * feet and `width` wide, as shares of their height, `depth` as deep as
   * it is wide, at `opacity`.
   */
  readonly shadow: {
    readonly feet: FigureShadow
    readonly reach: FigureShadow
  }
}

/** A stop of a figure's gradient, in one of the light's tones. */
export interface FigureStop extends Omit<GradientStop, 'color'> {
  readonly tone: 'sun' | 'slate'
}

/** One of a figure's shadows on the ground. */
export interface FigureShadow {
  readonly dx: number
  readonly dy: number
  readonly width: number
  readonly depth: number
  readonly opacity: number
}

/**
 * The reference draws a person 116 tall, from their feet to the top of
 * their head: its numbers are divided by it.
 */
const REFERENCE = 116

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
  groundY: 690,
  laneOffset: 44,
  mergeDistance: 40,
  counterX: 526,
  slotSpacing: 66,
  edgeMargin: 60,
  bob: { height: 3, stride: 28 },
  avatar: { x: 730, feetY: 638, height: 130, skin: '#C98E62', hair: '#3B2A20' },
  employee: {
    x: 1166,
    feetY: 690,
    facing: -1,
    height: 118,
    skin: '#7C4B2C',
    hair: '#2B2622',
  },
  fatigue: AVATAR_FATIGUE,
  fans: ASSETS.fans,
  tally: { x: 850, y: 176, width: 330, height: 56, fontSize: 30 },
  card: { width: 260, gap: 10, margin: 8 },
  pickMargin: 8,
  looks: {
    height: { min: 106, max: 126 },
    childHeight: { min: 62, max: 76 },
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
      // The design reference's shirts.
      '#3F7F8F',
      '#7A8F3C',
      '#6B4A8C',
      '#C0573A',
      '#D08A2E',
      '#4A6FA5',
    ],
    hair: {
      colors: [
        '#7A4B2A',
        '#4A5A2A',
        '#C9A24A',
        '#2B2622',
        '#5A3A2A',
        '#3B2A20',
      ],
      capChance: 0.35,
    },
    coat: '#7A5C44',
    tote: '#8FB573',
    laptopBag: '#3F4448',
    trousers: '#3B3A44',
    officeChance: 0.35,
    familyChance: 0.3,
  },
  figure: {
    shade: { arm: 0.45, hand: 0.4, leg: 0.36 },
    lit: {
      arm: 0.12,
      bentArm: 0.15,
      capEdge: 0.4,
      hairEdge: 0.45,
      ownerHairEdge: 0.25,
    },
    side: [
      { offset: 0, tone: 'sun', alpha: 0.3 },
      { offset: 0.45, tone: 'sun', alpha: 0 },
      { offset: 1, tone: 'slate', alpha: 0.38 },
    ],
    round: {
      centre: { x: 0.32, y: 0.28 },
      radius: 0.85,
      stops: [
        { offset: 0, tone: 'sun', alpha: 0.45 },
        { offset: 0.5, tone: 'sun', alpha: 0 },
        { offset: 1, tone: 'slate', alpha: 0.42 },
      ],
    },
    cup: { color: '#FFFFFF', band: '#C97B2C' },
    shadow: {
      feet: {
        dx: 4 / REFERENCE,
        dy: 1 / REFERENCE,
        width: 44 / REFERENCE,
        depth: 10 / 44,
        opacity: 0.45,
      },
      reach: {
        dx: 26 / REFERENCE,
        dy: -1 / REFERENCE,
        width: 60 / REFERENCE,
        depth: 8 / 60,
        opacity: 0.2,
      },
    },
  },
}
