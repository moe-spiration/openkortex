#!/usr/bin/env node
// Release APK for Android (Windows host). Run it through the build queue, never directly:
//
//   pnpm build-queue run --kind android --name <branch>-android --cwd apps/mobile -- node scripts/build-android.mjs
//
// Why this script exists: running `./gradlew.bat` from Git Bash under `set -e` ended with exit 2 even
// after "BUILD SUCCESSFUL" (the batch wrapper's exit code does not survive the bash -> cmd hop
// reliably), so the queue marked a good build as failed. Here gradle runs natively through cmd.exe, and
// the result is decided by what matters: gradle's own success line plus a fresh APK on disk.
//
// Env: JAVA_HOME and ANDROID_HOME win; otherwise the usual per-user install paths are tried.
// Options: --arch x86_64,arm64-v8a (default both: emulator + phone), --clean (gradle clean first).
import { spawn } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const androidDir = path.join(app, "android");
const apk = path.join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};

const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
const firstExisting = (...c) => c.find((p) => p && existsSync(p));
const javaHome = firstExisting(process.env.JAVA_HOME, path.join(local, "Programs", "Microsoft", "jdk-17.0.10.7-hotspot"));
const sdk = firstExisting(process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(local, "Android", "Sdk"));
if (!javaHome || !sdk) {
  console.error(`build-android: JDK 17 (${javaHome ?? "missing"}) or Android SDK (${sdk ?? "missing"}) not found; set JAVA_HOME / ANDROID_HOME`);
  process.exit(2);
}
const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, CI: "1" };

/** Runs a command line natively (cmd.exe on Windows), streams its output and resolves with exit code + whether `marker` was printed. */
function run(line, cwd, marker) {
  return new Promise((resolve) => {
    let seen = false;
    let tail = "";
    const child = spawn(line, { cwd, env, shell: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const pass = (out) => (chunk) => {
      out.write(chunk);
      if (marker && !seen) {
        tail = (tail + chunk.toString()).slice(-4096);
        seen = tail.includes(marker);
      }
    };
    child.stdout.on("data", pass(process.stdout));
    child.stderr.on("data", pass(process.stderr));
    child.on("exit", (code) => resolve({ code: code ?? 1, seen }));
    child.on("error", (e) => {
      console.error(`build-android: ${e.message}`);
      resolve({ code: 1, seen });
    });
  });
}

const started = Date.now();

if (!existsSync(androidDir)) {
  console.log("build-android: no android/ yet, running expo prebuild");
  const pre = await run("npx expo prebuild --platform android --no-install", app);
  if (pre.code !== 0) process.exit(pre.code);
}
// Forward slashes: local.properties is a Java properties file, backslashes would be escapes.
writeFileSync(path.join(androidDir, "local.properties"), `sdk.dir=${sdk.replace(/\\/g, "/")}\n`);

// Absolute path: with NoDefaultCurrentDirectoryInExePath set (agent shells), cmd does not look in the cwd.
const gradlew = `"${path.join(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew")}"`;
const archs = opt("arch", "x86_64,arm64-v8a");
// Caps parallel native compile jobs and the gradle heap so the build fits next to other work on the machine.
const gradleArgs = [
  ...(args.includes("--clean") ? ["clean"] : []),
  "assembleRelease",
  "-I", `"${path.join(here, "cap-native-jobs.init.gradle")}"`,
  `-PreactNativeArchitectures=${archs}`,
  "--console=plain",
  "--no-parallel",
  "--max-workers=2",
  `"-Dorg.gradle.jvmargs=-Xmx2560m -XX:MaxMetaspaceSize=512m"`,
  "-Pkotlin.compiler.execution.strategy=in-process",
];
const g = await run(`${gradlew} ${gradleArgs.join(" ")}`, androidDir, "BUILD SUCCESSFUL");

const fresh = existsSync(apk) && statSync(apk).mtimeMs >= started;
if (g.seen && fresh) {
  if (g.code !== 0) console.warn(`build-android: gradle wrapper exited ${g.code} after BUILD SUCCESSFUL; the APK is fresh, counting it as success`);
  const mb = (statSync(apk).size / 1024 ** 2).toFixed(1);
  console.log(`build-android: OK ${apk} (${mb} MB, ${archs}) in ${Math.round((Date.now() - started) / 60_000)} min`);
  process.exit(0);
}
console.error(`build-android: FAILED (gradle exit ${g.code}, success line ${g.seen ? "seen" : "missing"}, APK ${fresh ? "fresh" : existsSync(apk) ? "stale" : "missing"})`);
process.exit(g.code || 1);
