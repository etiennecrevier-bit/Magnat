// What the decision controls of « Le camion » are described by.

/** What a Défi's lock does to a control: disabled, and why. */
export interface Lock {
  readonly disabled: boolean
  readonly describedBy: string | undefined
}

/** The ids, space-separated, of what describes a control; none if empty. */
export function describedBy(
  ...ids: readonly (string | undefined)[]
): string | undefined {
  const given = ids.filter((id) => id !== undefined && id !== '')
  return given.length === 0 ? undefined : given.join(' ')
}
