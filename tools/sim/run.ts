import { main } from './cli.ts'

// Entry point of `npm run sim`; see cli.ts.
process.exitCode = main(process.argv.slice(2))
