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
 * (https://docs.gradle.org/current/userguide/build_environment.html). On this
 * 12-core workstation that is 12 forks, each able to spawn its own `clang++`;
 * 8+ concurrent compilers at 200–600 MB each were observed. 6 halves that fan-out
 * without changing what is built — the native work is bounded by the four ABIs,
 * not by the worker count.
 *
 * **None of this reduces the ABIs.** React Native's own guidance is that building
 * one ABI cuts native build time ~75%
 * (https://reactnative.dev/docs/build-speed) and that all ABIs must be restored
 * for a release. Anything uploaded to Play keeps all four; the arm64-only switch
 * is for local iteration and belongs in the build-android skill, not here.
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
