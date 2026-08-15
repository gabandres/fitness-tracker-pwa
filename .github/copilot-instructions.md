# Copilot instructions — Ignia

**Read `CLAUDE.md` at the repo root first. It is the single source of truth for
repo shape, commands, architecture and conventions.** When working under
`apps/mobile/`, read `apps/mobile/AGENTS.md` too. For what is true *right now*
— live versions, what is merged but in no binary, what is blocked — read
`STATUS.md`.

This file deliberately holds **only** what those files do not: the owner's
personal working protocol, below. Everything else it used to contain was a
second copy of the project description, and it drifted badly enough to be
actively misleading. Do not reintroduce a duplicate description here; correct
`CLAUDE.md` instead.

> **Rewritten 2026-08-15.** The previous version told an agent that the
> codebase lived in a `fitness-tracker-pwa\` subdirectory (it does not — the
> repo root *is* the Angular project), that the workspace root was not a git
> repository (it is), and to "preserve the *Personal Calibration Log*
> aesthetic" — branding retired by the Ignia pivot, ADR-0015. It described a
> single Angular SPA with Stripe subscriptions as current direction, and never
> mentioned the Expo app, `packages/core`, or Cloud Functions at all — despite
> mobile being the long-term product (ADR-0015) and the web logging app being
> frozen (ADR-0022). An instruction file that confidently describes the wrong
> repository is worse than no instruction file.

## The `/grill` command (requirement gathering)

If my prompt includes `/grill`, obey strictly:

1. Do NOT write any code or draft any worktrees.
2. Adopt the persona of a strict Lead Systems Architect.
3. Ask exactly ONE question about edge cases, state management, or potential
   architectural failures regarding my feature request.
4. Wait for my answer.
5. Ask the next question based on my answer. Repeat until you have 100% clarity
   on the requirements.

## Hard constraints when writing code here

1. **Strict Angular** — standalone components only. Never generate
   `.module.ts` files.
2. **Strict typing** — never use `any`. Use the types in `src/app/models/`
   (e.g. `MacroEstimate`) and the domain types in `packages/core`.
3. **Cross-frontend domain and math logic lives in `packages/core`**, which is
   pure and dependency-free. Never reimplement it per frontend.
4. **Never import `firebase/firestore` directly in app-bundle code** — see the
   single-SDK-copy rule in `CLAUDE.md`. It broke production sign-in once.
