/** Runs `run` once the current event is over, as `setTimeout(run, 0)` does. */
export type Schedule = (run: () => void) => void

const AFTER_THE_EVENT: Schedule = (run) => {
  window.setTimeout(run, 0)
}

/**
 * Opens a link of the world, a building of the city or a spot of the
 * street, once the press that clicked it is over: the press moves the focus
 * after its listeners run, so a panel opened in one would lose the focus it
 * gives « Fermer ». It opens with the opener there by then, so nothing opens
 * once play has stopped. Null while nothing opens links.
 */
export function openLater<L>(
  opener: { readonly current: ((link: L) => void) | null },
  schedule: Schedule = AFTER_THE_EVENT,
): ((link: L) => void) | null {
  if (opener.current === null) return null
  return (link) => {
    schedule(() => opener.current?.(link))
  }
}
