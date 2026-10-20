import { Container, Graphics, type Sprite } from 'pixi.js'
import type { CityManifest, CityPoint } from '../content/assets.ts'
import type { Avatar } from '../content/schema.ts'
import {
  drawFigure,
  drawLabel,
  drawVan,
  type FigureLook,
} from './cityPlaceholders.ts'
import type { CityScene } from './cityScene.ts'
import type { CityActors, CityView } from './cityView.ts'
import { depthAmong, type Vec } from './iso.ts'
import { dashesOf, pointAlong, reversed } from './route.ts'

// The people of the city and the van, moved each frame (see `actorsAt`):
// the owner and the employees serving in the truck's hatch, the owner
// walking to the day's place along its dashed way, the line, the baker at
// the bakery's door, the deliverer by the van, and the van on its round.
// Each one walking is drawn among the boxes by where they stand (see
// `depthAmong`), so a building in front hides them.

/** The city's people, made once and shown from the view and the minute. */
export interface CityPeople {
  /** « En route vers… », to add over the atmosphere. */
  readonly labels: Container
  /** Shows the day: who works, the trip's way and words, the van. */
  show: (view: CityView, avatar: Avatar) => void
  /** Puts everyone where they are, with `inLine` customers in line. */
  frame: (actors: CityActors, inLine: number) => void
  /** Takes them down. */
  destroy: () => void
}

/** Puts the people of `city` in `scene`. */
export function createCityPeople(
  scene: CityScene,
  city: CityManifest,
): CityPeople {
  const { style, block, truck, shadows } = scene
  const { figure } = city
  const { palette } = style
  const half = figure.width / 2
  const labels = new Container({ label: 'labels' })
  const path = scene.ground.addChild(new Graphics({ label: 'tripPath' }))

  /** Someone standing on the ground, with their contact shadow. */
  interface Walker {
    readonly root: Container
    readonly shadow: Sprite
  }
  const walker = (id: string, look: FigureLook): Walker => {
    const root = block.addChild(drawFigure(look, style, figure))
    root.label = id
    root.visible = false
    const shadow = shadows.contactShadow(id, 0, 0, figure.width * 1.4, 'person')
    shadow.visible = false
    return { root, shadow }
  }
  const place = ({ root, shadow }: Walker, at: Vec | null, width = half) => {
    root.visible = at !== null
    shadow.visible = at !== null
    if (at === null) return
    root.position.set(at[0], at[1])
    shadow.position.set(at[0], at[1])
    root.zIndex = depthAmong(at, scene.boxes, width)
  }
  const look = (coat: string, index: number): FigureLook => ({
    coat,
    skin: figure.skins[index % figure.skins.length]!,
    hair: figure.hair,
  })
  const staff = (index: number) => look(palette[figure.staffShirt], index)
  const ownerLook = (avatar: Avatar): FigureLook => ({
    ...look(palette[figure.shirt], 0),
    apron: palette[figure.apron],
    avatar,
  })

  // Who serves stands in the hatch, drawn with the truck.
  const inTruck = (point: CityPoint): Vec => [
    point[0] - truck.x,
    point[1] - truck.y,
  ]
  const crew = new Container({ label: 'crew' })
  truck.addChild(crew)
  let ownerBust: Container | null = null
  const crewBusts: Container[] = []
  let avatarShown: Avatar | null = null

  const owner = walker('owner', ownerLook('homme'))
  const line = Array.from({ length: city.truck.line.max }, (_, i) =>
    walker(
      `customer:${i}`,
      look(palette[figure.coats[i % figure.coats.length]!], i + 1),
    ),
  )
  // Where each customer in line stands, the first nearest the hatch.
  const { first, step } = city.truck.line
  const spots = line.map((_, i): Vec => [
    first[0] + step[0] * i,
    first[1] + step[1] * i,
  ])
  const baker = walker('baker', staff(2))
  const deliverer = walker('deliverer', staff(3))
  const van = block.addChild(drawVan(city.deliveries.van, style))
  van.visible = false
  const vanShadow = shadows.contactShadow(
    'van',
    0,
    0,
    city.deliveries.van.width * 0.9,
    'wheel',
  )
  vanShadow.visible = false

  let view: CityView | null = null
  let route: readonly Vec[] = []
  let round: readonly Vec[] = []
  let label: Container | null = null
  let tripShown: string | null = null

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
    const { dash, gap, width, color } = city.path
    for (const [from, to] of dashesOf(route, dash, gap)) {
      path.moveTo(...from).lineTo(...to)
    }
    path.stroke({ width, color: palette[color], cap: 'round' })
    const door = route[route.length - 1]!
    label = labels.addChild(drawLabel(trip.label, city.label, style))
    label.position.set(door[0], door[1] - city.label.rise)
  }

  return {
    labels,
    show: (next, avatar) => {
      view = next
      if (avatar !== avatarShown) {
        avatarShown = avatar
        ownerBust?.destroy({ children: true })
        ownerBust = crew.addChild(
          drawFigure(ownerLook(avatar), style, figure, true),
        )
        ownerBust.position.set(...inTruck(city.truck.window.first))
        owner.root
          .removeChildren()
          .forEach((child) => child.destroy({ children: true }))
        owner.root.addChild(drawFigure(ownerLook(avatar), style, figure))
      }
      while (crewBusts.length < next.atTruck) {
        const bust = crew.addChild(
          drawFigure(staff(crewBusts.length), style, figure, true),
        )
        // The owner in the hatch's first place, each employee a step on.
        const hatch = city.truck.window
        const n = crewBusts.length + 1
        bust.position.set(
          ...inTruck([
            hatch.first[0] + hatch.step[0] * n,
            hatch.first[1] + hatch.step[1] * n,
          ]),
        )
        crewBusts.push(bust)
      }
      crewBusts.forEach((bust, i) => {
        bust.visible = i < next.atTruck
      })
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
      place(
        owner,
        actors.owner?.kind === 'away' && route.length > 0
          ? pointAlong(route, actors.owner.share)
          : null,
      )
      line.forEach((customer, i) =>
        place(customer, i < inLine ? (spots[i] ?? null) : null),
      )
      place(baker, view.baker ? city.baker : null)
      const driving = actors.van !== null && round.length > 0
      const vanAt = view.vanAt
      place(
        deliverer,
        view.deliverer &&
          vanAt !== null &&
          !(driving && view.van?.driver === 'employee')
          ? city.deliveries.standAt[vanAt]
          : null,
      )
      const at: Vec | null =
        vanAt === null || round.length === 0
          ? null
          : driving
            ? pointAlong(round, actors.van ?? 0)
            : round[0]!
      van.visible = at !== null
      vanShadow.visible = at !== null
      if (at !== null) {
        van.position.set(at[0], at[1])
        vanShadow.position.set(at[0], at[1])
        van.zIndex = depthAmong(at, scene.boxes, city.deliveries.van.width / 2)
      }
    },
    destroy: () => {
      labels.destroy({ children: true })
    },
  }
}
