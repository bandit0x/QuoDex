import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App, applyRouteGate } from "./App";
import type {
  CapacitySnapshot,
  DisplayPreferences,
  TomatoConnectionSnapshot,
  ZCodeQuotaSnapshot,
} from "./capacityTypes";

const inertPreferences = {
  loadPreferences: async () => ({ opacity: 0.92, reducedMotion: false, x: null, y: null }),
  savePreferences: async () => undefined,
  enableClickThrough: async () => undefined,
  setWindowLayout: async () => undefined,
  openSettingsWindow: async () => ({
    baseLayout: "compact" as const,
    placement: "above" as const,
    windowPosition: { x: 0, y: 0 },
    windowSize: { width: 300, height: 278 },
    restore: { layout: "compact" as const, position: { x: 0, y: 148 } },
  }),
  closeSettingsWindow: async () => undefined,
  loadTomatoConnection: async (): Promise<TomatoConnectionSnapshot> => ({
    state: "healthy",
    countryCode: "UK",
    latencyMs: 42,
    observedAtMs: 1_800_000_000_000,
    diagnostic: null,
  }),
};

const healthySnapshot: CapacitySnapshot = {
  sourceState: "healthy",
  fiveHour: {
    usedPercent: 24,
    remainingPercent: 76,
    windowDurationMins: 300,
    resetsAt: 1_800_000_000,
  },
  weekly: {
    usedPercent: 58,
    remainingPercent: 42,
    windowDurationMins: 10_080,
    resetsAt: 1_800_172_800,
  },
  fullResetCredits: {
    availableCount: 2,
    nearestExpiryAt: 1_800_432_000,
  },
  observedAtMs: 1_800_000_000_000,
};

const healthyZcodeSnapshot: ZCodeQuotaSnapshot = {
  sourceState: "healthy",
  fiveHour: {
    usedPercent: 24,
    remainingPercent: 76,
    windowDurationMins: 300,
    resetsAt: 1_800_000_000,
    quotaTotal: 2000,
    quotaUsed: 480,
    quotaRemaining: 1520,
  },
  weekly: {
    usedPercent: 58,
    remainingPercent: 42,
    windowDurationMins: 10_080,
    resetsAt: 1_800_172_800,
    quotaTotal: 10000,
    quotaUsed: 5800,
    quotaRemaining: 4200,
  },
  planLevel: "pro",
  observedAtMs: 1_800_000_000_000,
};

const zcodeSnapshotWithoutReset: ZCodeQuotaSnapshot = {
  ...healthyZcodeSnapshot,
  fiveHour: { ...healthyZcodeSnapshot.fiveHour!, resetsAt: null },
};

const basePreferences: DisplayPreferences = {
  opacity: 0.92,
  reducedMotion: false,
  x: null,
  y: null,
};

const blockedTomato: TomatoConnectionSnapshot = {
  state: "blocked",
  countryCode: "UK",
  latencyMs: null,
  observedAtMs: 1_800_000_000_000,
  diagnostic: { code: "CRV-404", message: "TomatoCloud route is unavailable", detail: null },
};

const healthyTomato: TomatoConnectionSnapshot = {
  state: "healthy",
  countryCode: "UK",
  latencyMs: 42,
  observedAtMs: 1_800_000_000_000,
  diagnostic: null,
};

describe("Codex capacity overlay", () => {
  it("requires two consecutive blocked probes before replacing a healthy route", () => {
    const initial = { visible: healthyTomato, consecutiveFailures: 0 };
    const firstFailure = applyRouteGate(initial, blockedTomato);
    expect(firstFailure.visible).toBe(healthyTomato);
    expect(firstFailure.consecutiveFailures).toBe(1);

    const secondFailure = applyRouteGate(firstFailure, blockedTomato);
    expect(secondFailure.visible).toBe(blockedTomato);
    expect(secondFailure.consecutiveFailures).toBe(2);

    const recovered = applyRouteGate(secondFailure, healthyTomato);
    expect(recovered.visible).toBe(healthyTomato);
    expect(recovered.consecutiveFailures).toBe(0);
  });

  it("keeps both quota windows present with equal loading treatment", () => {
    render(<App {...inertPreferences} loadSnapshot={() => new Promise(() => undefined)} />);

    expect(screen.getByLabelText("正在读取 Codex 配额")).toBeInTheDocument();
    expect(screen.getByText("5 HOUR")).toBeInTheDocument();
    expect(screen.getByText("WEEK")).toBeInTheDocument();
  });

  it("renders five-hour and weekly remaining capacity as co-primary values", async () => {
    render(<App {...inertPreferences} loadSnapshot={async () => healthySnapshot} />);

    const fiveHour = await screen.findByRole("group", { name: "5 HOUR quota" });
    const weekly = screen.getByRole("group", { name: "WEEK quota" });
    expect(within(fiveHour).getByText("76%", { exact: false })).toBeInTheDocument();
    expect(within(weekly).getByText("42%", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("FULL RESETS", { exact: false })).toHaveTextContent("2");
    expect(await screen.findByText("UK · 42 ms")).toBeInTheDocument();
  });

  it("shows one shared red route alert while preserving both quota windows", async () => {
    render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => healthySnapshot}
        loadTomatoConnection={async () => blockedTomato}
      />,
    );

    await waitFor(
      () => expect(screen.getByText("TomatoCloud route is unavailable")).toBeInTheDocument(),
      { timeout: 3_000 },
    );
    expect(screen.getByText("Route blocked · retrying")).toBeInTheDocument();
    expect(screen.getAllByRole("group")).toHaveLength(2);
  });

  it("keeps the blocked route state visible when Codex data is unavailable", async () => {
    const { container } = render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => {
          throw { code: "CRV-201", message: "Codex unavailable", detail: null };
        }}
        loadTomatoConnection={async () => blockedTomato}
      />,
    );

    await waitFor(
      () => expect(screen.getByRole("alert")).toHaveTextContent("TomatoCloud route is unavailable"),
      { timeout: 3_000 },
    );
    expect(screen.getByRole("status", { name: /TomatoCloud Route blocked/ })).toBeInTheDocument();
    expect(container.querySelector(".glass-shell--route-blocked")).toBeInTheDocument();
  });

  it("uses one shared actionable failure surface and retries", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const loadSnapshot = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw { code: "CRV-201", message: "无法读取 Codex 配额", detail: null };
      }
      return healthySnapshot;
    };

    render(<App {...inertPreferences} loadSnapshot={loadSnapshot} />);
    expect(await screen.findByText("诊断码 CRV-201", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText("无法读取 Codex 配额")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("76%", { exact: false })).toBeInTheDocument();
  });

  it("reveals refresh, bounded click-through, and settings after expansion", async () => {
    const user = userEvent.setup();
    let clickThroughCalls = 0;
    render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => healthySnapshot}
        enableClickThrough={async () => { clickThroughCalls += 1; }}
      />,
    );

    await screen.findByText("76%", { exact: false });
    await user.click(screen.getByRole("button", { name: "展开重置详情" }));
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "穿透 10 秒" }));
    expect(clickThroughCalls).toBe(1);
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("dialog", { name: "显示设置" })).toBeInTheDocument();
  });

  it("moves between compact, expanded, and collapsed window layouts", async () => {
    const user = userEvent.setup();
    const layouts: string[] = [];
    render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => healthySnapshot}
        setWindowLayout={async (layout) => { layouts.push(layout); }}
      />,
    );

    await screen.findByText("76%", { exact: false });
    await user.click(screen.getByRole("button", { name: "展开重置详情" }));
    expect(layouts[layouts.length - 1]).toBe("expanded");

    await user.click(screen.getByRole("button", { name: "收起为窄条" }));
    expect(layouts[layouts.length - 1]).toBe("collapsed");
    expect(screen.getByRole("button", { name: "恢复标准视图" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "恢复标准视图" }));
    expect(layouts[layouts.length - 1]).toBe("compact");
  });

  it("drags the native window from the collapsed surface", async () => {
    const user = userEvent.setup();
    const positions: Array<{ x: number; y: number }> = [];
    const { container } = render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => healthySnapshot}
        getWindowPosition={async () => ({ x: 100, y: 200 })}
        setWindowPosition={async (position) => {
          positions.push(position);
        }}
      />,
    );

    await screen.findByText("76%", { exact: false });
    await user.click(screen.getByRole("button", { name: "展开重置详情" }));
    await user.click(screen.getByRole("button", { name: "收起为窄条" }));

    const frame = container.querySelector(".app-frame") as HTMLElement;
    const collapsedSurface = screen.getByRole("button", { name: "恢复标准视图" });
    frame.setPointerCapture = () => undefined;
    frame.hasPointerCapture = () => false;

    fireEvent.pointerDown(collapsedSurface, {
      button: 0,
      pointerId: 17,
      screenX: 20,
      screenY: 30,
    });
    fireEvent.pointerMove(collapsedSurface, {
      pointerId: 17,
      screenX: 48,
      screenY: 44,
    });

    await waitFor(() => expect(positions[positions.length - 1]).toEqual({ x: 128, y: 214 }));
    fireEvent.pointerUp(collapsedSurface, {
      pointerId: 17,
      screenX: 48,
      screenY: 44,
    });
    fireEvent.click(collapsedSurface);
    expect(frame).toHaveClass("app-frame--collapsed");
  });

  it("moves the native window while the reservoir surface is dragged", async () => {
    const positions: Array<{ x: number; y: number }> = [];
    const { container } = render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => healthySnapshot}
        getWindowPosition={async () => ({ x: 100, y: 200 })}
        setWindowPosition={async (position) => {
          positions.push(position);
        }}
      />,
    );

    await screen.findByText("76%", { exact: false });
    const surface = container.querySelector(".app-frame") as HTMLElement;
    surface.setPointerCapture = () => undefined;
    surface.hasPointerCapture = () => false;

    fireEvent.pointerDown(surface, { button: 0, pointerId: 7, screenX: 20, screenY: 30 });
    await waitFor(() => expect(surface).toHaveClass("is-dragging"));
    fireEvent.pointerMove(surface, { pointerId: 7, screenX: 48, screenY: 44 });

    await waitFor(() => expect(positions[positions.length - 1]).toEqual({ x: 128, y: 214 }));
  });

  it("preserves immediate drag movement while the native position is still loading", async () => {
    const positions: Array<{ x: number; y: number }> = [];
    let resolvePosition: ((position: { x: number; y: number }) => void) | undefined;
    const pendingPosition = new Promise<{ x: number; y: number }>((resolve) => {
      resolvePosition = resolve;
    });
    const { container } = render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => healthySnapshot}
        getWindowPosition={() => pendingPosition}
        setWindowPosition={async (position) => {
          positions.push(position);
        }}
      />,
    );

    await screen.findByText("76%", { exact: false });
    const surface = container.querySelector(".app-frame") as HTMLElement;
    surface.setPointerCapture = () => undefined;
    surface.hasPointerCapture = () => false;

    fireEvent.pointerDown(surface, { button: 0, pointerId: 11, screenX: 20, screenY: 30 });
    fireEvent.pointerMove(surface, { pointerId: 11, screenX: 48, screenY: 44 });
    expect(positions).toHaveLength(0);

    resolvePosition?.({ x: 100, y: 200 });
    await waitFor(() => expect(positions[positions.length - 1]).toEqual({ x: 128, y: 214 }));
  });

  it("keeps the last successful snapshot visibly stale after a refresh failure", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => {
          attempt += 1;
          if (attempt === 1) return healthySnapshot;
          throw { code: "CRV-111", message: "读取 Codex 配额超时", detail: null };
        }}
      />,
    );

    await screen.findByText("76%", { exact: false });
    await user.click(screen.getByRole("button", { name: "展开重置详情" }));
    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("STALE · CRV-111")).toBeInTheDocument();
    expect(screen.getByText("76%", { exact: false })).toBeInTheDocument();
  });

  it("preserves both Codex fluid hues through a TomatoCloud failure and recovery", async () => {
    const user = userEvent.setup();
    let snapshotAttempt = 0;
    let routeAttempt = 0;
    const { container } = render(
      <App
        {...inertPreferences}
        loadPreferences={async () => ({ ...basePreferences, source: "codex" })}
        loadSnapshot={async () => {
          snapshotAttempt += 1;
          if (snapshotAttempt === 1) return healthySnapshot;
          throw { code: "CRV-111", message: "读取 Codex 配额超时", detail: null };
        }}
        loadZcodeSnapshot={async () => healthyZcodeSnapshot}
        loadTomatoConnection={async () => {
          routeAttempt += 1;
          return routeAttempt <= 2 ? blockedTomato : healthyTomato;
        }}
      />,
    );

    await screen.findByText("76%", { exact: false });
    await screen.findByText("TomatoCloud route is unavailable");
    await user.click(screen.getByRole("button", { name: "展开重置详情" }));
    await user.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText("STALE · CRV-111");

    await waitFor(
      () => expect(screen.getByText("UK · 42 ms")).toBeInTheDocument(),
      { timeout: 4_000 },
    );
    const reservoirs = Array.from(container.querySelectorAll<HTMLCanvasElement>(".fluid-reservoir"))
      .filter((reservoir) => getComputedStyle(reservoir).display !== "none");
    expect(reservoirs).toHaveLength(2);
    expect(reservoirs.map((reservoir) => getComputedStyle(reservoir).filter)).toEqual([
      "none",
      "none",
    ]);
    expect(container.querySelector(".quota-cell--cyan")).toBeInTheDocument();
    expect(container.querySelector(".quota-cell--mint")).toBeInTheDocument();
  }, 10_000);

  it("labels an upstream stale snapshot instead of presenting it as healthy", async () => {
    render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => ({ ...healthySnapshot, sourceState: "stale" })}
      />,
    );

    expect(await screen.findByText("STALE · cached snapshot")).toBeInTheDocument();
  });

  it("renders a missing quota window as unavailable without a broken percentage", async () => {
    render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => ({ ...healthySnapshot, fiveHour: null })}
      />,
    );

    const fiveHour = await screen.findByRole("group", { name: "5 HOUR quota unavailable" });
    expect(within(fiveHour).getByText("Data unavailable")).toBeInTheDocument();
    expect(within(fiveHour).queryByText("LEFT")).not.toBeInTheDocument();
    expect(screen.getByText(/5-hour unavailable/)).toBeInTheDocument();
  });

  it("persists opacity and reduced-motion choices as display-only preferences", async () => {
    const user = userEvent.setup();
    const saves: Array<{ opacity: number; reducedMotion: boolean }> = [];
    render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => healthySnapshot}
        savePreferences={async (preferences) => {
          saves.push({ opacity: preferences.opacity, reducedMotion: preferences.reducedMotion });
        }}
      />,
    );

    await screen.findByText("76%", { exact: false });
    await user.click(screen.getByRole("button", { name: "展开重置详情" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("checkbox", { name: "减少动效" }));
    expect(saves[saves.length - 1]).toEqual({ opacity: 0.92, reducedMotion: true });
  });

  it("closes the settings dialog with Escape", async () => {
    const user = userEvent.setup();
    render(<App {...inertPreferences} loadSnapshot={async () => healthySnapshot} />);

    await screen.findByText("76%", { exact: false });
    await user.click(screen.getByRole("button", { name: "展开重置详情" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("dialog", { name: "显示设置" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "显示设置" })).not.toBeInTheDocument();
  });

  it("quits the application from the settings dialog", async () => {
    const user = userEvent.setup();
    const quitApp = vi.fn(async () => undefined);
    render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => healthySnapshot}
        quitApp={quitApp}
      />,
    );

    await screen.findByText("76%", { exact: false });
    await user.click(screen.getByRole("button", { name: "展开重置详情" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "退出应用" }));
    await waitFor(() => expect(quitApp).toHaveBeenCalledTimes(1));
  });

  it("anchors settings above a collapsed shell and restores the prior layout on Escape", async () => {
    const user = userEvent.setup();
    const openSettingsWindow = vi.fn(async () => ({
      baseLayout: "compact" as const,
      placement: "above" as const,
      windowPosition: { x: 80, y: 252 },
      windowSize: { width: 300, height: 278 },
      restore: { layout: "collapsed" as const, position: { x: 80, y: 400 } },
    }));
    const closeSettingsWindow = vi.fn(async () => undefined);
    const { container } = render(
      <App
        {...inertPreferences}
        initialLayout="collapsed"
        loadSnapshot={async () => healthySnapshot}
        openSettingsWindow={openSettingsWindow}
        closeSettingsWindow={closeSettingsWindow}
      />,
    );

    await screen.findByRole("button", { name: "恢复标准视图" });
    fireEvent.contextMenu(container.querySelector("main")!);

    expect(await screen.findByRole("dialog", { name: "显示设置" })).toBeInTheDocument();
    expect(openSettingsWindow).toHaveBeenCalledWith("collapsed");
    expect(container.querySelector("main")).toHaveClass(
      "app-frame--compact",
      "app-frame--settings-above",
    );

    await user.keyboard("{Escape}");
    await waitFor(() => expect(closeSettingsWindow).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "恢复标准视图" })).toBeInTheDocument();
  });

  it("prevents a second manual refresh while the first refresh is pending", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    render(
      <App
        {...inertPreferences}
        loadSnapshot={() => {
          attempt += 1;
          if (attempt === 1) return Promise.resolve(healthySnapshot);
          return new Promise(() => undefined);
        }}
      />,
    );

    await screen.findByText("76%", { exact: false });
    await user.click(screen.getByRole("button", { name: "展开重置详情" }));
    await user.click(screen.getByRole("button", { name: "刷新" }));
    const refreshButton = screen.getByRole("button", { name: "刷新中" });
    expect(refreshButton).toBeDisabled();
    await user.click(refreshButton);
    expect(attempt).toBe(2);
  });
});

describe("dual quota sources", () => {
  it("defaults to a carousel that starts on Codex when the source preference is absent", async () => {
    render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => healthySnapshot}
        loadZcodeSnapshot={async () => healthyZcodeSnapshot}
      />,
    );

    expect(await screen.findByText("76%", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("CODEX")).toBeInTheDocument();
    expect(screen.queryByText("ZCODE")).not.toBeInTheDocument();
    expect(screen.getByText(/FULL RESETS/)).toBeInTheDocument();
  });

  it("renders ZCode quota windows with the ZCODE badge, credits, and plan chip", async () => {
    render(
      <App
        {...inertPreferences}
        loadPreferences={async () => ({ ...basePreferences, source: "zcode" })}
        loadSnapshot={async () => healthySnapshot}
        loadZcodeSnapshot={async () => healthyZcodeSnapshot}
      />,
    );

    const fiveHour = await screen.findByRole("group", { name: "5 HOUR quota" });
    expect(fiveHour).toHaveClass("quota-cell--moonlight");
    expect(within(fiveHour).getByText("76%", { exact: false })).toBeInTheDocument();
    expect(within(fiveHour).getByText("1520 / 2000")).toBeInTheDocument();
    const weekly = screen.getByRole("group", { name: "WEEK quota" });
    expect(weekly).toHaveClass("quota-cell--emerald");
    expect(within(weekly).getByText("42%", { exact: false })).toBeInTheDocument();
    expect(within(weekly).getByText("4200 / 10000")).toBeInTheDocument();
    expect(screen.getByText("ZCODE")).toBeInTheDocument();
    expect(screen.getByText("PRO")).toBeInTheDocument();
    expect(screen.queryByText(/FULL RESETS/)).not.toBeInTheDocument();
  });

  it("renders a placeholder when the ZCode window has no reset time", async () => {
    render(
      <App
        {...inertPreferences}
        loadPreferences={async () => ({ ...basePreferences, source: "zcode" })}
        loadSnapshot={async () => healthySnapshot}
        loadZcodeSnapshot={async () => zcodeSnapshotWithoutReset}
      />,
    );

    const fiveHour = await screen.findByRole("group", { name: "5 HOUR quota" });
    expect(within(fiveHour).getByText("Resets —")).toBeInTheDocument();
    const weekly = screen.getByRole("group", { name: "WEEK quota" });
    expect(within(weekly).getByText(/Resets /)).toBeInTheDocument();
  });

  it("renders a single ZCode cell when only the five-hour window exists", async () => {
    render(
      <App
        {...inertPreferences}
        loadPreferences={async () => ({ ...basePreferences, source: "zcode" })}
        loadZcodeSnapshot={async () => ({ ...healthyZcodeSnapshot, weekly: null })}
      />,
    );

    expect(await screen.findByRole("group", { name: "5 HOUR quota" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "WEEK quota" })).not.toBeInTheDocument();
  });

  it("alternates the active source every ten seconds in carousel mode", async () => {
    vi.useFakeTimers();
    try {
      render(
        <App
          {...inertPreferences}
          loadPreferences={async () => ({ ...basePreferences, source: "carousel" })}
          loadSnapshot={async () => healthySnapshot}
          loadZcodeSnapshot={async () => healthyZcodeSnapshot}
        />,
      );

      await act(async () => undefined);
      expect(screen.getByText("CODEX")).toBeInTheDocument();
      expect(screen.queryByText("ZCODE")).not.toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText("ZCODE")).toBeInTheDocument();
      expect(screen.getByText("1520 / 2000")).toBeInTheDocument();
      expect(screen.queryByText("CODEX")).not.toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText("CODEX")).toBeInTheDocument();
      expect(screen.getByText(/FULL RESETS/)).toBeInTheDocument();
      expect(screen.queryByText("ZCODE")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a ZCode failure surface while Codex data stays reachable", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <App
        {...inertPreferences}
        loadPreferences={async () => ({ ...basePreferences, source: "zcode" })}
        loadSnapshot={async () => healthySnapshot}
        loadZcodeSnapshot={async () => {
          throw { code: "CRV-502", message: "无法读取 ZCode 配额", detail: null };
        }}
      />,
    );

    expect(await screen.findByText("无法读取 ZCode 配额")).toBeInTheDocument();
    expect(screen.getByText(/诊断码 CRV-502/)).toBeInTheDocument();

    fireEvent.contextMenu(container.querySelector(".app-frame") as HTMLElement);
    await user.click(await screen.findByRole("button", { name: "Codex" }));

    expect(await screen.findByText("76%", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/FULL RESETS/)).toBeInTheDocument();
    expect(screen.getByText("CODEX")).toBeInTheDocument();
  });

  it("suppresses the TomatoCloud route alarm while ZCode is displayed", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <App
        {...inertPreferences}
        loadPreferences={async () => ({ ...basePreferences, source: "zcode" })}
        loadSnapshot={async () => healthySnapshot}
        loadZcodeSnapshot={async () => healthyZcodeSnapshot}
        loadTomatoConnection={async () => blockedTomato}
      />,
    );

    expect(await screen.findByText("ZCODE")).toBeInTheDocument();
    // 连续两次阻断探测（约 1 秒节奏）足以让 Codex 门限成立；ZCode 态不得出现任何报警
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.querySelector(".route-alert-halo")).toBeNull();
    expect(container.querySelector(".glass-shell--route-blocked")).toBeNull();

    fireEvent.contextMenu(container.querySelector(".app-frame") as HTMLElement);
    await user.click(await screen.findByRole("button", { name: "Codex" }));

    await waitFor(
      () => expect(screen.getByText("TomatoCloud route is unavailable")).toBeInTheDocument(),
      { timeout: 4_000 },
    );
    expect(container.querySelector(".route-alert-halo")).not.toBeNull();
  }, 15_000);

  it("saves the selected quota source from the settings panel and applies it immediately", async () => {
    const user = userEvent.setup();
    const savedSources: Array<DisplayPreferences["source"]> = [];
    render(
      <App
        {...inertPreferences}
        loadSnapshot={async () => healthySnapshot}
        loadZcodeSnapshot={async () => healthyZcodeSnapshot}
        savePreferences={async (preferences) => {
          savedSources.push(preferences.source);
        }}
      />,
    );

    await screen.findByText("76%", { exact: false });
    await user.click(screen.getByRole("button", { name: "展开重置详情" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "Zcode" }));
    expect(savedSources[savedSources.length - 1]).toBe("zcode");

    expect(await screen.findByText("ZCODE")).toBeInTheDocument();
    expect(screen.getByText("1520 / 2000")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "轮播" }));
    expect(savedSources[savedSources.length - 1]).toBe("carousel");
  });

  it("loads both quota sources on mount", async () => {
    const codexLoader = vi.fn(async () => healthySnapshot);
    const zcodeLoader = vi.fn(async () => healthyZcodeSnapshot);
    render(
      <App
        {...inertPreferences}
        loadSnapshot={codexLoader}
        loadZcodeSnapshot={zcodeLoader}
      />,
    );

    await waitFor(() => expect(codexLoader).toHaveBeenCalled());
    await waitFor(() => expect(zcodeLoader).toHaveBeenCalled());
  });
});
