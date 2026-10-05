Pod::Spec.new do |s|
  s.name           = 'IntentInbox'
  s.version        = '1.0.0'
  s.summary        = 'Hands App Intent outcomes to JS through the App Group.'
  s.description    = 'Reads and clears the intent inbox that Live Activity buttons and Siri intents write in targets/_shared/IntentInbox.swift, and rings JS when it changes.'
  s.author         = 'Ignia'
  s.homepage       = 'https://ignia.fit'
  s.license        = { :type => 'MIT' }
  s.source         = { :git => '' }
  s.static_framework = true

  # DO NOT raise this above the app's `ios.deploymentTarget` in app.json (16.4).
  # Expo's autolinking SILENTLY DROPS a module whose podspec floor sits above
  # the app's — no warning, no failure, every call a no-op (the note on
  # FastingLiveActivity.podspec / QuickAddCredentials.podspec). Feature floors
  # belong in `@available` checks at the call site, never here.
  s.platforms      = { :ios => '15.1' }

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
