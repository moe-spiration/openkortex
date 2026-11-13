# OpenKortex for Android (`apps/mobile`)

Expo (expo-router) app, Android first; the iOS configuration is in place but untested.

## Connect it to your server

The app has no built-in server. On first start it asks for the address of your installation (the
same address as the web app, see `selfhost/README.md`) and reads the Supabase address and public key
from `GET <server>/api/instance`. Settings → Server switches later.

A build can come preconfigured instead through `apps/mobile/.env` (git-ignored):

```
EXPO_PUBLIC_KORTEX_URL=https://kortex.example.com
EXPO_PUBLIC_SUPABASE_URL=https://kortex.example.com
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the ANON_KEY from selfhost/.env>
```

## How it talks to the server

| What | Where |
| --- | --- |
| Sign-in | Supabase email and password (same account as the web app), session in SecureStore |
| Entries, inbox | `kortex.knowledge_items` directly through Supabase (row level security) |
| Home, Life | `GET /api/mobile/home`, `GET /api/mobile/life` |
| Note, link | `POST /api/ingest` |
| Voice memo | expo-audio (m4a) → `POST /api/chat/transcribe` → `POST /api/ingest` |
| Ask AI | `POST /api/chat` |
| Share sheet | `expo-share-intent` → `POST /api/ingest` (link, text or file) |

The Supabase access token is the bearer token for every call.

## Run it on a phone

```bash
pnpm install
cd apps/mobile
npx expo start --tunnel        # scan the QR code with Expo Go
```

Everything works in Expo Go except the Android share sheet, which needs a native module. For that,
build a development client with Android Studio and the Android SDK installed:

```bash
npx expo run:android
```

## Build an APK

Needs JDK 17 and the Android SDK (`JAVA_HOME`, `ANDROID_HOME`):

```bash
cd apps/mobile
node scripts/build-android.mjs --arch arm64-v8a,armeabi-v7a
```

The script runs `expo prebuild` once and then gradle; the APK lands in
`android/app/build/outputs/apk/release/app-release.apk`. It carries the debug signature and is meant
for sideloading. The release workflow (`.github/workflows/release.yml`) builds the same APK for every
version tag.

Over-the-air updates (EAS Update) are not configured: if you want them, create your own Expo account
and project and add `updates.url` and `extra.eas.projectId` to `app.json`. Signing updates is
optional and needs `certs/certificate.pem` (see `app.config.js`).

## Checks

```bash
pnpm --filter @kortex/mobile typecheck
pnpm --filter @kortex/mobile lint
pnpm --filter @kortex/mobile test
```
