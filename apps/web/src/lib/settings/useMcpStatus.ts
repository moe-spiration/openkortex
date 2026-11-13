"use client";

import { useCallback, useEffect, useState } from "react";
import { isLiveData } from "@/lib/workspace-data";
import { getMcpStatus, type McpStatus } from "@/server/settings/mcp";

/** MCP server card: real host/port/token facts, and a /healthz probe on mount and on demand (live only). */
export function useMcpStatus() {
  const live = isLiveData();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [testing, setTesting] = useState(false);

  const test = useCallback(async () => {
    if (!live) return;
    setTesting(true);
    const res = await getMcpStatus(true).catch(() => null);
    setTesting(false);
    if (res?.ok) setStatus(res.data);
  }, [live]);

  useEffect(() => {
    void test();
  }, [test]);

  return { live, status, testing, test };
}
