import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import type {
  CapacitySnapshot,
  SourceSelection,
  TomatoConnectionSnapshot,
  ZCodeQuotaSnapshot,
} from "./capacityTypes";
import { overlayLayoutSizes, type OverlayLayout } from "./windowClient";

const visualFixture: CapacitySnapshot = {
  sourceState: "healthy",
  planType: null,
  accountId: null,
  fiveHour: {
    usedPercent: 82,
    remainingPercent: 18,
    windowDurationMins: 300,
    resetsAt: 1_800_000_000,
  },
  weekly: {
    usedPercent: 5,
    remainingPercent: 95,
    windowDurationMins: 10_080,
    resetsAt: 1_800_172_800,
  },
  fullResetCredits: { availableCount: 2, nearestExpiryAt: 1_800_432_000 },
  observedAtMs: Date.now(),
};

const visualZcodeFixture: ZCodeQuotaSnapshot = {
  sourceState: "healthy",
  fiveHour: {
    usedPercent: 24,
    remainingPercent: 76,
    windowDurationMins: 300,
    resetsAt: 1_787_810_092,
    quotaTotal: 2000,
    quotaUsed: 480,
    quotaRemaining: 1520,
  },
  weekly: {
    usedPercent: 58,
    remainingPercent: 42,
    windowDurationMins: 10_080,
    resetsAt: 1_788_395_128,
    quotaTotal: 10000,
    quotaUsed: 5800,
    quotaRemaining: 4200,
  },
  planLevel: "pro",
  planKind: "coding_plan",
  observedAtMs: Date.now(),
};

const visualZcodeTrialFixture: ZCodeQuotaSnapshot = {
  sourceState: "healthy",
  fiveHour: {
    usedPercent: 35,
    remainingPercent: 65,
    windowDurationMins: 0,
    resetsAt: 1_789_600_000,
    quotaTotal: 1500,
    quotaUsed: 525,
    quotaRemaining: 975,
  },
  weekly: null,
  planLevel: "Start",
  planKind: "start_plan",
  observedAtMs: Date.now(),
};

const visualHealthyRoute: TomatoConnectionSnapshot = {
  state: "healthy",
  countryCode: "UK",
  latencyMs: 42,
  observedAtMs: Date.now(),
  diagnostic: null,
};

const visualBlockedRoute: TomatoConnectionSnapshot = {
  state: "blocked",
  countryCode: null,
  latencyMs: null,
  observedAtMs: Date.now(),
  diagnostic: {
    code: "CRV-404",
    message: "TomatoCloud route is unavailable",
    detail: null,
  },
};

const visualFixtureNames = new Set([
  "v4",
  "v7-healthy",
  "v7-loading",
  "v7-failed",
  "v7-expanded",
  "v7-collapsed",
  "v7-route-blocked",
  "zcode-healthy",
  "zcode-trial",
  "zcode-failed",
  "zcode-carousel",
]);

function resolveFixtureLayout(
  fixtureName: string | null,
  requestedLayout: string | null,
): OverlayLayout {
  if (fixtureName === "v7-expanded") return "expanded";
  if (fixtureName === "v7-collapsed") return "collapsed";
  if (requestedLayout === "expanded" || requestedLayout === "collapsed") return requestedLayout;
  return "compact";
}

function resolveFixtureSource(fixtureName: string | null): SourceSelection {
  if (fixtureName === "zcode-carousel") return "carousel";
  if (fixtureName?.startsWith("zcode")) return "zcode";
  return "codex";
}

function createFixtureLoader(fixtureName: string | null) {
  if (fixtureName === "v7-loading") {
    return () => new Promise<CapacitySnapshot>(() => undefined);
  }
  if (fixtureName === "v7-failed") {
    return async (): Promise<CapacitySnapshot> => {
      throw { code: "CRV-201", message: "无法读取 Codex 配额", detail: null };
    };
  }
  return async () => visualFixture;
}

function createZcodeFixtureLoader(fixtureName: string | null) {
  if (fixtureName === "zcode-failed") {
    return async (): Promise<ZCodeQuotaSnapshot> => {
      throw { code: "CRV-502", message: "无法读取 ZCode 配额", detail: null };
    };
  }
  if (fixtureName === "zcode-trial") {
    return async () => visualZcodeTrialFixture;
  }
  return async () => visualZcodeFixture;
}

const query = new URLSearchParams(window.location.search);
const fixtureName = import.meta.env.DEV ? query.get("fixture") : null;
const requestedLayout = query.get("layout");
const fixtureLayout = resolveFixtureLayout(fixtureName, requestedLayout);
const fixtureEnabled = fixtureName !== null && visualFixtureNames.has(fixtureName);

const fixtureProps: React.ComponentProps<typeof App> = fixtureEnabled
  ? {
      initialLayout: fixtureLayout,
      loadSnapshot: createFixtureLoader(fixtureName),
      loadZcodeSnapshot: createZcodeFixtureLoader(fixtureName),
      loadTomatoConnection: async () =>
        fixtureName === "v7-route-blocked" ? visualBlockedRoute : visualHealthyRoute,
      loadPreferences: async () => ({
        opacity: 0.92,
        reducedMotion: false,
        x: null,
        y: null,
        source: resolveFixtureSource(fixtureName),
      }),
      savePreferences: async () => undefined,
      enableClickThrough: async () => undefined,
      setWindowLayout: async () => undefined,
      // 设置面板桩：浏览器里没有 tauri invoke，让 ?fixture= 页面能截图设置状态
      openSettingsWindow: async () => ({
        baseLayout: fixtureLayout,
        placement: "above" as const,
        windowPosition: { x: 0, y: 0 },
        windowSize: { width: overlayLayoutSizes[fixtureLayout].width, height: 360 },
        restore: { layout: fixtureLayout, position: { x: 0, y: 0 } },
      }),
      closeSettingsWindow: async () => undefined,
      getWindowPosition: async () => ({ x: 0, y: 0 }),
      setWindowPosition: async () => undefined,
    }
  : {};

const rootElement = document.getElementById("root") as HTMLElement;
if (fixtureEnabled) {
  const fixtureSize = overlayLayoutSizes[fixtureLayout];
  rootElement.style.width = `${fixtureSize.width}px`;
  rootElement.style.height = `${fixtureSize.height}px`;
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App {...fixtureProps} />
  </React.StrictMode>,
);
