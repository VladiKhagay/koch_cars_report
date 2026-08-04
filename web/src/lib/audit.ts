import { supabase } from './supabase';

export async function recordAudit(jobId: string, userId: string, action: string, changes?: Record<string, unknown>) {
  // Best-effort: a failed audit write should never block the underlying
  // save the user is waiting on.
  try {
    await supabase.from('audit_log').insert({ job_id: jobId, user_id: userId, action, changes: changes ?? null });
  } catch {
    // ignore — see comment above
  }
}
