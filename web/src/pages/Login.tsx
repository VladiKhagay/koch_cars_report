import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import Logo from '../components/Logo';
import StatusBanner from '../components/StatusBanner';
import { AuthShell, Button, Field, LanguageToggle, fieldClass, fieldErrorClass } from '../components/ui';

export default function Login() {
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  if (!loading && session) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(false);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) setError(true);
  }

  return (
    <AuthShell footer={<LanguageToggle compact />}>
      {/* The wordmark is the brand moment; the heading is the product. Neither
          is an eyebrow for the other, so they carry different weights. */}
      <div className="text-ink-900">
        <Logo height={24} title={t('app.name')} />
      </div>

      <h1 className="mt-8 text-3xl font-semibold tracking-tighter text-ink-900">{t('auth.signIn')}</h1>
      <p className="mt-2 text-base text-ink-600">{t('app.signInLead')}</p>

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-5">
        <Field htmlFor="login-email" label={t('auth.email')}>
          <input
            id="login-email"
            type="email"
            required
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="next"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(false);
            }}
            className={`${fieldClass} ${error ? fieldErrorClass : ''}`}
          />
        </Field>

        <Field htmlFor="login-password" label={t('auth.password')}>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            enterKeyHint="go"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            className={`${fieldClass} ${error ? fieldErrorClass : ''}`}
          />
        </Field>

        {/* One error treatment, the same one the rest of the app uses — and it
            names the recovery rather than only reporting the failure. */}
        {error && (
          <StatusBanner tone="error" live>
            {t('auth.error')}
          </StatusBanner>
        )}

        <Button type="submit" size="lg" block busy={submitting}>
          {submitting ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>

      {/* There is no self-service reset, so the screen has to say what to do
          instead of showing a "Forgot password?" link that goes nowhere. */}
      <p className="mt-8 border-t border-line pt-6 text-sm leading-relaxed text-ink-600">
        {t('auth.forgotHelp')}
      </p>
    </AuthShell>
  );
}
