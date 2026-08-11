import { BarChart } from 'web';

/** The monthly trend on My Stats and Analytics — the canonical usage. */
export const JobsByMonth = () => (
  <div className="max-w-md bg-slate-50 p-4">
    <BarChart
      title="Jobs by month"
      valueLabel="Jobs"
      data={[
        { label: 'Mar', value: 84 },
        { label: 'Apr', value: 112 },
        { label: 'May', value: 97 },
        { label: 'Jun', value: 131 },
        { label: 'Jul', value: 145 },
        { label: 'Aug', value: 62 },
      ]}
    />
  </div>
);

/** Analytics → jobs by worker. Short people-name labels. */
export const JobsByWorker = () => (
  <div className="max-w-md bg-slate-50 p-4">
    <BarChart
      title="Jobs by worker"
      valueLabel="Jobs"
      data={[
        { label: 'Anna', value: 48 },
        { label: 'Dmitri', value: 39 },
        { label: 'Marek', value: 31 },
        { label: 'Olga', value: 26 },
      ]}
    />
  </div>
);

/** Analytics → jobs by service, labelled by catalog number so long service
 *  names (and their Russian equivalents) never blow out the axis. */
export const JobsByService = () => (
  <div className="max-w-md bg-slate-50 p-4">
    <BarChart
      title="Jobs by service"
      valueLabel="Jobs"
      data={[
        { label: 'SVC-001', value: 128 },
        { label: 'SVC-002', value: 96 },
        { label: 'SVC-004', value: 54 },
        { label: 'SVC-007', value: 22 },
        { label: 'SVC-011', value: 17 },
      ]}
    />
  </div>
);

/** Empty state — a new worker's first month, or a site with no jobs yet. */
export const NoData = () => (
  <div className="max-w-md bg-slate-50 p-4">
    <BarChart title="Jobs by month" valueLabel="Jobs" data={[]} />
  </div>
);
