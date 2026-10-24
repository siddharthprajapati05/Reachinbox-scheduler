import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, getSettings, listEmails, listSenders, reindexSearch, searchEmails } from '../api';
import ComposeModal from '../components/ComposeModal';
import EmailTable from '../components/EmailTable';
import Header from '../components/Header';
import Pagination from '../components/Pagination';
import SlackBar from '../components/SlackBar';
import { useToast } from '../toast';
import type { EmailPage, Sender, Settings, Tab } from '../types';

const PAGE_SIZE = 20;
const REFRESH_MS = 10_000;

export default function DashboardPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>('scheduled');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [data, setData] = useState<EmailPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState('');
  const [reindexing, setReindexing] = useState(false);

  const [composeOpen, setComposeOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);

  const latestRequest = useRef(0);

  // Show the result of the Slack OAuth round trip, then clean the URL.
  useEffect(() => {
    const slack = searchParams.get('slack');
    if (!slack) return;
    toast(slack === 'connected' ? 'success' : 'error', slack === 'connected' ? 'Slack connected' : 'Slack connection failed. Try again.');
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, toast]);

  useEffect(() => {
    Promise.all([getSettings(), listSenders()])
      .then(([loadedSettings, loadedSenders]) => {
        setSettings(loadedSettings);
        setSenders(loadedSenders);
      })
      .catch(() => toast('error', 'Could not load your settings. Refresh the page.'));
  }, [toast]);

  // Wait 300 ms after the last keystroke before searching
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    try {
      const result = debouncedQuery
        ? await searchEmails(debouncedQuery, tab, page, PAGE_SIZE)
        : await listEmails(tab, page, PAGE_SIZE);
      if (requestId !== latestRequest.current) return; // a newer request already replaced this one
      setData(result);
      setSearchError('');
    } catch (error) {
      if (requestId !== latestRequest.current) return;
      if (error instanceof ApiError && error.code === 'search_unavailable') {
        setSearchError(error.message);
        setData({ items: [], page, pageSize: PAGE_SIZE, total: 0 });
      } else {
        toast('error', error instanceof ApiError ? error.message : 'Could not load emails');
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [debouncedQuery, tab, page, toast]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Keep statuses fresh while the page is open
  useEffect(() => {
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  function changeTab(next: Tab) {
    setTab(next);
    setPage(1);
  }

  async function handleReindex() {
    setReindexing(true);
    try {
      const result = await reindexSearch();
      toast('success', `Search index rebuilt for ${result.reindexed} emails`);
      setSearchError('');
      void load();
    } catch (error) {
      toast('error', error instanceof ApiError ? error.message : 'Reindex failed');
    } finally {
      setReindexing(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <SlackBar />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Email lists" className="flex gap-1 rounded-md border border-slate-200 p-1">
            {(['scheduled', 'sent'] as const).map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                type="button"
                onClick={() => changeTab(name)}
                className={`rounded px-4 py-1.5 text-sm font-semibold ${tab === name ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {name === 'scheduled' ? 'Scheduled emails' : 'Sent emails'}
              </button>
            ))}
          </div>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            <input
              type="search"
              aria-label="Search emails"
              placeholder="Search recipient, sender, subject or status"
              className="input max-w-sm"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            <button type="button" className="btn-primary" onClick={() => setComposeOpen(true)} disabled={!settings}>
              Compose
            </button>
          </div>
        </div>

        {searchError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span>{searchError} Clear the search box to see your emails.</span>
            <button type="button" className="btn-secondary" onClick={() => void handleReindex()} disabled={reindexing}>
              {reindexing ? 'Rebuilding...' : 'Rebuild search index'}
            </button>
          </div>
        )}

        <section className="rounded-md border border-slate-200">
          <EmailTable tab={tab} items={data?.items ?? []} loading={loading} searching={debouncedQuery !== ''} />
          {data && data.total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />}
        </section>
      </main>

      {composeOpen && settings && (
        <ComposeModal
          settings={settings}
          senders={senders}
          onSenderAdded={(sender) => setSenders((current) => [...current, sender])}
          onSenderDeleted={(id) => setSenders((current) => current.filter((s) => s.id !== id))}
          onClose={() => setComposeOpen(false)}
          onScheduled={() => {
            setTab('scheduled');
            setPage(1);
            void load();
          }}
        />
      )}
    </div>
  );
}
