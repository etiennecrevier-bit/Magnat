// The chart of accounts. Codes, names, types and normal balances are the
// structure of the books that the statements are built on, not tunables, so
// they stay here rather than in src/content/.

export type AccountType =
  'actif' | 'passif' | 'capitaux propres' | 'produit' | 'charge'

/** The side an account's balance normally sits on. */
export type NormalBalance = 'debit' | 'credit'

const CHART = [
  { code: '1000', name: 'Encaisse', type: 'actif', normalBalance: 'debit' },
  {
    code: '1100',
    name: 'Comptes clients',
    type: 'actif',
    normalBalance: 'debit',
  },
  { code: '1200', name: 'Stocks', type: 'actif', normalBalance: 'debit' },
  { code: '1500', name: 'Équipement', type: 'actif', normalBalance: 'debit' },
  // A contra-asset: it sits with the assets and reduces them, so its balance
  // is a credit.
  {
    code: '1510',
    name: 'Amortissement cumulé',
    type: 'actif',
    normalBalance: 'credit',
  },
  {
    code: '2000',
    name: 'Comptes fournisseurs',
    type: 'passif',
    normalBalance: 'credit',
  },
  {
    code: '2500',
    name: 'Emprunts bancaires',
    type: 'passif',
    normalBalance: 'credit',
  },
  {
    code: '3000',
    name: 'Capital-actions',
    type: 'capitaux propres',
    normalBalance: 'credit',
  },
  {
    code: '3100',
    name: 'Bénéfices non répartis',
    type: 'capitaux propres',
    normalBalance: 'credit',
  },
  { code: '4000', name: 'Ventes', type: 'produit', normalBalance: 'credit' },
  {
    code: '5000',
    name: 'Coût des marchandises vendues',
    type: 'charge',
    normalBalance: 'debit',
  },
  {
    code: '5100',
    name: 'Pertes sur stocks',
    type: 'charge',
    normalBalance: 'debit',
  },
  { code: '5200', name: 'Emballages', type: 'charge', normalBalance: 'debit' },
  { code: '6000', name: 'Salaires', type: 'charge', normalBalance: 'debit' },
  {
    code: '6100',
    name: 'Loyer et permis',
    type: 'charge',
    normalBalance: 'debit',
  },
  {
    code: '6120',
    name: 'Location du camion',
    type: 'charge',
    normalBalance: 'debit',
  },
  {
    code: '6130',
    name: 'Location du fournil',
    type: 'charge',
    normalBalance: 'debit',
  },
  { code: '6150', name: 'Assurances', type: 'charge', normalBalance: 'debit' },
  {
    code: '6200',
    name: 'Carburant et entretien',
    type: 'charge',
    normalBalance: 'debit',
  },
  { code: '6300', name: 'Marketing', type: 'charge', normalBalance: 'debit' },
  {
    code: '6400',
    name: 'Amortissement',
    type: 'charge',
    normalBalance: 'debit',
  },
  {
    code: '6500',
    name: 'Frais bancaires et de cartes',
    type: 'charge',
    normalBalance: 'debit',
  },
  {
    code: '6900',
    name: 'Autres charges',
    type: 'charge',
    normalBalance: 'debit',
  },
  {
    code: '6950',
    name: 'Créances irrécouvrables',
    type: 'charge',
    normalBalance: 'debit',
  },
  { code: '7000', name: 'Intérêts', type: 'charge', normalBalance: 'debit' },
] as const satisfies readonly {
  code: string
  name: string
  type: AccountType
  normalBalance: NormalBalance
}[]

export type AccountCode = (typeof CHART)[number]['code']

export interface Account {
  readonly code: AccountCode
  /** The account's name as the player sees it. */
  readonly name: string
  readonly type: AccountType
  readonly normalBalance: NormalBalance
}

/** Every account in code order. The list and its records are frozen. */
export const ACCOUNTS: readonly Account[] = Object.freeze(
  CHART.map((account): Account => Object.freeze({ ...account })),
)

const BY_CODE: ReadonlyMap<string, Account> = new Map(
  ACCOUNTS.map((account) => [account.code, account]),
)

export function isAccountCode(value: string): value is AccountCode {
  return BY_CODE.has(value)
}

/** Throws a RangeError if `code` is not in the chart. */
export function getAccount(code: AccountCode): Account {
  const account = BY_CODE.get(code)
  if (account === undefined) {
    throw new RangeError(`Unknown account: ${code}`)
  }
  return account
}
