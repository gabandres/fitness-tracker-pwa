//
//  PROBE — delete after wayfinder #47 is answered. Ships nothing.
//
//  The minimum watchOS complication that can be built and embedded: #47's
//  "does the complication target build and embed into the watch app, given
//  #45's explicit entitlement fix?".
//
//  It reads NOTHING. #37/#39 have the real complication read the snapshot back
//  out of the watch's own App Group container, but that container is only
//  non-empty after a real `WCSession` push from a real phone — hardware, not
//  simulator (#43 §"verification split"). What can be observed here is that the
//  target compiles, signs, embeds into `IgniaWatch.app` and appears in the
//  complication picker.
//
//  `.containerBackground` is watchOS 10 API and doubles as a check on #37's
//  `10.0` pin: on watchOS 10 a widget without it renders wrong, and below the
//  pin it would need an `#available` branch — which is exactly why 9.4 was
//  rejected. If the build fails ONLY on this modifier, that is a finding worth
//  recording, not a line to quietly delete.
//
//  The three families are #40's decided set (no `.accessoryCorner`).
//

import SwiftUI
import WidgetKit

private struct ProbeEntry: TimelineEntry {
  let date: Date
}

private struct ProbeProvider: TimelineProvider {
  func placeholder(in context: Context) -> ProbeEntry {
    ProbeEntry(date: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (ProbeEntry) -> Void) {
    completion(ProbeEntry(date: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ProbeEntry>) -> Void) {
    completion(Timeline(entries: [ProbeEntry(date: Date())], policy: .never))
  }
}

@main
struct IgniaWatchComplicationProbe: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "fit.ignia.app.watch.probe", provider: ProbeProvider()) { _ in
      Text("probe")
        .containerBackground(.clear, for: .widget)
    }
    .configurationDisplayName("Ignia probe")
    .description("Probe target — wayfinder #47.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}
