//
//  PROBE — delete after wayfinder #47 is answered. Ships nothing.
//
//  The minimum watchOS app that can be built and launched: #47's
//  "does an empty watch app build and launch on a 40mm simulator?".
//
//  Deliberately trivial and deliberately alone. Every other question #47 asks
//  lives in its own sibling file (`ProbeSharedUse.swift`,
//  `ProbeViewThatFits.swift`) so that a failure of one does not take the build
//  down with it — delete the offending file, record the failure, rebuild, and
//  the remaining questions still get answered in the same sitting.
//
//  This is NOT #39's mirror screen. That screen is specced, not built; this is
//  a launchable shell so the simulator has something to put on a 40mm face.
//

import SwiftUI

@main
struct IgniaWatchProbeApp: App {
  var body: some Scene {
    WindowGroup {
      Text("Ignia probe")
    }
  }
}
