/**
 * Centralized cleanup registry — inspired by Claude Code's cleanupRegistry.ts.
 *
 * Any module can register a cleanup function (e.g. close WebSocket, stop scheduler).
 * On shutdown, all registered functions run in parallel.
 * Each registration returns an unregister function for early cleanup.
 */

import { logger } from "./logger.js";

type CleanupFn = () => void | Promise<void>;

const cleanupFunctions = new Set<CleanupFn>();

/**
 * Register a cleanup function to run on shutdown.
 * Returns an unregister function.
 */
export function registerCleanup(fn: CleanupFn): () => void {
  cleanupFunctions.add(fn);
  return () => {
    cleanupFunctions.delete(fn);
  };
}

/**
 * Run all registered cleanup functions.
 * Called once during graceful shutdown.
 */
export async function runAllCleanups(): Promise<void> {
  const fns = [...cleanupFunctions];
  cleanupFunctions.clear();

  const results = await Promise.allSettled(fns.map((fn) => fn()));

  for (const result of results) {
    if (result.status === "rejected") {
      logger.error("Cleanup", "Cleanup function failed", result.reason);
    }
  }
}
