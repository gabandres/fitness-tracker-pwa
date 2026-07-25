# Can Expo prebuild generate a watchOS app target?

Research for [#32](https://github.com/gabandres/fitness-tracker-pwa/issues/32), on the map
[Apple glanceable surfaces — iPhone Lock Screen + Watch face complication](https://github.com/gabandres/fitness-tracker-pwa/issues/31).

**Date:** 2026-07-24 · **Verdict:** `plugin-viable-with-work` · **Eject required:** **no**

---

## Verdict

`@bacons/apple-targets@5.0.0` — the exact version already installed in `apps/mobile` — ships
**two** watchOS target types, `watch` (a watchOS app) and `watch-widget` (a watch face
complication), and does the full Xcode wiring for both at prebuild time. **`ios/` stays
uncommitted and the app stays managed/CNG.** Ejecting a live App Store app is *not* on the table.

It is not a flat `managed-viable` because the remaining work is real and partly unproven:

1. The plugin author's own caveat covers these types — see [Risks](#risks-and-unproven-edges).
2. Two brand-new bundle identifiers need provisioning profiles that do not exist yet, and
   this repo does **not** use the EAS declaration that pre-registers extra targets.
3. Every line of the watch app is hand-written SwiftUI. React Native does not run on watchOS.

---

## What the installed plugin actually does

All of the following is read from `node_modules/@bacons/apple-targets` at **v5.0.0**, not from
the `main` branch — so it describes what this repo has today.

### The two target types exist

`build/target.js` declares them in the same table that already backs our `widget` target:

```js
watch: {
    productType: "com.apple.product-type.application",
    needsEmbeddedSwift: true,
    displayName: "Watch",
},
"watch-widget": {
    // extensionPointIdentifier intentionally omitted to avoid collision
    // with "widget" in KNOWN_EXTENSION_POINT_IDENTIFIERS. The Info.plist
    // is handled explicitly in getTargetInfoPlistForType().
    frameworks: ["WidgetKit", "SwiftUI"],
    appGroupsByDefault: true,
    displayName: "Watch Widget",
    description: "Watch face complication using WidgetKit",
},
```

The README's supported-types table lists them as `Watch App (with companion iOS App)` and
`Watch Face Complication`. Neither appears in the README's "Not yet supported" list (only
tvOS Top Shelf, macOS Finder Sync, and macOS Mail are unsupported).

### The watch app is generated as a real, modern watchOS app

`build/configuration-list.js` → `createWatchAppConfigurationList()` emits:

| Build setting | Value |
| --- | --- |
| `SDKROOT` | `watchos` |
| `TARGETED_DEVICE_FAMILY` | `4` (Apple Watch) |
| `WATCHOS_DEPLOYMENT_TARGET` | config `deploymentTarget`, default **`9.4`** |
| `INFOPLIST_KEY_WKCompanionAppBundleIdentifier` | read from the **main app target's** `PRODUCT_BUNDLE_IDENTIFIER` |
| `CODE_SIGN_STYLE` | `Automatic` |
| `GENERATE_INFOPLIST_FILE` | `YES` |
| `SWIFT_VERSION` | `5.0` |

`getTargetInfoPlistForType("watch")` returns `{}` — no `WKWatchKitApp`, no
`WKExtensionDelegateClassName`. That is the **Xcode 14+ single-target watchOS app** shape:
SwiftUI `@main` App lifecycle, no legacy WatchKit extension. Correct and current.

The companion link is derived, not typed by hand: the plugin reads the iOS app's bundle id
straight off the main target, so `WKCompanionAppBundleIdentifier` cannot drift from
`fit.ignia.app`.

### The embed/dependency graph is wired correctly, including the nested case

`build/with-xcode-changes.js` distinguishes a watch **app** from a watch **extension**
(`isWatchOSExtensionTarget()` — watchOS SDK but not `isWatchOSTarget()`), and routes each:

- **watch app** → embedded into the **main iOS app** via its `Embed Watch Content` copy phase;
  build dependency added to the iOS app.
- **watch-widget** → embedded into the **watchOS app target** via an
  `Embed Foundation Extensions` phase (`dstSubfolderSpec: 13`); build dependency added to the
  **watch app**, not the phone app — *"so Xcode builds the extension before the watch app."*

There is an explicit fallback with a `console.warn` if a `watch-widget` is added without a
`watch` app present. So the ordering constraint is: **the complication needs the watch app.**
A complication is not a standalone thing we can add on its own.

`needsEmbeddedSwift: true` on the watch app also flips
`ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = YES` on the main iOS app target — a change to the
shipping phone binary, harmless but not nothing.

### Config surface

The `Config` type (`build/config.d.ts`) is the same one the existing widget uses. Relevant fields:

- `type: "watch" | "watch-widget"`
- `name?` — defaults to a sanitized directory name
- `bundleIdentifier?` — *"Will default to a sanitized version of the root project + name. If the
  specified bundle identifier is prefixed with a dot (.), the bundle identifier will be appended
  to the main app's bundle identifier."*
- `deploymentTarget?`, `frameworks?`, `entitlements?`, `icon?`, `displayName?`

Apple requires a companion watch app's bundle id to be **prefixed by the iOS app's bundle id
plus a dot**. Both the default derivation and a leading-dot override satisfy that. Recommended
explicit values, matching Apple's convention and the existing `fit.ignia.app.Today` precedent:

- watch app → `.watchkitapp` (→ `fit.ignia.app.watchkitapp`)
- complication → `.watchkitapp.complication` (must sit under the watch app)

### Entitlements

The plugin writes `ios/.targets/<productName>/generated.entitlements` and points
`CODE_SIGN_ENTITLEMENTS` at it — derived, never hand-edited, regenerated every prebuild. Targets
flagged `appGroupsByDefault` automatically mirror
`ios.entitlements['com.apple.security.application-groups']` from `app.json`.

`watch-widget` **is** flagged `appGroupsByDefault: true`. **This is a trap for ticket
[#37](https://github.com/gabandres/fitness-tracker-pwa/issues/37).** The complication will get
`group.fit.ignia.app` in its entitlements for free, which *looks* like the phone's snapshot blob
is reachable. It is not — App Groups are a per-device container. What that entitlement actually
buys is a shared container between the **watch app and its own complication on the watch**,
which is genuinely useful: it is the watch-side half of any transport, but never the transport
itself.

> **Corrected by [#45](https://github.com/gabandres/fitness-tracker-pwa/issues/45) (2026-07-25) —
> "for free" is wrong, and it fails silently.** A real `npx expo prebuild -p ios` with a
> `watch-widget` config that omits `entitlements` emits the target with **no
> `CODE_SIGN_ENTITLEMENTS` build setting at all** and **no `ios/.targets/<name>/` directory** —
> the `appGroupsByDefault` flag does not fire for this type. Declaring the App Group explicitly
> in `targets/watch-widget/expo-target.config.js`, exactly as `targets/widget` already does,
> produces the correct `generated.entitlements` in both Debug and Release. The paragraph above is
> right about what the entitlement *buys*; it is wrong that the complication gets it unaided.
> This is risk #1 in [Risks](#risks-and-unproven-edges) — a quiet seam — landing exactly where it
> was predicted to.

---

## Code signing and EAS

The plugin's position: *"The codesigning is theoretically handled entirely by EAS Build. This
plugin will add the requisite entitlements for target signing to work. I've only tested this
end-to-end with my Pillar Valley Widget."* The one documented automation gap is App Clips, not
watch.

Two new targets means two new bundle ids, each needing its own provisioning profile — Expo's
docs are explicit that *"iOS applications that utilize App Extensions … require credentials for
every target within the Xcode project."*

For CNG projects, Expo provides
[`extra.eas.build.experimental.ios.appExtensions`](https://docs.expo.dev/build-reference/app-extensions),
so *"EAS CLI knows what app extensions exist before the build starts (before the Xcode project has
been generated) to ensure that the required credentials are generated and validated."*

**`apps/mobile/app.json` does not declare this field today**, and the `Today` widget shipped to
the App Store anyway — so it is evidently not a hard prerequisite in our setup; EAS reconciled
credentials after prebuild. That precedent is the reason to expect the same for watch, and the
reason to expect a **first-build failure at signing as a recoverable outcome, not a blocker**.
Note the field is documented for *app extensions*; the docs say nothing about a watchOS **app**
target, so its applicability to the `watch` target is unverified.

### Does this re-open the owner-gate question?

`apps/mobile/WIDGET_PLAN.md` already settled that App Groups was **not** an owner gate, because
EAS auto capability signing enables matching capabilities on the Apple Developer Console during
the build. Nothing found here contradicts that, and a watch target introduces **no new
capability** — the same App Group, plus `CODE_SIGN_STYLE: Automatic` on both new targets. What it
introduces is **new bundle identifiers**, which is a registration concern rather than a capability
concern.

**No new Apple fee.** A watchOS app ships inside the same app record; the $99/yr program is paid.

---

## Risks and unproven edges

1. **The author's blanket caveat.** README, immediately above the supported-types table:
   *"I haven't tested all of these and they may not work."* The watch types are new enough that
   `main` carries a dedicated `skills/apple-targets/watch.md` guide, and the disambiguation logic
   (`watch-widget` vs `widget` — both are `com.apple.widgetkit-extension`, told apart only by the
   presence of `WATCHOS_DEPLOYMENT_TARGET`) is the kind of seam that breaks quietly.
2. **No watch scaffolding is vendored.** v5.0.0's `files` list is
   `app.plugin.js`, `build`, `ios`, `expo-module.config.json`, `prebuild-blank.tgz` — there are no
   watch templates on disk. Upstream's flow is `bunx create-target watch`, which pulls templates
   remotely. The Swift is ours to write regardless.
3. **Verification costs an EAS build.** There is no way to prove the generated Xcode project
   compiles and signs without one. Free-plan iOS quota was last measured exhausted (15/15), reset
   **2026-08-01** — see [#35](https://github.com/gabandres/fitness-tracker-pwa/issues/35). A
   *local* `npx expo prebuild -p ios` is free and does prove the plugin emits the targets,
   the embed phases and the entitlements — but it cannot prove signing.
4. **`WATCHOS_DEPLOYMENT_TARGET` defaults to 9.4.** WidgetKit complications require watchOS 9+,
   so the default is technically sufficient — but the accessory rendering modes and several
   complication APIs moved through watchOS 10 and 11. Pin `deploymentTarget` deliberately rather
   than inheriting 9.4; that choice belongs with
   [#34](https://github.com/gabandres/fitness-tracker-pwa/issues/34).
5. **React Native does not run on watchOS.** The watch app is pure SwiftUI, hand-written. This is
   a third hand-mirrored surface after `widget-snapshot.ts` and `index.swift` — exactly the
   pressure [#38](https://github.com/gabandres/fitness-tracker-pwa/issues/38) exists to relieve.
6. **App Review surface.** A watch binary is a new reviewable component on an app already rejected
   twice. Out of this ticket's scope; still on the map's fog.

---

## What this means for the rest of the map

- **The "eject required" branch is dead.** The map's *Not yet specified* entry —
  *"If research finds a watchOS target requires leaving managed prebuild: the 'is it still a yes'
  decision"* — can be struck. The destination stands as drawn.
- **The Lock Screen work is untouched by any of this.** It is families plus SwiftUI views on the
  existing `Today` target, no new bundle id, no new profile, no watch app.
- **The complication cannot be added alone.** It embeds into, and depends on, a watch app target.
  Any transport design in [#37](https://github.com/gabandres/fitness-tracker-pwa/issues/37) must
  assume a watch app exists to run it — a complication process alone has no networking story.
- **The watch-side App Group is free and real; the phone-to-watch hop is not.** WatchConnectivity
  (`WCSession`) is the on-device mechanism and requires a delegate before activation, only
  property-list types, and `transferUserInfo` rather than `sendMessage` when the phone is not
  reachable. That is [#34](https://github.com/gabandres/fitness-tracker-pwa/issues/34)'s problem,
  not this one's.

---

## Sources

- `node_modules/@bacons/apple-targets@5.0.0` — `build/target.js`, `build/configuration-list.js`,
  `build/with-xcode-changes.js`, `build/config.d.ts`, `README.md`, `package.json` (the installed
  copy, i.e. what this repo builds with)
- [`@bacons/apple-targets` README on `main`](https://github.com/EvanBacon/expo-apple-targets) —
  supported-types table, Code Signing, Entitlements
- [`skills/apple-targets/watch.md`](https://github.com/EvanBacon/expo-apple-targets/blob/main/skills/apple-targets/watch.md)
  — watchOS app lifecycle, WidgetKit-replaces-ClockKit, WCSession and background-refresh gotchas
- [Expo — App extensions (EAS Build reference)](https://docs.expo.dev/build-reference/app-extensions)
- [Expo — Local credentials, multi-target projects](https://docs.expo.dev/app-signing/local-credentials)
- [Apple — `WKCompanionAppBundleIdentifier`](https://developer.apple.com/documentation/bundleresources/information-property-list/wkcompanionappbundleidentifier)
- [Apple — watchOS Info.plist keys](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/watchOSKeys.html)
- `apps/mobile/WIDGET_PLAN.md`, `apps/mobile/app.json`, `apps/mobile/eas.json` (local precedent)
