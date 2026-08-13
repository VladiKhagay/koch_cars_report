import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';

/**
 * The jobs grid leans on a handful of TanStack Table v9 calls whose shapes
 * changed from v8 — `useTable` instead of `useReactTable`, `tableFeatures`
 * instead of `getCoreRowModel`, `table.FlexRender` instead of the standalone
 * `flexRender`. TypeScript checks the call signatures; only rendering checks
 * that they actually produce a table. A v8-shaped mistake type-checks in
 * several places and then throws on the first paint of a screen that needs a
 * manager login to reach — which is exactly the wrong place to find out.
 *
 * Deliberately not a test of the page: no i18n, no Supabase, no router. Just
 * the third-party contract the page is built on.
 */
interface Row {
  id: string;
  plate: string;
  billing_code: string | null;
}

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, Row>();

const columns = helper.columns([
  helper.accessor('plate', { id: 'plate', header: () => 'Plate' }),
  helper.accessor((row) => row.billing_code ?? '—', {
    id: 'billing',
    header: () => 'Receipt',
    cell: ({ getValue }) => <span data-cell="billing">{getValue()}</span>,
  }),
  helper.display({ id: 'flags', header: () => 'Flags', cell: () => <span>!</span> }),
]);

const DATA: Row[] = [
  { id: 'a', plate: '12-345-67', billing_code: 'R-900' },
  { id: 'b', plate: '98-765-43', billing_code: null },
];

function Grid({ hideFlags }: { hideFlags?: boolean }) {
  const table = useTable({
    features,
    columns: hideFlags ? columns.filter((c) => c.id !== 'flags') : columns,
    data: DATA,
  });

  return (
    <table>
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th key={header.id}>{header.isPlaceholder ? null : <table.FlexRender header={header} />}</th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getAllCells().map((cell) => (
              <td key={cell.id}>
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

describe('jobs grid table contract', () => {
  const html = renderToStaticMarkup(<Grid />);

  it('renders one row per record with every column', () => {
    expect(html.match(/<tr>/g)).toHaveLength(3); // header + 2 rows
    expect(html).toContain('Plate');
    expect(html).toContain('Receipt');
  });

  it('runs accessor functions and custom cell renderers', () => {
    expect(html).toContain('12-345-67');
    expect(html).toContain('<span data-cell="billing">R-900</span>');
    // The null billing code falls through the accessor's own placeholder.
    expect(html).toContain('<span data-cell="billing">—</span>');
  });

  it('renders display columns that have no underlying field', () => {
    expect(html).toContain('Flags');
  });

  // The grid drops the Site column for non-admins the same way.
  it('honours a filtered column set', () => {
    const narrowed = renderToStaticMarkup(<Grid hideFlags />);
    expect(narrowed).not.toContain('Flags');
    expect(narrowed).toContain('Plate');
  });
});
