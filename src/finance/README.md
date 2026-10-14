Owns the journal and the financial statements; only engine and finance write journal entries, and every entry balances (debits = credits).

The three financial statements (`statements.ts`) are plain data read from the journal: French labels and amounts in cents, which only the UI formats.

The état des flux de trésorerie shows only the cash that went through 1000 Encaisse. It nets the other lines of an entry that touches Encaisse within each row of the statement. If those rows all go one way, each shows what it got. Otherwise some lines moved no cash, such as the part of a truck a loan pays for, and the entry must say which: its cash goes only one way and a single row goes that way, as with a truck bought with a down payment and a loan. `cashFlowStatement` throws on any other entry in its period, such as a loan received and fuel paid in one entry, because it reads more than one way; post such parts as entries of their own. The 10-year invariant test reads every month, so an engine change that posts one fails it. Depreciation (6400 Amortissement against 1510 Amortissement cumulé) nets out within the Équipement row, so it can go with any entry.

`loan.ts` works out a bank loan's monthly payments (`loanSchedule`): a spreadsheet's PMT rounded to the cent, each month's interest on the balance, and a last payment that absorbs the rounding.

How the engine posts the startup and the running costs, so each cash entry feeds one row of the état des flux de trésorerie:

- Facile's truck, already the owner's: Dr 1500 Équipement / Cr 3000 Capital-actions. It moves no cash, so it stays out of the état des flux de trésorerie.
- Moyen's startup, three entries: the Mise de fonds (Dr 1000 / Cr 3000, Capital-actions in financing), the loan (Dr 1000 / Cr 2500, Emprunts bancaires in financing), and the truck bought (Dr 1500 / Cr 1000, Équipement in investing).
- Each loan payment, two entries with the amounts of `loanSchedule`: the interest (Dr 7000 Intérêts / Cr 1000, Intérêts payés in operating) and the principal (Dr 2500 / Cr 1000, Emprunts bancaires in financing). `postEntry` rejects a line of zero, so a loan without interest posts no interest entry, and nor does a month the schedule pays nothing.
- Difficile's truck lease: Dr 6120 Location du camion / Cr 1000, Autres charges in operating.
- Packaging (5200 Emballages) goes with the suppliers, like stock. Card fees (6500 Frais bancaires et de cartes), insurance (6150 Assurances) and marketing (6300 Marketing) are Autres charges; the owner's pay is 6000 Salaires.

Emballages shows under Charges on the état des résultats, not in the cost of goods sold, which stays a single account, so the Marge brute leaves packaging out.
