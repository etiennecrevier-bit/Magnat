# Magnat

[![CI](https://github.com/etiennecrevier-bit/Magnat/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/etiennecrevier-bit/Magnat/actions/workflows/ci.yml)

Single-player browser tycoon game in French (Quebec) where you grow a food truck into a business empire and learn finance and operations without being taught.

## Requirements
- Node 24 (LTS) and npm. Node 25 is not supported by Vitest.

## Commands
- `npm run dev`: local dev server
- `npm run build`: production build into `dist/`
- `npm test`: Vitest
- `npm run lint`, `npm run typecheck`, `npm run format`
- `npm run deploy`: build and deploy to Cloudflare (needs `wrangler login`)
- `npm run sim -- --days 3650 --seed 42`: headless simulation (from phase 1)

Jouer à la dernière version : (lien à venir)
