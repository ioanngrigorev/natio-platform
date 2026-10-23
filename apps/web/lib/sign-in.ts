import { apiClient, ApiRequestError } from './api';

export type WorkspaceKind = 'merchant' | 'admin';
export const workspacePath = (kind: WorkspaceKind) => kind === 'admin' ? '/admin' : '/dashboard';

/** Both entry pages accept existing credentials. The API still authenticates
 * each account and issues its own scoped cookie; no role is inferred from email.
 * Try the other workspace only after an explicit credential rejection. Never
 * retry locks, throttling, disabled accounts or an uncertain network response.
 */
export async function signInToWorkspace(preferred: WorkspaceKind, credentials: {email: string; password: string}): Promise<WorkspaceKind> {
  const body = {email: credentials.email.trim(), password: credentials.password};
  try {
    await apiClient(`${workspacePath(preferred)}/auth/login`, {body});
    return preferred;
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 401 || error.code !== 'unauthorized' || error.message !== 'Invalid email or password') throw error;
  }
  const other: WorkspaceKind = preferred === 'admin' ? 'merchant' : 'admin';
  await apiClient(`${workspacePath(other)}/auth/login`, {body});
  return other;
}
