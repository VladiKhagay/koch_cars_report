import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Logo from '../components/Logo';
import StatusBanner from '../components/StatusBanner';
import {
  AuthShell,
  Button,
  Field,
  LanguageToggle,
  Skeleton,
  fieldClass,
  fieldErrorClass,
} from '../components/ui';

/** Landing page for invite links: supabase-js exchanges the URL-hash token for a session, and registration completes when the invitee sets a password. No self-signup exists. */
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

    /* The token exchange takes a moment on a yard connection; show a skeleton, not a blank screen. */
  if (!ready) {
    return (
      <AuthShell>
        <div role="status" aria-live="polite">
          <span className="sr-only">{t('common.loading')}</span>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-8 h-8 w-3/5" />
          <Skeleton className="mt-3 h-4 w-4/5" />
          <Skeleton className="mt-8 h-control w-full" />
          <Skeleton className="mt-4 h-control w-full" />
        </div>
      </AuthShell>
    );
  }

  if (!hasSession) {
    return (
      <AuthShell footer={<LanguageToggle compact />}>
        <div className="text-ink-900">
          <Logo height={24} title={t('app.name')} />
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tighter text-ink-900 sm:text-3xl">
          {t('welcome.invalidTitle')}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-600">{t('welcome.invalidLink')}</p>

        <Button size="lg" block className="mt-8" onClick={() => navigate('/', { replace: true })}>
          {t('welcome.goToSignIn')}
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell footer={<LanguageToggle compact />}>
      <div className="text-ink-900">
        <Logo height={24} title={t('app.name')} />
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tighter text-ink-900 sm:text-3xl">{t('welcome.title')}</h1>
      <p className="mt-2 text-base text-ink-600">{t('welcome.subtitle')}</p>

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-4">
        {/* The length rule is stated before it can be broken rather than only
            as an error after the fact. */}
        <Field htmlFor="welcome-password" label={t('welcome.password')}>
          <input
            id="welcome-password"
            type="password"
            required
            autoComplete="new-password"
            enterKeyHint="next"
            aria-describedby="welcome-password-hint"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            className={fieldClass}
          />
          <p id="welcome-password-hint" className="mt-2 text-sm text-ink-600">
            {t('welcome.tooShort')}
          </p>
        </Field>

        <Field htmlFor="welcome-confirm" label={t('welcome.confirm')}>
          <input
            id="welcome-confirm"
            type="password"
            required
            autoComplete="new-password"
            enterKeyHint="go"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setError(null);
            }}
            className={`${fieldClass} ${error === t('welcome.mismatch') ? fieldErrorClass : ''}`}
          />
        </Field>

        {error && (
          <StatusBanner tone="error" live>
            {error}
          </StatusBanner>
        )}

        <Button type="submit" size="lg" block busy={saving}>
          {t('welcome.finish')}
        </Button>
      </form>
    </AuthShell>
  );
}
