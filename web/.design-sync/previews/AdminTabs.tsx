import { AdminTabs } from 'web';

// AdminTabs renders react-router <Link>s; the DSProvider wrapper supplies the
// MemoryRouter they need. Each admin page passes its own `active` key.

/** As rendered at the top of Admin → Users. */
export const UsersActive = () => (
  <div className="bg-slate-50 p-4">
    <AdminTabs active="users" />
  </div>
);

/** Admin → Services. */
export const ServicesActive = () => (
  <div className="bg-slate-50 p-4">
    <AdminTabs active="services" />
  </div>
);

/** Admin → Sites. */
export const SitesActive = () => (
  <div className="bg-slate-50 p-4">
    <AdminTabs active="sites" />
  </div>
);
