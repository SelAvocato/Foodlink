export interface CleanupStore {
  run(otpDays: number, notificationDays: number): Promise<void>;
}

export async function runCleanup(
  deps: { store: CleanupStore },
  options: { otpDays?: number; notificationDays?: number } = {},
): Promise<{ otpDays: number; notificationDays: number }> {
  const otpDays = options.otpDays ?? 1;
  const notificationDays = options.notificationDays ?? 90;
  await deps.store.run(otpDays, notificationDays);
  return { otpDays, notificationDays };
}
