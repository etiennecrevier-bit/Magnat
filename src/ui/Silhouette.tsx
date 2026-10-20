/**
 * A cream silhouette, for someone with no portrait yet: a character of the
 * event cards, the owner or an employee.
 */
export function Silhouette({
  className,
  size,
}: {
  readonly className: string
  readonly size: number
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 96 96"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="48" cy="38" r="17" />
      <path d="M14 96c0-21 15-35 34-35s34 14 34 35z" />
    </svg>
  )
}
