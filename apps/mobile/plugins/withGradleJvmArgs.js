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
 * `-Xmx6g` on a 16 GB machine leaves room for the Kotlin daemon (which gets its
 * own heap), Metro and the OS. `-XX:MaxMetaspaceSize=2g` is 4x the template's
 * and is the value the successful retry ran with — measured, not guessed.
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

module.exports = function withGradleJvmArgs(config) {
  return withGradleProperties(config, (cfg) => {
    const existing = cfg.modResults.find(
      (item) => item.type === 'property' && item.key === 'org.gradle.jvmargs',
    );
    if (existing) {
      existing.value = JVM_ARGS;
    } else {
      cfg.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS });
    }
    return cfg;
  });
};
