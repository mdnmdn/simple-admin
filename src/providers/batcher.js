// Per-microtask getMany id batcher (architecture §4.3) — reproduces react-admin's N+1
// avoidance without react-query. Reference fields register the ids they need into a bucket
// keyed by `reference`; at end-of-tick one dataProvider.getMany(reference, { ids: dedupe }) runs
// and each caller resolves with the records matching the ids it asked for (order preserved).

export const createGetManyBatcher = (dataProvider) => {
  const buckets = new Map(); // reference -> { ids: Set, waiters: [{ ids, resolve, reject }] }
  let scheduled = false;

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  };

  const flush = () => {
    scheduled = false;
    const pending = [...buckets.entries()];
    buckets.clear();

    for (const [reference, bucket] of pending) {
      const ids = [...bucket.ids];
      Promise.resolve()
        .then(() => dataProvider.getMany(reference, { ids }))
        .then((result) => {
          const byId = new Map(
            (result.data || []).map((record) => [String(record.id), record])
          );
          for (const waiter of bucket.waiters) {
            waiter.resolve(
              waiter.ids
                .map((id) => byId.get(String(id)))
                .filter((record) => record !== undefined)
            );
          }
        })
        .catch((err) => {
          for (const waiter of bucket.waiters) waiter.reject(err);
        });
    }
  };

  // Request records by id for a reference. Returns Promise<Record[]>.
  const getMany = (reference, ids = []) =>
    new Promise((resolve, reject) => {
      let bucket = buckets.get(reference);
      if (!bucket) {
        bucket = { ids: new Set(), waiters: [] };
        buckets.set(reference, bucket);
      }
      for (const id of ids) bucket.ids.add(id);
      bucket.waiters.push({ ids: [...ids], resolve, reject });
      schedule();
    });

  return { getMany };
};

export default createGetManyBatcher;
