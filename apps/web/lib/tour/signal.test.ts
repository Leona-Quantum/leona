import assert from "node:assert/strict";
import test from "node:test";

import {
  TOUR_SIGNAL_EVENT,
  TOUR_SIGNAL_NO_STEP,
  tourSignal,
  type TourSignal,
} from "./signal.ts";

type FakeNavigator = {
  doNotTrack?: string;
  globalPrivacyControl?: boolean;
  sendBeacon?: (url: string, data: string) => boolean;
};

/**
 * Installs the minimum `window`/`navigator` shape `signal.ts` reads, the same
 * pattern `chat-history.test.ts`'s `withStorage` uses. Returns the events
 * `window.dispatchEvent` recorded and the beacon/fetch calls observed, so a
 * test can assert on both halves of `tourSignal` at once.
 */
function withBrowser(navigatorOverrides: FakeNavigator = {}) {
  const dispatched: TourSignal[] = [];
  const beaconCalls: Array<{ url: string; data: string }> = [];
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];

  (globalThis as { window?: unknown }).window = {
    dispatchEvent(event: CustomEvent<TourSignal>) {
      dispatched.push(event.detail);
    },
  };
  // Node (v21+) defines `globalThis.navigator` itself as a non-configurable-
  // by-assignment getter, so `globalThis.navigator = ...` throws. `defineProperty`
  // with `configurable: true` both overrides it here and lets `reset()` remove
  // the override cleanly afterwards.
  Object.defineProperty(globalThis, "navigator", {
    value: {
      sendBeacon(url: string, data: string) {
        beaconCalls.push({ url, data });
        return true;
      },
      ...navigatorOverrides,
    },
    configurable: true,
    writable: true,
  });
  (globalThis as { fetch?: unknown }).fetch = (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init });
    return Promise.resolve(new Response(null, { status: 204 }));
  };

  return { dispatched, beaconCalls, fetchCalls };
}

const REAL_NAVIGATOR = globalThis.navigator;

function reset() {
  delete (globalThis as { window?: unknown }).window;
  Object.defineProperty(globalThis, "navigator", {
    value: REAL_NAVIGATOR,
    configurable: true,
    writable: true,
  });
  delete (globalThis as { fetch?: unknown }).fetch;
}

test("a step-level signal dispatches the local event and beacons track/step/kind", () => {
  const { dispatched, beaconCalls } = withBrowser();
  try {
    tourSignal({ event: "step_done", tour: "build", step: "code" });

    assert.equal(dispatched.length, 1);
    assert.deepEqual(dispatched[0], { event: "step_done", tour: "build", step: "code" });

    assert.equal(beaconCalls.length, 1);
    assert.match(beaconCalls[0]!.url, /\/v1\/tour-signals$/);
    assert.deepEqual(JSON.parse(beaconCalls[0]!.data), {
      track: "build",
      step: "code",
      kind: "step_done",
    });
  } finally {
    reset();
  }
});

test("a track-level signal with no step sends the NO_STEP sentinel, never undefined", () => {
  const { beaconCalls } = withBrowser();
  try {
    tourSignal({ event: "tour_started", tour: "build" });

    assert.equal(beaconCalls.length, 1);
    const body = JSON.parse(beaconCalls[0]!.data) as { step: string };
    assert.equal(body.step, TOUR_SIGNAL_NO_STEP);
    assert.notEqual(body.step, undefined);
  } finally {
    reset();
  }
});

test("Do Not Track suppresses the network send but not the local event", () => {
  const { dispatched, beaconCalls } = withBrowser({ doNotTrack: "1" });
  try {
    tourSignal({ event: "step_done", tour: "build", step: "code" });

    assert.equal(dispatched.length, 1, "the local event still fires — nothing about it leaves the browser");
    assert.equal(beaconCalls.length, 0);
  } finally {
    reset();
  }
});

test("Global Privacy Control suppresses the network send", () => {
  const { beaconCalls } = withBrowser({ globalPrivacyControl: true });
  try {
    tourSignal({ event: "step_done", tour: "build", step: "code" });
    assert.equal(beaconCalls.length, 0);
  } finally {
    reset();
  }
});

test("falls back to fetch(keepalive) when sendBeacon does not exist", () => {
  const { fetchCalls, beaconCalls } = withBrowser({ sendBeacon: undefined });
  try {
    tourSignal({ event: "step_done", tour: "build", step: "code" });

    assert.equal(beaconCalls.length, 0);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]!.init.method, "POST");
    assert.equal(fetchCalls[0]!.init.keepalive, true);
    assert.deepEqual(JSON.parse(fetchCalls[0]!.init.body as string), {
      track: "build",
      step: "code",
      kind: "step_done",
    });
  } finally {
    reset();
  }
});

test("a throwing sendBeacon never escapes tourSignal", () => {
  const { dispatched } = withBrowser({
    sendBeacon: () => {
      throw new Error("boom");
    },
  });
  try {
    assert.doesNotThrow(() => tourSignal({ event: "step_done", tour: "build", step: "code" }));
    // The local event fired before the network call, so it is unaffected by
    // the network path throwing.
    assert.equal(dispatched.length, 1);
  } finally {
    reset();
  }
});

test("no window at all (SSR) is a no-op, not a throw", () => {
  reset();
  assert.doesNotThrow(() => tourSignal({ event: "step_done", tour: "build", step: "code" }));
});

test("TOUR_SIGNAL_EVENT is the event name signal.ts's own doc comment promises", () => {
  assert.equal(TOUR_SIGNAL_EVENT, "leona:tour-signal");
});
