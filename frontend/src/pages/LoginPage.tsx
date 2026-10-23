import { useSearchParams } from 'react-router-dom';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const failed = params.get('error') === 'login_failed';

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-lg font-bold text-brand-600">Outbox</p>
        <h1 className="text-2xl font-bold">Sign in to schedule emails</h1>
        <p className="mt-2 text-sm text-slate-600">
          Upload your leads, pick a time, and Outbox sends each email on schedule, one by one, within your hourly limits.
        </p>

        {failed && (
          <p role="alert" className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            Google sign-in did not complete. Try again.
          </p>
        )}

        {/* A normal link: the browser leaves for Google, then Google sends it back to the backend callback. */}
        <a href="/api/auth/google" className="btn-secondary mt-6 w-full py-3">
          <GoogleIcon />
          Continue with Google
        </a>
      </div>
    </main>
  );
}
