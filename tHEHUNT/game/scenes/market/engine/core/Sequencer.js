/**
 * Sequencer — runs GSAP timelines one after another with cancellation.
 *
 * Cinematics are written as async functions:
 *     if (!(await seq.run(tlA))) return;   // cancelled → stop cleanly
 *     if (!(await seq.run(buildB()))) return;
 * Each step is BUILT when it starts, so it reads the live scene state
 * (current hand positions, current camera), which avoids snapping.
 */
export class Sequencer {
  constructor() {
    this.current = null;
    this._resolve = null;
    this.token = 0;
    this.speed = 1; // playback rate for every step (repeat visits run brisker)
  }

  run(tl) {
    const token = this.token;
    return new Promise((resolve) => {
      if (token !== this.token) { tl?.kill(); resolve(false); return; }
      this.current = tl;
      this._resolve = resolve;
      tl.eventCallback('onComplete', () => {
        if (this.current === tl) { this.current = null; this._resolve = null; }
        resolve(token === this.token);
      });
      if (this.speed !== 1) tl.timeScale(tl.timeScale() * this.speed);
      if (tl.paused()) tl.play();
    });
  }

  /** Wait (seconds) — cancellable. */
  wait(sec, gsap) {
    return this.run(gsap.timeline().to({}, { duration: sec }));
  }

  /** Kill whatever is running; pending awaits resolve to false. */
  cancel() {
    this.token++;
    this.current?.kill();
    this.current = null;
    const r = this._resolve;
    this._resolve = null;
    r?.(false);
  }

  get busy() { return !!this.current; }
}
