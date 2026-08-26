// Throwaway Gradle runner for the vc 39 build. See
// `.claude/skills/build-android/REFERENCE.md` — `NoDefaultCurrentDirectoryInExePath`
// is set in the environment Git Bash hands to Node here, so cmd.exe refuses to
// resolve `gradlew.bat` from the current directory, and the wrapper still exits 0.
// The path is passed as `cwd` and never appears in the command string.
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
delete env.NoDefaultCurrentDirectoryInExePath;

const r = spawnSync('cmd.exe', ['/d', '/c', '.\\gradlew.bat bundleRelease'], {
  cwd: 'Z:/macro-app/apps/mobile/android',
  stdio: 'inherit',
  env,
});
console.log('gradle exit status:', r.status);
process.exit(r.status ?? 1);
