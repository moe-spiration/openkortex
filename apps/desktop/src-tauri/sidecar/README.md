# Vault sync sidecar

Filled by `node scripts/build-sidecar.mjs` (part of `tauri build`): `md-sync.mjs` (bundled
`packages/md-sync`) and `node.exe`. Both are build output and not in git; this README keeps the
folder, which `tauri.conf.json` ships as resources (`bundle.resources`). See `src/vault.rs`.
