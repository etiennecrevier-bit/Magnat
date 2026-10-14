import { useId, useRef, useState } from 'react'
import type { Avatar, DifficultyId } from '../content/schema.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState } from '../engine/types.ts'
import { formatGameDate } from './formatGameDate.ts'
import { DIFFICULTIES, difficultyLine, readBusinessName } from './newGame.ts'
import {
  browserStorage,
  importSaveFile,
  readStoredSave,
  type StoredSave,
} from './saves.ts'
import { newGame } from './store.ts'
import './StartScreen.css'

const AVATARS: Record<Avatar, string> = { femme: 'Femme', homme: 'Homme' }

interface StartMenuViewProps {
  /** What the browser holds: « Continuer » shows only for a game it loads. */
  stored: StoredSave
  /** Why the last imported file was rejected, if it was. */
  importError: string | null
  onContinue: () => void
  onNewGame: () => void
  onImport: (file: File) => void
}

/** The first screen: continue the saved game, start one, or import one. */
export function StartMenuView({
  stored,
  importError,
  onContinue,
  onNewGame,
  onImport,
}: StartMenuViewProps) {
  const headingId = useId()
  const savedId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
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
          pour la reprendre plus tard.
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
        <button
          type="button"
          className="button"
          onClick={() => fileInput.current?.click()}
        >
          Importer une sauvegarde
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            // So that picking the same file again still reports it.
            event.target.value = ''
            if (file !== undefined) onImport(file)
          }}
        />
      </div>
      {importError !== null && (
        <p className="start-screen__error" role="alert">
          {importError}
        </p>
      )}
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

/**
 * The start screen wired to the browser's saves: the menu, then the new
 * game form. `onStart` gets the game to play, new, continued or imported.
 */
export default function StartScreen({
  onStart,
}: {
  onStart: (game: GameState) => void
}) {
  const [stored] = useState(() => readStoredSave(browserStorage()))
  const [defaults] = useState(defaultProfile)
  const [page, setPage] = useState<'menu' | 'newGame'>('menu')
  const [importError, setImportError] = useState<string | null>(null)
  const [difficulty, setDifficulty] = useState(defaults.difficulty)
  const [businessName, setBusinessName] = useState(defaults.businessName)
  const [avatar, setAvatar] = useState(defaults.avatar)

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

  return (
    <main>
      <StartMenuView
        stored={stored}
        importError={importError}
        onContinue={() => {
          if (stored.status === 'found') onStart(stored.game)
        }}
        onNewGame={() => {
          setImportError(null)
          setPage('newGame')
        }}
        onImport={(file) => {
          setImportError(null)
          void importSaveFile(file).then((result) => {
            if ('game' in result) onStart(result.game)
            else setImportError(result.error)
          })
        }}
      />
    </main>
  )
}
