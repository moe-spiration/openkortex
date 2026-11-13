// Hourly jobs of a self-hosted Kortex (service "cron"): calls the cron endpoints of the web app.
// digest: weekly digests and the standing orders of the agent. radar: watched pages.
const base = (process.env.KORTEX_INTERNAL_URL ?? "http://web:3000").replace(/\/+$/, "");
const secret = process.env.KORTEX_CRON_SECRET?.trim();
if (!secret) {
  console.error("cron: KORTEX_CRON_SECRET is not set");
  process.exit(1);
}

const JOBS = ["digest", "radar"];
const HOUR = 60 * 60 * 1000;

async function run() {
  for (const job of JOBS) {
    try {
      const res = await fetch(`${base}/api/cron/${job}`, {
        method: "POST",
        headers: { "x-kortex-cron-secret": secret },
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      console.log(`${new Date().toISOString()} cron: ${job} ${res.status}`);
    } catch (error) {
      console.error(
        `${new Date().toISOString()} cron: ${job} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

// First run a few minutes after the start, then every hour.
setTimeout(
  () => {
    void run();
    setInterval(() => void run(), HOUR);
  },
  5 * 60 * 1000,
);
process.on("SIGTERM", () => process.exit(0));
