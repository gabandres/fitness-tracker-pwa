# store-assets

Working directory for App Store Connect screenshot production.

```
raw/<locale>/01.png … 05.png   ← what you capture on the phone (git-ignored)
out/<locale>/01.png … 05.png   ← what you upload to ASC (committed)
fonts/Manrope-ExtraBold.ttf    ← optional, for on-brand caption type (git-ignored)
```

`raw/` is ignored on purpose: those frames show a populated demo account, and
an account's real logs are not something to put in git history.

## Capture (phone, ~15 min)

Use the **iPhone that already has the App Store build installed** — no dev
build, no simulator, no EAS quota. Volume-up + side button, then AirDrop.

Order is the pitch; the first two frames are what a search-results thumbnail
strip shows, so both differentiators have to land there. The shot list and the
captions live in [`docs/app-store-metadata.md` §3](../docs/app-store-metadata.md).

1. Today — rings, adaptive target visible
2. Train — a session in progress, sets/reps/RIR
3. Food search or a barcode result
4. Trends — weekly insights + weight projection
5. Settings, or any "no paywall" surface

Then switch the app language to es-PR and shoot the same five into `raw/es/`.

Checklist before you shoot:

- [ ] Signed in as a demo account with **realistic, populated data** — empty
      rings sell nothing
- [ ] **No PII**: no real name, no personal email, not the owner account
- [ ] One theme across the whole set — don't mix light and dark
- [ ] Nothing visible that `docs/go-to-market.md` §0 lists as not-claimable
      (photo scan, Pro, Health sync, widget, Android)

## Composite

```sh
node scripts/store-screenshots.mjs                       # both locales
node scripts/store-screenshots.mjs --locale en           # one locale
node scripts/store-screenshots.mjs --font store-assets/fonts/Manrope-ExtraBold.ttf
```

Output is exactly 1320 × 2868 (6.9"), which is the only set Apple needs — it
downscales for every smaller device. Files are numbered by sort order of the
input directory, so name the raws `01`…`05`.

Without a Manrope TTF the captions render in the system sans and the set looks
subtly off-brand; the script warns when that happens. Manrope is OFL —
download `Manrope-ExtraBold.ttf` into `fonts/`, or point `--font` at it.
