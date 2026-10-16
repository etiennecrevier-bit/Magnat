import { useId, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { Avatar, DifficultyId } from '../content/schema.ts'
import { defiById } from '../engine/challenge.ts'
import { DEFIS } from '../engine/day.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState } from '../engine/types.ts'
import { DefiBriefingView, DefiListView } from './DefisScreen.tsx'
import { formatGameDate } from './formatGameDate.ts'
import { DIFFICULTIES, difficultyLine, readBusinessName } from './newGame.ts'
import { browserStorage, readStoredSave, type StoredSave } from './saves.ts'
import { settingsStore, type SettingsStore } from './settings.ts'
import { continueStoredGame } from './startMenu.ts'
import { newChallenge, newGame } from './store.ts'
import './StartScreen.css'

const AVATARS: Record<Avatar, string> = { femme: 'Femme', homme: 'Homme' }

interface StartMenuViewProps {
  /** What the browser holds: « Continuer » shows only for a game it loads. */
  stored: StoredSave
  onContinue: () => void
  onNewGame: () => void
  onDefis: () => void
}

/** The first screen: continue the saved game, start one or try a Défi. */
export function StartMenuView({
  stored,
  onContinue,
  onNewGame,
  onDefis,
}: StartMenuViewProps) {
  const headingId = useId()
  const savedId = useId()
  return (
    <section className="start-screen" aria-labelledby={headingId}>
      <h1 id={headingId}>Magnat</h1>
      {stored.status === 'unreadable' && (
        <p className="notice">
          La partie sauvegardée dans ce navigateur ne peut plus être chargée.
          Une nouvelle partie la remplacera.
        </p>
      )}
      {stored.status === 'unavailable' && (
        <p className="notice">
          Ce navigateur bloque la sauvegarde automatique. Exportez votre partie
          dans les Réglages pour la reprendre plus tard.
        </p>
      )}
      <div className="start-screen__actions">
        {stored.status === 'found' && (
          <>
            <button
              type="button"
              className="button button--primary"
              aria-describedby={savedId}
              onClick={onContinue}
            >
              Continuer
            </button>
            <p id={savedId} className="start-screen__saved">
              {stored.game.profile.businessName},{' '}
              {formatGameDate(stored.game.day).toLowerCase()}
            </p>
          </>
        )}
        <button
          type="button"
          className={
            stored.status === 'found' ? 'button' : 'button button--primary'
          }
          onClick={onNewGame}
        >
          Nouvelle partie
        </button>
        <button type="button" className="button" onClick={onDefis}>
          Défis
        </button>
      </div>
    </section>
  )
}

interface NewGameFormViewProps {
  difficulty: DifficultyId
  /** The business name as typed. */
  businessName: string
  avatar: Avatar
  /** Whether starting replaces the game the browser has saved. */
  replacesSave: boolean
  onDifficultyChange: (difficulty: DifficultyId) => void
  onBusinessNameChange: (text: string) => void
  onAvatarChange: (avatar: Avatar) => void
  /** Called with the cleaned-up name, only once it is a valid one. */
  onStart: (businessName: string) => void
  onBack: () => void
}

/** The new game form: difficulty, business name and avatar. */
export function NewGameFormView({
  difficulty,
  businessName,
  avatar,
  replacesSave,
  onDifficultyChange,
  onBusinessNameChange,
  onAvatarChange,
  onStart,
  onBack,
}: NewGameFormViewProps) {
  const headingId = useId()
  const nameId = useId()
  const nameErrorId = useId()
  const nameField = useRef<HTMLInputElement>(null)
  const name = readBusinessName(businessName)
  return (
    <section className="start-screen" aria-labelledby={headingId}>
      <h1 id={headingId}>Nouvelle partie</h1>
      <form
        className="new-game"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (name.name === null) nameField.current?.focus()
          else onStart(name.name)
        }}
      >
        <fieldset className="new-game__group">
          <legend>Difficulté</legend>
          <div className="difficulty-cards">
            {DIFFICULTIES.map((option) => (
              <label key={option.id} className="difficulty-card">
                <input
                  type="radio"
                  name="difficulty"
                  value={option.id}
                  checked={option.id === difficulty}
                  onChange={() => onDifficultyChange(option.id)}
                />
                <span className="difficulty-card__name">{option.name}</span>
                <span className="difficulty-card__line">
                  {difficultyLine(option)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="new-game__group">
          <label className="new-game__label" htmlFor={nameId}>
            Nom de l'entreprise
          </label>
          <input
            ref={nameField}
            id={nameId}
            className="new-game__name"
            type="text"
            autoComplete="off"
            value={businessName}
            aria-invalid={name.error !== null}
            aria-describedby={name.error === null ? undefined : nameErrorId}
            onChange={(event) => onBusinessNameChange(event.target.value)}
          />
          {name.error !== null && (
            <p id={nameErrorId} className="new-game__error">
              {name.error}
            </p>
          )}
        </div>
        <fieldset className="new-game__group">
          <legend>Avatar</legend>
          <div className="new-game__avatars">
            {(Object.keys(AVATARS) as Avatar[]).map((option) => (
              <label key={option} className="new-game__avatar">
                <input
                  type="radio"
                  name="avatar"
                  value={option}
                  checked={option === avatar}
                  onChange={() => onAvatarChange(option)}
                />
                {AVATARS[option]}
              </label>
            ))}
          </div>
        </fieldset>
        {replacesSave && (
          <p className="notice">
            La nouvelle partie remplacera celle sauvegardée dans ce navigateur.
          </p>
        )}
        <div className="start-screen__actions">
          <button type="submit" className="button button--primary">
            Commencer
          </button>
          <button type="button" className="button" onClick={onBack}>
            Retour
          </button>
        </div>
      </form>
    </section>
  )
}

/** The start screen's pages: the menu, a form, a list, a briefing. */
type Page = 'menu' | 'newGame' | 'defis' | { readonly briefing: string }

/**
 * The start screen wired to the browser's saves and the medals `settings`
 * keeps: the menu, then the new game form, or the Défis and a Défi's
 * briefing. `onStart` gets the game to play, new, continued or a Défi.
 */
export default function StartScreen({
  onStart,
  settings = settingsStore,
}: {
  onStart: (game: GameState) => void
  settings?: SettingsStore
}) {
  const [stored] = useState(() => readStoredSave(browserStorage()))
  const [defaults] = useState(defaultProfile)
  const [page, setPage] = useState<Page>('menu')
  const [difficulty, setDifficulty] = useState(defaults.difficulty)
  const [businessName, setBusinessName] = useState(defaults.businessName)
  const [avatar, setAvatar] = useState(defaults.avatar)
  const bestMedals = useStore(settings, (state) => state.bestMedals)

  if (page === 'newGame') {
    return (
      <main>
        <NewGameFormView
          difficulty={difficulty}
          businessName={businessName}
          avatar={avatar}
          replacesSave={stored.status === 'found'}
          onDifficultyChange={setDifficulty}
          onBusinessNameChange={setBusinessName}
          onAvatarChange={setAvatar}
          onStart={(name) =>
            onStart(
              newGame(window.location.search, {
                businessName: name,
                avatar,
                difficulty,
              }),
            )
          }
          onBack={() => setPage('menu')}
        />
      </main>
    )
  }

  if (page === 'defis') {
    return (
      <main>
        <DefiListView
          defis={DEFIS.defis}
          bestMedals={bestMedals}
          onOpen={(id) => setPage({ briefing: id })}
          onBack={() => setPage('menu')}
        />
      </main>
    )
  }

  if (typeof page === 'object') {
    const defi = defiById(DEFIS, page.briefing)
    return (
      <main>
        <DefiBriefingView
          defi={defi}
          bestMedal={bestMedals[defi.id]}
          onStart={() => onStart(newChallenge(window.location.search, defi.id))}
          onBack={() => setPage('defis')}
        />
      </main>
    )
  }

  return (
    <main>
      <StartMenuView
        stored={stored}
        onContinue={() =>
          continueStoredGame(() => readStoredSave(browserStorage()), onStart)
        }
        onNewGame={() => setPage('newGame')}
        onDefis={() => setPage('defis')}
      />
    </main>
  )
}
