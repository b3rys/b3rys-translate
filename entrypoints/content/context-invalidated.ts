let invalidated = false;

export function isContextInvalidated(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.includes('Extension context invalidated') ||
    msg.includes('Receiving end does not exist') ||
    (err instanceof TypeError && msg.includes('Cannot read properties of undefined'))
  );
}

/** Mark context as invalidated — FAB click will show toast instead of translating */
export function markContextInvalidated(): void {
  invalidated = true;
}

/** Check if context has been marked as invalidated */
export function isMarkedInvalidated(): boolean {
  return invalidated;
}
