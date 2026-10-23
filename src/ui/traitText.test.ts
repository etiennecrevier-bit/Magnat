import { describe, expect, it } from 'vitest'
import {
  staffRoleIdSchema,
  traitIdSchema,
  type StaffContent,
} from '../content/schema.ts'
import { STAFF } from '../engine/staff.ts'
import { discoveryText, traitTip } from './traitText.ts'

const ROLES = staffRoleIdSchema.options
const TRAITS = traitIdSchema.options
const LEVELS = ['strong', 'weak'] as const

describe('traitTip', () => {
  it('says what each trait does, strong or weak, in each role', () => {
    expect(traitTip('rapidite', 'strong', 'camion')).toBe(
      'Sert les clients plus vite',
    )
    expect(traitTip('minutie', 'weak', 'boulanger')).toBe(
      'Gaspille plus de croissants',
    )
    expect(traitTip('rapidite', 'strong', 'livreur')).toBe(
      'Sans effet en livraison',
    )
    for (const trait of TRAITS) {
      for (const role of ROLES) {
        for (const level of LEVELS) {
          expect(traitTip(trait, level, role), `${trait} ${role}`).not.toBe('')
        }
      }
    }
  })

  it('says « Sans effet » exactly where the content says the trait does not act', () => {
    for (const trait of TRAITS) {
      for (const role of ROLES) {
        const acts = STAFF.traits[trait].roles.includes(role)
        for (const level of LEVELS) {
          expect(
            traitTip(trait, level, role).startsWith('Sans effet'),
            `${trait} ${role}`,
          ).toBe(!acts)
        }
      }
    }
    const content: StaffContent = {
      ...STAFF,
      traits: {
        ...STAFF.traits,
        minutie: { ...STAFF.traits.minutie, roles: ['camion'] },
      },
    }
    expect(traitTip('minutie', 'strong', 'boulanger', content)).toBe(
      'Sans effet au fournil',
    )
  })

  it('gives a strength and a weakness different words', () => {
    for (const trait of TRAITS) {
      for (const role of STAFF.traits[trait].roles) {
        expect(traitTip(trait, 'strong', role)).not.toBe(
          traitTip(trait, 'weak', role),
        )
      }
    }
  })

  it('never says a number, a percentage or a multiplier', () => {
    for (const trait of TRAITS) {
      for (const role of ROLES) {
        for (const level of LEVELS) {
          expect(traitTip(trait, level, role)).not.toMatch(/[\d%×]/)
        }
      }
    }
  })
})

describe('discoveryText', () => {
  it('says when a weakness shows, in weeks when whole', () => {
    expect(discoveryText()).toBe('Se révèle après 2\u00a0semaines de travail')
    expect(discoveryText({ ...STAFF, discoveryDays: 7 })).toBe(
      'Se révèle après 1\u00a0semaine de travail',
    )
    expect(discoveryText({ ...STAFF, discoveryDays: 10 })).toBe(
      'Se révèle après 10\u00a0jours de travail',
    )
  })
})
