# AGENTS.md

## Project overview

`@monetizekit/node`: server SDK for the MonetizeKit REST API (client,
entitlement/decision helpers, OpenTelemetry hooks). Source in `src/`, tests in
`tests/` (Vitest), built with `tsup` into ESM and CJS with an `otel` subpath.

## Commands

- `pnpm install --frozen-lockfile`
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- `pnpm check-entry`, `pnpm smoke`
- `.github/workflows/examples-watch.yml` checks the `examples` repository
  against this SDK on a schedule.

## Conventions

- Unit tests mock HTTP at the fetch boundary only; anything that reaches the
  real API belongs in the `examples` lifecycle E2E, not here.
- Every exported helper is wired through `src/index.ts`; `check-entry` fails
  otherwise.
- Behavior changes need a changeset and a README example update.

## Verifying your work

```
$ pnpm lint
> eslint .
(no output, exit 0)

$ pnpm typecheck
(no output, exit 0)

$ pnpm test
 Test Files  4 passed (4)
      Tests  38 passed (38)

$ pnpm build
DTS dist/index.d.cts             19.47 KB
DTS dist/otel.d.cts              3.24 KB

$ pnpm check-entry
Package entry guard passed: client + helpers are exported and wired.
```

## Releasing

Published to npm by Changesets from `.github/workflows/release.yml` on push to
`main`, with npm provenance. Add a changeset (`pnpm changeset`) to any PR that
changes the published surface. Because `main` only receives promotions from
`delivery`, a release is the result of a promotion, not of a feature merge.

## SDLC and promotion chain

- Branches: `feature/*` -> PR -> `development` -> `delivery` -> `main`. Feature
  PRs target `development`. Promotion between stages is a promotion PR from
  the upstream stage branch (`development -> delivery`, `delivery -> main`);
  where this repository has `.github/workflows/promote.yml`, that workflow
  opens it when the stage gate is green, and `delivery -> main` is always
  merged by a human. Never open a feature PR against `main` or `delivery`.
- Every PR must pass the `Required Checks Gate` job in `.github/workflows/ci.yml`.
  The `Shadow Review (advisory)` job posts a model review comment; it never
  blocks. React with a thumbs-down to dismiss a finding.
- Agent roles, model IDs, tools and autonomy for the whole fleet are declared in
  [`MonetizeKit/.github/agent-policy.json`](https://github.com/MonetizeKit/.github/blob/main/agent-policy.json).
  Never hardcode a model ID in this repository.
- Conventional commits (`feat:`, `fix:`, `chore:`, ...). Position and status live
  in Linear (team `MK`); reference the issue key in the PR body when one exists.
- The fleet-wide plan is
  [`docs/engineering/ai-native-sdlc-plan.md`](https://github.com/MonetizeKit/app-monetizekit-monorepo/blob/main/docs/engineering/ai-native-sdlc-plan.md)
  in the monorepo.
