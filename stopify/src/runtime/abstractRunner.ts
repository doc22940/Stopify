import { RuntimeOpts, AsyncRun } from '../types';
import { Runtime } from 'stopify-continuations/dist/src/types';
import { RuntimeWithSuspend, badResume } from './suspend';
import { makeEstimator } from './elapsedTimeEstimator';
import { Result } from 'stopify-continuations/dist/src/types';

enum EventProcessingMode {
  Running,
  Paused,
  Waiting
}

interface EventHandler {
  body: () => void;
  receiver: (x: Result) => void;
}

export abstract class AbstractRunner implements AsyncRun {
  private continuationsRTS: Runtime;
  private suspendRTS: RuntimeWithSuspend;
  private onDone: () => void = function() { };
  private onYield: () => void = function() {  };
  private onBreakpoint: (line: number) => void = function() { };
  private breakpoints: number[] = [];
  private k: any;
  // The runtime system starts executing the main body of the program.
  private eventMode = EventProcessingMode.Running;
  private eventQueue: EventHandler[] = [];

  constructor(private opts: RuntimeOpts) { }

  private mayYieldRunning(): boolean {
    const n = this.suspendRTS.rts.linenum;
    if (typeof n !== 'number') {
      return false;
    }
    return this.breakpoints.includes(n);
  }

  private onYieldRunning() {
    if (this.mayYieldRunning()) {
      this.onBreakpoint(this.suspendRTS.rts.linenum!);
      return false;
    }
    else {
      this.onYield();
      return true;
    }
  }

  /**
   * Indirectly called by the stopified program.
   */
  init(rts: Runtime) {
    this.continuationsRTS = rts;
    const estimator = makeEstimator(this.opts);
    this.suspendRTS = new RuntimeWithSuspend(this.continuationsRTS,
      this.opts.yieldInterval, estimator);
    this.suspendRTS.mayYield = () => this.mayYieldRunning();
    this.suspendRTS.onYield = () => this.onYieldRunning();
    return this;
  }

  /**
   * Called by the stopified program.
   */
  suspend() {
    return this.suspendRTS.suspend();
  }

  /**
   * Called by the stopfied program.
   */
  onEnd(): void {
    if (this.continuationsRTS.delimitDepth === 1) {
      this.eventMode = EventProcessingMode.Waiting;
      this.onDone();
      this.processQueuedEvents();
    }
  }

  runInit(onDone: () => void,
    onYield?: () => void,
    onBreakpoint?: (line: number) => void) {
    if (onYield) {
      this.onYield = onYield;
    }
    if (onBreakpoint) {
      this.onBreakpoint = onBreakpoint;
    }
    this.onDone = onDone;
  }

  abstract run(onDone: () => void,
    onYield?: () => void,
    onBreakpoint?: (line: number) => void): void;

  pause(onPaused: (line?: number) => void) {
    if (this.eventMode === EventProcessingMode.Paused) {
      throw new Error('the program is already paused');
    }

    if (this.eventMode === EventProcessingMode.Waiting) {
      this.suspendRTS.onYield = function() {
        throw new Error('Stopify internal error: onYield invoked during pause+wait');
      }
      onPaused(); // onYield will not be invoked
    }
    else {
      this.suspendRTS.onYield = () => {
        this.suspendRTS.onYield = () => {
          this.onYield();
          return true;
        };
        const maybeLine = this.suspendRTS.rts.linenum;
        if (typeof maybeLine === 'number') {
          onPaused(maybeLine);
        }
        else {
          onPaused();
        }
        return false;
      };
    }

    this.eventMode = EventProcessingMode.Paused;
  }

  setBreakpoints(lines: number[]): void {
    this.breakpoints = lines;
  }

  resume() {
    if (this.eventMode === EventProcessingMode.Waiting) {
      return;
    }

    if (this.eventMode === EventProcessingMode.Running) {
      throw new Error(`invokes .resume() while the program is running`);
    }

    // Program was paused, but there was no active continuation.
    if (this.suspendRTS.continuation === badResume) {
      this.eventMode = EventProcessingMode.Waiting;
      this.processQueuedEvents();
    }
    else {
      this.eventMode = EventProcessingMode.Running;
      this.suspendRTS.mayYield = () => this.mayYieldRunning();
      this.suspendRTS.onYield = () => this.onYieldRunning();
      this.suspendRTS.resumeFromCaptured();
    }
  }

  step(onStep: (line: number) => void) {
    if (this.eventMode !== EventProcessingMode.Paused) {
      throw new Error(`step(onStep) requires the program to be paused`);
    }

    // NOTE: The program remains Paused while stepping.
    const currentLine = this.suspendRTS.rts.linenum;
    // Yield control if the line number changes.
    const mayYield = () => {
      const n = this.suspendRTS.rts.linenum;
      if (typeof n !== 'number') {
        return false;
      }
      if (n !== currentLine) {
        onStep(n);
        return true;
      }
      else {
        return false;
      }
    };
    this.suspendRTS.mayYield = mayYield;
    // Pause if the line number changes.
    this.suspendRTS.onYield = () => !mayYield();
    this.suspendRTS.resumeFromCaptured();
  }

  pauseImmediate(callback: () => void): void {
    // NOTE: We don't switch the mode to paused! This is because we don't want
    // the user to be able to hit "step" at this point.
    return this.continuationsRTS.captureCC((k) => {
      return this.continuationsRTS.endTurn(onDone => {
        this.k = { k, onDone }
        callback();
      });
    });
  }

  continueImmediate(result: any): void {
    const { k, onDone } = this.k;
    this.k = undefined;
    return this.continuationsRTS.runtime(() => k(result), (result) => onDone(result));
  }

  processEvent(body: () => void, receiver: (x: Result) => void): void {
    this.eventQueue.push({ body, receiver } );
    this.processQueuedEvents();
  }

  private processQueuedEvents() {
    if (this.eventMode !== EventProcessingMode.Waiting) {
      return;
    }

    const eventHandler = this.eventQueue.shift();
    if (eventHandler === undefined) {
      return;
    }
    const { body, receiver } = eventHandler;
    this.eventMode = EventProcessingMode.Running;
    this.continuationsRTS.runtime(body, (result) => {
      this.eventMode = EventProcessingMode.Waiting;
      receiver(result);
      this.processQueuedEvents();
    });
  }
}