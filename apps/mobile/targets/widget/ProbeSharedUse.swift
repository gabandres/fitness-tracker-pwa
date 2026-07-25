//
//  PROBE — delete after wayfinder #47 is answered. Ships nothing.
//
//  The iPhone-widget half of the `_shared` membership question — the one #38
//  actually cares most about, since `index.swift` is the hand-written mirror
//  whose decode/version-gate/staleness/`Metric`/string-table are what #38 moves
//  into `_shared`.
//
//  Kept as a separate file rather than a line inside `index.swift` on purpose:
//  `targets/widget/index.swift` is SHIPPING code (`Today`, live in the next
//  binary), and a probe should never be something you have to remember to unpick
//  out of it. Delete this file and the widget is untouched.
//
//  Failure mode: "cannot find 'ProbeShared' in scope" on THIS file.
//

enum ProbeSharedUseWidget {
  static let echo = ProbeShared.marker
}
