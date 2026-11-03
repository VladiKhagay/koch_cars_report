import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import StatusBanner from '../components/StatusBanner';
import { AuthShell, Button, Field, LanguageToggle, fieldClass } from '../components/ui';

/** Asks the Worker to email a recovery link. It lands on /welcome, which already turns the URL-hash session into a "set password" form. */
export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    // Through the Worker, which mails only invited, active users; it answers 200 either way.
    const res = await fetch(`${import.meta.env.VITE_WORKER_URL}/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) setSent(true);
    else setError(true);
  }

  return (
    <AuthShell footer={<LanguageToggle compact />}>
      <div className="text-ink-900">
        <Logo height={28} title={t('app.name')} />
      </div>
      <h1 className="mt-8 text-2xl font-semibold tracking-tighter text-ink-900 sm:text-3xl">{t('forgot.title')}</h1>

      {sent ? (
        <div className="mt-6">
          <StatusBanner tone="success" live>
            {t('forgot.sent')}
          </StatusBanner>
        </div>
      ) : (
        <>
          <p className="mt-2 text-base text-ink-600">{t('forgot.lead')}</p>
          <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-4">
            <Field htmlFor="forgot-email" label={t('auth.email')}>
              <input
                id="forgot-email"
                type="email"
                required
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldClass}
              />
            </Field>
            {error && (
              <StatusBanner tone="error" live>
                {t('forgot.error')}
              </StatusBanner>
            )}
            <Button type="submit" size="lg" block busy={busy}>
              {t('forgot.send')}
            </Button>
          </form>
        </>
      )}

      <p className="mt-8 border-t border-line pt-6 text-sm">
        <Link to="/login" className="font-medium text-ink-900 underline">
          {t('forgot.back')}
        </Link>
      </p>
    </AuthShell>
  );
}
