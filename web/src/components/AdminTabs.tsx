import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function AdminTabs({ active }: { active: 'users' | 'services' | 'sites' }) {
  const { t } = useTranslation();
  const tabs = [
    { key: 'users', to: '/admin/users', label: t('admin.users') },
    { key: 'services', to: '/admin/services', label: t('admin.services') },
    { key: 'sites', to: '/admin/sites', label: t('admin.sites') },
  ] as const;

  return (
    <div className="flex gap-2 border-b border-slate-200 pb-2">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          to={tab.to}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${
            active === tab.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
