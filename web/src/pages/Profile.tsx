import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import StatusBanner from '../components/StatusBanner';

export default function Profile() {
  const { t } = useTranslation();
  const { appUser, session, refreshAppUser } = useAuth();
  const [name, setName] = useState(appUser?.name ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nameStatus, setNameStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [pwStatus, setPwStatus] = useState<'idle' | 'saved' | 'error' | 'mismatch' | 'tooShort'>('idle');
  const [saving, setSaving] = useState(false);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setNameStatus('idle');
    const { error } = await supabase.rpc('update_my_name', { p_name: name.trim() });
    setSaving(false);
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
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setPwStatus('error');
      return;
    }
    setPassword('');
    setConfirm('');
    setPwStatus('saved');
  }

  const inputClass = 'h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base';

  return (
    <div className="mx-auto max-w-md space-y-6 p-4">
      <h1 className="text-xl font-bold text-slate-900">{t('profile.title')}</h1>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('auth.email')}</p>
        <p className="mt-1 text-slate-900">{session?.user.email}</p>
      </div>

      <form onSubmit={(e) => void saveName(e)} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('profile.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        {nameStatus === 'saved' && <StatusBanner tone="success">{t('profile.saved')}</StatusBanner>}
        {nameStatus === 'error' && <StatusBanner tone="error">{t('common.error')}</StatusBanner>}
        <button type="submit" disabled={saving} className="w-full rounded-xl bg-brand-600 py-3 font-semibold text-white disabled:opacity-60">
          {t('profile.saveName')}
        </button>
      </form>

      <form onSubmit={(e) => void savePassword(e)} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('profile.newPassword')}</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{t('welcome.confirm')}</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </label>
        {pwStatus === 'tooShort' && <StatusBanner tone="error">{t('welcome.tooShort')}</StatusBanner>}
        {pwStatus === 'mismatch' && <StatusBanner tone="error">{t('welcome.mismatch')}</StatusBanner>}
        {pwStatus === 'error' && <StatusBanner tone="error">{t('common.error')}</StatusBanner>}
        {pwStatus === 'saved' && <StatusBanner tone="success">{t('profile.saved')}</StatusBanner>}
        <button type="submit" disabled={saving} className="w-full rounded-xl bg-brand-600 py-3 font-semibold text-white disabled:opacity-60">
          {t('profile.savePassword')}
        </button>
      </form>
    </div>
  );
}
