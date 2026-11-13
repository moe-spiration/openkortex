import { existsSync, readFileSync, rmSync } from "node:fs";
import { adminClient, countRows, deleteCreatedSince, leftSince, TABLES_WITH_USER, type E2EUser } from "./support/admin";
import { USER_FILE } from "./support/user";

/**
 * Temp user: deleted (rows cascade), then nothing of it may be left in schema kortex.
 * Staging account (live run): kept; every row it created since the run started is deleted and
 * the same check runs on those rows.
 */
export default async function globalTeardown() {
  if (!existsSync(USER_FILE)) return;
  const user = JSON.parse(readFileSync(USER_FILE, "utf8")) as E2EUser;
  if (user.staging && user.since) {
    await deleteCreatedSince(user.id, user.since);
    const left = await leftSince(user.id, user.since);
    rmSync(USER_FILE, { force: true });
    if (left.length) throw new Error(`e2e: staging rows remain after cleanup: ${left.join(", ")}`);
    return;
  }
  const { error } = await adminClient().auth.admin.deleteUser(user.id);
  if (error) throw new Error(`e2e: deleteUser failed: ${error.message}`);
  const left: string[] = [];
  for (const table of TABLES_WITH_USER) {
    const n = await countRows(user.id, table);
    if (n > 0) left.push(`${table}=${n}`);
  }
  rmSync(USER_FILE, { force: true });
  if (left.length) throw new Error(`e2e: kortex rows remain after teardown: ${left.join(", ")}`);
}
