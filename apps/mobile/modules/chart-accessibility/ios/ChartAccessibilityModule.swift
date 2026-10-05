import Accessibility
import ExpoModulesCore
import UIKit

/**
 * Audio graphs for the React Native charts (iOS 15+): VoiceOver's "Play Audio
 * Graph" and "Chart Details" rotor items, driven by an `AXChartDescriptor`.
 *
 * ## How it stays additive
 *
 * The charts already are one ADJUSTABLE accessible element each — summary as
 * the label, the day under the cursor as the value, increment/decrement to step
 * (`useAdjustableDays`, `WeightChart`). An audio graph has to hang off that same
 * element: VoiceOver reads `accessibilityChartDescriptor` from whichever element
 * is focused.
 *
 * So `AccessibleChartView` does not wrap the chart's accessible view in a new
 * one — it REPLACES it. Under Fabric an `ExpoView` is an
 * `RCTViewComponentView` (`ExpoFabricView`), which applies every standard RN
 * accessibility prop (`accessible`, label, role, value, actions,
 * `onAccessibilityAction`) to itself exactly as a plain `<View>` would. The JS
 * wrapper (`src/components/charts/AccessibleChart.tsx`) passes the chart's
 * existing props straight through, so the element VoiceOver lands on is the same
 * element with the same words — and now also conforms to `AXChart`.
 *
 * ## The descriptor's shape
 *
 * Plain JSON from JS, parsed here rather than declared as `Record`s because it
 * is nested arrays of optional numbers, which a hand parse states more plainly:
 *
 *     { title, summary?,
 *       xAxis: { title, labels?: string[], range?: { min, max } },
 *       yAxis: { title, range: { min, max }, unit?, decimals? },
 *       series: [{ name, continuous?, values: [{ x, y | null, label? }] }] }
 *
 * `xAxis.labels` makes the x axis categorical (dates, in this app); without it
 * the x axis is numeric over `range`. `y: null` is a gap — a day with no
 * reading — which the audio graph renders as silence rather than a zero.
 *
 * A malformed descriptor yields `nil`, never a crash: the chart then simply has
 * no audio graph, which is where it was before this module existed.
 */
public class ChartAccessibilityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ChartAccessibility")

    View(AccessibleChartView.self) {
      Prop("descriptor") { (view: AccessibleChartView, descriptor: [String: Any]?) in
        view.accessibilityChartDescriptor = descriptor.flatMap(ChartDescriptorParser.parse)
      }
    }
  }
}

/// The chart's accessible element, conforming to `AXChart`. Everything else —
/// label, value, traits, the increment/decrement actions — comes from the RN
/// props the base class already handles.
public final class AccessibleChartView: ExpoView, AXChart {
  public var accessibilityChartDescriptor: AXChartDescriptor?
}

enum ChartDescriptorParser {
  static func parse(_ raw: [String: Any]) -> AXChartDescriptor? {
    guard let xRaw = raw["xAxis"] as? [String: Any],
          let yRaw = raw["yAxis"] as? [String: Any],
          let seriesRaw = raw["series"] as? [[String: Any]],
          !seriesRaw.isEmpty
    else { return nil }

    let labels = (xRaw["labels"] as? [Any])?.compactMap { $0 as? String }
    let categorical = labels.map { !$0.isEmpty } ?? false

    let xTitle = (xRaw["title"] as? String) ?? ""
    let xAxis: AXDataAxisDescriptor
    if categorical, let labels {
      xAxis = AXCategoricalDataAxisDescriptor(title: xTitle, categoryOrder: labels)
    } else {
      let range = bounds(xRaw["range"]) ?? derivedXRange(seriesRaw)
      xAxis = AXNumericDataAxisDescriptor(
        title: xTitle, range: range, gridlinePositions: [],
        valueDescriptionProvider: { value in format(value, decimals: 0, unit: nil) })
    }

    let yUnit = yRaw["unit"] as? String
    let yDecimals = (yRaw["decimals"] as? NSNumber)?.intValue ?? 0
    guard let yRange = bounds(yRaw["range"]) ?? derivedYRange(seriesRaw) else { return nil }
    let yAxis = AXNumericDataAxisDescriptor(
      title: (yRaw["title"] as? String) ?? "",
      range: yRange,
      gridlinePositions: [],
      valueDescriptionProvider: { value in format(value, decimals: yDecimals, unit: yUnit) })

    let series: [AXDataSeriesDescriptor] = seriesRaw.map { s in
      let points: [AXDataPoint] = ((s["values"] as? [[String: Any]]) ?? []).compactMap { v in
        let y = (v["y"] as? NSNumber)?.doubleValue
        let label = v["label"] as? String
        if categorical {
          guard let x = v["x"] as? String else { return nil }
          return AXDataPoint(x: x, y: y, additionalValues: [], label: label)
        }
        guard let x = (v["x"] as? NSNumber)?.doubleValue else { return nil }
        return AXDataPoint(x: x, y: y, additionalValues: [], label: label)
      }
      return AXDataSeriesDescriptor(
        name: (s["name"] as? String) ?? "",
        isContinuous: (s["continuous"] as? Bool) ?? false,
        dataPoints: points)
    }

    return AXChartDescriptor(
      title: raw["title"] as? String,
      summary: raw["summary"] as? String,
      xAxis: xAxis,
      yAxis: yAxis,
      additionalAxes: [],
      series: series)
  }

  /// `{ min, max }` → a non-empty range. An axis whose bounds are equal (a flat
  /// line) is widened by one unit each way rather than rejected: the audio graph
  /// of a flat week is a flat tone, which is the truth.
  private static func bounds(_ raw: Any?) -> ClosedRange<Double>? {
    guard let r = raw as? [String: Any],
          let lo = (r["min"] as? NSNumber)?.doubleValue,
          let hi = (r["max"] as? NSNumber)?.doubleValue,
          lo.isFinite, hi.isFinite
    else { return nil }
    let low = min(lo, hi)
    let high = max(lo, hi)
    return low == high ? (low - 1)...(high + 1) : low...high
  }

  private static func derivedYRange(_ series: [[String: Any]]) -> ClosedRange<Double>? {
    let ys = series.flatMap { ($0["values"] as? [[String: Any]]) ?? [] }
      .compactMap { ($0["y"] as? NSNumber)?.doubleValue }
      .filter(\.isFinite)
    guard let lo = ys.min(), let hi = ys.max() else { return nil }
    return lo == hi ? (lo - 1)...(hi + 1) : lo...hi
  }

  private static func derivedXRange(_ series: [[String: Any]]) -> ClosedRange<Double> {
    let xs = series.flatMap { ($0["values"] as? [[String: Any]]) ?? [] }
      .compactMap { ($0["x"] as? NSNumber)?.doubleValue }
      .filter(\.isFinite)
    guard let lo = xs.min(), let hi = xs.max(), lo < hi else { return 0...1 }
    return lo...hi
  }

  /// `2,410 kcal` / `81.6 kg`, in the device's number format. VoiceOver speaks
  /// this for every value it reads off the y axis.
  private static func format(_ value: Double, decimals: Int, unit: String?) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.maximumFractionDigits = max(0, decimals)
    f.minimumFractionDigits = 0
    let n = f.string(from: NSNumber(value: value)) ?? String(value)
    guard let unit, !unit.isEmpty else { return n }
    return "\(n) \(unit)"
  }
}
