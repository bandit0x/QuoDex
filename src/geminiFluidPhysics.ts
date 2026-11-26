import type { FluidMotionSample } from "./fluidPhysics";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export interface GeminiCavityState {
  /** Normalized surface tilt (>0: right wall rises / left drops; <0: left wall rises / right drops). */
  tilt: number;
  /** Symmetric capillary concavity depth (>= 0). */
  concavity: number;
  /** Bulk liquid contact height on the left wall in normalized cavity coordinates [-1, 1] (-1 = top, +1 = bottom). */
  edgeL: number;
  /** Bulk liquid contact height on the right wall in normalized cavity coordinates [-1, 1]. */
  edgeR: number;
  /** Highest wetted meniscus position on the left glass wall [-1, 1] (<= edgeL when clinging). */
  wetL: number;
  /** Highest wetted meniscus position on the right glass wall [-1, 1] (<= edgeR when clinging). */
  wetR: number;
  /** Left wall clinging film intensity in [0, 1]. */
  filmL: number;
  /** Right wall clinging film intensity in [0, 1]. */
  filmR: number;
  /** Combined agitation intensity in [0, 1] for smooth optical rest handoff. */
  intensity: number;
  /** Whether the cavity fluid is actively sloshing or draining a wall film. */
  active: boolean;
  /** Normalized surface height v(xi) in [-1, 1] for horizontal position xi in [-1, 1]. */
  surfaceV: (xi: number) => number;
}

/**
 * Baked meniscus vertical ratio [0..1] in the twin-glass atlases.
 * Keeping the rest height identical ensures a seamless handoff to static frames.
 */
export function twinMeniscusRatio(level: number, narrow: boolean): number {
  const clamped = clamp(level, 0, 1);
  const low = narrow ? 0.737 : 0.725;
  const high = narrow ? 0.298 : 0.345;
  if (clamped < 0.24) return 1 + ((low - 1) * clamped) / 0.24;
  if (clamped <= 0.82) return low + ((high - low) * (clamped - 0.24)) / 0.58;
  return high * (1 - (clamped - 0.82) / 0.18);
}

/**
 * Normalized half-width u(v) in [0, 1] for vertical cavity coordinate v in [-1, 1].
 * Matches both the standard elliptical porthole and the narrow rounded-bottom capsule.
 */
export function cavityHalfWidth(v: number, narrow: boolean): number {
  const cv = clamp(v, -1, 1);
  if (!narrow) {
    return Math.sqrt(Math.max(0, 1 - cv * cv));
  }
  if (cv < -0.58) {
    const t = clamp((cv + 0.58) / -0.42, 0, 1);
    return Math.sqrt(Math.max(0, 1 - t * t * 0.92));
  }
  if (cv > 0.28) {
    const t = clamp((cv - 0.28) / 0.72, 0, 1);
    return Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.2)));
  }
  return 1;
}

export interface GeminiCavityOptions {
  /** Viscous clinging-film drain time constant in milliseconds (default 550ms). */
  drainMs?: number;
}

/**
 * Three-DOF cohesive slosh & curved-glass wall-clinging physics for the Gemini twin portholes.
 *
 * Replaces multi-node shallow-water sine ripples with:
 * 1. Filtered physical inertial forcing (-dv/dt + high-speed drag shear) with Newton's-law sign.
 * 2. Near-critically-damped 1st-mode bulk surge tilt (no short-wavelength oscillations).
 * 3. Symmetric 2nd-mode capillary concavity (climbs both walls on drop/shake).
 * 4. Asymmetric left/right wall-clinging state machine (fast climb, contact-line pin, slow drain).
 */
export class GeminiCavityFluid {
  private readonly variation: number;
  private readonly drainMs: number;

  private smoothVelX = 0; // px/s
  private smoothVelY = 0; // px/s
  private prevSmoothVelX = 0;
  private prevSmoothVelY = 0;
  private smoothAccX = 0; // px/s^2
  private smoothAccY = 0; // px/s^2
  private fallbackForceX = 0;
  private fallbackForceY = 0;
  private hasVelocityInput = false;

  private tilt = 0;
  private tiltVel = 0;
  private concavity: number | null = null;
  private edgeL = 0;
  private edgeR = 0;
  private wetL: number | null = null;
  private wetR: number | null = null;
  private pinL = 0;
  private pinR = 0;
  private filmL = 0;
  private filmR = 0;
  private settledEquilibriumV = 0;

  constructor(chamberSeed = 0.46, options: GeminiCavityOptions = {}) {
    const seed = ((chamberSeed % 1) + 1) % 1;
    // Subtle +/-10% natural differentiation between AG Gemini and AG Claude/GPT
    this.variation = 0.92 + (seed - 0.5) * 0.24;
    this.drainMs = options.drainMs ?? 550;
  }

  pushMotion(sample: FluidMotionSample): void {
    const vx = sample.velocityX ?? 0;
    const vy = sample.velocityY ?? 0;
    if (sample.phase === "idle" && vx === 0 && vy === 0) {
      this.smoothVelX = 0;
      this.smoothVelY = 0;
      this.prevSmoothVelX = 0;
      this.prevSmoothVelY = 0;
      return;
    }
    if (
      sample.phase === "released" &&
      vx === 0 &&
      vy === 0 &&
      Math.abs(this.tilt) <= 0.0025 &&
      Math.abs(this.tiltVel) <= 0.008 &&
      this.filmL <= 0.006 &&
      this.filmR <= 0.006 &&
      Math.hypot(this.smoothVelX, this.smoothVelY) <= 1 &&
      Math.hypot(this.smoothAccX, this.smoothAccY) <= 10
    ) {
      return;
    }

    if (sample.velocityX !== undefined && sample.velocityY !== undefined) {
      this.hasVelocityInput = true;
      const dt = clamp((sample.elapsedMs ?? 16.667) / 1000, 0.006, 0.05);
      // Convert px/ms -> px/s and smooth discrete integer-pixel mouse sampling
      const targetVx = sample.velocityX * 1000;
      const targetVy = sample.velocityY * 1000;
      const alphaV = 1 - Math.exp(-dt / 0.020);
      this.smoothVelX += (targetVx - this.smoothVelX) * alphaV;
      this.smoothVelY += (targetVy - this.smoothVelY) * alphaV;

      const instAccX = (this.smoothVelX - this.prevSmoothVelX) / dt;
      const instAccY = (this.smoothVelY - this.prevSmoothVelY) / dt;
      this.prevSmoothVelX = this.smoothVelX;
      this.prevSmoothVelY = this.smoothVelY;

      const alphaA = 1 - Math.exp(-dt / 0.035);
      this.smoothAccX += (instAccX - this.smoothAccX) * alphaA;
      this.smoothAccY += (instAccY - this.smoothAccY) * alphaA;
      return;
    }

    // Legacy fallback when only accelerationX/Y is supplied: preserve Newton sign (-a)
    this.hasVelocityInput = false;
    const gain = sample.phase === "released" ? 1.45 : 0.85;
    this.fallbackForceX = clamp(this.fallbackForceX - sample.accelerationX * 0.42 * gain, -2.5, 2.5);
    this.fallbackForceY = clamp(this.fallbackForceY - sample.accelerationY * 0.42 * gain, -2.5, 2.5);
  }

  step(elapsedMs: number, remainingPercent: number, narrow: boolean): GeminiCavityState {
    const dt = clamp(elapsedMs / 1000, 0.004, 0.04);
    const level = clamp(remainingPercent / 100, 0, 1);

    if (level <= 0.004) {
      this.reset();
      return this.snapshot(1, true);
    }

    const v0 = 2 * twinMeniscusRatio(level, narrow) - 1;
    if (Math.abs(v0 - this.settledEquilibriumV) > 0.06 && this.wetL !== null && this.wetR !== null) {
      // Shift tracked wet marks alongside major quota-level updates without snapping
      const shift = v0 - this.settledEquilibriumV;
      this.wetL = clamp(this.wetL + shift, -0.96, 0.96);
      this.wetR = clamp(this.wetR + shift, -0.96, 0.96);
    }
    this.settledEquilibriumV = v0;

    // Decay kinematic state smoothly between pointer events / during release coasting
    let fx: number;
    let fy: number;
    if (this.hasVelocityInput) {
      const accDecay = Math.exp(-dt / 0.055);
      const velDecay = Math.exp(-dt / 0.14);
      fx = -this.smoothAccX / 2500 - 0.80 * Math.tanh(this.smoothVelX / 680);
      fy = -this.smoothAccY / 2300 - 0.42 * Math.tanh(this.smoothVelY / 650);
      this.smoothAccX *= accDecay;
      this.smoothAccY *= accDecay;
      this.smoothVelX *= velDecay;
      this.smoothVelY *= velDecay;
      this.prevSmoothVelX = this.smoothVelX;
      this.prevSmoothVelY = this.smoothVelY;
    } else {
      fx = this.fallbackForceX;
      fy = this.fallbackForceY;
      const decay = Math.exp(-dt / 0.085);
      this.fallbackForceX *= decay;
      this.fallbackForceY *= decay;
    }

    const headroom = Math.pow(Math.sin(Math.PI * clamp(level, 0.04, 0.96)), 0.72);
    const omega = (narrow ? 15.8 : 14.0) * this.variation;
    const zeta = 0.82; // Near-critical damping: clean cohesive surge, zero oscillatory ripples
    const maxTilt = (narrow ? 0.76 : 0.70) * headroom;
    const targetTilt = maxTilt * Math.tanh(fx * 0.72);
    const tiltAccel = omega * omega * (targetTilt - this.tilt) - 2 * zeta * omega * this.tiltVel;
    this.tiltVel += tiltAccel * dt;
    this.tilt = clamp(this.tilt + this.tiltVel * dt, -0.88, 0.88);

    // 2nd-mode symmetric capillary concavity (deepens on drop weightlessness or slosh energy)
    const baseConcavity = (narrow ? 0.062 : 0.082) * headroom;
    const atRestBeforeStep =
      Math.abs(this.tilt) <= 0.0025 &&
      Math.abs(this.tiltVel) <= 0.008 &&
      this.filmL <= 0.006 &&
      this.filmR <= 0.006 &&
      Math.hypot(fx, fy) <= 0.015;
    if (this.concavity === null || atRestBeforeStep) {
      this.concavity = baseConcavity;
    }
    const weightlessClimb = Math.max(0, -fy) * 0.34;
    const kineticClimb = Math.abs(this.tilt) * 0.18 + Math.abs(this.tiltVel) * 0.032;
    const targetConcavity = clamp(
      baseConcavity + (weightlessClimb + kineticClimb) * headroom,
      0.02,
      0.56,
    );
    const tauConcavity = targetConcavity > this.concavity ? 0.045 : 0.20;
    this.concavity += (targetConcavity - this.concavity) * (1 - Math.exp(-dt / tauConcavity));

    // Area-conserving vertical shift weighted by chamber chord width
    let rawAreaOffset = 0;
    let weightSum = 0;
    const samples = 15;
    for (let i = 0; i < samples; i += 1) {
      const xi = -1 + (2 * (i + 0.5)) / samples;
      const widthWeight = Math.max(0.08, cavityHalfWidth(v0, narrow));
      const offset = -this.tilt * xi - this.concavity * Math.pow(Math.abs(xi), 2.5);
      rawAreaOffset += offset * widthWeight;
      weightSum += widthWeight;
    }
    const meanOffset = weightSum > 0 ? rawAreaOffset / weightSum : 0;

    this.edgeL = clamp(v0 + this.tilt - this.concavity - meanOffset, -0.95, 0.95);
    this.edgeR = clamp(v0 - this.tilt - this.concavity - meanOffset, -0.95, 0.95);

    if (this.wetL === null) this.wetL = this.edgeL;
    if (this.wetR === null) this.wetR = this.edgeR;

    const tauDrain = (this.drainMs / 1000) * (1.06 - (this.variation - 0.92) * 0.4);
    const pinHold = clamp(tauDrain * 0.16, 0.04, 0.16);

    const left = this.stepWallClinging(dt, this.edgeL, this.wetL, this.pinL, this.filmL, tauDrain, pinHold);
    this.wetL = left.wet;
    this.pinL = left.pin;
    this.filmL = left.film;

    const right = this.stepWallClinging(dt, this.edgeR, this.wetR, this.pinR, this.filmR, tauDrain, pinHold);
    this.wetR = right.wet;
    this.pinR = right.pin;
    this.filmR = right.film;

    const intensity = clamp(
      Math.max(
        Math.abs(this.tilt) * 1.4,
        Math.abs(this.tiltVel) * 0.25,
        Math.abs(this.concavity - baseConcavity) * 2.2,
        this.filmL,
        this.filmR,
      ),
      0,
      1,
    );

    const active =
      Math.abs(this.tilt) > 0.0025 ||
      Math.abs(this.tiltVel) > 0.008 ||
      Math.abs(this.concavity - baseConcavity) > 0.004 ||
      this.filmL > 0.006 ||
      this.filmR > 0.006 ||
      Math.hypot(fx, fy) > 0.015;

    if (!active) {
      this.tilt = 0;
      this.tiltVel = 0;
      this.concavity = baseConcavity;
      this.wetL = this.edgeL;
      this.wetR = this.edgeR;
      this.pinL = 0;
      this.pinR = 0;
      this.filmL = 0;
      this.filmR = 0;
    }

    return this.snapshot(intensity, !active);
  }

  private stepWallClinging(
    dt: number,
    edge: number,
    wet: number,
    pin: number,
    film: number,
    tauDrain: number,
    pinHold: number,
  ): { wet: number; pin: number; film: number } {
    if (edge <= wet + 0.004) {
      // Climbing UP the hydrophilic glass wall (smaller v = higher)
      const climbRate = 1 - Math.exp(-dt / 0.018);
      const nextWet = wet + (edge - wet) * climbRate;
      const nextFilm = film * Math.exp(-dt / 0.04);
      return {
        wet: nextWet,
        pin: pinHold,
        film: nextFilm < 0.01 ? 0 : nextFilm,
      };
    }

    // Receding DOWN: hold contact line briefly (pinning), then drain slowly down curved wall
    let nextPin = pin;
    let nextWet: number;
    if (nextPin > 0) {
      nextPin = Math.max(0, nextPin - dt);
      nextWet = wet + (edge - wet) * (1 - Math.exp(-dt / (tauDrain * 3.2)));
    } else {
      const expNext = wet + (edge - wet) * (1 - Math.exp(-dt / tauDrain));
      // Gentle gravity floor prevents an endless asymptotic tail
      nextWet = Math.min(edge, Math.max(expNext, wet + 0.14 * dt));
    }

    const span = Math.max(0, edge - nextWet);
    if (span < 0.008) {
      return { wet: edge, pin: 0, film: 0 };
    }
    const targetFilm = clamp(span / 0.18, 0, 1);
    const nextFilm = film + (targetFilm - film) * (1 - Math.exp(-dt / 0.022));
    return {
      wet: nextWet,
      pin: nextPin,
      film: nextFilm,
    };
  }

  private snapshot(intensity: number, settled: boolean): GeminiCavityState {
    const edgeL = this.edgeL;
    const edgeR = this.edgeR;
    const concavity = this.concavity ?? 0;
    const effTilt = (edgeL - edgeR) * 0.5;
    const baseShift = (edgeL + edgeR) * 0.5 + concavity;
    return {
      tilt: this.tilt,
      concavity,
      edgeL,
      edgeR,
      wetL: this.wetL ?? edgeL,
      wetR: this.wetR ?? edgeR,
      filmL: this.filmL,
      filmR: this.filmR,
      intensity: settled ? 0 : intensity,
      active: !settled,
      surfaceV: (xi: number) => {
        const cx = clamp(xi, -1, 1);
        return clamp(baseShift - effTilt * cx - concavity * Math.pow(Math.abs(cx), 2.5), -0.98, 0.98);
      },
    };
  }

  reset(): void {
    this.smoothVelX = 0;
    this.smoothVelY = 0;
    this.prevSmoothVelX = 0;
    this.prevSmoothVelY = 0;
    this.smoothAccX = 0;
    this.smoothAccY = 0;
    this.fallbackForceX = 0;
    this.fallbackForceY = 0;
    this.tilt = 0;
    this.tiltVel = 0;
    this.concavity = null;
    this.edgeL = 0;
    this.edgeR = 0;
    this.wetL = null;
    this.wetR = null;
    this.pinL = 0;
    this.pinR = 0;
    this.filmL = 0;
    this.filmR = 0;
  }
}
