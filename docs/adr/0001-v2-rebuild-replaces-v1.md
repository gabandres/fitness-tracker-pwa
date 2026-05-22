# ADR-0001: v2 rebuild replaces v1

- **Status:** accepted
- **Date:** 2026-05-01 (v1 retired in commit `dbdfc4f`)

## Context

The app shipped two parallel UI generations in mid-2026. The original
("v1") surfaces were the tabs and sheets the app launched with. "v2"
was a six-week rebuild that re-skinned and re-flowed every primary
surface (Today, Body, Trends, History, DayDetail, Settings, Entry,
Refine Targets) and introduced a 2-question onboarding flow with manual
heuristic targets that bypass the Mifflin-St Jeor profile until the user
opts in via the Day-3 Refine Targets card.

For a few weeks both versions were live behind a runtime flag while
v2 stabilized. After the cutover (commit `839965c`, "flipped v2 to
default") and the polish week that followed, v1 became dead weight —
two layouts for every screen, double the i18n keys, double the CSS
namespace.

## Decision

v1 is retired entirely. The v2 surfaces are the only surfaces. The flag
is removed. v1 component folders, routes, templates, and tests are
deleted.

The legacy `v2.*` i18n key prefix and `v2-` CSS class prefix **remain**
across the codebase. Renaming them would touch hundreds of files for a
purely cosmetic gain and would invalidate any in-flight Spanish
translation work. This is a pragmatic choice, not a principled one —
the prefixes are a fossil of the rebuild, and we accept the cosmetic
mismatch in exchange for not paying the migration cost. See also
[ADR-0006](0006-drop-v2-suffix-component-naming.md).

## Consequences

- One UI tree to maintain. No flag, no dead code path.
- New i18n keys and CSS classes should **not** acquire a `v2.*` /
  `v2-` prefix — those are legacy markers, not a naming convention.
  Use the bare term.
- Old keys and classes are not refactored on sight. Leave them.
- Any documentation, screenshots, or copy referring to "v1" or "the
  old UI" is historical only.
- A future "v3" — should one ever happen — needs its own flag mechanism
  rebuilt; the v1/v2 toggle is gone.
