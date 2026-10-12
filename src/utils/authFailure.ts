import axios from 'axios';

export function isTemporaryAuthFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error) || axios.isCancel(error)) return false;
  const status = error.response?.status;
  return !status || status === 429 || status >= 500;
}
