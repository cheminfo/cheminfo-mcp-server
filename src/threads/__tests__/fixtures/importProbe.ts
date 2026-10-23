/**
 * Imports the module `workerData` names, in a fresh thread, and posts every
 * module that import resolved and how long it took.
 */

import { registerHooks } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

const resolved: string[] = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    resolved.push(result.url);
    return result;
  },
});
const started = performance.now();
await import(workerData as string);
parentPort?.postMessage({
  resolved,
  milliseconds: performance.now() - started,
});
