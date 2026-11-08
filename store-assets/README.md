# store-assets

Working directory for App Store Connect screenshot production.

```
raw/<locale>/01.png … 05.png   ← what you capture on the phone (git-ignored)
out/<locale>/01.png … 05.png   ← what you upload to ASC (committed)
fonts/Manrope-ExtraBold.ttf    ← optional, for on-brand caption type (git-ignored)
```

`raw/` is ignored on purpose: those frames show a populated demo account, and
an account's real logs are not something to put in git history.

## Capture (iOS simulator, ~10 min a locale)

The set is shot by `apps/mobile/.maestro/capture/store-shots.yaml` on an
iPhone 16 Pro Max simulator. Its native 1320 × 2868 is the 6.9" slot exactly.
The flow's header is the runbook:

1. Seed the demo account: `node scripts/seed-demo-account.mjs --email demo@ignia.fit --reset --any-hour`.
   Its password is in `~/demo-pass.txt` on `ignia-mac`.
2. Set the locale (`qa-regression-verify.mjs set-locale`) and run the flow with
   `THEME=dark`, once per locale. It signs in, sets the theme, and starts a
   workout, which it leaves open. Clear that workout before the next run.
3. Copy `takeScreenshot/<locale>/*.png` into `raw/<locale>/`. The leading
   number in each file name is the frame slot.

The app needs a Release simulator build (`xcodebuild … -configuration Release
-destination 'generic/platform=iOS Simulator' ARCHS=arm64`) with
`EXUpdatesEnabled=false`, so an OTA can't swap the bundle. Its
`CFBundleShortVersionString` must be at least the update-required minimum, or
the app opens on the update screen.

Order is the pitch. The first two frames are what a search-results thumbnail
strip shows, so both differentiators have to land there. The shot list and the
captions live in [`docs/app-store-metadata.md` §3](../docs/app-store-metadata.md).

1. Today: the rings, with the adaptive target visible
2. Train: a session in progress, two sets ticked
3. Food search, with the keyboard down
4. Trends: maintenance, measured
5. Body: the weight trend toward the goal

Checklist:

- [ ] Signed in as `demo@ignia.fit`, freshly seeded. Never `review@`.
- [ ] **No PII**: no real name, no personal email, not the owner account
- [ ] One theme across the whole set (dark since 2026-11-08)
- [ ] Nothing visible that `docs/go-to-market.md` §0 lists as not-claimable

## Composite

```sh
node scripts/store-screenshots.mjs                       # both locales
node scripts/store-screenshots.mjs --locale en           # one locale
node scripts/store-screenshots.mjs --font store-assets/fonts/Manrope-ExtraBold.ttf
```

Output is exactly 1320 × 2868 (6.9"), which is the only set Apple needs: it
downscales for every smaller device. Each frame is the whole phone in a drawn
bezel, with a Dynamic Island, over an ember glow. `*…*` in a caption draws
those words in coral. Files are numbered by sort order of the
input directory, so name the raws `01`…`05`.

Without a Manrope TTF the captions render in the system sans and the set looks
subtly off-brand; the script warns when that happens. Manrope is OFL —
download `Manrope-ExtraBold.ttf` into `fonts/`, or point `--font` at it.
