import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import StatusBanner from '../components/StatusBanner';
import {
  Button,
  Card,
  ConfirmAction,
  DataList,
  Field,
  LanguageToggle,
  Page,
  PageHeading,
  SectionHeading,
  fieldClass,
  fieldErrorClass,
} from '../components/ui';

export default function Profile() {
  const { t } = useTranslation();
  const { appUser, session, signOut, refreshAppUser } = useAuth();
  const [name, setName] = useState(appUser?.name ?? '');
  const [siteName, setSiteName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nameStatus, setNameStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [pwStatus, setPwStatus] = useState<'idle' | 'saved' | 'error' | 'mismatch' | 'tooShort'>('idle');
  const [savingName, setSavingName] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!appUser?.site_id) return;
    supabase
      .from('sites')
      .select('name')
      .eq('id', appUser.site_id)
      .single()
      .then(({ data }) => setSiteName(data?.name ?? null));
  }, [appUser?.site_id]);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingName(true);
    setNameStatus('idle');
    const { error } = await supabase.rpc('update_my_name', { p_name: name.trim() });
    setSavingName(false);
    if (error) {
      setNameStatus('error');
      return;
    }
    setNameStatus('saved');
    await refreshAppUser();
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPwStatus('idle');
    if (password.length < 8) {
      setPwStatus('tooShort');
      return;
    }
    if (password !== confirm) {
      setPwStatus('mismatch');
      return;
    }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSavingPw(false);
    if (error) {
      setPwStatus('error');
      return;
    }
    setPassword('');
    setConfirm('');
    setPwStatus('saved');
  }

  return (
    <Page width="form" className="space-y-5">
      <PageHeading>{t('profile.title')}</PageHeading>

      {/*
        Identity first, and the read-only facts sit with the one editable one.
        Role and site are here because they decide what this person can see —
        a worker who has been moved to the wrong site needs to be able to spot
        that themselves rather than discover it as a missing car.
      */}
      <Card className="p-5">
        <SectionHeading icon="user">{t('profile.account')}</SectionHeading>

        <DataList
          items={[
            { label: t('auth.email'), value: session?.user.email ?? '—' },
            { label: t('profile.role'), value: appUser ? t(`roles.${appUser.role}`) : '—' },
            {
              label: t('profile.site'),
              value: siteName ?? <span className="font-normal text-ink-600">{t('profile.noSite')}</span>,
            },
          ]}
        />

        <form onSubmit={(e) => void saveName(e)} className="mt-5 space-y-4 border-t border-line pt-5">
          <Field htmlFor="profile-name" label={t('profile.name')}>
            <input
              id="profile-name"
              value={name}
              autoComplete="name"
              onChange={(e) => {
                setName(e.target.value);
                setNameStatus('idle');
              }}
              className={fieldClass}
            />
          </Field>

          {nameStatus === 'saved' && (
            <StatusBanner tone="success" live>
              {t('profile.saved')}
            </StatusBanner>
          )}
          {nameStatus === 'error' && (
            <StatusBanner tone="error" live>
              {t('common.error')}
            </StatusBanner>
          )}

          <Button type="submit" busy={savingName} disabled={!name.trim() || name.trim() === appUser?.name}>
            {t('profile.saveName')}
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <SectionHeading icon="lock">{t('profile.passwordSection')}</SectionHeading>

        <form onSubmit={(e) => void savePassword(e)} className="space-y-4">
          <Field htmlFor="profile-password" label={t('profile.newPassword')}>
            <input
              id="profile-password"
              type="password"
              autoComplete="new-password"
              aria-describedby="profile-password-hint"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPwStatus('idle');
              }}
              className={`${fieldClass} ${pwStatus === 'tooShort' ? fieldErrorClass : ''}`}
            />
            <p id="profile-password-hint" className="mt-2 text-sm text-ink-600">
              {t('welcome.tooShort')}
            </p>
          </Field>

          <Field htmlFor="profile-confirm" label={t('welcome.confirm')}>
            <input
              id="profile-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setPwStatus('idle');
              }}
              className={`${fieldClass} ${pwStatus === 'mismatch' ? fieldErrorClass : ''}`}
            />
          </Field>

          {pwStatus === 'tooShort' && (
            <StatusBanner tone="error" live>
              {t('welcome.tooShort')}
            </StatusBanner>
          )}
          {pwStatus === 'mismatch' && (
            <StatusBanner tone="error" live>
              {t('welcome.mismatch')}
            </StatusBanner>
          )}
          {pwStatus === 'error' && (
            <StatusBanner tone="error" live>
              {t('common.error')}
            </StatusBanner>
          )}
          {pwStatus === 'saved' && (
            <StatusBanner tone="success" live>
              {t('profile.saved')}
            </StatusBanner>
          )}

          <Button type="submit" busy={savingPw} disabled={!password || !confirm}>
            {t('profile.savePassword')}
          </Button>
        </form>
      </Card>

      {/*
        The only language switch in the product. It was exported from lib/i18n
        and wired to nothing, which left a bilingual app with no way to change
        language — for a Russian-speaking worker that is the whole interface.
      */}
      <Card className="p-5">
        <SectionHeading icon="language">{t('profile.languageSection')}</SectionHeading>
        <LanguageToggle block />
      </Card>

      {/* Sign-out lives here, one tap behind the app's standard confirmation —
          on a shared phone in a yard, an accidental sign-out costs a worker
          their whole shift's ability to submit. */}
      <ConfirmAction
        variant="secondary"
        block
        icon="signOut"
        trigger={t('auth.signOut')}
        question={t('profile.signOutConfirm')}
        confirmLabel={t('auth.signOut')}
        onConfirm={() => void signOut()}
      />
    </Page>
  );
}
