// Minimal fine-grained reactivity: signal / computed / effect (architecture §4.1).
//
// - Automatic dependency tracking via a current-effect stack.
// - Each signal owns a Set of subscriber effects.
// - Notifications are microtask-batched: many .set()s in one tick => one flush.

let currentEffect = null;
const effectStack = [];

let pending = new Set();
let flushScheduled = false;

const scheduleFlush = () => {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
};

const flush = () => {
  flushScheduled = false;
  const toRun = pending;
  pending = new Set();
  for (const runner of toRun) runner._run();
};

const unlink = (runner) => {
  for (const subscribers of runner._deps) subscribers.delete(runner);
  runner._deps.clear();
};

export const signal = (initial) => {
  let value = initial;
  const subscribers = new Set();

  const self = {
    get() {
      if (currentEffect) {
        subscribers.add(currentEffect);
        currentEffect._deps.add(subscribers);
      }
      return value;
    },
    // Read without establishing a dependency.
    peek() {
      return value;
    },
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const runner of subscribers) pending.add(runner);
      scheduleFlush();
    },
    update(fn) {
      self.set(fn(value));
    },
  };
  return self;
};

export const effect = (fn) => {
  const runner = {
    _deps: new Set(),
    _active: true,
    _run() {
      if (!this._active) return;
      unlink(this);
      currentEffect = this;
      effectStack.push(this);
      try {
        fn();
      } finally {
        effectStack.pop();
        currentEffect = effectStack.length ? effectStack[effectStack.length - 1] : null;
      }
    },
  };
  runner._run();
  // Returns a teardown that unsubscribes the effect (no leaks).
  return () => {
    if (!runner._active) return;
    runner._active = false;
    unlink(runner);
    pending.delete(runner);
  };
};

// Run `fn` with dependency tracking suspended: signal reads inside it subscribe NOTHING, even
// when called from inside a running effect. Effects *created* inside `fn` still track their own
// dependencies normally (each effect's _run manages currentEffect itself) — only reads belonging
// to `fn`'s own synchronous body are untracked.
//
// Why this exists: a coarse orchestration effect (e.g. <sa-admin>'s route effect) may
// synchronously call into arbitrary component code — connectedCallbacks, renderControl(), form
// wiring — that legitimately reads signals for one-shot setup. Without masking, every such read
// subscribes the ORCHESTRATION effect, so a later write to any of those signals re-runs the whole
// orchestration (in the route effect's case: a full view remount, which re-writes the same
// signals — an infinite remount loop that froze the page; see verification-plan.md).
// The effect stack must be masked too, not just currentEffect: a nested effect() created inside
// `fn` restores currentEffect from the stack when it finishes, which would resurrect the outer
// effect mid-untracked-window.
export const untracked = (fn) => {
  const prevEffect = currentEffect;
  const prevStack = effectStack.splice(0, effectStack.length);
  currentEffect = null;
  try {
    return fn();
  } finally {
    effectStack.push(...prevStack);
    currentEffect = prevEffect;
  }
};

export const computed = (fn) => {
  const cell = signal(undefined);
  effect(() => {
    cell.set(fn());
  });
  return {
    get: () => cell.get(),
    peek: () => cell.peek(),
  };
};
