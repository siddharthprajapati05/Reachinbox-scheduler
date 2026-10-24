import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { ApiError, createCustomSender, createSender, deleteSender, parseRecipientFile, scheduleEmails } from '../api';
import type { CustomSmtpInput } from '../api';
import { toLocalInputValue } from '../format';
import { useToast } from '../toast';
import type { InvalidRow, ParseResult, Sender, Settings } from '../types';

interface ComposeModalProps {
  settings: Settings;
  senders: Sender[];
  onSenderAdded: (sender: Sender) => void;
  onSenderDeleted: (senderId: string) => void;
  onClose: () => void;
  onScheduled: () => void;
}

type FieldErrors = Partial<Record<'senderId' | 'subject' | 'body' | 'recipients' | 'startAt' | 'minDelayMs' | 'hourlyLimit', string>>;

export default function ComposeModal({ settings, senders, onSenderAdded, onSenderDeleted, onClose, onScheduled }: ComposeModalProps) {
  const toast = useToast();

  const [senderId, setSenderId] = useState(senders[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [startAt, setStartAt] = useState(() => toLocalInputValue(new Date(Date.now() + 5 * 60_000)));
  const [minDelayMs, setMinDelayMs] = useState(settings.defaultMinDelayMs);
  const [hourlyLimit, setHourlyLimit] = useState(settings.maxHourlyLimit);

  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileError, setFileError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [addingSender, setAddingSender] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [serverInvalidRows, setServerInvalidRows] = useState<InvalidRow[]>([]);

  // Custom SMTP form
  const [showSmtpForm, setShowSmtpForm] = useState(false);
  const [smtpForm, setSmtpForm] = useState<CustomSmtpInput>({
    email: '',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
  });
  const [smtpError, setSmtpError] = useState('');

  // Close with the Escape key
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsed(null);
    setFileError('');
    setServerInvalidRows([]);
    setParsing(true);
    try {
      setParsed(await parseRecipientFile(file)); // the backend does the parsing, so rules are the same everywhere
    } catch (error) {
      setFileError(error instanceof ApiError ? error.message : 'Could not read the file');
    } finally {
      setParsing(false);
    }
  }

  async function handleAddSender() {
    setAddingSender(true);
    try {
      const sender = await createSender();
      onSenderAdded(sender);
      setSenderId(sender.id);
      toast('success', `Added test sender ${sender.email}`);
    } catch (error) {
      toast('error', error instanceof ApiError ? error.message : 'Could not add a sender');
    } finally {
      setAddingSender(false);
    }
  }

  async function handleAddCustomSender() {
    setSmtpError('');
    if (!smtpForm.email || !smtpForm.smtpHost || !smtpForm.smtpUser || !smtpForm.smtpPass) {
      setSmtpError('All SMTP fields are required.');
      return;
    }
    setAddingSender(true);
    try {
      const sender = await createCustomSender(smtpForm);
      onSenderAdded(sender);
      setSenderId(sender.id);
      setShowSmtpForm(false);
      toast('success', `Added sender ${sender.email}`);
    } catch (error) {
      setSmtpError(error instanceof ApiError ? error.message : 'Could not add sender. Check your SMTP credentials.');
    } finally {
      setAddingSender(false);
    }
  }

  async function handleDeleteSender(id: string, email: string) {
    if (!window.confirm(`Delete sender "${email}"? This cannot be undone.`)) return;
    try {
      await deleteSender(id);
      onSenderDeleted(id);
      if (senderId === id) setSenderId('');
      toast('success', `Deleted sender ${email}`);
    } catch (error) {
      toast('error', error instanceof ApiError ? error.message : 'Could not delete sender');
    }
  }

  // Same rules as the backend (the backend checks them again).
  function validate(): FieldErrors {
    const found: FieldErrors = {};
    if (!senderId) found.senderId = 'Choose a sender, or add a test sender.';
    if (!subject.trim()) found.subject = 'Enter a subject.';
    if (!body.trim()) found.body = 'Enter the email body.';
    if (!parsed || parsed.validCount === 0) found.recipients = 'Upload a file with at least one valid email address.';
    else if (parsed.invalidCount > 0) found.recipients = 'Fix the invalid rows in your file and upload it again.';
    if (!startAt || new Date(startAt).getTime() <= Date.now()) found.startAt = 'Choose a start time in the future.';
    if (!Number.isInteger(minDelayMs) || minDelayMs < settings.defaultMinDelayMs) {
      found.minDelayMs = `Enter a whole number of at least ${settings.defaultMinDelayMs} ms.`;
    }
    if (!Number.isInteger(hourlyLimit) || hourlyLimit < 1 || hourlyLimit > settings.maxHourlyLimit) {
      found.hourlyLimit = `Enter a whole number from 1 to ${settings.maxHourlyLimit}.`;
    }
    return found;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0 || !parsed) return;

    setSubmitting(true);
    try {
      const result = await scheduleEmails({
        senderId,
        subject: subject.trim(),
        body: body.trim(),
        recipients: parsed.validEmails,
        startAt: new Date(startAt).toISOString(),
        minDelayMs,
        hourlyLimit,
      });
      toast(
        'success',
        result.alreadyScheduled
          ? 'These emails were already scheduled. Nothing was added twice.'
          : `Scheduled ${result.scheduledCount} emails`,
      );
      onScheduled();
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_recipients') {
        setServerInvalidRows(((error.details as { invalidRows?: InvalidRow[] } | undefined)?.invalidRows) ?? []);
        setFormError(error.message);
      } else if (error instanceof ApiError && error.code === 'validation_error') {
        const details = (error.details as { field: string; message: string }[] | undefined) ?? [];
        setErrors(Object.fromEntries(details.map((detail) => [detail.field.split('.')[0], detail.message])) as FieldErrors);
        setFormError('Some fields need fixing.');
      } else {
        setFormError(error instanceof ApiError ? error.message : 'Could not schedule the emails');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const invalidRows = parsed?.invalidRows ?? serverInvalidRows;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onMouseDown={(event) => event.target === event.currentTarget && !submitting && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        className="my-8 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="compose-title" className="text-xl font-bold">
            Compose new email
          </h2>
          <button type="button" className="text-sm font-medium text-slate-500 hover:text-slate-900" onClick={onClose} disabled={submitting}>
            Close
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <label htmlFor="sender" className="field-label">
              Send from
            </label>
            <div className="space-y-1">
              {senders.length === 0 && <p className="text-sm text-slate-400 italic">No senders yet — add one below.</p>}
              {senders.map((s) => (
                <div key={s.id} className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 cursor-pointer text-sm ${
                  senderId === s.id ? 'border-green-500 bg-green-50 font-semibold' : 'border-slate-200 hover:bg-slate-50'
                }`} onClick={() => setSenderId(s.id)}>
                  <span>{s.email}</span>
                  <button
                    type="button"
                    title="Delete sender"
                    className="ml-2 text-red-400 hover:text-red-600 text-base leading-none"
                    onClick={(e) => { e.stopPropagation(); void handleDeleteSender(s.id, s.email); }}
                  >🗑️</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <button type="button" className="btn-secondary shrink-0" onClick={() => void handleAddSender()} disabled={addingSender}>
                {addingSender ? 'Adding...' : 'Add test sender'}
              </button>
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => { setShowSmtpForm((v) => !v); setSmtpError(''); }}
              >
                {showSmtpForm ? 'Cancel' : '+ Real SMTP'}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Use <strong>Add test sender</strong> for Ethereal (fake inbox) or <strong>+ Real SMTP</strong> for Gmail/Postmark/etc.</p>
            {errors.senderId && <p className="field-error">{errors.senderId}</p>}

            {showSmtpForm && (
              <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-blue-900">Add real SMTP sender</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="field-label text-xs">From Email</label>
                    <input className="input" type="email" placeholder="you@gmail.com" value={smtpForm.email}
                      onChange={(e) => setSmtpForm((f) => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <label className="field-label text-xs">SMTP Host</label>
                    <input className="input" placeholder="smtp.gmail.com" value={smtpForm.smtpHost}
                      onChange={(e) => setSmtpForm((f) => ({ ...f, smtpHost: e.target.value }))} />
                  </div>
                  <div>
                    <label className="field-label text-xs">SMTP Port</label>
                    <input className="input" type="number" value={smtpForm.smtpPort}
                      onChange={(e) => setSmtpForm((f) => ({ ...f, smtpPort: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="field-label text-xs">SMTP Username</label>
                    <input className="input" placeholder="you@gmail.com" value={smtpForm.smtpUser}
                      onChange={(e) => setSmtpForm((f) => ({ ...f, smtpUser: e.target.value }))} />
                  </div>
                  <div>
                    <label className="field-label text-xs">SMTP Password / App Password</label>
                    <input className="input" type="password" placeholder="App password" value={smtpForm.smtpPass}
                      onChange={(e) => setSmtpForm((f) => ({ ...f, smtpPass: e.target.value }))} />
                  </div>
                </div>
                {smtpError && <p className="text-xs text-red-600">{smtpError}</p>}
                <button type="button" className="btn-primary text-sm" onClick={() => void handleAddCustomSender()} disabled={addingSender}>
                  {addingSender ? 'Saving...' : 'Save SMTP sender'}
                </button>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="subject" className="field-label">
              Subject
            </label>
            <input id="subject" className="input" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} />
            {errors.subject && <p className="field-error">{errors.subject}</p>}
          </div>

          <div>
            <label htmlFor="body" className="field-label">
              Body
            </label>
            <textarea id="body" rows={6} className="input" value={body} onChange={(event) => setBody(event.target.value)} />
            {errors.body && <p className="field-error">{errors.body}</p>}
          </div>

          <div>
            <label htmlFor="recipients-file" className="field-label">
              Recipients file
            </label>
            <input
              id="recipients-file"
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={(event) => void handleFileChange(event)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-50"
            />
            <p className="mt-1 text-xs text-slate-500">CSV with an "email" column, or a text file with one address per line.</p>

            {parsing && <p className="mt-2 text-sm text-slate-500">Reading {fileName}...</p>}
            {fileError && <p className="field-error" role="alert">{fileError}</p>}
            {parsed && (
              <p className="mt-2 text-sm" aria-live="polite">
                <span className="font-semibold text-brand-700">{parsed.validCount} valid unique {parsed.validCount === 1 ? 'address' : 'addresses'}</span>
                {parsed.duplicateCount > 0 && <span className="text-slate-600">, {parsed.duplicateCount} duplicates removed</span>}
                {parsed.invalidCount > 0 && <span className="font-semibold text-red-600">, {parsed.invalidCount} invalid</span>}
              </p>
            )}
            {invalidRows.length > 0 && (
              <ul className="mt-2 max-h-32 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {invalidRows.map((row) => (
                  <li key={`${row.row}-${row.value}`}>
                    Row {row.row}: "{row.value}" - {row.reason}
                  </li>
                ))}
              </ul>
            )}
            {errors.recipients && <p className="field-error">{errors.recipients}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="start" className="field-label">
                Start date and time
              </label>
              <input id="start" type="datetime-local" className="input" value={startAt} min={toLocalInputValue(new Date())} onChange={(event) => setStartAt(event.target.value)} />
              {errors.startAt && <p className="field-error">{errors.startAt}</p>}
            </div>
            <div>
              <label htmlFor="delay" className="field-label">
                Delay between emails (ms)
              </label>
              <input id="delay" type="number" className="input" min={settings.defaultMinDelayMs} step={100} value={minDelayMs} onChange={(event) => setMinDelayMs(Number(event.target.value))} />
              {errors.minDelayMs && <p className="field-error">{errors.minDelayMs}</p>}
            </div>
            <div>
              <label htmlFor="limit" className="field-label">
                Emails per hour
              </label>
              <input id="limit" type="number" className="input" min={1} max={settings.maxHourlyLimit} value={hourlyLimit} onChange={(event) => setHourlyLimit(Number(event.target.value))} />
              {errors.hourlyLimit && <p className="field-error">{errors.hourlyLimit}</p>}
            </div>
          </div>
        </div>

        {formError && (
          <p role="alert" className="mt-5 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting || parsing}>
            {submitting ? 'Scheduling...' : 'Schedule emails'}
          </button>
        </div>
      </form>
    </div>
  );
}
