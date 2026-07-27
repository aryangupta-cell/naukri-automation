/** Retries an async operation once on failure, with a short pause between attempts. */
export async function retryOnce<T>(fn: () => Promise<T>, pauseMs = 1000): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    return fn();
  }
}
