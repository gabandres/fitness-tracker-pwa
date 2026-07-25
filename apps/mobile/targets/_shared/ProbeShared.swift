//
//  PROBE — delete after wayfinder #47 is answered. Ships nothing.
//
//  This file is the whole of #47's load-bearing question, and #38 rests on it.
//
//  `@bacons/apple-targets@5.0.0` attaches `targets/_shared` to the
//  `fileSystemSynchronizedGroups` of ALL four targets — and then lists every
//  shared file in each target's `membershipExceptions`, the same key that
//  EXCLUDES `Info.plist` from the `Today` target's compile (#45 §3). Whether
//  Xcode reads that key as "member here" or "not a member here" on a
//  multi-target synchronized group is not decidable from the project file.
//  One compile settles it.
//
//  The three `ProbeSharedUse.swift` files — one in `targets/watch/`, one in
//  `targets/watch-widget/`, one in `targets/widget/` — each reference the
//  symbol below. Build each target and record, per target, whether it resolves
//  or fails with "cannot find 'ProbeShared' in scope".
//
//  If it does NOT resolve, #38's "the hand-mirror count stays at one" does not
//  hold and the shared-decode plan needs a different vehicle.
//

enum ProbeShared {
  static let marker = "shared-reached"
}
