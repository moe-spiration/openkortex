// PM2 example for the md-sync daemon (Windows-friendly: runs tsx's JS entry directly, no shell).
//   pnpm add -g pm2
//   pm2 start packages/md-sync/ecosystem.config.cjs
//   pm2 logs kortex-md-sync
//   pm2 save   (+ pm2-installer / pm2-windows-startup to start on boot)
//
// Secrets stay in the repo's gitignored .env.local (read by src/cli.ts); don't put them here.
module.exports = {
  apps: [
    {
      name: "kortex-md-sync",
      cwd: __dirname,
      script: `${__dirname}/node_modules/tsx/dist/cli.mjs`,
      args: "src/cli.ts",
      interpreter: "node",
      autorestart: true,
      // Back off when Supabase/Realtime is down instead of hammering it.
      exp_backoff_restart_delay: 2000,
      max_memory_restart: "300M",
      kill_timeout: 5000,
      shutdown_with_message: true, // Windows: graceful stop via process.on("message")
      time: true,
      env: {
        NODE_ENV: "production",
        // KORTEX_VAULT_PATH: "C:/Users/<you>/KortexVault",
        // KORTEX_SYNC_LOG_LEVEL: "info",
        // KORTEX_SYNC_RECONCILE_MINUTES: "10",
        // KORTEX_SYNC_DELETE_MODE: "archive",
      },
    },
  ],
};
