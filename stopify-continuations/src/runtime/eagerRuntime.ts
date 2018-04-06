import * as common from './abstractRuntime';
export * from './abstractRuntime';
import { Result } from '../types';

export class EagerRuntime extends common.Runtime {
  eagerStack: common.Stack;

  constructor(stackSize: number, restoreFrames: number) {
    super(stackSize, restoreFrames);
    this.eagerStack = [];
  }

  captureCC(f: (k: any) => any) {
    this.capturing = true;
    throw new common.Capture(f, [...this.eagerStack]);
  }

  makeCont(stack: common.Stack) {
    return (v: any, err: any=this.noErrorProvided) => {
      var throwExn = err !== this.noErrorProvided;
      let restarter = () => {
        if(throwExn) { throw err; }
        else { return v; }
      };
      this.eagerStack = [...stack];
      throw new common.Restore([this.topK(restarter), ...stack], []);
    };
  }

  endTurn(callback: (onDone: (x: Result) => any) => any): never {
    throw new common.EndTurn(callback);
  }

  abstractRun(body: () => any): common.RunResult {
    try {
      const v = body();
      return { type: 'normal', value: v };
    }
    catch (exn) {
      if (exn instanceof common.Capture) {
        this.capturing = false;
        return { type: 'capture', stack: exn.stack, f: exn.f };
      }
      else if (exn instanceof common.Restore) {
        return { type: 'restore', stack: exn.stack, savedStack: exn.savedStack };
      }
      else if (exn instanceof common.EndTurn) {
        return { type: 'end-turn', callback: exn.callback };
      }
      else {
        return { type: 'exception', value: exn };
      }
    }
  }
}