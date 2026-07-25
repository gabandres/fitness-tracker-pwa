//
//  PROBE — delete after wayfinder #47 is answered. Ships nothing.
//
//  The watch-app half of the `_shared` membership question. See
//  `targets/_shared/ProbeShared.swift` for what turns on it.
//
//  Nothing references this type; it does not need to. Being compiled into the
//  target is the entire test. If `_shared` does not reach here the build fails
//  with "cannot find 'ProbeShared' in scope" ON THIS FILE — record that, delete
//  this file, and rebuild to get at the rest of #47's checklist.
//

enum ProbeSharedUseWatch {
  static let echo = ProbeShared.marker
}
