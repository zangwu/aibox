import type { ReactNode } from 'react';

export function Card({ title, extra, children, className = '', dense = false }: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || extra) && (
        <div
          className={`flex items-center justify-between border-b border-slate-100 ${
            dense ? 'px-3 py-2' : 'px-4 py-3'
          }`}
        >
          <div className="text-sm font-medium text-slate-800">{title}</div>
          {extra}
        </div>
      )}
      <div className={dense ? 'p-3' : 'p-4'}>{children}</div>
    </div>
  );
}

export function StatusDot({ status }: { status: 'ok' | 'warn' | 'err' | 'idle' }) {
  const map = {
    ok: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]',
    warn: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]',
    err: 'bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.8)]',
    idle: 'bg-slate-300',
  } as const;
  return <span className={`inline-block h-2 w-2 rounded-full ${map[status]}`} />;
}
