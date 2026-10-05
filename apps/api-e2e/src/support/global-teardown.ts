import type { ChildProcess } from 'node:child_process';

/* eslint-disable */
var __API_PROCESS__: ChildProcess | undefined;
var __TEARDOWN_MESSAGE__: string;

const STOP_TIMEOUT_MS = 10_000;

module.exports = async function () {
  // Stops the API started by the global setup.
  const child: ChildProcess | undefined = globalThis.__API_PROCESS__;
  if (child && child.exitCode === null) {
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill();
    const timer = new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS));
    await Promise.race([exited, timer]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  console.log(globalThis.__TEARDOWN_MESSAGE__);
};
