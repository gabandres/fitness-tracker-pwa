const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Raises the Gradle daemon's heap and, more importantly, its **metaspace**.
 *
 * ## The failure this exists to prevent
 *
 * On 2026-08-08 an Android release build on `ignia-mac` (16 GB, 8 CPU) died with
 * `java.lang.OutOfMemoryError: Metaspace` during
 * `:react-native-health-connect:lintVitalAnalyzeRelease`. Android Lint loads the
 * class metadata of every module in the graph into metaspace, and this app's
 * graph is large enough that the Expo template's `MaxMetaspaceSize=512m` is not
 * enough to hold it.
 *
 * The cost was not just the ten minutes: `autoIncrement` burns a versionCode per
 * *attempt*, so the failure consumed a number that will never exist.
 *
 * ## Why a plugin and not `expo-build-properties`
 *
 * `expo-build-properties` has no option for Gradle JVM arguments — its Android
 * surface covers SDK versions, Proguard, packaging and cleartext, and nothing
 * about the daemon. So until this file existed the fix was an environment
 * variable (`GRADLE_OPTS=-Dorg.gradle.jvmargs=…`) typed by hand at the start of
 * a build, which is to say: a fix that worked exactly as often as someone
 * remembered it, on a failure that takes ten minutes to reproduce.
 *
 * `gradle.properties` is the durable place for it, and `withGradleProperties` is
 * the supported way to reach `gradle.properties` from a managed app. It is
 * regenerated on every prebuild, so hand-editing it is not an option.
 *
 * ## The numbers
 *
 * `-XX:MaxMetaspaceSize=2g` is 4x the template's and is the value the successful
 * retry ran with — measured, not guessed. `-Xmx6g` is kept for the same reason.
 * For scale, Gradle's own defaults are `-Xmx512m -XX:MaxMetaspaceSize=384m`.
 *
 * ## The Kotlin daemon does NOT get its own heap — it INHERITS this one
 *
 * The line above used to say the Kotlin daemon "gets its own heap", which is
 * backwards and was costing real memory. Kotlin's docs are explicit: *"By
 * default, the Kotlin daemon tries to inherit the heap size (-Xmx) of the
 * launching JVM process"*
 * (https://kotlinlang.org/docs/kotlin-daemon.html). So `-Xmx6g` here does not
 * provision one 6 GB heap, it provisions **two** — measured 2026-08-17 on the
 * vc 33 build, where the Gradle daemon sat at 6.0 GB with a second java process
 * at 3.1 GB and still climbing, on a machine with 3.1 GB free.
 *
 * `kotlin.daemon.jvmargs` caps the second one independently. 2g is ample: the
 * Kotlin compile in this graph is a fraction of what Android Lint needs, and the
 * metaspace failure this plugin exists for was Lint's, not Kotlin's.
 *
 * ## Capping the worker fan-out
 *
 * `org.gradle.parallel=true` is in the Expo template, and Gradle "will fork up
 * to `org.gradle.workers.max` JVMs", defaulting to the CPU count
 * (https://docs.gradle.org/current/userguide/build_environment.html).
 *
 * **It does NOT cap the C++ compiler fan-out, measured on the vc 34 build.** With
 * `workers.max=6` set, concurrent `clang++` peaked at **14** — higher, not lower.
 * Gradle's worker cap bounds parallel *tasks*; each CMake task then invokes
 * **ninja**, which parallelizes internally with its own `-j` defaulting to the
 * CPU count. So one Gradle task can spawn a dozen compilers whatever this is set
 * to. It is kept because bounding Gradle's own JVM forks is still worth having,
 * but it is **not** the lever for the clang swarm and should not be sold as one.
 *
 * The real lever there is the ABI count — each ABI is a full native build — and
 * as of 2026-08-19 this plugin DOES set it. That reverses what this paragraph
 * said before, so the reasoning matters.
 *
 * ## Dropping x86: why the release ABI set is two, not four
 *
 * On this workstation every native compile runs **emulated**. The NDK ships
 * `windows-x86_64` only — there is no `windows-aarch64` — and the box is a
 * Snapdragon X, so four ABIs is four emulated C++ builds. That is most of a
 * 16-minute release build.
 *
 * `x86` and `x86_64` are run by emulators and a few x86 Chromebooks; no phone
 * uses them, the QA device (LG G6) is `arm64-v8a`, and this project has no
 * emulator host at all. Play serves **per-device splits** from the AAB, so
 * carrying them never cost a user a byte — only the build host. `armeabi-v7a`
 * stays: `minSdkVersion` is 26, so 32-bit ARM devices are still in range.
 *
 * This overturns the previous rule here that "all ABIs must be restored for a
 * release", which generalised
 * [RN's build-speed guidance](https://reactnative.dev/docs/build-speed) past
 * what it claims. RN's point is that a ONE-ABI build is a local-iteration trick;
 * it is not an argument for shipping x86 to a store that splits per device.
 * For local iteration the one-ABI switch is still right, and still belongs in
 * the build-android skill: `-PreactNativeArchitectures=arm64-v8a`.
 *
 * **Setting it here moves the fingerprint, and that was the deliberate trade.**
 * Measured the same day: adding one key to this file moved the Android hash
 * `ae526937…` → `f0f6cff9…`, and adding only a COMMENT moved it to
 * `e84ab503…`. So this closed the Android OTA channel against vc 35 and
 * required vc 36. It was done knowingly, with the channel reopening on that
 * binary — not as a side effect anyone should repeat casually.
 *
 * The remaining flags are the Expo template's own, carried over deliberately:
 * dropping the file-encoding line changes how Gradle reads source, which is not
 * a side effect this plugin should have.
 *
 * **This moves the fingerprint.** `app.json`'s plugin list is hashed, so adding
 * or editing this file means the next Android `eas update` reaches no existing
 * binary until a new one ships. See `AGENTS.md`.
 */
const JVM_ARGS = '-Xmx6g -XX:MaxMetaspaceSize=2g -Dfile.encoding=UTF-8';

/** Written alongside org.gradle.jvmargs. Keys are set, not appended, so a
 *  prebuild is idempotent and a template default is overridden rather than
 *  duplicated. */
const PROPS = {
  'org.gradle.jvmargs': JVM_ARGS,
  // Without this the Kotlin daemon inherits -Xmx6g above, giving two 6 GB heaps.
  'kotlin.daemon.jvmargs': '-Xmx2g',
  // Default is the CPU count (12 here); each fork can spawn its own clang++.
  'org.gradle.workers.max': '6',
  // Two ABIs, not the Expo template's four — see "Dropping x86" above. Override
  // for a local check with -PreactNativeArchitectures=arm64-v8a.
  reactNativeArchitectures: 'armeabi-v7a,arm64-v8a',
};

module.exports = function withGradleJvmArgs(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      const existing = cfg.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      );
      if (existing) {
        existing.value = value;
      } else {
        cfg.modResults.push({ type: 'property', key, value });
      }
    }
    return cfg;
  });
};

/**
 * ## PROVEN INERT ON THE WINDOWS WORKSTATION — 2026-08-17
 *
 * Everything above describes what this plugin *intends*. On the Windows Android
 * build host it does not happen, and it took reading a live daemon's command
 * line to notice:
 *
 *     gradle  -Xmx8192m  -XX:MaxMetaspaceSize=1024m     <-- actual
 *     plugin  -Xmx6g     -XX:MaxMetaspaceSize=2g        <-- intended
 *
 * `C:\Users\gabri\.gradle\gradle.properties` contains
 * `org.gradle.jvmargs=-Xmx8192m -XX:MaxMetaspaceSize=1024m`, and Gradle gives the
 * USER-level file precedence over the project's. So the one thing this plugin
 * exists for — raising metaspace past the 512m that killed a release build in
 * Lint — is running at **1024m, half its intended 2g**, on the machine that now
 * builds every Android release. vc 32 and vc 33 succeeded because 1024m happened
 * to be enough, not because the guard was working.
 *
 * `kotlin.daemon.jvmargs` is NOT overridden and does take effect (verified: the
 * daemon starts `-Xmx2g` instead of inheriting the launcher's 8g). So the Kotlin
 * cap below is real; only the `org.gradle.jvmargs` line is shadowed.
 *
 * **Fixing it is a machine-level decision, not a repo one.** That file is outside
 * this repo and applies to every Gradle project on the box, `tracker-app`
 * included, so it has deliberately not been edited here. The options are to drop
 * the `org.gradle.jvmargs` line from the user file so the project's value governs,
 * or to raise the user file's metaspace to 2048m. Until one of those happens,
 * treat this plugin as documentation of intent on Windows rather than as an
 * active guard.
 *
 * Note also that `./gradlew --stop` does not stop the **Kotlin** daemon. A stale
 * one survives with its old JVM args, which is exactly how the first reading of
 * this came back as 8192m and nearly hid the finding.
 */
