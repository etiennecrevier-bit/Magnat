// What the tutorial's watcher hears from the interface besides the store
// (#238): a tooltip opening on an anchor, and a speed button pressed, even
// on the speed already picked, as the pause when the game is held paused.
// Tooltips also register how to open them, so the bubble can open one a
// tap on its anchor would not, as on a phone.

/** A gesture of the interface the store does not see. */
export type TutorialSignal =
  /** The tooltip of the element whose `data-tuto` is `anchor` opened. */
  | { readonly kind: 'tooltip'; readonly anchor: string }
  /** The speed button of `speed` was pressed. */
  | { readonly kind: 'speed'; readonly speed: number }

export interface TutorialSignals {
  emit: (signal: TutorialSignal) => void
  /** Calls `listener` with each signal; returns the function that stops. */
  listen: (listener: (signal: TutorialSignal) => void) => () => void
  /**
   * Keeps `open` as what opens the tooltip of `anchor`, until the function
   * it returns is called.
   */
  registerTip: (anchor: string, open: () => void) => () => void
  /** Opens the tooltip of `anchor`; false when none is registered. */
  openTip: (anchor: string) => boolean
}

export function createTutorialSignals(): TutorialSignals {
  const listeners = new Set<(signal: TutorialSignal) => void>()
  const tips = new Map<string, () => void>()
  return {
    emit: (signal) => {
      for (const listener of [...listeners]) listener(signal)
    },
    listen: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    registerTip: (anchor, open) => {
      tips.set(anchor, open)
      return () => {
        if (tips.get(anchor) === open) tips.delete(anchor)
      }
    },
    openTip: (anchor) => {
      const open = tips.get(anchor)
      if (open === undefined) return false
      open()
      return true
    },
  }
}

/** The signals of the app. */
export const tutorialSignals: TutorialSignals = createTutorialSignals()
