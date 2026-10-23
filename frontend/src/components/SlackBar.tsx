import { useEffect, useState } from 'react';
import { disconnectSlack, getSlackStatus } from '../api';
import type { SlackStatus } from '../types';
import { useToast } from '../toast';

export default function SlackBar() {
  const toast = useToast();
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSlackStatus()
      .then(setStatus)
      .catch(() => toast('error', 'Could not load the Slack connection status'));
  }, [toast]);

  async function handleDisconnect() {
    setBusy(true);
    try {
      await disconnectSlack();
      setStatus((current) => (current ? { ...current, connected: false, teamName: null, channelName: null } : current));
      toast('success', 'Slack disconnected');
    } catch {
      toast('error', 'Could not disconnect Slack. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-sm">
        <span className="font-semibold">Slack</span>{' '}
        {status.connected ? (
          <span className="text-slate-600">
            Connected to {status.teamName} in {status.channelName}. You get a message when a sender reaches its hourly limit.
          </span>
        ) : status.configured ? (
          <span className="text-slate-600">Not connected. Connect to get a message when a sender reaches its hourly limit.</span>
        ) : (
          <span className="text-slate-600">Not available. Add the Slack keys to backend/.env to turn this on.</span>
        )}
      </div>

      {status.connected ? (
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void handleDisconnect()}>
          {busy ? 'Disconnecting...' : 'Disconnect Slack'}
        </button>
      ) : status.configured ? (
        // Full page navigation: the backend starts the real Slack OAuth flow.
        <a href="/api/slack/connect" className="btn-primary">
          Connect Slack
        </a>
      ) : (
        <button type="button" className="btn-primary" disabled>
          Connect Slack
        </button>
      )}
    </div>
  );
}
