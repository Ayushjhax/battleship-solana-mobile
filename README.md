# Empire of Bits: Sea Battle

Battleship in a ballpoint-pen-on-graph-paper style. Expo SDK 57 · TypeScript strict ·
Android · landscape only · **Expo Go compatible for the whole build**.

Read [CLAUDE.md](CLAUDE.md) first — it holds the rules that must survive the build.
The full spec is in [docs/brief.md](docs/brief.md), the build order in
[docs/prompts.md](docs/prompts.md), and every art/audio drop point in
[docs/assets.md](docs/assets.md).

## Run it

```bash
npm install
cp .env.example .env        # fill in Supabase keys when P11 lands them
npm start                   # scan the QR with Expo Go on Android
```

Match server (separate install, shares `src/engine` via `@engine/*`):

```bash
cd server && npm install && cd ..
npm run server              # http://localhost:8080/health · ws://localhost:8080/ws
```

## Checks

| | |
|---|---|
| `npm run typecheck` | app, strict + `noUncheckedIndexedAccess` |
| `npm test` | vitest, `src/engine` only, no RN shims |
| `npm run lint` | eslint flat config, includes the engine-purity rule |
| `npx expo-doctor` | must stay at 21/21 |

## Status

P00 scaffold, P01 design system, P02 boot + menu, P03 engine, P04 board, P07 battle and P09 tutorial complete. `src/engine` is
the full rules engine (90 tests): placement, shots, arsenal, reducer, masking, AI.
`src/ui` and `src/board` are typed placeholders that P01/P04 replace.
