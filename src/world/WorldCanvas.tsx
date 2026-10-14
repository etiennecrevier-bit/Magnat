import { useEffect, useRef } from 'react'
import { mountWorld, worldOptions } from './mountWorld.ts'
import { startStreet } from './street.ts'
import './WorldCanvas.css'

/** The street, drawn behind the panels. Screen readers skip it. */
export default function WorldCanvas() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current === null) return
    return mountWorld(ref.current, worldOptions(window), (app) =>
      startStreet(app),
    )
  }, [])

  return <div className="world" aria-hidden="true" ref={ref} />
}
