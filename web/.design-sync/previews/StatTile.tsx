import { StatTile } from 'web';

/** Single tile, as Analytics renders "Today". */
export const Default = () => (
  <div className="max-w-[220px] bg-slate-50 p-4">
    <StatTile label="This month" value={128} />
  </div>
);

/** The three-up row from My Stats — the canonical usage. */
export const StatRow = () => (
  <div className="grid grid-cols-3 gap-3 bg-slate-50 p-4">
    <StatTile label="Total jobs" value={1_284} />
    <StatTile label="This month" value={128} />
    <StatTile label="Avg / month" value={107} />
  </div>
);

/** Russian labels run ~60% longer than English — the tile must not clip. */
export const LongLabels = () => (
  <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4">
    <StatTile label="Всего работ" value={1_284} />
    <StatTile label="В среднем за месяц" value={107} />
  </div>
);

/** Values are string | number — a formatted string keeps the same type ramp. */
export const StringValue = () => (
  <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4">
    <StatTile label="Busiest site" value="Nord-Ost" />
    <StatTile label="Last export" value="10 Aug" />
  </div>
);
