import { useState, type ReactNode } from 'react'
import type { DecisionChange } from '../engine/decisions.ts'
import type { FieldResult } from './decisionInput.ts'

interface NumberFieldViewProps {
  id: string
  label: string
  /** The text in the field. */
  text: string
  /** What the field counts in, shown after it, e.g. `$ par semaine`. */
  unit: string
  inputMode: 'decimal' | 'numeric'
  /** What is wrong with the text, in French; null when nothing is. */
  error: string | null
  onTextChange: (text: string) => void
  /** Enter, or leaving the field: the text is done. */
  onCommit: () => void
  /** Controls on either side of the field, such as steppers. */
  before?: ReactNode
  after?: ReactNode
}

/** A labelled text field for an amount or a number of units. */
export function NumberFieldView({
  id,
  label,
  text,
  unit,
  inputMode,
  error,
  onTextChange,
  onCommit,
  before,
  after,
}: NumberFieldViewProps) {
  const unitId = `${id}-unit`
  const errorId = `${id}-error`
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__control">
        {before}
        <input
          id={id}
          className="field__input"
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={text}
          aria-invalid={error !== null}
          aria-describedby={error === null ? unitId : `${unitId} ${errorId}`}
          onChange={(event) => onTextChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCommit()
          }}
        />
        <span id={unitId} className="field__unit">
          {unit}
        </span>
        {after}
      </div>
      {error !== null && (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

interface NumberFieldProps extends Omit<
  NumberFieldViewProps,
  'text' | 'error' | 'onTextChange' | 'onCommit'
> {
  /** The decision as the field shows it when nothing is being typed. */
  value: string
  /** Reads the typed text: a change, the same value, or what is wrong. */
  read: (text: string) => FieldResult
  onChange: (change: DecisionChange) => void
}

/**
 * A field the player types a decision in. The text stays a draft until
 * Enter or leaving the field: then a valid change goes to `onChange`, and
 * invalid text stays, with its message, without reaching `onChange`. When
 * `value` changes, say from a stepper, the draft and its message go.
 */
export function NumberField({
  value,
  read,
  onChange,
  ...view
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shownValue, setShownValue] = useState(value)
  if (value !== shownValue) {
    setShownValue(value)
    setDraft(null)
    setError(null)
  }

  const commit = () => {
    if (draft === null) return
    const result = read(draft)
    if (result.kind === 'invalid') {
      setError(result.message)
      return
    }
    if (result.kind === 'change') onChange(result.change)
    setDraft(null)
    setError(null)
  }

  return (
    <NumberFieldView
      {...view}
      text={draft ?? value}
      error={error}
      onTextChange={setDraft}
      onCommit={commit}
    />
  )
}
