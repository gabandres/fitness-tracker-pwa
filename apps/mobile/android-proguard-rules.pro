# R8 keeps for Ignia's release build.
#
# These are appended to the flags in `proguard-android.txt`; see the
# `proguardFiles` directive in build.gradle.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS FILE SUDDENLY MATTERS (issue #101)
#
# Until 2026-08-26 it did not, because R8 was OFF. The Expo template reads
# `findProperty('android.enableMinifyInReleaseBuilds') ?: false` and that
# property was set nowhere, so every release AAB this project ever shipped had
# `minifyEnabled false` and none of the rules below were ever exercised.
#
# Google Play requires >=25% DEX optimization coverage from **February 2027**,
# so R8 is now enabled in step 1c of `scripts/patch-android-release.mjs`. That
# turns this file from decoration into load-bearing config.
#
# THE FAILURE MODE TO EXPECT: R8 strips classes nothing references *statically*.
# Anything resolved by REFLECTION or by NAME at runtime is invisible to it —
# React Native's TurboModule/JNI bridge, Firebase's model deserialization,
# Android's manifest-declared components. A stripped class does not fail the
# build; it throws `ClassNotFoundException` or silently returns nothing on a
# real device, which is why a release build MUST be exercised on hardware
# before it is submitted. `verify-mobile-artifact.mjs` checks the manifest, not
# the DEX.
#
# Most modern libraries ship their own `consumer-rules.pro` inside their AAR, so
# this file is deliberately NOT an exhaustive list of dependencies — adding
# blanket keeps for libraries that already protect themselves buys nothing and
# costs coverage against the 25% floor. What is here is what this app does that
# a library cannot know about.
# ─────────────────────────────────────────────────────────────────────────────

# ─── React Native core ───────────────────────────────────────────────────────
# The bridge resolves native modules by name from JavaScript, so no Java caller
# references them and R8 sees them as dead.
-keep class com.facebook.react.turbomodule.** { *; }
-keep,includedescriptorclasses class com.facebook.react.bridge.** { *; }
-keep @com.facebook.proguard.annotations.DoNotStrip class * { *; }
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.react.bridge.ReactMethod *;
}
# JNI: any method called from C++ has no Java caller.
-keepclasseswithmembernames class * {
    native <methods>;
}

# react-native-reanimated — was already here before R8 was enabled, kept.
-keep class com.swmansion.reanimated.** { *; }

# ─── This app's own native modules ───────────────────────────────────────────
# `modules/*` are Expo Modules, reached from JS by name through the Expo module
# registry. Nothing in Kotlin references them, so R8 would remove all four.
# `quick-add-tile` is the one that would fail most quietly: its Quick Settings
# service is instantiated by the SYSTEM from the manifest, so it breaks on a
# user's notification shade rather than in the app.
-keep class fit.ignia.app.** { *; }
-keep class expo.modules.** { *; }

# ─── Firebase / Google Sign-In ───────────────────────────────────────────────
# Firestore maps documents onto model classes reflectively; obfuscated field
# names silently stop matching stored field names, which corrupts reads without
# throwing. This app talks to Firestore through the JS SDK rather than the
# native one, so the risk is lower than usual — the keep stays because the cost
# is small and the failure is data-shaped rather than a crash.
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# ─── Sentry ──────────────────────────────────────────────────────────────────
# Obfuscated frames make every future crash report unreadable, and a stack trace
# that cannot be symbolicated is indistinguishable from no report at all.
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**
# Keep line numbers, then map the obfuscated names back to source. Without both,
# `prod-errors` triage has nothing to work with.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ─── Health Connect ──────────────────────────────────────────────────────────
# Record types are resolved by class, and a stripped one reads at runtime as
# "the user has no data of that kind" — the failure ADR-0026 warns is
# indistinguishable from an export being switched off in the vendor's app.
-keep class androidx.health.connect.** { *; }
-dontwarn androidx.health.connect.**

# ─── Home-screen widget ──────────────────────────────────────────────────────
# Instantiated by the launcher from the manifest, not by app code.
-keep class com.reactnativeandroidwidget.** { *; }

# ─── Kotlin coroutines / serialization ───────────────────────────────────────
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }
-dontwarn kotlinx.coroutines.**

# ─── Annotations R8 needs to keep honouring ──────────────────────────────────
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions
