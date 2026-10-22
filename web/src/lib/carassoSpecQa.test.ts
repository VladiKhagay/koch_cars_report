import { describe, expect, it } from 'vitest';
import { buildWorkbook } from './excelFile';
import {
  REPORT_SHEET_NAME,
  SHEET_NAMES,
  buildCustomerReport,
  buildStatsSheet,
  buildWorkerPaymentReport,
  customerReportFileName,
  exportLocale,
  type ExportJob,
} from './exports';
import { ROUTE_ROLES, landingPathFor, navItemsFor } from './nav';
import { availableColumns, CUSTOMER_COLUMNS, resolveCustomerColumns } from './reportConfig';
import { validateClientPrices } from './clientPrices';
import type { UserRole } from './types';

/* ------------------------------------------------ spec 4: files end to end */

const all = resolveCustomerColumns({ columns: CUSTOMER_COLUMNS.map((key) => ({ key, visible: true })) });
const j = (over: Partial<ExportJob> = {}): ExportJob => ({
  created_at: '2026-03-04T09:30:00.000Z',
  plate: '1234567',
  vin: 'VIN1',
  brand: 'Kia',
  billing_code: 'R-1',
  worker_price: 99,
  worker: { name: 'Dana' },
  site: { name: 'Haifa' },
  service: { name_en: 'Wash', name_he: '', catalog_number: 'C1' },
  client_unit_price: 10,
  client_total_price: 50,
  ...over,
});

async function roundTrip(rows: ReturnType<typeof buildCustomerReport>, sheet: string, lang: 'he' | 'en') {
  const { XLSX, workbook } = await buildWorkbook(rows, sheet, lang);
  const buf = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const back = XLSX.read(buf, { type: 'array' });
  return { back, rows: XLSX.utils.sheet_to_json<unknown[]>(back.Sheets[back.SheetNames[0]], { header: 1 }) };
}

describe('spec 4 end to end', () => {
  const ctx = { role: 'admin' as const, hideWorkerNames: false, multiSite: true };

  it('Hebrew customer report: exact headers, sheet, RTL view, service fallback', async () => {
    const grid = buildCustomerReport([j()], availableColumns(all, ctx), exportLocale('he'), 'he');
    const { back, rows } = await roundTrip(grid, REPORT_SHEET_NAME, 'he');
    expect(back.SheetNames).toEqual(['Koch - Report']);
    expect(back.Workbook?.Views?.[0]?.RTL).toBe(true);
    expect(rows[0]).toEqual([
      'תאריך', 'אתר', 'יצרן', 'רישוי', 'שלדה', 'שירות', 'מק"ט', 'מספר הזמנה', 'עובד', 'מחיר לחלק (₪)', 'מחיר כולל (₪)',
    ]);
    expect(rows[1][5]).toBe('Wash'); // name_he empty -> name_en
    expect(rows[1].slice(-2)).toEqual([10, 50]);
  });

  it('English report is LTR with the English headers', async () => {
    const grid = buildCustomerReport([j()], availableColumns(all, ctx), exportLocale('en'), 'en');
    const { back, rows } = await roundTrip(grid, REPORT_SHEET_NAME, 'en');
    expect(back.Workbook?.Views?.[0]?.RTL).toBeFalsy();
    expect(rows[0]).toEqual([
      'Date', 'Site', 'Vehicle brand', 'Vehicle registration number', 'VIN', 'Work performed', 'Catalog number',
      'Customer billing code', 'Worker', 'Client unit price (₪)', 'Client total price (₪)',
    ]);
  });

  it('payments and stats: Hebrew headers, sheet names, RTL', async () => {
    const pay = buildWorkerPaymentReport([j({ service: { name_en: 'Wash', name_he: 'שטיפה', catalog_number: 'C1' } })], 'Dana', 'he-IL', 'he');
    const p = await roundTrip(pay, SHEET_NAMES.he.payments, 'he');
    expect(p.back.SheetNames).toEqual(['תשלומים']);
    expect(p.back.Workbook?.Views?.[0]?.RTL).toBe(true);
    expect(p.rows[0]).toEqual(['תאריך', 'אתר', 'עובד', 'שירות', 'רישוי', 'סכום']);
    const flatPay = p.rows.flat().map(String);
    for (const w of ['סיכום', 'עבודות', 'סה"כ']) expect(flatPay).toContain(w);

    const stats = buildStatsSheet(
      [{ day: '2026-03-04', site: 'Haifa', worker: 'Dana', catalog_number: 'C1', service: { name_en: 'Wash' }, job_count: 2 }],
      'he',
    );
    const s = await roundTrip(stats, SHEET_NAMES.he.stats, 'he');
    expect(s.back.SheetNames).toEqual(['סטטיסטיקה']);
    expect(s.rows[0]).toEqual(['תאריך', 'אתר', 'עובד', 'מק"ט', 'שירות', 'מספר עבודות']);
    expect(s.rows[1][4]).toBe('Wash');
  });

  it('file name', () => {
    expect(customerReportFileName('2026-03-01', '2026-03-31')).toBe('Koch-Report-2026-03-01-to-2026-03-31.xlsx');
  });

  it('column gating by role', () => {
    const keys = (role: UserRole, hide = false, multiSite = false) =>
      availableColumns(all, { role, hideWorkerNames: hide, multiSite }).map((c) => c.key);
    expect(keys('manager', false, true)).not.toContain('client_unit_price');
    expect(keys('manager', false, true)).not.toContain('client_total_price');
    expect(keys('admin')).toContain('client_total_price');
    expect(keys('carasso')).toContain('client_unit_price');
    expect(keys('carasso', true)).not.toContain('worker');
    expect(keys('carasso', false)).toContain('worker');
    expect(keys('admin', true)).toContain('worker'); // hide applies to carasso only
    expect(keys('admin', false, false)).not.toContain('site');
    expect(keys('admin', false, true)).toContain('site');
  });

  it('a hand-built manager file never contains the client or pay numbers', () => {
    const grid = buildCustomerReport(
      [j({ worker_price: 777 })],
      availableColumns(all, { role: 'manager', hideWorkerNames: false, multiSite: true }),
      'en-GB',
      'he',
    );
    expect(grid.flat()).not.toContain(777);
    expect(grid.flat()).not.toContain(50);
  });
});

/* ------------------------------------------------------------ nav guards */

describe('route guards', () => {
  const roles: UserRole[] = ['worker', 'manager', 'admin', 'carasso'];
  const allowed = (name: keyof typeof ROUTE_ROLES, r: UserRole) => (ROUTE_ROLES[name] as readonly UserRole[]).includes(r);

  it('carasso: only jobs and export', () => {
    for (const name of Object.keys(ROUTE_ROLES) as (keyof typeof ROUTE_ROLES)[]) {
      expect(allowed(name, 'carasso')).toBe(name === 'jobs' || name === 'export');
    }
  });

  it('other roles unchanged', () => {
    expect(ROUTE_ROLES.newJob).toEqual(['worker']);
    expect(ROUTE_ROLES.workerScreens).toEqual(['worker']);
    expect(ROUTE_ROLES.admin).toEqual(['admin']);
    expect(ROUTE_ROLES.team).toEqual(['manager']);
    for (const n of ['dashboard', 'analytics', 'services'] as const) expect([...ROUTE_ROLES[n]]).toEqual(['manager', 'admin']);
    expect(allowed('jobs', 'worker')).toBe(false);
    expect(allowed('export', 'worker')).toBe(false);
  });

  it('landing page is reachable for every role (no redirect loop)', () => {
    const target: Record<string, keyof typeof ROUTE_ROLES> = { '/new': 'newJob', '/dashboard': 'dashboard', '/jobs': 'jobs' };
    for (const r of roles) expect(allowed(target[landingPathFor(r)], r)).toBe(true);
    expect(landingPathFor(undefined)).toBe('/jobs');
  });

  it('every nav entry points at a route the role may open', () => {
    const t = (k: string) => k;
    const pathRoles: Record<string, keyof typeof ROUTE_ROLES> = {
      '/new': 'newJob', '/mine': 'workerScreens', '/stats': 'workerScreens', '/lookup': 'workerScreens',
      '/dashboard': 'dashboard', '/jobs': 'jobs', '/export': 'export', '/analytics': 'analytics',
      '/team': 'team', '/services': 'services', '/admin/users': 'admin',
    };
    for (const r of roles) {
      const nav = navItemsFor(r, t);
      for (const i of [...nav.primary, ...nav.secondary]) expect(allowed(pathRoles[i.to], r), `${r} ${i.to}`).toBe(true);
      expect(nav.primary.length).toBeLessThanOrEqual(5);
    }
  });
});

/* -------------------------------------------------------- price validation */

describe('client price validation', () => {
  it('matrix', () => {
    expect(validateClientPrices(true, '', '')).toBe('required');
    expect(validateClientPrices(true, '5', '')).toBe('required');
    expect(validateClientPrices(true, '5', '10')).toBeNull();
    expect(validateClientPrices(true, '0', '0')).toBeNull();
    expect(validateClientPrices(false, '', '')).toBeNull();
    expect(validateClientPrices(false, null, undefined)).toBeNull();
    expect(validateClientPrices(true, 'abc', '1')).toBe('invalid');
    expect(validateClientPrices(true, '-1', '1')).toBe('invalid');
    expect(validateClientPrices(false, '1e2x', '')).toBe('invalid');
    expect(validateClientPrices(true, 12.5, 50)).toBeNull();
  });
});

// Raw file text through Vite (no node typings in the app tsconfig).
const migrations = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const localeText = import.meta.glob('../locales/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/* ---------------------------------------------------------------- locales */

describe('locales', () => {
  const raw = (l: string) => localeText[`../locales/${l}.json`];
  const load = (l: string) => JSON.parse(raw(l));
  it('he brand is יצרן and customerHelp is no longer the stale claim', () => {
    const text = raw('he');
    expect(text).toContain('"brand": "יצרן"');
    expect(text).not.toContain('דגם');
    for (const l of ['en', 'he', 'ru']) {
      const help = JSON.stringify(load(l)).match(/"customerHelp":"([^"]*)"/)?.[1] ?? '';
      expect(help.length).toBeGreaterThan(0);
      expect(help.toLowerCase()).not.toMatch(/never contains worker names/);
      expect(help).not.toMatch(/никогда не содерж|אף פעם|לעולם/);
    }
  });
  it('default UI language is Hebrew when nothing is stored', async () => {
    const store: Record<string, string> = {};
    const doc = { documentElement: { lang: '', dir: '' } };
    (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) };
    (globalThis as any).document = doc;
    const mod = await import('./i18n');
    await new Promise((r) => setTimeout(r, 20));
    expect(mod.default.language).toBe('he');
    expect(doc.documentElement.dir).toBe('rtl');
  });
});

/* ------------------------------------------------------------ static SQL */

describe('migrations 0026-0030 (static)', () => {
  const files = Object.keys(migrations).sort();
  const base = (f: string) => f.split('/').pop()!;
  const sql = (prefix: string) => {
    const f = files.find((x) => base(x).startsWith(prefix));
    if (!f) throw new Error('missing ' + prefix);
    return migrations[f];
  };
  const code = (s: string) => s.replace(/--.*$/gm, '');
  // `create or replace` keeps earlier grants, so a revoke anywhere in the history counts.
  const everything = files.map((f) => code(migrations[f])).join('\n');

  it('0026 is the ALTER TYPE alone', () => {
    const stmts = code(sql('0026')).split(';').map((s) => s.trim()).filter(Boolean);
    expect(stmts).toEqual(["alter type user_role add value if not exists 'carasso'"]);
  });

  it("no earlier migration names 'carasso' as a value", () => {
    for (const f of files.filter((x) => base(x) < '0026')) expect(code(migrations[f])).not.toMatch(/carasso/i);
  });

  it('every security definer function pins search_path, and non-trigger ones revoke from public/anon', () => {
    for (const p of ['0027', '0028', '0029', '0030']) {
      const text = code(sql(p));
      const fns = text.split(/create (?:or replace )?function /i).slice(1);
      for (const body of fns) {
        const name = body.match(/^\s*([a-z_0-9]+)\s*\(/i)![1];
        const header = body.split(/\bas\s+\$\$/i)[0];
        if (!/security definer/i.test(header)) continue;
        expect(header, `${p} ${name} search_path`).toMatch(/set search_path\s*=/i);
        if (/returns\s+trigger/i.test(header)) continue;
        expect(everything, `${p} ${name} revoke`).toMatch(new RegExp(`revoke all on function ${name}\\([^)]*\\)\\s+from[^;]*\\banon\\b`, 'i'));
      }
    }
  });

  it('nothing is granted to anon or public', () => {
    for (const p of ['0027', '0028', '0029', '0030']) {
      expect(code(sql(p)), p).not.toMatch(/grant\s[^;]*\sto\s[^;]*\b(anon|public)\b/i);
    }
  });

  it('jobs_carasso exposes no pay or manager note column', () => {
    const text = code(sql('0028'));
    const view = text.match(/create (?:or replace )?view jobs_carasso as([\s\S]*?);\s*\n\s*revoke/i)![1];
    for (const c of ['worker_price', 'coworker_share', 'submitter_share', 'manager_note', 'duplicate_of_job_id']) {
      expect(view, c).not.toContain(c);
    }
    expect(view).not.toMatch(/\bj\.\*/);
    for (const p of ['0027', '0029']) {
      expect(text.length).toBeGreaterThan(0);
      expect(code(sql(p)).match(/create (?:or replace )?view jobs_carasso[\s\S]*?;/i)).toBeNull();
    }
  });
});
