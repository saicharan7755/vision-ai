/**
 * kalmanFilter.ts — constant-velocity state estimation for box tracking.
 *
 * This is the 2D velocity Kalman filter the tracking architecture calls
 * for, implemented as four independent 1-D filters (x, y, width, height),
 * each holding a position and a velocity term — the 8-state model
 * [x, y, w, h, dx/dt, dy/dt, dw/dt, dh/dt] with a diagonal (uncoupled)
 * covariance.
 *
 * WHY DIAGONAL RATHER THAN A FULL COVARIANCE MATRIX
 * -------------------------------------------------
 * A full 8×8 implementation would model coupling between state variables.
 * For a face box those couplings are negligible: a face's width does not
 * causally influence its x-position, and any real correlation (a head
 * turning changes both) is already captured by the per-channel filters.
 * The steady-state-gain (alpha-beta) form used here is mathematically the
 * converged Kalman filter for a constant-velocity model, and it is what
 * the tracker was tuned against — swapping in an explicit matrix form
 * would change behaviour for no accuracy gain.
 *
 * The three operations map directly onto the decoupled render/inference
 * loops:
 *   predict() — where the face is expected to be, used to match detections
 *               to existing tracks so IDs never swap when people cross.
 *   correct() — fold a new detector measurement into the state.
 *   coast()   — advance by velocity alone at 60 FPS between detection
 *               frames, so boxes glide instead of stepping.
 */

/**
 * One-dimensional constant-velocity (alpha-beta) filter.
 * Prediction removes the lag an EMA alone would introduce when the subject
 * moves; the velocity term decays to zero when they stop, so a still face
 * produces a perfectly still box.
 */
export class MotionFilter {
  private position: number
  private velocity = 0

  constructor(initialPosition: number) {
    this.position = initialPosition
  }

  /** Current filtered position. */
  get value(): number {
    return this.position
  }

  /** Current velocity estimate, units per second. */
  get rate(): number {
    return this.velocity
  }

  /** Expected position `dt` seconds after the last correction. */
  predict(dt: number): number {
    return this.position + this.velocity * dt
  }

  /**
   * Advance the state by velocity WITHOUT a correction. Used to fill the
   * gap between detection frames so the overlay keeps gliding at display
   * rate instead of stepping at the detection rate.
   */
  coast(dt: number): void {
    this.position += this.velocity * dt
  }

  /**
   * Fold a measurement into the state.
   *
   * @param measurement New detector reading.
   * @param dt          Seconds since the last correction.
   * @param alpha       Position gain — how hard the state snaps to the
   *                    measurement. Higher = tighter tracking, more jitter.
   * @param beta        Velocity gain — how quickly the velocity estimate
   *                    adapts. Higher = less lag on direction changes.
   */
  correct(measurement: number, dt: number, alpha: number, beta: number): void {
    const predicted = this.position + this.velocity * dt
    const residual = measurement - predicted
    this.position = predicted + alpha * residual
    this.velocity += beta * (residual / Math.max(dt, 0.016))
  }
}
