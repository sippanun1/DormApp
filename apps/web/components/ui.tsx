'use client';

/**
 * The handful of primitives every screen shares. Deliberately small: the
 * prototype's components.css is the styling reference, and anything that only
 * one screen needs stays on that screen rather than being generalised here.
 */

export function Card({
  title,
  hint,
  children,
  className = '',
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded border border-border bg-card p-4 ${className}`}>
      {(title || hint) && (
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          {title && <h2 className="text-base">{title}</h2>}
          {hint && <p className="text-xs text-text-muted">{hint}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-text-muted">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass = 'rounded-btn border border-border bg-card px-3 py-2 outline-none focus:border-primary';
/** A value the system decided, shown but not editable — never a disabled input
 *  the user might think they can argue with. */
export const readonlyClass = 'rounded-btn border border-border bg-surface px-3 py-2 text-text-muted';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-primary text-primary-contrast disabled:opacity-50',
    ghost: 'border border-border disabled:opacity-50',
    danger: 'border border-danger text-danger disabled:opacity-50',
  }[variant];
  return <button {...props} className={`rounded-btn px-4 py-2 font-medium ${styles} ${className}`} />;
}

/**
 * One semantic colour system across every screen — a colour means the same
 * thing everywhere (success/paid · info/occupied · warning/pending · danger/
 * overdue · neutral/blocked). Don't add a sixth meaning.
 */
const TONE = {
  success: 'border-success text-success bg-[var(--success-soft)]',
  info: 'border-info text-info bg-[var(--info-soft)]',
  warning: 'border-warning text-warning bg-[var(--warning-soft)]',
  danger: 'border-danger text-danger bg-[var(--danger-soft)]',
  neutral: 'border-neutral text-text-muted bg-[var(--neutral-soft)]',
} as const;

export type Tone = keyof typeof TONE;

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-[10px] py-[2px] text-xs ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function Alert({ kind = 'danger', children }: { kind?: 'danger' | 'success' | 'info'; children: React.ReactNode }) {
  if (!children) return null;
  const styles = {
    danger: 'border-danger bg-[var(--danger-soft)] text-danger',
    success: 'border-success bg-[var(--success-soft)] text-success',
    info: 'border-info bg-[var(--info-soft)] text-info',
  }[kind];
  return <p className={`rounded border px-3 py-2 ${styles}`}>{children}</p>;
}

export function Loading({ what = 'ข้อมูล' }: { what?: string }) {
  return <p className="text-text-muted">กำลังโหลด{what}…</p>;
}
