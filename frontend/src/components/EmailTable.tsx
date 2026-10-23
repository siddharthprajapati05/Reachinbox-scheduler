import { formatDateTime } from '../format';
import type { EmailItem, EmailStatus, Tab } from '../types';

const STATUS_STYLES: Record<EmailStatus, string> = {
  scheduled: 'bg-amber-50 text-amber-800 border-amber-200',
  processing: 'bg-blue-50 text-blue-800 border-blue-200',
  sent: 'bg-brand-50 text-brand-700 border-brand-100',
  failed: 'bg-red-50 text-red-700 border-red-200',
};

function StatusBadge({ status }: { status: EmailStatus }) {
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>{status}</span>;
}

interface EmailTableProps {
  tab: Tab;
  items: EmailItem[];
  loading: boolean;
  searching: boolean;
}

export default function EmailTable({ tab, items, loading, searching }: EmailTableProps) {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading emails">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-8 animate-pulse rounded bg-slate-100" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    const message = searching
      ? 'No emails match your search.'
      : tab === 'scheduled'
        ? 'No scheduled emails yet. Use Compose to schedule your first batch.'
        : 'Nothing sent yet. Sent and failed emails will show up here.';
    return <p className="px-4 py-12 text-center text-sm text-slate-500">{message}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Recipient</th>
            <th className="px-4 py-3 font-medium">Subject</th>
            <th className="px-4 py-3 font-medium">{tab === 'scheduled' ? 'Scheduled for' : 'Sent at'}</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((email) => {
            // If the time moved later than requested, the rate limiter delayed this email.
            const delayed = new Date(email.nextSendAt).getTime() - new Date(email.scheduledAt).getTime() > 1000;
            return (
              <tr key={email.id}>
                <td className="px-4 py-3 font-medium">{email.toEmail}</td>
                <td className="max-w-xs truncate px-4 py-3 text-slate-600" title={email.subject}>
                  {email.subject}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {tab === 'scheduled' ? (
                    <>
                      {formatDateTime(email.nextSendAt)}
                      {delayed && <span className="ml-2 text-xs text-amber-700">Delayed by rate limit</span>}
                    </>
                  ) : (
                    formatDateTime(email.sentAt)
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={email.status} />
                  {email.previewUrl && (
                    <a href={email.previewUrl} target="_blank" rel="noreferrer" className="ml-3 text-xs font-medium text-brand-700 hover:underline">
                      Open preview
                    </a>
                  )}
                  {email.status === 'failed' && email.lastError && (
                    <p className="mt-1 max-w-xs truncate text-xs text-red-600" title={email.lastError}>
                      {email.lastError}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
