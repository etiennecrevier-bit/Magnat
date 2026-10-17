import { useEffect, useRef, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import type { DecisionChange } from '../engine/decisions.ts'

/** What a panel with decision fields wires its dialog with. */
export interface FieldDialog {
  readonly dialogRef: RefObject<HTMLDialogElement | null>
  /** Hands a change to `decide`, unless Escape is closing the dialog. */
  readonly onChange: (change: DecisionChange) => void
  /** Fermer: commits the field being typed in, then closes if all is valid. */
  readonly close: () => void
  /** For the dialog's `onCancel`: Escape drops what is still being typed. */
  readonly onCancel: () => void
}

/**
 * A modal dialog for a panel whose fields change decisions, as « Gérer le
 * camion » and « Qui fait quoi » are: the page behind it is out of reach
 * and Escape closes it. Fermer keeps what was typed, after any invalid text
 * is fixed; Escape drops what is still being typed. The changes already
 * made stay either way.
 */
export function useFieldDialog(
  decide: (change: DecisionChange) => void,
): FieldDialog {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Set as Escape starts closing the dialog. The browser then moves the
  // focus back to the opener, and the field losing it would commit its
  // draft before React re-renders, so this is a ref, read at once.
  const cancelled = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    // StrictMode runs this twice; the second time, the dialog is open.
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [])

  const onChange = (change: DecisionChange) => {
    if (!cancelled.current) decide(change)
  }

  const close = () => {
    const dialog = dialogRef.current
    if (dialog === null) return
    // The field being typed in commits as it loses the focus, and shows its
    // message now if its text is invalid. Any such field keeps the panel
    // open and gets the focus back.
    const active = document.activeElement
    if (active instanceof HTMLElement && dialog.contains(active)) {
      flushSync(() => active.blur())
    }
    const invalid = dialog.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (invalid !== null) {
      invalid.focus()
      return
    }
    dialog.close()
  }

  const onCancel = () => {
    cancelled.current = true
  }

  return { dialogRef, onChange, close, onCancel }
}
