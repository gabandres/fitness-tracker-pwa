//
//  PROBE — delete after wayfinder #47 is answered. Ships nothing.
//
//  #47's `ViewThatFits` line, and #43 §7's "compile-gated, the one failure mode
//  with no silent variant". #43 made `ViewThatFits(in: .vertical)` the vehicle
//  for #40's 4-row/3-row rectangular fallback, so if it does not compile against
//  the `10.0` pin, #43's central mechanism is gone and the fallback needs a
//  different one.
//
//  This is a COMPILE probe, not a layout readout — reading which branch fires at
//  which case size is #46's job, on a simulator, with real strings. The shape is
//  copied from #43 (`in: .vertical`, `.lineLimit(1)` as a correctness
//  prerequisite, `.minimumScaleFactor(0.7)`) only so the compiler is asked about
//  the construct that will actually ship, not a reduced stand-in.
//
//  Nothing references this view; being compiled into the target is the test.
//

import SwiftUI

struct ProbeViewThatFits: View {
  var body: some View {
    ViewThatFits(in: .vertical) {
      // 4-row: 46mm keeps #40's `as of` honesty row.
      VStack(alignment: .leading, spacing: 0) {
        Text("1,240 kcal left").lineLimit(1).minimumScaleFactor(0.7)
        Text("1,240 / 2,000").lineLimit(1).minimumScaleFactor(0.7)
        Text("proteína 88/150").lineLimit(1).minimumScaleFactor(0.7)
        Text("as of 8:04 AM").font(.caption2).foregroundStyle(.secondary)
          .lineLimit(1).minimumScaleFactor(0.7)
      }

      // 3-row: 40mm drops the `as of` row, never protein (#40's ranking).
      VStack(alignment: .leading, spacing: 0) {
        Text("1,240 kcal left").lineLimit(1).minimumScaleFactor(0.7)
        Text("1,240 / 2,000").lineLimit(1).minimumScaleFactor(0.7)
        Text("proteína 88/150").lineLimit(1).minimumScaleFactor(0.7)
      }
    }
  }
}
