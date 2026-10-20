/** Adds the step that undoes what a scene just set up. */
export type Undo = (step: () => void) => void

/**
 * Sets a scene up with `setUp`, which hands `undo` the step undoing each
 * thing as it sets it up. Returns the function that takes the scene down:
 * it runs those steps, the last added first, and does nothing the second
 * time. When `setUp` throws halfway, as on an app no longer there, it runs
 * the steps added so far, freeing what the scene made, then throws on.
 */
export function setUpOrUndo(setUp: (undo: Undo) => void): () => void {
  const steps: (() => void)[] = []
  let down = false
  const takeDown = () => {
    if (down) return
    down = true
    for (const step of steps.reverse()) step()
  }
  try {
    setUp((step) => {
      steps.push(step)
    })
  } catch (error) {
    takeDown()
    throw error
  }
  return takeDown
}
