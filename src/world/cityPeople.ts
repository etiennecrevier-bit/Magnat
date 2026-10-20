import { Container, Graphics } from 'pixi.js'
import type { CityManifest, CityPoint } from '../content/assets.ts'
import { segmentIdSchema, type Avatar } from '../content/schema.ts'
import { drawLabel, drawVan, flat, type CityStyle } from './cityPlaceholders.ts'
import type { CityScene } from './cityScene.ts'
import type { CityActors, CityView } from './cityView.ts'
import {
  CROWD,
  type CrowdSettings,
  type FigureShadow,
} from './crowdSettings.ts'
import { boxCorners, castShadow, depthAmong, type Vec } from './iso.ts'
import { seeded } from './noise.ts'
import {
  createPeopleShading,
  drawAvatar,
  drawCustomer,
  drawEmployee,
  pickLook,
  type PeopleStyle,
} from './people.ts'
import { dashesOf, pointAlong, reversed } from './route.ts'

// The people of the city and the van, moved each frame (see `actorsAt`):
// the owner and the employees serving in the truck's hatch, the owner
// walking to the day's place along its dashed way, the line, the bakers at
// the bakery's door, the deliverers by the van, and the van on its round.
// They are the street's people (people.ts), drawn `figure.scale` times as
// big, each with the street's two shadows on the ground. Each one walking
// is drawn among the boxes by where they stand (see `depthAmong`), so a
// building in front hides them.

/** The city's people, made once and shown from the view and the minute. */
export interface CityPeople {
  /** « En route vers… » and a building's name, to add over the atmosphere. */
  readonly labels: Container
  /** Shows the day: who works, the trip's way and words, the van. */
  show: (view: CityView, avatar: Avatar) => void
  /** Puts everyone where they are, with `inLine` customers in line. */
  frame: (actors: CityActors, inLine: number) => void
  /** Shows `name` over `at`, or no name with null. */
  name: (name: string | null, at: Vec | null) => void
  /** Takes them down. */
  destroy: () => void
}

/** Puts the people of `city` in `scene`, as the street's `crowd` look. */
export function createCityPeople(
  scene: CityScene,
  city: CityManifest,
  crowd: CrowdSettings = CROWD,
): CityPeople {
  const { block, shadows } = scene
  const { scale } = city.figure
  const style: PeopleStyle & CityStyle = {
    ...scene.style,
    shading: createPeopleShading(scene.style.light, crowd.figure),
  }
  const { palette } = style
  const { trousers } = crowd.looks
  const labels = new Container({ label: 'labels' })
  const path = scene.ground.addChild(new Graphics({ label: 'tripPath' }))
  const ring = scene.ground.addChild(
    new Graphics({ label: 'ring', visible: false }),
  )
  const { ring: around } = city.path
  ring
    .ellipse(0, 0, around.width / 2, around.depth / 2)
    .stroke({ width: around.stroke, color: palette[city.path.color] })

  /** Someone standing on the ground, with their two shadows. */
  interface Walker {
    readonly root: Container
    readonly ground: readonly Container[]
  }
  const walker = (id: string, figure: Container, height: number): Walker => {
    const root = block.addChild(new Container({ label: id, visible: false }))
    root.scale.set(scale)
    root.addChild(figure)
    // As the street's, the sun on their left whichever way they face.
    const { feet, reach } = style.shading.figure.shadow
    const tall = height * scale
    const sized = (oval: FigureShadow) => ({
      ...oval,
      dx: oval.dx * tall,
      dy: oval.dy * tall,
      width: oval.width * tall,
    })
    const ground = [
      shadows.castOval(id, 0, 0, sized(reach)),
      shadows.spot(id, 0, 0, sized(feet)),
    ]
    for (const shadow of ground) shadow.visible = false
    return { root, ground }
  }
  const half = (crowd.looks.height.max * scale) / 4
  const place = ({ root, ground }: Walker, at: Vec | null) => {
    root.visible = at !== null
    for (const shadow of ground) shadow.visible = at !== null
    if (at === null) return
    root.position.set(at[0], at[1])
    for (const shadow of ground) shadow.position.set(at[0], at[1])
    root.zIndex = depthAmong(at, scene.boxes, half)
  }
  const employee = () => drawEmployee(crowd.employee, style, trousers)

  // Who serves stands in the hatch, behind its awning, seen through it.
  const { crew, truck } = scene
  const hatch = city.pieces.find((piece) => piece.kind === 'hatch')
  if (hatch !== undefined) {
    const corner = (x: number, y: number): Vec => [x - truck.x, y - truck.y]
    const { x, y, width: w, height: h } = hatch
    const window = crew.addChild(
      new Graphics({ label: 'window' })
        .poly(
          flat([
            corner(x, y),
            corner(x + w, y + w / 2),
            corner(x + w, y + w / 2 + h),
            corner(x, y + h),
          ]),
        )
        .fill(palette.ink),
    )
    crew.mask = window
  }
  const inTruck = (point: CityPoint): Vec => [
    point[0] - truck.x,
    point[1] - truck.y,
  ]
  const atHatch = (n: number): Vec => {
    const { first, step } = city.truck.window
    return inTruck([first[0] + step[0] * n, first[1] + step[1] * n])
  }
  let ownerBust: Container | null = null
  const crewBusts: Container[] = []
  let avatarShown: Avatar | null = null

  // The owner walking, in their blue shirt and apron with their avatar's
  // hair, drawn facing each way so the sun stays on their left; drawn again
  // when the avatar changes.
  const ownerLook = {
    ...crowd.employee,
    height: crowd.avatar.height,
    skin: crowd.avatar.skin,
    hair: crowd.avatar.hair,
  }
  const facings = new Container({ label: 'facings' })
  let facingLeft = false
  const drawOwner = (avatar: Avatar) => {
    for (const drawn of facings.removeChildren()) {
      drawn.destroy({ children: true })
    }
    for (const facing of [1, -1] as const) {
      const drawn = facings.addChild(
        drawEmployee({ ...ownerLook, facing }, style, trousers, {
          shirt: palette.playerBlue,
          avatar,
        }),
      )
      drawn.label = facing === 1 ? 'facesRight' : 'facesLeft'
      drawn.visible = (facing === -1) === facingLeft
    }
  }
  const face = (left: boolean) => {
    facingLeft = left
    facings.children.forEach((drawn, i) => {
      drawn.visible = (i === 1) === left
    })
  }
  const owner = walker('owner', facings, ownerLook.height)
  // The line, the same people each day, facing the truck.
  const random = seeded(city.figure.seed)
  const segments = segmentIdSchema.options
  const line = Array.from({ length: city.truck.line.max }, (_, i) => {
    const look = pickLook(
      segments[i % segments.length]!,
      'semaine',
      crowd.looks,
      random,
    )
    // Drawn to face left, then turned there.
    const customer = drawCustomer(look, style, crowd.looks, -1)
    customer.scale.x = -1
    return walker(`customer:${i}`, customer, look.height)
  })
  // Where each customer in line stands, the first nearest the hatch.
  const { first, step } = city.truck.line
  const spots = line.map((_, i): Vec => [
    first[0] + step[0] * i,
    first[1] + step[1] * i,
  ])
  // The bakers and the deliverers, one figure each, made as they are hired.
  const bakers: Walker[] = []
  const deliverers: Walker[] = []
  const hire = (row: Walker[], id: string, count: number) => {
    while (row.length < count) {
      row.push(walker(`${id}:${row.length}`, employee(), crowd.employee.height))
    }
  }
  /** Stands `count` of `row` from `first`, each a `step` on; hides the rest. */
  const stand = (
    row: readonly Walker[],
    count: number,
    first: CityPoint | null,
    step: CityPoint,
  ) =>
    row.forEach((one, i) =>
      place(
        one,
        first === null || i >= count
          ? null
          : [first[0] + step[0] * i, first[1] + step[1] * i],
      ),
    )

  const { van: vanSize } = city.deliveries
  const van = block.addChild(drawVan(vanSize, style))
  van.visible = false
  // Its box with its footprint's middle at 0, 0, for its shadow.
  const vanBox = boxCorners({
    x: -vanSize.width / 2,
    y: vanSize.width / 4 - vanSize.height,
    width: vanSize.width,
    height: vanSize.height,
    depth: vanSize.depth,
  })
  const { reach, drop } = style.light.castShadow
  const vanShadows = [
    shadows.castShape('van', castShadow(vanBox, reach, drop)),
    shadows.contactShadow('van', 0, 0, vanSize.width * 0.9, 'wheel'),
  ]
  for (const shadow of vanShadows) shadow.visible = false

  let view: CityView | null = null
  let route: readonly Vec[] = []
  let round: readonly Vec[] = []
  let label: Container | null = null
  let tripShown: string | null = null
  let named: { name: string; label: Container } | null = null
  // Where the owner walking was last drawn, to face the way they go.
  let walked: Vec | null = null

  const drawTrip = (trip: CityView['trip']) => {
    const key = trip === null ? null : `${trip.place}:${trip.label}`
    if (key === tripShown) return
    tripShown = key
    path.clear()
    label?.destroy({ children: true })
    label = null
    if (trip === null) {
      route = []
      return
    }
    route = city.routes[trip.place]
    const { dash, gap, width, color, dot } = city.path
    for (const [from, to] of dashesOf(route, dash, gap)) {
      path.moveTo(...from).lineTo(...to)
    }
    path.stroke({ width, color: palette[color], cap: 'round' })
    const door = route[route.length - 1]!
    path.circle(door[0], door[1], dot).fill(palette[color])
    label = labels.addChild(drawLabel(trip.label, city.label, style))
    label.position.set(door[0], door[1] - city.label.rise)
  }

  return {
    labels,
    show: (next, avatar) => {
      view = next
      if (avatar !== avatarShown) {
        avatarShown = avatar
        drawOwner(avatar)
        ownerBust?.destroy({ children: true })
        const art = drawAvatar(
          avatar,
          style,
          crowd.avatar,
          trousers,
          crowd.fatigue.circlesColor,
        )
        ownerBust = crew.addChild(art.root)
        ownerBust.scale.set(scale)
        ownerBust.position.set(...atHatch(0))
      }
      while (crewBusts.length < next.atTruck) {
        // The owner in the hatch's first place, each employee a step on.
        const bust = crew.addChild(employee())
        bust.label = `crew:${crewBusts.length}`
        bust.scale.set(scale)
        bust.position.set(...atHatch(crewBusts.length + 1))
        crewBusts.push(bust)
      }
      crewBusts.forEach((bust, i) => {
        bust.visible = i < next.atTruck
      })
      hire(bakers, 'baker', next.bakers)
      hire(deliverers, 'deliverer', next.deliverers)
      drawTrip(next.trip)
      const from = next.vanAt === null ? [] : city.deliveries.from[next.vanAt]
      round =
        next.van === null
          ? from
          : [
              ...from,
              ...next.van.stops.map((grocer) => city.deliveries.stops[grocer]),
              ...reversed(from),
            ]
    },
    frame: (actors, inLine) => {
      if (view === null) return
      const serving = actors.truckOpen
      if (ownerBust !== null) {
        ownerBust.visible = serving && actors.owner?.kind === 'serving'
      }
      crew.visible = serving
      const at =
        actors.owner?.kind === 'away' && route.length > 0
          ? pointAlong(route, actors.owner.share)
          : null
      place(owner, at)
      ring.visible = at !== null
      if (at !== null) {
        ring.position.set(at[0], at[1])
        // Facing the way they walk, there or back.
        if (walked !== null && at[0] !== walked[0]) face(at[0] < walked[0])
      }
      walked = at
      line.forEach((customer, i) =>
        place(customer, i < inLine ? (spots[i] ?? null) : null),
      )
      stand(bakers, view.bakers, city.bakers.first, city.bakers.step)
      const driving = actors.van !== null && round.length > 0
      const vanAt = view.vanAt
      // A deliverer drives the van on its round; the others wait for it.
      const byVan = city.deliveries.deliverers
      stand(
        deliverers,
        view.deliverers - (driving && view.van?.driver === 'employee' ? 1 : 0),
        vanAt === null ? null : byVan.first[vanAt],
        byVan.step,
      )
      const parked: Vec | null =
        vanAt === null || round.length === 0
          ? null
          : driving
            ? pointAlong(round, actors.van ?? 0)
            : round[0]!
      van.visible = parked !== null
      for (const shadow of vanShadows) shadow.visible = parked !== null
      if (parked !== null) {
        van.position.set(parked[0], parked[1])
        for (const shadow of vanShadows) {
          shadow.position.set(parked[0], parked[1])
        }
        van.zIndex = depthAmong(parked, scene.boxes, vanSize.width / 2)
      }
    },
    name: (name, at) => {
      if (name === null || at === null) {
        named?.label.destroy({ children: true })
        named = null
        return
      }
      if (named?.name !== name) {
        named?.label.destroy({ children: true })
        named = {
          name,
          label: labels.addChild(drawLabel(name, city.label, style)),
        }
        named.label.label = 'name'
      }
      named.label.position.set(at[0], at[1] - city.label.above)
    },
    destroy: () => {
      labels.destroy({ children: true })
      style.shading.destroy()
    },
  }
}
