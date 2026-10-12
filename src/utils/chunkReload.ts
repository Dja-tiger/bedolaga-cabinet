export function reloadAfterChunkFailure(): boolean {
  // If storage is blocked, a reload cannot carry a loop guard across launches.
  try {
    const key = 'chunk_reload_ts';
    const now = Date.now();
    if (now - Number(sessionStorage.getItem(key) || '0') <= 30_000) return false;
    sessionStorage.setItem(key, String(now));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
