import './PrudhommeAdvice.css'

// French quotation marks hold their text with no-break spaces (U+00A0).
const OPEN_QUOTE = '« '
const CLOSE_QUOTE = ' »'

/**
 * « Le conseil de Mme Prudhomme »: the banker's line on a report, with her
 * portrait when it has one. The weekly report shows it under its facts.
 */
export function PrudhommeAdvice({
  advice,
  portrait,
}: {
  advice: string
  /** The URL of her portrait; null shows none. */
  portrait: string | null
}) {
  return (
    <section
      className="prudhomme-advice"
      aria-label="Le conseil de Mme Prudhomme"
    >
      {/* Low in a report, under its chart: it loads once scrolled to. */}
      {portrait !== null && (
        <img
          className="prudhomme-advice__portrait"
          src={portrait}
          alt=""
          width={64}
          height={64}
          loading="lazy"
        />
      )}
      <div>
        <p className="prudhomme-advice__title">Le conseil de Mme Prudhomme</p>
        <p className="prudhomme-advice__text">
          {`${OPEN_QUOTE}${advice}${CLOSE_QUOTE}`}
        </p>
      </div>
    </section>
  )
}
