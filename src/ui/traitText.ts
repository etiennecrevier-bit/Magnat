import type { StaffContent, StaffRoleId, TraitId } from '../content/schema.ts'
import { STAFF } from '../engine/staff.ts'

// What an employee's strength or weakness does, as « Équipe » says it
// (#256): in plain words, at the role they work in, never a number.

/** A level of a trait the player sees: a strength or a weakness. */
export type ShownLevel = 'strong' | 'weak'

/** Where each role works, as « Sans effet … » says it. */
export const ROLE_WHERE: Readonly<Record<StaffRoleId, string>> = {
  camion: 'au camion',
  livreur: 'en livraison',
  boulanger: 'au fournil',
}

/**
 * What each trait does, strong or weak, in each role it acts in. A role
 * the content's `roles` leaves out has none: there it is « Sans effet ».
 */
export const TRAIT_EFFECT: Readonly<
  Record<
    TraitId,
    Partial<Record<StaffRoleId, Readonly<Record<ShownLevel, string>>>>
  >
> = {
  rapidite: {
    camion: {
      strong: 'Sert les clients plus vite',
      weak: 'Sert les clients moins vite',
    },
  },
  minutie: {
    camion: {
      strong: 'Rate peu de commandes',
      weak: 'Rate plus de commandes',
    },
    boulanger: {
      strong: 'Gaspille peu de croissants',
      weak: 'Gaspille plus de croissants',
    },
  },
  fiabilite: {
    camion: {
      strong: 'Ne manque jamais une journée',
      weak: 'Manque parfois une journée',
    },
    livreur: {
      strong: 'Ne manque jamais une journée',
      weak: 'Manque parfois une journée',
    },
    boulanger: {
      strong: 'Ne manque jamais une journée',
      weak: 'Manque parfois une journée',
    },
  },
  accueil: {
    camion: {
      strong: "Attire plus d'habitués",
      weak: "Attire moins d'habitués",
    },
  },
}

/**
 * What `trait`, at `level`, does for someone working in `role`: its
 * effect, or « Sans effet en livraison » where the content's `roles` says
 * it does not act. Throws a RangeError for a role it acts in with no text,
 * which the tests rule out.
 */
export function traitTip(
  trait: TraitId,
  level: ShownLevel,
  role: StaffRoleId,
  content: StaffContent = STAFF,
): string {
  if (!content.traits[trait].roles.includes(role)) {
    return `Sans effet ${ROLE_WHERE[role]}`
  }
  const text = TRAIT_EFFECT[trait][role]?.[level]
  if (text === undefined) {
    throw new RangeError(`No text for ${trait} ${level} in ${role}`)
  }
  return text
}

// A calendar fact, not a tunable.
const DAYS_PER_WEEK = 7

// A no-break space (U+00A0) goes between a number and its unit.
const NBSP = '\u00a0'

/**
 * When a weakness shows, as an unknown one's tooltip says it: « Se révèle
 * après 2 semaines de travail », in days when they are not whole weeks.
 */
export function discoveryText(content: StaffContent = STAFF): string {
  const days = content.discoveryDays
  const weeks = days / DAYS_PER_WEEK
  const span = Number.isInteger(weeks)
    ? `${weeks}${NBSP}semaine${weeks > 1 ? 's' : ''}`
    : `${days}${NBSP}jour${days > 1 ? 's' : ''}`
  return `Se révèle après ${span} de travail`
}
