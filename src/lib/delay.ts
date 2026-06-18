/** Resolves after `ms` milliseconds. Used to simulate database latency. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
