Pod::Spec.new do |s|
  s.name           = 'QuickAddCredentials'
  s.version        = '1.0.0'
  s.summary        = 'Keychain envelope that lets an App Intent write to Firestore without Firebase.'
  s.description    = 'Stores the credential envelope quick-add App Intents read to mint an ID token and PATCH the Firestore REST API. Write side only; the read side is targets/_shared/QuickAdd.swift. See ADR-0020.'
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
  #
  # It matters more here than it did for WatchLink: a silently absent pod means
  # the envelope is never written, every Siri phrase and widget button reports
  # "open Ignia to sign in", and nothing anywhere errors.
  s.platforms      = { :ios => '15.1' }

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
