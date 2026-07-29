# cleanup-docs.ps1 — remove documentation superseded by STATUS.md (2026-07-29)
#
# Run from the repo root:  .\cleanup-docs.ps1
#
# Every file below is a PLAN or CHECKLIST whose work has shipped, or a draft
# that a living document replaced. Git keeps all of them; recover any with:
#   git log --diff-filter=D --name-only -- <path>
#   git show <commit>^:<path> > recovered.md
#
# Nothing here is referenced by code or by a surviving doc any more — the
# pointers were rewritten to STATUS.md in the same pass that created this file.

$ErrorActionPreference = 'Stop'

$dead = @(
  # superseded by STATUS.md §1-§4 (state) and §6 (App Review standing rules)
  'docs/post-launch-roadmap.md',      # every row shipped; kept warning readers it was written from intent
  'docs/aug-2026-build-batch.md',     # the batch it sequenced is merged; 3 inline CORRECTION blocks
  'docs/LAUNCH_CHECKLIST.md',         # app launched 2026-07-20
  'docs/app-review-readiness.md',     # 1.0 rejections resolved; permanent rules moved to STATUS.md §6
  'apps/mobile/MOBILE_RELEASE.md',    # build/account gates now STATUS.md §3 and §6

  # self-declared historical
  'apps/mobile/HEALTHKIT_PLAN.md',    # header says "SHIPPED AND LIVE ... historical design rationale"
  'apps/mobile/HEALTH_PHASE1_PLAN.md',# same work, shipped in 1.0

  # superseded drafts
  'docs/MACRONAUT_PLAN.md',           # pre-pivot plan; the decision is ADR-0015
  'docs/APP_STORE_LISTING.md',        # docs/app-store-metadata.md is the source of truth for listing fields
  'apps/mobile/README.md'             # stock Expo scaffold text; AGENTS.md is the real entry point
)

$removed = 0
foreach ($f in $dead) {
  if (Test-Path $f) {
    git rm --quiet -- $f
    Write-Host "removed  $f"
    $removed++
  } else {
    Write-Host "skipped  $f (already gone)"
  }
}

Write-Host ""
Write-Host "$removed file(s) removed. Now review and commit:"
Write-Host "  git status"
Write-Host "  git add -A"
Write-Host '  git commit -m "docs: one STATUS.md, delete shipped plans, move research behind verdicts"'
