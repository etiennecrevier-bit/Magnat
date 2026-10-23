import { Container, Sprite } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import { bakeRenderer, createBackdrop, type BakeRenderer } from './backdrop.ts'

/** A stage as the street builds it: its layers, then the atmosphere. */
function setUp(resolution = 2) {
  const stage = new Container()
  const street = stage.addChild(new Container({ label: 'street' }))
  const layers = ['sky', 'buildings', 'street'].map((id) =>
    street.addChild(new Container({ label: `layer:${id}` })),
  )
  const shadows = street.addChild(new Container({ label: 'layer:shadows' }))
  const truck = street.addChild(new Container({ label: 'layer:truck' }))
  const atmosphere = stage.addChild(new Container({ label: 'atmosphere' }))
  const labels = stage.addChild(new Container({ label: 'labels' }))
  // What each render drew: the renderable children, by label.
  const drawn: string[][] = []
  const renderer: BakeRenderer = {
    resolution,
    render: vi.fn(({ container }) => {
      const shown = (node: Container): string[] =>
        node.children.flatMap((child) =>
          child.renderable ? [child.label, ...shown(child)] : [],
        )
      drawn.push(shown(container))
    }),
  }
  const backdrop = createBackdrop(
    stage,
    { street, layers, others: [atmosphere, labels] },
    renderer,
    '#CFE8F3',
  )
  return {
    stage,
    street,
    layers,
    shadows,
    truck,
    atmosphere,
    labels,
    renderer,
    drawn,
    backdrop,
  }
}

describe('createBackdrop', () => {
  it('draws the layers under the shadows alone into its texture, shown first', () => {
    const { stage, drawn, backdrop } = setUp()
    backdrop.update(1440, 900)
    expect(drawn).toEqual([
      ['street', 'layer:sky', 'layer:buildings', 'layer:street'],
    ])
    const sprite = stage.children[0] as Sprite
    expect(sprite.label).toBe('backdrop')
    expect(sprite.renderable).toBe(true)
    expect(sprite.texture.width).toBe(1440)
    expect(sprite.texture.source.resolution).toBe(2)
  })

  it('leaves the baked layers out of each frame, and draws everything else', () => {
    const { layers, shadows, truck, atmosphere, labels, backdrop } = setUp()
    backdrop.update(1440, 900)
    expect(layers.map((layer) => layer.renderable)).toEqual([
      false,
      false,
      false,
    ])
    expect(
      [shadows, truck, atmosphere, labels].every((n) => n.renderable),
    ).toBe(true)
  })

  it('draws again only when asked, or when the screen changes', () => {
    const { renderer, backdrop, stage } = setUp()
    backdrop.update(1440, 900)
    backdrop.update(1440, 900)
    expect(renderer.render).toHaveBeenCalledTimes(1)
    backdrop.invalidate()
    backdrop.update(1440, 900)
    expect(renderer.render).toHaveBeenCalledTimes(2)
    backdrop.update(900, 600)
    expect(renderer.render).toHaveBeenCalledTimes(3)
    expect((stage.children[0] as Sprite).texture.width).toBe(900)
  })

  it('shows the layers live again once taken down', () => {
    const { layers, stage, backdrop } = setUp()
    backdrop.update(1440, 900)
    backdrop.destroy()
    expect(layers.every((layer) => layer.renderable)).toBe(true)
    expect(stage.getChildByLabel('backdrop')).toBeNull()
  })
})

describe('bakeRenderer', () => {
  it('takes WebGL and WebGPU renderers that render, and no other', () => {
    const render = () => {}
    expect(
      bakeRenderer({ type: 1, resolution: 2, render } as never),
    ).not.toBeNull()
    expect(
      bakeRenderer({ type: 2, resolution: 1, render } as never),
    ).not.toBeNull()
    expect(bakeRenderer({ type: 4, resolution: 1, render } as never)).toBeNull()
    expect(bakeRenderer({ type: 1 })).toBeNull()
    expect(bakeRenderer(undefined)).toBeNull()
  })
})
