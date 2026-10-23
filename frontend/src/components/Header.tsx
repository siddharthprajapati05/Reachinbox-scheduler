import { useAuth } from '../auth';

export default function Header() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="border-b border-slate-200">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-lg font-bold text-brand-600">Outbox</p>

        <div className="flex items-center gap-3">
          {user.isAdmin && (
            <a href="/admin/queues" target="_blank" rel="noreferrer" className="text-sm font-medium text-slate-600 hover:text-brand-700">
              Queue dashboard
            </a>
          )}
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-9 w-9 rounded-full" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold">
              {user.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="hidden text-right leading-tight sm:block">
            <p className="text-sm font-semibold">{user.name}</p>
            <p className="text-xs text-slate-500">{user.email}</p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
