/**
 * Serialize OTP inbox polls per applier so concurrent sessions don't stampede IMAP/AI.
 */
const otpLocks = new Map<string, Promise<void>>();

export async function withOtpMutex<T>(applierName: string, fn: () => Promise<T>): Promise<T> {
  const key = String(applierName || "").trim() || "_default";
  const prev = otpLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  otpLocks.set(
    key,
    prev.then(() => gate).catch(() => {}),
  );
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}
