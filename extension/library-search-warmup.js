// Prepare lazy search rows between interactions. A query can still read any unprepared row
// synchronously; this job never determines whether a result is available.
export function createSearchIndexWarmup({ requestIdle, cancelIdle, now, sliceMs }) {
  let scheduled = null;
  let rows = null;
  const cancel = () => {
    if (scheduled !== null) cancelIdle(scheduled);
    scheduled = null;
    rows = null;
  };
  const schedule = () => {
    if (!requestIdle || scheduled !== null || !rows) return;
    scheduled = requestIdle(() => {
      scheduled = null;
      const end = now() + sliceMs;
      while (now() < end) {
        const next = rows.next();
        if (next.done) { rows = null; return; }
        void next.value.fullText;
      }
      schedule();
    });
  };
  return {
    start(values) { cancel(); rows = values[Symbol.iterator](); schedule(); },
    cancel
  };
}
