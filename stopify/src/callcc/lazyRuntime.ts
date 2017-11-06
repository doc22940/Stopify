import * as common from './runtime';
export * from './runtime';
import { ElapsedTimeEstimator } from '../elapsedTimeEstimator';
import * as assert from 'assert';

export class LazyRuntime extends common.Runtime {
  constructor(yieldInterval: number, estimator: ElapsedTimeEstimator) {
    super(yieldInterval, estimator);
  }

  captureCC(f: (k: any) => any): void {
    this.capturing = true;
    throw new common.Capture(f, []);
  }

  abortCC(f: () => any) {
    throw new common.Discard(f);
  }

  makeCont(stack: common.Stack) {
    return (v: any) => {
      throw new common.Restore([this.topK(() => v), ...stack]);
    };
  }

  runtime(body: () => any): any {
    try {
      body();
      assert(this.mode, 'executing completed in restore mode');
    }
    catch (exn) {
      if (exn instanceof common.Capture) {
        this.capturing = false;
        // Recursive call to runtime addresses nested continuations. The return
        // statement ensures that the invocation is in tail position.
        // At this point, exn.stack is the continuation of callCC, but doesn’t have
        // a top-of-stack frame that actually restores the saved continuation. We
        // need to apply the function passed to callCC to the stack here, because
        // this is the only point where the whole stack is ready.
        // Doing exn.f makes "this" wrong.
        return this.runtime(() => exn.f.call(global, this.makeCont(exn.stack)));
      } else if (exn instanceof common.Discard) {
        return this.runtime(() => exn.f());
      } else if (exn instanceof common.Restore) {
        // The current continuation has been discarded and we now restore the
        // continuation in exn.
        return this.runtime(() => {
          if (exn.stack.length === 0) {
            throw new Error(`Can't restore from empty stack`);
          }
          this.mode = false;
          this.stack = exn.stack;
          const frame = this.stack[this.stack.length - 1];
          frame.f.apply(frame.this, frame.args);
        });
      } else {
        throw exn; // userland exception
      }
    }
  }

  handleNew(constr: any, ...args: any[]) {
    if (common.knownBuiltIns.includes(constr)) {
      return new constr(...args);
    }

    let obj;
    if (this.mode) {
      obj = Object.create(constr.prototype);
    } else {
      const frame = this.stack[this.stack.length - 1];
      if (frame.kind === "rest") {
        [obj] = frame.locals;
      } else {
        throw "bad";
      }
      this.stack.pop();
    }

    let result: any;
    try {
      if (this.mode) {
        result = constr.apply(obj, args);
      }
      else {
        result = constr.apply(obj, this.stack[this.stack.length-1].args);
      }
    }
    catch (exn) {
      if (exn instanceof common.Capture) {
        exn.stack.push({
          kind: "rest",
          f: this.handleNew,
          this: this,
          args: <any>arguments,
          locals: [obj],
          index: 0
        });
      }
      throw exn;
    }

    if (typeof result === 'object') {
      return result;
    }
    else {
      return obj;
    }
  }
}

export default LazyRuntime;
