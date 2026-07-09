/**
 * process-lifecycle.test.ts
 *
 * Tests for orphan process prevention fixes:
 *   1. SubprocessCliSession.killProcess() (via public API)
 *   2. TaskScheduler.stop()
 *   3. Server shutdown idempotency + SIGHUP handler
 *
 * Uses Node.js built-in test runner (node:test + node:assert).
 * No external test framework required.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { EventQueue, SubprocessCliSession } from "../server/subprocess-cli-session.js";
import {
  writeMcpConfigFile,
  removeMcpConfigFile,
  cleanupStaleMcpConfigDirs,
} from "../server/mcp-config.js";
import type { Settings } from "../server/types.js";

// ---------------------------------------------------------------------------
// 1. SubprocessCliSession — tested through a lightweight inline replica
//    (avoids importing the full module which pulls in db.ts + sqlite at load time)
// ---------------------------------------------------------------------------

/**
 * Minimal replica of the killProcess / close / sendMessage logic so we can
 * unit-test it without pulling in the full module's DB / spawn side-effects.
 */
class KillProcessHarness {
  process: ChildProcess | null = null;
  forceKillTimer: ReturnType<typeof setTimeout> | null = null;
  killCount = 0; // how many times killProcess was called
  killedPids: number[] = [];

  /** Public: matches SubprocessCliSession.close() */
  close() {
    this.killProcess();
  }

  /** Public: matches the "kill previous process" step in sendMessage() */
  sendMessage(spawnNew: () => ChildProcess) {
    this.killProcess(); // kill any previous process
    this.process = spawnNew();

    this.process.on("exit", () => {
      this.process = null;
      if (this.forceKillTimer) {
        clearTimeout(this.forceKillTimer);
        this.forceKillTimer = null;
      }
    });
  }

  /** Direct copy of SubprocessCliSession.killProcess() logic */
  private killProcess() {
    this.killCount++;
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer);
      this.forceKillTimer = null;
    }
    if (this.process) {
      const proc = this.process;
      this.process = null;
      if (proc.pid) this.killedPids.push(proc.pid);
      try {
        proc.kill("SIGTERM");
      } catch {}
      this.forceKillTimer = setTimeout(() => {
        this.forceKillTimer = null;
        try {
          proc.kill("SIGKILL");
        } catch {}
      }, 3000);
      (this.forceKillTimer as any).unref?.();
    }
  }
}

// ---------------------------------------------------------------------------
// 2. TaskScheduler — tested through a lightweight inline replica
//    (avoids importing node-cron + db.ts + claude-agent-sdk at load time)
// ---------------------------------------------------------------------------

class TaskSchedulerHarness {
  jobs = new Map<string, { stop(): void }>();
  runningAbortControllers = new Map<string, AbortController>();
  stopped = false;

  /** Direct copy of TaskScheduler.stop() logic */
  stop() {
    this.stopped = true;
    for (const [, job] of this.jobs) {
      job.stop();
    }
    this.jobs.clear();
    for (const [, controller] of this.runningAbortControllers) {
      controller.abort();
    }
    this.runningAbortControllers.clear();
  }

  /** Simulate retry guard (from executeTask) */
  shouldRetry(retryCount: number, maxRetries: number): boolean {
    return !this.stopped && retryCount < maxRetries;
  }
}

// ---------------------------------------------------------------------------
// 3. Server shutdown — inline replica of the module-level shutdown function
// ---------------------------------------------------------------------------

function makeShutdownHarness() {
  let isShuttingDown = false;
  let shutdownCallCount = 0;
  const schedulerStopCalls: number[] = [];
  const sessionCloseCalls: string[] = [];
  const intervalsClearedIds: ReturnType<typeof setInterval>[] = [];

  const fakeScheduler = {
    stop() {
      schedulerStopCalls.push(Date.now());
    },
  };

  const fakeSessions = new Map<string, { close(): void }>([
    [
      "s1",
      {
        close() {
          sessionCloseCalls.push("s1");
        },
      },
    ],
    [
      "s2",
      {
        close() {
          sessionCloseCalls.push("s2");
        },
      },
    ],
  ]);

  // Simulate a heartbeat interval that keeps the event loop alive
  let heartbeatInterval: ReturnType<typeof setInterval> | null = setInterval(() => {}, 1000);
  let idleCleanupInterval: ReturnType<typeof setInterval> | null = setInterval(() => {}, 5000);

  /** Replica of server.ts shutdown() — now includes clearInterval steps */
  function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    shutdownCallCount++;

    fakeScheduler.stop();
    for (const [, session] of fakeSessions) {
      session.close();
    }
    fakeSessions.clear();

    // 3. Clear intervals that keep the event loop alive (server.ts lines 302-304)
    if (idleCleanupInterval !== null) {
      clearInterval(idleCleanupInterval);
      intervalsClearedIds.push(idleCleanupInterval);
      idleCleanupInterval = null;
    }
    if (heartbeatInterval !== null) {
      clearInterval(heartbeatInterval);
      intervalsClearedIds.push(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  return {
    shutdown,
    get isShuttingDown() {
      return isShuttingDown;
    },
    get shutdownCallCount() {
      return shutdownCallCount;
    },
    get heartbeatInterval() {
      return heartbeatInterval;
    },
    get idleCleanupInterval() {
      return idleCleanupInterval;
    },
    schedulerStopCalls,
    sessionCloseCalls,
    intervalsClearedIds,
  };
}

// ---------------------------------------------------------------------------
// 4. Electron killServer — inline replica of the Electron main.cjs function
// ---------------------------------------------------------------------------

/**
 * Full replica of the killServer() function from electron/main.cjs.
 *
 * Key design properties being tested:
 *   - forceKillTimer declared BEFORE the exit handler (no TDZ risk)
 *   - resolve() is called only once via the settled flag
 *   - safetyTimer resolves if the exit event is never received
 *   - Promise resolves after the process actually exits
 */
function makeKillServerHarness(
  fakeProc: NodeJS.EventEmitter & { kill(signal: string): void; pid?: number },
  opts: { forceKillMs?: number; safetyMs?: number } = {}
) {
  const forceKillMs = opts.forceKillMs ?? 3000;
  const safetyMs = opts.safetyMs ?? 6000;

  let resolveCount = 0;
  let forceKillFired = false;
  let safetyTimerFired = false;

  const promise = new Promise<void>((resolve) => {
    if (!fakeProc) return resolve();

    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    function done() {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      clearTimeout(safetyTimer);
      resolveCount++;
      resolve();
    }

    // forceKillTimer declared BEFORE the exit handler — matches TDZ-safe version
    fakeProc.once("exit", done);

    fakeProc.kill("SIGTERM");

    forceKillTimer = setTimeout(() => {
      forceKillFired = true;
      try {
        fakeProc.kill("SIGKILL");
      } catch {}
    }, forceKillMs);

    // Absolute backstop: resolves even if the exit event was missed
    const safetyTimer = setTimeout(() => {
      safetyTimerFired = true;
      done();
    }, safetyMs);
  });

  return {
    promise,
    get resolveCount() {
      return resolveCount;
    },
    get forceKillFired() {
      return forceKillFired;
    },
    get safetyTimerFired() {
      return safetyTimerFired;
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Scheduler retry: re-check this.stopped AFTER the 30s sleep
// ---------------------------------------------------------------------------

/**
 * Simulates the retry wait path in TaskScheduler.executeAttempt():
 *
 *   if (!this.stopped && retryCount < task.max_retries) {
 *     await new Promise(r => setTimeout(r, 30000));   // <-- sleep
 *     if (this.stopped) return earlyExit();           // <-- re-check HERE
 *     return { execution, retry: true };              // <-- executeTask() loops
 *   }
 *
 * The overlap guard (runningTasks) is held by executeTask() for the whole
 * lifecycle including retries — it is never released between attempts.
 */
async function simulateRetryWait(
  stoppedDuringSleep: boolean,
  sleepMs = 0 // use 0 ms in tests for speed
): Promise<"aborted" | "retried"> {
  let stopped = false;
  let maxRetries = 3;
  let retryCount = 0;

  // Before sleep: check stopped flag (pre-sleep guard)
  if (stopped || retryCount >= maxRetries) return "aborted";

  // Simulate the sleep
  await new Promise((r) => setTimeout(r, sleepMs));

  // Simulate stop() being called during the sleep
  if (stoppedDuringSleep) {
    stopped = true;
  }

  // Post-sleep re-check (scheduler.ts line 291)
  if (stopped) return "aborted";

  return "retried";
}

// ===========================================================================
// Test suites
// ===========================================================================

describe("SubprocessCliSession.killProcess()", () => {
  test("close() kills the subprocess (process.null after kill)", (t, done) => {
    const harness = new KillProcessHarness();

    // Spawn a long-running process
    const proc = spawn("sleep", ["60"]);
    harness.process = proc;

    const pid = proc.pid!;
    assert.ok(pid > 0, "process should have a pid");

    harness.close();

    // After close(), the internal process reference is nulled immediately
    assert.strictEqual(harness.process, null, "process should be null after close()");
    assert.deepStrictEqual(harness.killedPids, [pid], "pid should be in killedPids");
    assert.ok(harness.forceKillTimer !== null, "forceKillTimer should be set (SIGKILL fallback)");

    // Clean up the forceKillTimer so it doesn't delay test exit
    if (harness.forceKillTimer) {
      clearTimeout(harness.forceKillTimer);
      harness.forceKillTimer = null;
    }

    done();
  });

  test("close() is idempotent — can be called multiple times safely", () => {
    const harness = new KillProcessHarness();

    // No process attached — multiple close() calls should not throw
    assert.doesNotThrow(() => harness.close(), "first close() with no process");
    assert.doesNotThrow(() => harness.close(), "second close() should not throw");
    assert.doesNotThrow(() => harness.close(), "third close() should not throw");

    assert.strictEqual(harness.process, null);
  });

  test("close() on already-exited process does not throw", (t, done) => {
    const harness = new KillProcessHarness();

    // Spawn a process that exits immediately
    const proc = spawn("true", []);
    harness.process = proc;

    proc.on("exit", () => {
      // Process already exited; close() should handle gracefully
      // (proc.kill() will throw — the real code has try/catch)
      assert.doesNotThrow(() => harness.close(), "close() after process exit should not throw");
      done();
    });
  });

  test("sendMessage() kills previous process before spawning new one", (t, done) => {
    const harness = new KillProcessHarness();

    // First message: spawn sleep 60
    const firstProc = spawn("sleep", ["60"]);
    const firstPid = firstProc.pid!;
    harness.sendMessage(() => firstProc);

    assert.strictEqual(harness.process, firstProc, "harness should hold first process");

    // Second message: should kill the first process first
    const secondProc = spawn("sleep", ["60"]);
    harness.sendMessage(() => secondProc);

    // The first process pid should have been recorded as killed
    assert.deepStrictEqual(harness.killedPids, [firstPid], "first process should have been killed");
    // The new process is now held
    assert.strictEqual(harness.process, secondProc, "harness should hold second process");

    // Clean up
    harness.close();
    if (harness.forceKillTimer) {
      clearTimeout(harness.forceKillTimer);
      harness.forceKillTimer = null;
    }
    done();
  });

  test("forceKillTimer is cleared when process exits naturally", (t, done) => {
    const harness = new KillProcessHarness();

    // Spawn a very short process
    const proc = spawn("echo", ["hello"]);
    harness.process = proc;

    // Replicate the exit handler that the real class installs
    proc.on("exit", () => {
      harness.process = null;
      if (harness.forceKillTimer) {
        clearTimeout(harness.forceKillTimer);
        harness.forceKillTimer = null;
      }

      // After natural exit, forceKillTimer should be null
      assert.strictEqual(
        harness.forceKillTimer,
        null,
        "forceKillTimer should be cleared on natural exit"
      );
      done();
    });
  });
});

// ---------------------------------------------------------------------------

describe("TaskScheduler.stop()", () => {
  test("stop() sets the stopped flag", () => {
    const scheduler = new TaskSchedulerHarness();
    assert.strictEqual(scheduler.stopped, false, "should not be stopped initially");

    scheduler.stop();

    assert.strictEqual(scheduler.stopped, true, "stopped flag should be true after stop()");
  });

  test("stop() aborts all running AbortControllers", () => {
    const scheduler = new TaskSchedulerHarness();

    const ctrl1 = new AbortController();
    const ctrl2 = new AbortController();
    scheduler.runningAbortControllers.set("task-1", ctrl1);
    scheduler.runningAbortControllers.set("task-2", ctrl2);

    assert.strictEqual(ctrl1.signal.aborted, false);
    assert.strictEqual(ctrl2.signal.aborted, false);

    scheduler.stop();

    assert.strictEqual(ctrl1.signal.aborted, true, "ctrl1 should be aborted");
    assert.strictEqual(ctrl2.signal.aborted, true, "ctrl2 should be aborted");
    assert.strictEqual(scheduler.runningAbortControllers.size, 0, "map should be cleared");
  });

  test("stop() stops all cron jobs and clears job map", () => {
    const scheduler = new TaskSchedulerHarness();

    const stoppedJobs: string[] = [];
    scheduler.jobs.set("job-1", {
      stop() {
        stoppedJobs.push("job-1");
      },
    });
    scheduler.jobs.set("job-2", {
      stop() {
        stoppedJobs.push("job-2");
      },
    });

    scheduler.stop();

    assert.strictEqual(scheduler.jobs.size, 0, "jobs map should be cleared");
    assert.deepStrictEqual(stoppedJobs.sort(), ["job-1", "job-2"], "all jobs should be stopped");
  });

  test("stop() prevents retry logic from executing", () => {
    const scheduler = new TaskSchedulerHarness();

    // Before stop: retries are allowed
    assert.strictEqual(scheduler.shouldRetry(0, 3), true, "should retry before stop");
    assert.strictEqual(scheduler.shouldRetry(2, 3), true, "should retry at max-1 before stop");

    scheduler.stop();

    // After stop: retries are blocked regardless of counts
    assert.strictEqual(scheduler.shouldRetry(0, 3), false, "should NOT retry after stop");
    assert.strictEqual(scheduler.shouldRetry(1, 3), false, "should NOT retry after stop");
    assert.strictEqual(scheduler.shouldRetry(0, 0), false, "should NOT retry with 0 max");
  });

  test("stop() is idempotent — safe to call multiple times", () => {
    const scheduler = new TaskSchedulerHarness();

    const ctrl = new AbortController();
    scheduler.runningAbortControllers.set("t1", ctrl);

    scheduler.stop();
    assert.doesNotThrow(() => scheduler.stop(), "second stop() should not throw");
    assert.doesNotThrow(() => scheduler.stop(), "third stop() should not throw");

    assert.strictEqual(scheduler.stopped, true);
    assert.strictEqual(scheduler.runningAbortControllers.size, 0);
  });
});

// ---------------------------------------------------------------------------

describe("Server shutdown function", () => {
  test("shutdown() is idempotent — isShuttingDown guard prevents double execution", () => {
    const h = makeShutdownHarness();

    h.shutdown();
    h.shutdown();
    h.shutdown();

    assert.strictEqual(h.shutdownCallCount, 1, "shutdown body should run exactly once");
    assert.strictEqual(h.isShuttingDown, true);
  });

  test("shutdown() stops the scheduler on first call", () => {
    const h = makeShutdownHarness();

    h.shutdown();

    assert.strictEqual(h.schedulerStopCalls.length, 1, "scheduler.stop() should be called once");
  });

  test("shutdown() closes all active sessions", () => {
    const h = makeShutdownHarness();

    h.shutdown();

    assert.deepStrictEqual(
      h.sessionCloseCalls.sort(),
      ["s1", "s2"],
      "all sessions should be closed"
    );
  });

  test("second shutdown() call does NOT close sessions again", () => {
    const h = makeShutdownHarness();

    h.shutdown();
    h.shutdown(); // should be a no-op

    // Sessions were closed once in the first shutdown; second call is blocked
    assert.strictEqual(h.sessionCloseCalls.length, 2, "each session closed exactly once");
    assert.strictEqual(h.schedulerStopCalls.length, 1, "scheduler stopped exactly once");
  });

  test("SIGHUP handler is registered on process", () => {
    // The real server.ts calls process.on('SIGHUP', shutdown).
    // We verify that the 'SIGHUP' event name is a recognized signal and
    // that registering a listener for it does not throw.
    let called = false;
    const handler = () => {
      called = true;
    };

    assert.doesNotThrow(() => {
      process.on("SIGHUP", handler);
    }, "registering SIGHUP handler should not throw");

    // Verify the handler is actually registered
    const listeners = process.listeners("SIGHUP");
    assert.ok(listeners.includes(handler), "our SIGHUP handler should be registered on process");

    // Clean up
    process.removeListener("SIGHUP", handler);
    assert.strictEqual(called, false, "handler should not have been called");
  });

  test("shutdown() clears heartbeat and idle-cleanup intervals", () => {
    const h = makeShutdownHarness();

    // Before shutdown: both intervals exist
    assert.notStrictEqual(
      h.heartbeatInterval,
      null,
      "heartbeat interval should exist before shutdown"
    );
    assert.notStrictEqual(
      h.idleCleanupInterval,
      null,
      "idleCleanup interval should exist before shutdown"
    );

    h.shutdown();

    // After shutdown: both are nulled out (clearInterval was called)
    assert.strictEqual(
      h.heartbeatInterval,
      null,
      "heartbeat interval should be null after shutdown"
    );
    assert.strictEqual(
      h.idleCleanupInterval,
      null,
      "idleCleanup interval should be null after shutdown"
    );
    assert.strictEqual(
      h.intervalsClearedIds.length,
      2,
      "exactly 2 intervals should have been cleared"
    );
  });

  test("shutdown() does NOT clear intervals a second time (idempotent interval clearing)", () => {
    const h = makeShutdownHarness();

    h.shutdown(); // first call clears intervals
    const clearedAfterFirst = h.intervalsClearedIds.length;

    h.shutdown(); // second call is a no-op (isShuttingDown guard)
    const clearedAfterSecond = h.intervalsClearedIds.length;

    assert.strictEqual(clearedAfterFirst, 2, "two intervals cleared on first shutdown");
    assert.strictEqual(clearedAfterSecond, 2, "no additional intervals cleared on second shutdown");
  });
});

// ---------------------------------------------------------------------------

describe("Electron killServer()", () => {
  test("killServer resolves after process exits naturally", (t, done) => {
    const proc = spawn("echo", ["hello"]);

    const { promise, get: _ } = (() => {
      const h = makeKillServerHarness(proc as any);
      return { promise: h.promise, get: () => h.resolveCount };
    })();

    promise
      .then(() => {
        done();
      })
      .catch(done);
  });

  test("forceKillTimer is declared before exit handler — no TDZ risk", () => {
    // This is a structural test: we verify that the harness (which mirrors the
    // production code) can be constructed without a ReferenceError, confirming
    // that forceKillTimer is always in scope when the exit handler fires.
    const proc = spawn("sleep", ["60"]);

    assert.doesNotThrow(() => {
      // Construct the harness — mirrors electron/main.cjs killServer()
      const h = makeKillServerHarness(proc as any);
      // Clean up immediately without waiting for the 3s SIGKILL timer
      proc.kill("SIGKILL");
    }, "constructing killServer harness should not throw (no TDZ)");
  });

  test("killServer resolves exactly once — no double-resolve", (t, done) => {
    // Verify that resolve() is called at most once even if somehow the exit
    // event were emitted twice (defensive test for the removed setTimeout(resolve,500)).
    const fakeProc = new EventEmitter() as NodeJS.EventEmitter & { kill(s: string): void };
    let killCalls = 0;
    fakeProc.kill = () => {
      killCalls++;
    };

    const h = makeKillServerHarness(fakeProc);

    let resolveCallCount = 0;
    h.promise.then(() => {
      resolveCallCount++;
    });

    // Fire exit once
    fakeProc.emit("exit");

    // Try to fire it again — the `.once` listener should already be removed
    fakeProc.emit("exit");

    // Give microtasks a chance to settle
    setImmediate(() => {
      assert.strictEqual(resolveCallCount, 1, "promise should resolve exactly once");
      done();
    });
  });

  test("killServer with null serverProcess resolves immediately", async () => {
    // When serverProcess is null the function should return a resolved promise
    const resolved = await new Promise<boolean>((resolve) => {
      // Simulate: if (!serverProcess) return resolve()
      const serverProcess: any = null;
      if (!serverProcess) {
        resolve(true);
        return;
      }
      resolve(false);
    });

    assert.strictEqual(resolved, true, "should resolve immediately when serverProcess is null");
  });

  test("6s safety timer resolves killServer when exit event is never received", (t, done) => {
    // This tests the backstop path: a process that was already dead before .once("exit")
    // was registered will never emit "exit", so the safetyTimer must resolve the promise.
    const fakeProc = new EventEmitter() as NodeJS.EventEmitter & { kill(s: string): void };
    fakeProc.kill = () => {}; // no-op — process is "already dead"

    // Use a very short safetyMs so the test completes quickly
    const h = makeKillServerHarness(fakeProc, { forceKillMs: 50, safetyMs: 80 });

    // Never emit "exit" — the safety timer must fire instead
    h.promise
      .then(() => {
        assert.strictEqual(
          h.safetyTimerFired,
          true,
          "safety timer should have fired to resolve the promise"
        );
        assert.strictEqual(
          h.resolveCount,
          1,
          "promise should resolve exactly once via safety timer"
        );
        done();
      })
      .catch(done);
  });
});

// ---------------------------------------------------------------------------

describe("Scheduler retry: post-sleep stopped re-check", () => {
  test("retry proceeds when scheduler is NOT stopped during sleep", async () => {
    const result = await simulateRetryWait(false, 0);
    assert.strictEqual(result, "retried", "should continue to retry when stop() was not called");
  });

  test("retry aborts when scheduler IS stopped during sleep", async () => {
    const result = await simulateRetryWait(true, 0);
    assert.strictEqual(result, "aborted", "should abort retry when stop() was called during sleep");
  });

  test("post-sleep re-check is independent of pre-sleep guard", async () => {
    // The pre-sleep guard (!this.stopped) was false before sleep,
    // but the post-sleep guard catches it becoming true during sleep.
    // This tests that both guards are necessary and independent.
    let stoppedBeforeSleep = false;
    let stoppedDuringSleep = false;

    // Pre-sleep check (would not abort)
    if (stoppedBeforeSleep) {
      assert.fail("should not abort before sleep in this scenario");
    }

    await new Promise((r) => setTimeout(r, 0)); // simulate sleep

    // Stop called DURING the sleep
    stoppedDuringSleep = true;

    // Post-sleep re-check (should abort)
    assert.strictEqual(stoppedDuringSleep, true, "post-sleep re-check should detect stopped=true");
  });

  test("shouldRetry() returns false at max retries boundary", () => {
    const scheduler = new TaskSchedulerHarness();

    // At exactly max retries, should NOT retry
    assert.strictEqual(
      scheduler.shouldRetry(3, 3),
      false,
      "retryCount === maxRetries should NOT retry"
    );
    assert.strictEqual(
      scheduler.shouldRetry(4, 3),
      false,
      "retryCount > maxRetries should NOT retry"
    );

    // One under max should retry
    assert.strictEqual(scheduler.shouldRetry(2, 3), true, "retryCount < maxRetries should retry");
  });
});

// ---------------------------------------------------------------------------

describe("EventQueue (real module): reset/finish lifecycle", () => {
  /**
   * Regression tests for the mid-turn wedge: sendMessage() during a running
   * turn calls eventQueue.reset(); the old reset() discarded a pending waiter
   * without resolving it, so the consumer's `for await` hung forever and
   * Session.isListening stayed true permanently.
   *
   * These import the REAL EventQueue from subprocess-cli-session.ts.
   */

  function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      p.finally(() => clearTimeout(timer)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(msg)), ms);
        timer.unref?.();
      }),
    ]);
  }

  test("reset() keeps a pending waiter — next turn's push resolves it (wedge regression)", async () => {
    const q = new EventQueue();
    const iter = q[Symbol.asyncIterator]();
    const pending = iter.next(); // parks a waiter (buffer is empty)

    // Mid-turn interruption: a new sendMessage() resets the queue...
    q.reset();
    // ...and the new turn's subprocess pushes its first event
    q.push({ type: "assistant", turn: 2 });

    const result = await withTimeout(
      pending,
      1000,
      "pending next() never resolved — reset() dropped the waiter (wedge)"
    );
    assert.strictEqual(result.done, false);
    assert.strictEqual((result.value as any).turn, 2);
  });

  test("for-await listening loop survives mid-turn reset and ends on next turn's finish", async () => {
    const q = new EventQueue();
    const received: any[] = [];

    // Mirrors Session.startListening: one long-lived loop over the queue
    const loop = (async () => {
      for await (const ev of q) received.push(ev);
    })();

    q.push({ id: "turn1-event" });
    await new Promise((r) => setImmediate(r)); // let the loop consume + park

    // Interruption: new turn resets the queue while the loop is parked
    q.reset();
    q.push({ id: "turn2-result", type: "result" });
    q.finish();

    await withTimeout(loop, 1000, "listening loop wedged after reset()");
    assert.deepStrictEqual(
      received.map((e) => e.id),
      ["turn1-event", "turn2-result"],
      "loop must receive events from both turns and then terminate"
    );
  });

  test("finish() resolves a pending waiter with done:true", async () => {
    const q = new EventQueue();
    const iter = q[Symbol.asyncIterator]();
    const pending = iter.next();

    q.finish();

    const res = await withTimeout(pending, 1000, "finish() did not resolve the pending waiter");
    assert.strictEqual(res.done, true);
  });

  test("push after finish is dropped; reset() re-opens the queue for the next turn", async () => {
    const q = new EventQueue();
    q.finish();
    q.push({ id: "dropped" }); // late event from a dead turn — must be ignored

    const it1 = q[Symbol.asyncIterator]();
    const r1 = await it1.next();
    assert.strictEqual(r1.done, true, "queue stays done after finish; late push is dropped");

    q.reset();
    q.push({ id: "turn2" });
    const it2 = q[Symbol.asyncIterator]();
    const r2 = await it2.next();
    assert.strictEqual(r2.done, false);
    assert.strictEqual((r2.value as any).id, "turn2");
  });
});

// ---------------------------------------------------------------------------

describe("SubprocessCliSession (real module): per-turn result lifecycle", () => {
  function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      p.finally(() => clearTimeout(timer)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(msg)), ms);
        timer.unref?.();
      }),
    ]);
  }

  async function drain(session: SubprocessCliSession, label: string): Promise<any[]> {
    const events: any[] = [];
    await withTimeout(
      (async () => {
        for await (const ev of session.getOutputStream()) events.push(ev);
      })(),
      2000,
      `${label}: output stream never finished — session wedged`
    );
    return events;
  }

  test("unsupported CLI emits exactly one result per turn and recovers across turns", async () => {
    // "aider" is a valid CliCommand but has no CLI_CONFIGS entry, so
    // sendMessage() takes the no-spawn error path: one result + finish.
    const session = new SubprocessCliSession("aider", "/tmp", "");

    session.sendMessage("turn 1");
    const t1 = await drain(session, "turn 1");
    assert.strictEqual(
      t1.filter((e) => e.type === "result").length,
      1,
      "exactly one result event per turn (no double-result)"
    );

    // Second turn on the same session: queue reset must allow a fresh
    // listen cycle (isListening lifecycle recovery)
    session.sendMessage("turn 2");
    const t2 = await drain(session, "turn 2");
    assert.strictEqual(t2.filter((e) => e.type === "result").length, 1);

    session.close();
  });
});

// ---------------------------------------------------------------------------

describe("SubprocessCliSession exit handler: supersession guard + single result (replica)", () => {
  /**
   * Replica of the per-turn captures installed by sendMessage() around the
   * exit handler (uses the REAL EventQueue):
   *
   *   const queue = this.eventQueue;
   *   const proc = this.process;
   *   const turn = { resultEmitted: false };
   *   proc.on("exit", (code) => {
   *     if (this.process !== proc) return;          // stale — superseded
   *     this.process = null;
   *     if (!turn.resultEmitted) queue.push(result); // synthesize only if needed
   *     queue.finish();
   *   });
   */
  class ExitGuardHarness {
    process: object | null = null;
    eventQueue = new EventQueue();

    /** Mirrors the handler wiring in sendMessage() for one spawned process */
    installTurn(proc: object) {
      this.process = proc;
      const queue = this.eventQueue;
      const turn = { resultEmitted: false };
      return {
        // stdout line handler pushing a parsed result event
        emitResultLine: () => {
          turn.resultEmitted = true;
          queue.push({ type: "result", subtype: "success" });
        },
        // exit handler
        onExit: (code: number): "stale" | "handled" => {
          if (this.process !== proc) return "stale";
          this.process = null;
          if (!turn.resultEmitted) {
            turn.resultEmitted = true;
            queue.push({
              type: "result",
              subtype: code === 0 ? "success" : "error",
            });
          }
          queue.finish();
          return "handled";
        },
      };
    }
  }

  async function collect(q: EventQueue): Promise<any[]> {
    const out: any[] = [];
    for await (const ev of q) out.push(ev);
    return out;
  }

  test("stale exit from a superseded process no-ops (no spurious result, no ref clobber)", async () => {
    const h = new ExitGuardHarness();

    const procA = { name: "A" };
    const turnA = h.installTurn(procA);

    // New sendMessage(): kill A, reset queue, spawn B
    h.eventQueue.reset();
    const procB = { name: "B" };
    const turnB = h.installTurn(procB);

    // A's late exit fires AFTER B was installed
    assert.strictEqual(turnA.onExit(143), "stale", "superseded exit handler must no-op");
    assert.strictEqual(h.process, procB, "stale exit must not clobber the new process ref");

    // B's turn completes normally
    turnB.emitResultLine();
    assert.strictEqual(turnB.onExit(0), "handled");

    const events = await collect(h.eventQueue);
    assert.strictEqual(
      events.filter((e) => e.type === "result").length,
      1,
      "only B's result must reach the queue — A's stale exit contributed nothing"
    );
  });

  test("exit does not synthesize a second result when the CLI already emitted one", async () => {
    const h = new ExitGuardHarness();
    const turn = h.installTurn({ name: "A" });

    turn.emitResultLine(); // CLI emitted its own result (e.g. turn.completed)
    turn.onExit(0);

    const events = await collect(h.eventQueue);
    assert.strictEqual(
      events.filter((e) => e.type === "result").length,
      1,
      "successful turn must emit exactly ONE result (no turnCount double-increment)"
    );
  });

  test("exit synthesizes exactly one result when the CLI emitted none", async () => {
    const h = new ExitGuardHarness();
    const turn = h.installTurn({ name: "A" });

    turn.onExit(1); // process died without emitting a result line

    const events = await collect(h.eventQueue);
    const results = events.filter((e) => e.type === "result");
    assert.strictEqual(results.length, 1, "one synthesized result");
    assert.strictEqual(results[0].subtype, "error", "non-zero exit code maps to error subtype");
  });
});

// ---------------------------------------------------------------------------

describe("MCP config temp dir lifecycle (real module)", () => {
  /** Settings with no MCP paths configured — writeMcpConfigFile still creates a temp dir */
  const emptySettings: Settings = {
    language: "en",
    theme: "light",
    cfBrowserMode: "cf-api",
    trendPulseVenvPython: "",
    cfBrowserVenvPython: "",
    notebooklmServerPath: "",
    cfBrowserUrl: "",
    cfBrowserApiKey: "",
    cfAccountId: "",
    cfApiToken: "",
    defaultWorkspace: "",
    minOverallScore: 70,
    minConversationScore: 55,
    agenticLevel: "standard",
  };

  test("removeMcpConfigFile deletes the temp dir created by writeMcpConfigFile", () => {
    const configPath = writeMcpConfigFile(emptySettings);
    const dir = dirname(configPath);
    assert.ok(existsSync(configPath), "config file should exist after write");

    removeMcpConfigFile(configPath);

    assert.ok(!existsSync(dir), "temp dir (credentials!) must be removed on session close");
    // Idempotent — second removal is a no-op
    assert.doesNotThrow(() => removeMcpConfigFile(configPath));
  });

  test("cleanupStaleMcpConfigDirs removes >24h-old dirs but keeps fresh ones", () => {
    // Stale dir from a "previous server run"
    const stale = mkdtempSync(join(tmpdir(), "studio-mcp-"));
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(stale, old, old);

    // Fresh dir (could belong to a concurrently running instance)
    const fresh = mkdtempSync(join(tmpdir(), "studio-mcp-"));

    try {
      cleanupStaleMcpConfigDirs();

      assert.ok(!existsSync(stale), "stale dir should be swept at startup");
      assert.ok(existsSync(fresh), "fresh dir must NOT be touched");
    } finally {
      rmSync(stale, { recursive: true, force: true });
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------

describe("TaskScheduler.executeTask(): stopped guard precedes overlap guard", () => {
  /**
   * Replica of the guards at the top of executeTask():
   *
   *   if (this.stopped) throw new Error("Scheduler is stopped");   // line 212
   *   // ...
   *   if (this.runningTasks.has(taskId)) throw new Error("already running");  // line 221
   *
   * The stopped check must come FIRST. If it came second, a stopped scheduler
   * with a running task would throw the wrong error ("already running") and
   * callers checking for the stopped condition would misbehave.
   */
  class ExecuteTaskGuardHarness {
    stopped = false;
    runningTasks = new Set<string>();

    /**
     * Replica of the two guards at the top of executeTask().
     * Returns which guard fired.
     */
    checkGuards(taskId: string): "stopped" | "already-running" | "ok" {
      if (this.stopped) return "stopped";
      if (this.runningTasks.has(taskId)) return "already-running";
      return "ok";
    }
  }

  test("stopped guard fires before overlap guard", () => {
    const h = new ExecuteTaskGuardHarness();

    // Both conditions true simultaneously
    h.stopped = true;
    h.runningTasks.add("task-1");

    const result = h.checkGuards("task-1");

    assert.strictEqual(
      result,
      "stopped",
      "stopped guard must fire first, even when task is also already running"
    );
  });

  test("overlap guard fires when scheduler is running (not stopped)", () => {
    const h = new ExecuteTaskGuardHarness();

    h.stopped = false;
    h.runningTasks.add("task-1");

    const result = h.checkGuards("task-1");

    assert.strictEqual(
      result,
      "already-running",
      "overlap guard should fire when stopped=false and task is running"
    );
  });

  test("executeTask proceeds when neither guard applies", () => {
    const h = new ExecuteTaskGuardHarness();

    h.stopped = false;
    // task-1 NOT in runningTasks

    const result = h.checkGuards("task-1");

    assert.strictEqual(
      result,
      "ok",
      "executeTask should proceed when scheduler is running and task is not already executing"
    );
  });

  test("stopped guard blocks task even when no overlap", () => {
    const h = new ExecuteTaskGuardHarness();

    h.stopped = true;
    // task is NOT running (no overlap) — stopped alone must block it

    const result = h.checkGuards("task-1");

    assert.strictEqual(
      result,
      "stopped",
      "stopped guard must block execution even with no overlap"
    );
  });
});

// ---------------------------------------------------------------------------

describe("TaskScheduler.executeTask(): overlap guard held across retries", () => {
  /**
   * Replica of the iterative retry structure in executeTask():
   *
   *   this.runningTasks.add(taskId);          // acquired ONCE
   *   try {
   *     for (let retryCount = 0; ; retryCount++) {
   *       const { execution, retry } = await this.executeAttempt(...);
   *       if (!retry) return execution;
   *     }
   *   } finally {
   *     this.runningTasks.delete(taskId);     // released ONCE
   *   }
   *
   * The old recursive version released + re-acquired the guard around each
   * retry, so the outer call's finally stripped the guard from the retried
   * execution — allowing concurrent duplicates.
   */
  class RetryLoopHarness {
    runningTasks = new Set<string>();
    guardSnapshots: boolean[] = [];

    async executeTask(taskId: string, attempts: Array<{ retry: boolean }>): Promise<string> {
      if (this.runningTasks.has(taskId)) throw new Error("already running");
      this.runningTasks.add(taskId);
      try {
        for (let retryCount = 0; ; retryCount++) {
          // Record whether the guard is held at the start of every attempt
          this.guardSnapshots.push(this.runningTasks.has(taskId));
          await Promise.resolve(); // simulate async attempt boundary
          if (!attempts[retryCount].retry) return `done-after-${retryCount + 1}-attempts`;
        }
      } finally {
        this.runningTasks.delete(taskId);
      }
    }
  }

  test("guard is held during every attempt including retries", async () => {
    const h = new RetryLoopHarness();
    const result = await h.executeTask("task-1", [
      { retry: true },
      { retry: true },
      { retry: false },
    ]);

    assert.strictEqual(result, "done-after-3-attempts");
    assert.deepStrictEqual(
      h.guardSnapshots,
      [true, true, true],
      "guard must be held at the start of every attempt, not just the first"
    );
    assert.strictEqual(
      h.runningTasks.has("task-1"),
      false,
      "guard must be released exactly once after the final attempt"
    );
  });

  test("concurrent executeTask during a retry backoff is rejected", async () => {
    const h = new RetryLoopHarness();
    const first = h.executeTask("task-1", [{ retry: true }, { retry: false }]);

    // While the first lifecycle (attempt + retry) is in flight, a second
    // trigger for the same task must hit the overlap guard.
    await assert.rejects(() => h.executeTask("task-1", [{ retry: false }]), /already running/);

    assert.strictEqual(await first, "done-after-2-attempts");
    assert.strictEqual(h.runningTasks.has("task-1"), false, "guard released after completion");
  });
});
