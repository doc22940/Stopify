import * as common from './runtime';
export * from './runtime';

export class LazyRuntime extends common.Runtime {
  constructor() {
    super();
  }

  captureCC(f: (k: any) => any): void {
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
    }
    catch (exn) {
      if (exn instanceof common.Capture) {
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
          this.mode = 'restoring';
          this.stack = exn.stack;
          this.stack[this.stack.length - 1].f();
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
    if (this.mode === "normal") {
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

    try {
      if (this.mode === "normal") {
        constr.apply(obj, args);
      }
      else {
        this.stack[this.stack.length - 1].f.apply(obj, []);
      }
    }
    catch (exn) {
      if (exn instanceof common.Capture) {
        exn.stack.push({
          kind: "rest",
          f: () => this.handleNew(constr, ...args) ,
          locals: [obj],
          index: 0
        });
      }
      throw exn;
    }
    return obj;
  }
}

export default new LazyRuntime();