import { StatusBanner } from 'web';

/** The four tones side by side — the whole surface of the component. */
export const AllTones = () => (
  <div className="flex max-w-sm flex-col gap-2 bg-slate-50 p-4">
    <StatusBanner tone="info">You can edit this for 15 minutes</StatusBanner>
    <StatusBanner tone="warning">This VIN was already logged in the last 7 days</StatusBanner>
    <StatusBanner tone="error">VIN must be 17 characters (no I, O, or Q)</StatusBanner>
    <StatusBanner tone="success">Job submitted</StatusBanner>
  </div>
);

/** Offline queue notice on New Job — the most common warning in the app. */
export const OfflineQueued = () => (
  <div className="max-w-sm bg-slate-50 p-4">
    <StatusBanner tone="warning">
      No connection — saved and will submit automatically once you're back online
    </StatusBanner>
  </div>
);

/** Russian copy runs long and wraps to two or three lines; the banner grows. */
export const LongRussianCopy = () => (
  <div className="max-w-sm bg-slate-50 p-4">
    <StatusBanner tone="error">
      Контрольная сумма VIN не совпадает — обычное дело для импортных автомобилей, проверьте фото
    </StatusBanner>
  </div>
);

/** children is a ReactNode, so a banner can carry inline emphasis or a count. */
export const RichChildren = () => (
  <div className="max-w-sm bg-slate-50 p-4">
    <StatusBanner tone="info">
      <strong>3 jobs</strong> waiting to sync
    </StatusBanner>
  </div>
);
