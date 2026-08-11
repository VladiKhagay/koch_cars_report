import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/**
 * Landing page for Supabase invite links. The link carries a one-time token
 * in the URL hash; supabase-js exchanges it for a session automatically on
 * load. Registration is complete only after the invitee sets a password
 * here — there is no self-signup path anywhere in the app.
 */
export default function Welcome() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // supabase-js processes the invite hash asynchronously; onAuthStateChange
    // covers the exchange finishing after our first getSession check.
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setHasSession(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t('welcome.tooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('welcome.mismatch'));
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    navigate('/', { replace: true });
  }

  if (!ready) return null;

  if (!hasSession) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-50 px-6">
        <p className="max-w-sm text-center text-sm text-slate-600">{t('welcome.invalidLink')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-6">
      <form onSubmit={(e) => void handleSubmit(e)} className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-xl font-semibold text-slate-900">{t('welcome.title')}</h1>
        <p className="text-center text-sm text-slate-500">{t('welcome.subtitle')}</p>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">{t('welcome.password')}</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">{t('welcome.confirm')}</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-brand-600 py-3.5 font-semibold text-white disabled:opacity-60"
        >
          {saving ? t('common.loading') : t('welcome.finish')}
        </button>
      </form>
    </div>
  );
}
