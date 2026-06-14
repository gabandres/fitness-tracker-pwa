# Progress photos in Firebase Storage, fetched via getBlob (no token URLs)

## Status

accepted (2026-06-13)

## Context

Progress photos are the first feature to need durable binary storage.
[ADR-0002](0002-firestore-no-backend-architecture.md) frames the app as
"Firestore, no-backend", so introducing Firebase Storage is a deliberate
deviation worth recording — a future reader will otherwise wonder why
Storage appeared.

## Decision

Store the resized JPEG bytes in **Firebase Storage** at
`users/{uid}/photos/{date}.jpg` (one photo per local-date key, retake
overwrites), with a Firestore index doc per photo at
`users/{uid}/photos/{date}` holding `{storagePath, takenAt, weightLb?}` —
**never** a download URL. The grid enumerates via a Firestore query and
fetches bytes via `getBlob()` → `URL.createObjectURL`, **not**
`getDownloadURL()`.

Storage rules are owner-only (`request.auth.uid == uid`) with a
`size < 2MB && contentType == 'image/jpeg'` write backstop; the client
resizes to 1080px / quality 0.8 (~150–350KB). `deleteAccount` (gdpr.ts)
gains a `deleteSubcollection('photos')` step **and** a
`bucket.deleteFiles({ prefix: 'users/{uid}/photos/' })` Storage purge.

## Considered options

- **Firestore base64** — keeps the "pure Firestore" stance but bloats docs
  ~33%, pushes the 1MB doc limit, and re-reads full image bytes through
  Firestore on every grid load. Rejected.
- **Local-only (IndexedDB)** — $0 and maximally private, but photos vanish
  on cache-clear and don't sync across devices, defeating a long-term
  before/after record. Rejected.
- **`getDownloadURL()` tokens** — the standard, CDN-cacheable Firebase
  pattern, but the token is a long-lived bearer credential: anyone with
  the link can view the photo, bypassing auth. For sensitive (often
  shirtless) photos that is an unacceptable leak surface. Rejected in
  favor of `getBlob()`, which re-checks the owner-only rule on every
  fetch and mints no shareable URL.

## Consequences

- `getBlob` object URLs must be revoked on component destroy to avoid
  leaks; no CDN token caching, so the grid re-fetches per session.
- **Guardrail:** no code path may store a `getDownloadURL` token, and the
  share-card (feature 9) must never source progress photos — either would
  reopen the exposure the `getBlob` choice closes.
- Deploy order: Storage rules + functions ship **before** the client that
  writes photos (same "rules before client" discipline as Firestore).
- **Pro-gated** (`subs.isPaid()`): the feature's only real cost is download
  egress ($0.12/GB past 100 GB/mo free), amplified by the no-cache `getBlob`
  choice. Gating *uploads* to Pro means free users hold no photos, so they
  generate no photo egress. Gate is client-side (the button + grid + the
  on-load fetch); Storage rules can't read Stripe state, but since uploads
  are owner-only and reads are owner-only, client gating fully caps the
  cost driver.
