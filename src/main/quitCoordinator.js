'use strict';

// Ordered application shutdown for quit.
//
// Problem it solves: `before-quit` handlers cannot await arbitrarily long
// work, but tool-run history must be given a bounded opportunity to settle
// BEFORE the database closes. Firing a fire-and-forget drain and closing the
// database on the next line lets completions race the close: persistence is
// attempted against a closing database and the history rows are lost.
//
// Protocol:
//   phase 0 (running): first quit request holds quit open (preventDefault),
//     marks draining, and runs the ordered sequence:
//     stop sync services -> bounded tool drain -> close database -> re-quit.
//   phase 1 (draining): re-entrant quit requests are held but start no
//     duplicate shutdown; the in-flight sequence re-issues quit when done.
//   phase 2 (done): quit proceeds; the database close is applied exactly
//     once even if reached from several paths.
//
// All injected phases are individually guarded so a throwing step can never
// strand the app in the held-quit state, and the drain itself is bounded so
// shutdown can never hang: worst case the timeout wins and quit completes.

// Synchronous lifecycle teardown shared by production shutdown: security
// background producers first (watcher/monitor stops, native child abort),
// then the pre-existing teardown order, unchanged. Every step is
// best-effort in isolation so one throwing service can never skip the
// remaining stops or strand database close. Never closes the database
// itself; closeDatabase stays owned by the coordinator sequence.
function stopLifecycleServices(refs = {}, clearTimer = clearInterval) {
  const safe = (fn) => {
    try {
      const result = fn();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {}
  };
  safe(() => refs.folderWatcher?.stop());
  safe(() => refs.networkAlertMonitor?.stop());
  safe(() => refs.clamEngine?.abortCurrentScan());
  safe(() => refs.maintenanceScheduler?.stop());
  safe(() => refs.maintenanceSafetyVault?.stop());
  safe(() => refs.persistenceMonitor?.stop());
  safe(() => refs.extensionBridge?.stop());
  safe(() => refs.removableDriveCoordinator?.dispose());
  safe(() => refs.processService?.stop());
  safe(() => refs.trayController?.dispose());
  safe(() => { if (refs.networkStatsTimer) clearTimer(refs.networkStatsTimer); });
  safe(() => { if (refs.pruneTimer) clearTimer(refs.pruneTimer); });
}

function createQuitCoordinator({ app, stopSyncServices, drainToolRuns, closeDatabase, drainTimeoutMs = 5000 }) {
  if (!app || typeof app.quit !== 'function') throw new Error('A quit coordinator requires an app with quit().');
  let phase = 0;
  let dbClosed = false;

  function closeOnce() {
    if (dbClosed) return;
    dbClosed = true;
    try {
      closeDatabase();
    } catch (_) {}
  }

  function holdQuit(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
  }

  async function runOrderedShutdown() {
    try {
      stopSyncServices();
    } catch (_) {}
    const ms = Number.isFinite(Number(drainTimeoutMs)) && Number(drainTimeoutMs) > 0
      ? Number(drainTimeoutMs)
      : 5000;
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => drainToolRuns(ms)),
        new Promise((resolve) => { timer = setTimeout(resolve, ms); }),
      ]);
    } catch (_) {
      // Drain failures must not strand shutdown; teardown continues below.
    } finally {
      if (timer && typeof timer.unref === 'function') timer.unref();
      clearTimeout(timer);
    }
    closeOnce();
    phase = 2;
    try {
      app.quit();
    } catch (_) {}
  }

  function handleBeforeQuit(event) {
    if (phase === 0) {
      phase = 1;
      holdQuit(event);
      void runOrderedShutdown();
      return { held: true, phase };
    }
    if (phase === 1) {
      holdQuit(event);
      return { held: true, phase };
    }
    closeOnce();
    return { held: false, phase };
  }

  function getPhase() {
    return phase;
  }

  return { handleBeforeQuit, getPhase };
}

module.exports = { createQuitCoordinator, stopLifecycleServices };
