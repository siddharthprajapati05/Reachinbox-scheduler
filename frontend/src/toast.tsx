import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

type ToastKind = 'success' | 'error';
interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

const ToastContext = createContext<(kind: ToastKind, text: string) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const show = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setMessages((current) => [...current, { id, kind, text }]);
    setTimeout(() => setMessages((current) => current.filter((message) => message.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" role="status" aria-live="polite">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`rounded-md border px-4 py-3 text-sm shadow-md ${
              message.kind === 'success' ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-red-300 bg-red-50 text-red-700'
            }`}
          >
            {message.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
