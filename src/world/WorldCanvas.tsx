import { useEffect, useRef } from 'react'
import { mountWorld, worldOptions } from './mountWorld.ts'
import './WorldCanvas.css'

/** The world, drawn behind the panels. Screen readers skip it. */
export default function WorldCanvas() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current === null) return
    return mountWorld(ref.current, worldOptions(window))
  }, [])

  return <div className="world" aria-hidden="true" ref={ref} />
}
