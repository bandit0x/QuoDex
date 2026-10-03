import { describe, expect, it } from "vitest";
import {
  ambientBreezeOffset,
  deriveChamberSeed,
  deriveFluidDynamics,
  FluidBodyMomentum,
  FluidSurface,
  linearLiquidLevel,
} from "./fluidPhysics";

describe("volumetric fluid surface", () => {
  it("makes shallow, half-full and deep slosh visibly differ under the same drag", () => {
    const measure = (level: number) => {
      const surface = new FluidSurface();
      surface.configure(deriveFluidDynamics(level, 0.35));
      surface.disturb(1.6, -0.5, true);
      let peak = 0;
      let firstReturn = 0;
      let initialSign = 0;
      for (let frame = 1; frame <= 180; frame += 1) {
        surface.step();
        const rms = Math.hypot(...surface.heights) / Math.sqrt(surface.heights.length);
        peak = Math.max(peak, rms);
        const tilt = surface.heights[50] - surface.heights[5];
        if (frame === 1) initialSign = Math.sign(tilt);
        if (firstReturn === 0 && Math.sign(tilt) !== initialSign) firstReturn = frame;
      }
      return { peak, firstReturn };
    };
    const low = measure(20);
    const middle = measure(50);
    const high = measure(85);
    expect(high.firstReturn).toBeGreaterThan(low.firstReturn * 1.8);
    expect(middle.peak).toBeGreaterThan(Math.max(low.peak, high.peak) * 1.4);
  });

  it("derives stable liquid dynamics from chamber seed and remaining capacity", () => {
    const shallow = deriveFluidDynamics(20, 0.35);
    const repeated = deriveFluidDynamics(20, 0.35);
    const deep = deriveFluidDynamics(80, 0.35);

    expect(repeated).toEqual(shallow);
    expect(shallow.tension).toBeGreaterThan(deep.tension);
    expect(shallow.damping).toBeLessThan(deep.damping);
    expect(shallow.surfaceRestoring).toBeGreaterThan(deep.surfaceRestoring);
    expect(deep.bodyImpulse).toBeGreaterThan(shallow.bodyImpulse);
  });

  it("derives stable but distinct chamber seeds within one launch", () => {
    const sessionSeed = 0.314159;
    const fiveHour = deriveChamberSeed(sessionSeed, "zcode-five-hour");
    const repeated = deriveChamberSeed(sessionSeed, "zcode-five-hour");
    const weekly = deriveChamberSeed(sessionSeed, "zcode-weekly");

    expect(repeated).toBe(fiveHour);
    expect(weekly).not.toBe(fiveHour);
    expect(fiveHour).toBeGreaterThanOrEqual(0);
    expect(fiveHour).toBeLessThan(1);
  });

  it("derives four distinct motion profiles from level and launch seed", () => {
    const sessionSeed = 0.314159;
    const profiles = [
      deriveFluidDynamics(76, deriveChamberSeed(sessionSeed, "codex-five-hour")),
      deriveFluidDynamics(42, deriveChamberSeed(sessionSeed, "codex-weekly")),
      deriveFluidDynamics(76, deriveChamberSeed(sessionSeed, "zcode-five-hour")),
      deriveFluidDynamics(42, deriveChamberSeed(sessionSeed, "zcode-weekly")),
    ];

    expect(new Set(profiles.map((profile) => profile.phaseOffset)).size).toBe(4);
    expect(new Set(profiles.map((profile) => profile.flowScale)).size).toBe(4);
    expect(new Set(profiles.map((profile) => profile.bodyImpulse)).size).toBe(4);
  });

  it("keeps all four chamber trajectories independent after the same drag", () => {
    const sessionSeed = 0.314159;
    const chambers = [
      { remaining: 76, key: "codex-five-hour" },
      { remaining: 42, key: "codex-weekly" },
      { remaining: 76, key: "zcode-five-hour" },
      { remaining: 42, key: "zcode-weekly" },
    ];
    const profiles = chambers.map(({ remaining, key }) =>
      deriveFluidDynamics(remaining, deriveChamberSeed(sessionSeed, key)));
    const surfaces = profiles.map((profile) => {
      const surface = new FluidSurface();
      surface.configure(profile);
      surface.disturb(1.9, -0.45, true);
      return surface;
    });
    const bodies = profiles.map((profile) => {
      const body = new FluidBodyMomentum();
      body.configure(profile);
      body.disturb(1.9, -0.45, true);
      return body;
    });

    for (let frame = 0; frame < 48; frame += 1) {
      surfaces.forEach((surface) => surface.step());
      bodies.forEach((body) => body.step());
    }

    const pairwiseSurfaceRms: number[] = [];
    const pairwiseBodyRms: number[] = [];
    for (let first = 0; first < chambers.length; first += 1) {
      for (let second = first + 1; second < chambers.length; second += 1) {
        let surfaceSquaredError = 0;
        for (let index = 0; index < surfaces[first].heights.length; index += 1) {
          const difference = surfaces[first].heights[index] - surfaces[second].heights[index];
          surfaceSquaredError += difference * difference;
        }
        pairwiseSurfaceRms.push(Math.sqrt(surfaceSquaredError / surfaces[first].heights.length));
        const bodyXDifference = bodies[first].offset[0] - bodies[second].offset[0];
        const bodyYDifference = bodies[first].offset[1] - bodies[second].offset[1];
        pairwiseBodyRms.push(Math.hypot(bodyXDifference, bodyYDifference));
      }
    }

    expect(Math.min(...pairwiseSurfaceRms)).toBeGreaterThan(0.25);
    expect(Math.min(...pairwiseBodyRms)).toBeGreaterThan(0.004);
  });

  it("maps remaining percentage linearly to the physical liquid level", () => {
    expect(linearLiquidLevel(0, 10, 180)).toBe(190);
    expect(linearLiquidLevel(18, 10, 180)).toBeCloseTo(157.6);
    expect(linearLiquidLevel(95, 10, 180)).toBeCloseTo(19);
    expect(linearLiquidLevel(100, 10, 180)).toBe(10);
  });

  it("bounds near-empty/full motion while conserving volume and settling", () => {
    for (const level of [0, 2, 20, 50, 85, 98, 100]) {
      const dynamics = deriveFluidDynamics(level, 0.35);
      const surface = new FluidSurface();
      surface.configure(dynamics);
      for (let frame = 0; frame < 120; frame += 1) {
        surface.disturb(frame % 30 < 15 ? 2.4 : -2.4, -1.5);
        surface.step();
        expect(Math.max(...surface.heights.map(Math.abs))).toBeLessThanOrEqual(dynamics.surfaceMaxDisplacement + 0.00001);
        expect(Math.abs(surface.heights.reduce((sum, value) => sum + value, 0))).toBeLessThan(0.0001);
      }
      for (let frame = 0; frame < 1200; frame += 1) surface.step();
      expect(surface.isActive).toBe(false);
    }
  });

  it("settles low-level drag at 30fps instead of staying at the displacement limit", () => {
    const surface = new FluidSurface();
    surface.configure(deriveFluidDynamics(20, 0.2));
    for (let frame = 0; frame < 120; frame += 1) {
      surface.disturb(frame % 30 < 15 ? 2.4 : -2.4, -1.5);
      surface.step(2);
    }
    for (let frame = 0; frame < 1200; frame += 1) surface.step(2);
    expect(surface.isActive).toBe(false);
    expect(Math.max(...surface.heights.map(Math.abs))).toBe(0);
  });

  it("keeps the settled surface within a sub-pixel sea-breeze range", () => {
    let largestIdleOffset = 0;
    let largestActiveOffset = 0;

    for (let frame = 0; frame <= 120; frame += 1) {
      for (let sample = 0; sample <= 56; sample += 1) {
        const x = sample / 56;
        const timeMs = frame * 250;
        largestIdleOffset = Math.max(
          largestIdleOffset,
          Math.abs(ambientBreezeOffset(x, timeMs, false)),
        );
        largestActiveOffset = Math.max(
          largestActiveOffset,
          Math.abs(ambientBreezeOffset(x, timeMs, true)),
        );
      }
    }

    expect(largestIdleOffset).toBeLessThan(0.42);
    expect(largestIdleOffset).toBeGreaterThan(0.3);
    expect(largestActiveOffset).toBeLessThan(0.11);
  });

  it("conserves represented volume while the free surface sloshes", () => {
    const surface = new FluidSurface();
    surface.disturb(1.8, -0.6, true);
    for (let frame = 0; frame < 180; frame += 1) surface.step();

    const mean = surface.heights.reduce((sum, value) => sum + value, 0) / surface.heights.length;
    expect(Math.abs(mean)).toBeLessThan(0.0001);
  });

  it("gives two chamber seeds visibly different responses to the same drag", () => {
    const fiveHour = new FluidSurface();
    const weekly = new FluidSurface();
    fiveHour.configure(deriveFluidDynamics(72, 0.18));
    weekly.configure(deriveFluidDynamics(41, 0.81));

    fiveHour.disturb(1.9, -0.45, true);
    weekly.disturb(1.9, -0.45, true);
    for (let frame = 0; frame < 48; frame += 1) {
      fiveHour.step();
      weekly.step();
    }

    const fiveHourHeights = Array.from(fiveHour.heights);
    const weeklyHeights = Array.from(weekly.heights);
    const fiveHourMean = fiveHourHeights.reduce((sum, value) => sum + value, 0) / fiveHourHeights.length;
    const weeklyMean = weeklyHeights.reduce((sum, value) => sum + value, 0) / weeklyHeights.length;

    expect(fiveHourHeights).not.toEqual(weeklyHeights);
    expect(Math.abs(fiveHourMean)).toBeLessThan(0.0001);
    expect(Math.abs(weeklyMean)).toBeLessThan(0.0001);
  });

  it("keeps surface, inertia, and phase visibly independent after an identical drag", () => {
    const fiveHour = new FluidSurface();
    const weekly = new FluidSurface();
    const fiveHourBody = new FluidBodyMomentum();
    const weeklyBody = new FluidBodyMomentum();
    fiveHour.configure(deriveFluidDynamics(72, 0.18));
    weekly.configure(deriveFluidDynamics(41, 0.81));
    fiveHourBody.configure(deriveFluidDynamics(72, 0.18));
    weeklyBody.configure(deriveFluidDynamics(41, 0.81));

    fiveHour.disturb(1.9, -0.45, true);
    weekly.disturb(1.9, -0.45, true);
    fiveHourBody.disturb(1.9, -0.45, true);
    weeklyBody.disturb(1.9, -0.45, true);

    let surfaceSquaredError = 0;
    let surfacePeakDifference = 0;
    let bodySquaredError = 0;
    for (let frame = 0; frame < 48; frame += 1) {
      fiveHour.step();
      weekly.step();
      fiveHourBody.step();
      weeklyBody.step();
      for (let index = 0; index < fiveHour.heights.length; index += 1) {
        const difference = fiveHour.heights[index] - weekly.heights[index];
        surfaceSquaredError += difference * difference;
        surfacePeakDifference = Math.max(surfacePeakDifference, Math.abs(difference));
      }
      const bodyXDifference = fiveHourBody.offset[0] - weeklyBody.offset[0];
      const bodyYDifference = fiveHourBody.offset[1] - weeklyBody.offset[1];
      bodySquaredError += bodyXDifference * bodyXDifference + bodyYDifference * bodyYDifference;
    }

    const surfaceRms = Math.sqrt(surfaceSquaredError / (48 * fiveHour.heights.length));
    const bodyRms = Math.sqrt(bodySquaredError / 48);
    expect(surfaceRms).toBeGreaterThan(1.1);
    expect(surfacePeakDifference).toBeGreaterThan(2.4);
    expect(bodyRms).toBeGreaterThan(0.04);
  });

  it("keeps the two reservoir states independent", () => {
    const fiveHour = new FluidSurface();
    const weekly = new FluidSurface();
    fiveHour.disturb(2, 0, true);
    fiveHour.step();

    expect(Array.from(fiveHour.heights).some((value) => Math.abs(value) > 0.01)).toBe(true);
    expect(Array.from(weekly.heights).every((value) => value === 0)).toBe(true);
  });

  it("carries drag momentum into the liquid body and decays after release", () => {
    const body = new FluidBodyMomentum();
    body.disturb(2.1, -0.8, true);
    body.step();

    const firstOffset = body.offset;
    const firstAgitation = body.agitation;
    for (let frame = 0; frame < 180; frame += 1) body.step();

    expect(firstOffset[0]).toBeGreaterThan(0);
    expect(firstOffset[1]).toBeLessThan(0);
    expect(body.offset[0]).toBeGreaterThan(firstOffset[0]);
    expect(body.agitation).toBeLessThan(firstAgitation);
  });
});
