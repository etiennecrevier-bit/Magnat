Owns the journal and the financial statements; only engine and finance write journal entries, and every entry balances (debits = credits).

The three financial statements (`statements.ts`) are plain data read from the journal: French labels and amounts in cents, which only the UI formats.

The état des flux de trésorerie shows only the cash that went through 1000 Encaisse. An entry that touches Encaisse can also hold lines that move no cash, such as the part of a purchase a loan pays for or the depreciation of the day; the statement then has to guess which rows those lines offset. Post such parts as entries of their own.
