Pod::Spec.new do |s|
  s.name           = 'WatchLink'
  s.version        = '1.0.0'
  s.summary        = 'One-function WatchConnectivity bridge for the Ignia watch complication.'
  s.description    = 'Pushes the already-serialized widget snapshot to the paired Apple Watch via WCSession.updateApplicationContext. See ios/WatchLinkModule.swift.'
  s.author         = 'Ignia'
  s.homepage       = 'https://ignia.fit'
  s.license        = { :type => 'MIT' }
  s.source         = { :git => '' }
  s.static_framework = true

  # DO NOT raise this above the app's `ios.deploymentTarget` in app.json (16.4).
  #
  # Expo's autolinking SILENTLY DROPS a module whose podspec floor sits above
  # the app's deployment target — no warning, no build failure, the pod simply
  # never exists and every call becomes a no-op. That is exactly how the
  # `ExtensionStorage` pod went missing and killed the iPhone widget for two
  # builds (STATUS.md §3). Keeping this comfortably below the app floor means
  # the trap cannot re-arm from this side.
  s.platforms      = { :ios => '15.1' }

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
