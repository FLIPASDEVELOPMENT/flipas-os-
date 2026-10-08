/** Jobs have a deadline shorter than their durable lease. Providers must honor abort. */
export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  milliseconds = 90000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("JOB_TIMEOUT"));
          controller.abort(new Error("JOB_TIMEOUT"));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
