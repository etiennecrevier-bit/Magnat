import { describe, expect, it } from 'vitest'
import {
  ACCOUNTS,
  getAccount,
  isAccountCode,
  type AccountType,
} from './accounts.ts'

// The chart as the card lists it, kept apart from accounts.ts so the test
// checks it against an independent spec.
const CHART: { code: string; name: string; type: AccountType }[] = [
  { code: '1000', name: 'Encaisse', type: 'actif' },
  { code: '1100', name: 'Comptes clients', type: 'actif' },
  { code: '1200', name: 'Stocks', type: 'actif' },
  { code: '1500', name: 'Équipement', type: 'actif' },
  { code: '1510', name: 'Amortissement cumulé', type: 'actif' },
  { code: '2000', name: 'Comptes fournisseurs', type: 'passif' },
  { code: '2500', name: 'Emprunts bancaires', type: 'passif' },
  { code: '3000', name: 'Capital-actions', type: 'capitaux propres' },
  { code: '3100', name: 'Bénéfices non répartis', type: 'capitaux propres' },
  { code: '4000', name: 'Ventes', type: 'produit' },
  { code: '5000', name: 'Coût des marchandises vendues', type: 'charge' },
  { code: '5100', name: 'Pertes sur stocks', type: 'charge' },
  { code: '5200', name: 'Emballages', type: 'charge' },
  { code: '6000', name: 'Salaires', type: 'charge' },
  { code: '6100', name: 'Loyer et permis', type: 'charge' },
  { code: '6120', name: 'Location du camion', type: 'charge' },
  { code: '6150', name: 'Assurances', type: 'charge' },
  { code: '6200', name: 'Carburant et entretien', type: 'charge' },
  { code: '6300', name: 'Marketing', type: 'charge' },
  { code: '6400', name: 'Amortissement', type: 'charge' },
  { code: '6500', name: 'Frais bancaires et de cartes', type: 'charge' },
  { code: '6900', name: 'Autres charges', type: 'charge' },
  { code: '6950', name: 'Créances irrécouvrables', type: 'charge' },
  { code: '7000', name: 'Intérêts', type: 'charge' },
]

describe('ACCOUNTS', () => {
  it('lists the chart in code order', () => {
    expect(
      ACCOUNTS.map(({ code, name, type }) => ({ code, name, type })),
    ).toEqual(CHART)
  })

  it('has unique, ascending codes', () => {
    const codes = ACCOUNTS.map(({ code }) => Number(code))
    expect(codes).toEqual([...new Set(codes)].sort((a, b) => a - b))
  })

  it.each(ACCOUNTS.filter(({ code }) => code !== '1510'))(
    '$code $name has the normal balance of its type',
    ({ type, normalBalance }) => {
      const debitTypes: AccountType[] = ['actif', 'charge']
      expect(normalBalance).toBe(debitTypes.includes(type) ? 'debit' : 'credit')
    },
  )

  it('makes Amortissement cumulé a contra-asset with a credit balance', () => {
    expect(getAccount('1510')).toMatchObject({
      type: 'actif',
      normalBalance: 'credit',
    })
  })

  it('is frozen, down to each account', () => {
    expect(Object.isFrozen(ACCOUNTS)).toBe(true)
    for (const account of ACCOUNTS) expect(Object.isFrozen(account)).toBe(true)
    expect(() => {
      ;(getAccount('1000') as { normalBalance: string }).normalBalance =
        'credit'
    }).toThrow(TypeError)
    expect(getAccount('1000').normalBalance).toBe('debit')
  })
})

describe('isAccountCode', () => {
  it.each(CHART)('accepts $code', ({ code }) => {
    expect(isAccountCode(code)).toBe(true)
  })

  it.each(['9999', '', '1000 ', '01000', 'Encaisse'])('rejects %j', (code) => {
    expect(isAccountCode(code)).toBe(false)
  })
})

describe('getAccount', () => {
  it('returns the shared record for a code', () => {
    expect(getAccount('4000')).toBe(
      ACCOUNTS.find(({ code }) => code === '4000'),
    )
  })

  it('throws for a code outside the chart', () => {
    // @ts-expect-error: only chart codes type-check
    expect(() => getAccount('9999')).toThrow(RangeError)
  })
})
