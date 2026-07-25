//
//  PROBE — delete after wayfinder #47 is answered. Ships nothing.
//
//  The complication half of the `_shared` membership question. See
//  `targets/_shared/ProbeShared.swift` for what turns on it. Answered per
//  target, because `membershipExceptions` is written per target and there is no
//  reason to assume all four resolve the same way.
//
//  Failure mode: "cannot find 'ProbeShared' in scope" on THIS file. Record it,
//  delete this file, rebuild.
//

enum ProbeSharedUseComplication {
  static let echo = ProbeShared.marker
}
