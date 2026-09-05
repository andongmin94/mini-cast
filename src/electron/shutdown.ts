/** A failed cleanup step must not prevent input hooks or native windows closing. */
export function runCleanupSteps(
  steps: readonly (() => void)[],
  reportError: (error: unknown) => void = console.error,
) {
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      reportError(error);
    }
  }
}
