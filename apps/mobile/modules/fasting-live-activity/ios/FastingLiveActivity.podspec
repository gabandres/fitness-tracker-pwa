Pod::Spec.new do |s|
  s.name           = 'FastingLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Starts and ends the fasting Live Activity (N3).'
  s.description    = 'Thin JS entry point for the fasting Live Activity. Owns no ActivityKit types of its own — it reaches IgniaFastActivity in targets/_shared/FastActivity.swift through the Objective-C runtime, because an Expo Module is a CocoaPods target and cannot see _shared at build time.'
  s.author         = 'Ignia'
  s.homepage       = 'https://ignia.fit'
  s.license        = { :type => 'MIT' }
  s.source         = { :git => '' }
  s.static_framework = true

  # DO NOT raise this above the app's `ios.deploymentTarget` in app.json (16.4).
  #
  # Expo's autolinking SILENTLY DROPS a module whose podspec floor sits above the
  # app's deployment target — no warning, no build failure, the pod simply never
  # exists and every call becomes a no-op (STATUS.md §3, and the same note on
  # QuickAddCredentials.podspec). Live Activities need iOS 16.1, but that floor
  # belongs in an `@available` check at the call site, NOT here: putting 16.1 in
  # the podspec would be within the app floor today and is a trap the day the app
  # floor moves.
  s.platforms      = { :ios => '15.1' }

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
