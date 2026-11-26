import { describe, expect, it } from "vitest";
import { cavityHalfWidth, GeminiCavityFluid, twinMeniscusRatio } from "./geminiFluidPhysics";

function feedRightWhipAndHardStop(fluid: GeminiCavityFluid, percent: number, narrow = false) {
  // Accelerate window strongly to the RIGHT over 120ms (7 frames)
  for (let i = 1; i <= 7; i += 1) {
    fluid.pushMotion({
      sequence: i,
      accelerationX: 0,
      accelerationY: 0,
      phase: "dragging",
      velocityX: (i / 7) * 1.8, // px/ms -> 1800 px/s rightward
      velocityY: 0,
      elapsedMs: 16.67,
    });
    fluid.step(16.67, percent, narrow);
  }
}

describe("GeminiCavityFluid wall-clinging physics", () => {
  it("surges UP the left (trailing) glass wall when accelerating right (Newton inertia)", () => {
    const fluid = new GeminiCavityFluid(0.46);
    fluid.step(16.67, 60, false); // initialize at rest
    const restV = 2 * twinMeniscusRatio(0.6, false) - 1;

    feedRightWhipAndHardStop(fluid, 60, false);
    const peakRightWhip = fluid.step(16.67, 60, false);

    // Smaller v = higher up the glass wall
    expect(peakRightWhip.edgeL).toBeLessThan(restV - 0.12);
    expect(peakRightWhip.edgeR).toBeGreaterThan(restV + 0.08);
    expect(peakRightWhip.tilt).toBeLessThan(0);
    expect(peakRightWhip.wetL).toBeLessThan(restV - 0.12);
  });

  it("retains a slow-draining left wall-clinging film after hard-stop / reversal to right wall", () => {
    const fluid = new GeminiCavityFluid(0.46, { drainMs: 550 });
    fluid.step(16.67, 60, false);
    feedRightWhipAndHardStop(fluid, 60, false);
    const climbedLeft = fluid.step(16.67, 60, false);
    const peakWetL = climbedLeft.wetL;

    // Hard stop: velocity suddenly drops to 0 on release
    fluid.pushMotion({
      sequence: 8,
      accelerationX: 0,
      accelerationY: 0,
      phase: "released",
      velocityX: 0,
      velocityY: 0,
      elapsedMs: 16.67,
    });

    // Step ~180ms: bulk liquid rebounds to right wall, while left wall STILL clings visibly
    let state = climbedLeft;
    for (let i = 0; i < 11; i += 1) {
      state = fluid.step(16.67, 60, false);
    }

    expect(state.edgeL).toBeGreaterThan(peakWetL + 0.12); // bulk level on left dropped
    expect(state.wetL).toBeLessThan(state.edgeL - 0.08); // clinging film remains above bulk
    expect(state.filmL).toBeGreaterThan(0.2);

    // After ~1.8s at rest, wall film drains and settles cleanly
    for (let i = 0; i < 120; i += 1) {
      state = fluid.step(16.67, 60, false);
    }
    expect(state.filmL).toBe(0);
    expect(state.filmR).toBe(0);
    expect(state.active).toBe(false);
  });

  it("produces a smooth single-concave free surface with zero multi-peak waves under vigorous shaking", () => {
    const fluid = new GeminiCavityFluid(0.72);
    fluid.step(16.67, 50, false);

    // Rapid alternating horizontal whip
    for (let frame = 1; frame <= 30; frame += 1) {
      const vx = Math.sin(frame * 0.65) * 1.9;
      fluid.pushMotion({
        sequence: frame,
        accelerationX: 0,
        accelerationY: 0,
        phase: "dragging",
        velocityX: vx,
        velocityY: 0,
        elapsedMs: 16.67,
      });
      const state = fluid.step(16.67, 50, false);

      // Sample 33 points across [-1, 1] and verify at most 1 internal extremum (the smooth concave trough)
      const samples = Array.from({ length: 33 }, (_, idx) => state.surfaceV(-1 + (2 * idx) / 32));
      let signChanges = 0;
      let prevDiffSign = 0;
      for (let i = 1; i < samples.length; i += 1) {
        const diff = samples[i] - samples[i - 1];
        if (Math.abs(diff) < 1e-6) continue;
        const sign = Math.sign(diff);
        if (prevDiffSign !== 0 && sign !== prevDiffSign) signChanges += 1;
        prevDiffSign = sign;
      }
      expect(signChanges).toBeLessThanOrEqual(1);
    }
  });

  it("climbs both curved walls symmetrically during a rapid downward drop", () => {
    const fluid = new GeminiCavityFluid(0.46);
    fluid.step(16.67, 55, true);
    const restEdge = fluid.step(16.67, 55, true).edgeL;

    // Rapid downward acceleration (vy > 0 -> upward inertial force fy < 0 -> weightless capillary climb)
    for (let i = 1; i <= 6; i += 1) {
      fluid.pushMotion({
        sequence: i,
        accelerationX: 0,
        accelerationY: 0,
        phase: "dragging",
        velocityX: 0,
        velocityY: (i / 6) * 1.6,
        elapsedMs: 16.67,
      });
      fluid.step(16.67, 55, true);
    }
    const dropped = fluid.step(16.67, 55, true);

    expect(dropped.edgeL).toBeLessThan(restEdge - 0.04);
    expect(dropped.edgeR).toBeLessThan(restEdge - 0.04);
    expect(Math.abs(dropped.edgeL - dropped.edgeR)).toBeLessThan(0.02);
  });

  it("stays settled (active=false) on cold start when no motion has occurred", () => {
    for (const narrow of [false, true]) {
      const fluid = new GeminiCavityFluid(0.46);
      const state = fluid.step(16.67, 65, narrow);
      expect(state.active).toBe(false);
      expect(state.tilt).toBe(0);
      expect(state.filmL).toBe(0);
      expect(state.filmR).toBe(0);
    }
  });

  it("handles 0%, 100%, narrow geometry, and legacy acceleration fallback safely", () => {
    for (const narrow of [false, true]) {
      expect(cavityHalfWidth(-1, narrow)).toBeGreaterThanOrEqual(0);
      expect(cavityHalfWidth(0, narrow)).toBe(1);
      expect(cavityHalfWidth(1, narrow)).toBeGreaterThanOrEqual(0);

      for (const level of [0, 2, 100]) {
        const fluid = new GeminiCavityFluid(0.46);
        fluid.pushMotion({
          sequence: 1,
          accelerationX: 2.2,
          accelerationY: -1.4,
          phase: "released",
        });
        const state = fluid.step(16.67, level, narrow);
        expect(Number.isFinite(state.tilt)).toBe(true);
        expect(Number.isFinite(state.edgeL)).toBe(true);
        expect(Number.isFinite(state.wetL)).toBe(true);
      }
    }
  });

  it("stays settled when a zero-velocity released sample arrives after a quota level change", () => {
    const fluid = new GeminiCavityFluid(0.46);
    fluid.step(16.67, 85, false);
    fluid.pushMotion({
      sequence: 1,
      accelerationX: 0,
      accelerationY: 0,
      phase: "released",
      velocityX: 0,
      velocityY: 0,
      elapsedMs: 16.67,
    });
    const state = fluid.step(16.67, 25, false);
    expect(state.active).toBe(false);
    expect(state.tilt).toBe(0);
    expect(state.filmL).toBe(0);
    expect(state.filmR).toBe(0);
  });
});
