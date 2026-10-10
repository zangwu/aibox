import { Star } from 'lucide-react';

export default function Stars({ value, onChange }: { value?: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          disabled={!onChange}
          onClick={() => onChange?.(n === value ? 0 : n)}
          className={n <= (value ?? 0) ? 'text-amber-400' : 'text-slate-300'}
        >
          <Star size={14} fill={n <= (value ?? 0) ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}
