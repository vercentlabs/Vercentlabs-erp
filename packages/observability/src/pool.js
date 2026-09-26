// Connection-pool visibility for pg pools (web and worker): a `db.pool`
// event every interval with in-use/idle/waiting counts (pool saturation is
// waiting > 0), and `db.pool.error` for idle-client errors. Duck-typed on
// pg.Pool's totalCount/idleCount/waitingCount; the timer never keeps the
// process alive.
export function monitorPool(pool, logger, { name = "default", maximum = null, intervalMilliseconds = 60_000 } = {}) {
  const snapshot = () => ({
    pool: name,
    total: pool.totalCount,
    idle: pool.idleCount,
    inUse: Math.max(0, pool.totalCount - pool.idleCount),
    waiting: pool.waitingCount,
    ...(maximum ? { maximum } : {}),
  });
  pool.on?.("error", (error) => logger.event("db.pool.error", { pool: name, error: String(error?.message || error) }, "error"));
  const timer = setInterval(() => {
    const state = snapshot();
    logger.event("db.pool", state, state.waiting > 0 ? "warn" : "debug");
  }, intervalMilliseconds);
  timer.unref?.();
  return Object.freeze({ snapshot, stop: () => clearInterval(timer) });
}
