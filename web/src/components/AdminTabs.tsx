import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon, { type IconName } from './Icon';

export default function AdminTabs({ active }: { active: 'users' | 'services' | 'sites' }) {
  const { t } = useTranslation();
  const tabs: { key: string; to: string; label: string; icon: IconName }[] = [
    { key: 'users', to: '/admin/users', label: t('admin.users'), icon: 'users' },
    { key: 'services', to: '/services', label: t('admin.services'), icon: 'tag' },
    { key: 'sites', to: '/admin/sites', label: t('admin.sites'), icon: 'grid' },
  ];

  return (
    <div className="flex flex-wrap gap-2 border-b border-line pb-3">
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <NavLink
            key={tab.key}
            to={tab.to}
            aria-current={isActive ? 'page' : undefined}
            className={`inline-flex min-h-tap items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold transition-colors duration-150 ${
              isActive
                ? 'border-ink-900 bg-ink-900 text-surface'
                : 'border-line-strong bg-surface text-ink-800 hover:bg-ink-50'
            }`}
          >
            <Icon name={tab.icon} size={18} className={isActive ? '' : 'text-ink-500'} />
            {tab.label}
          </NavLink>
        );
      })}
    </div>
  );
}
