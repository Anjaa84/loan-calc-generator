import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-line bg-surface text-text hover:bg-surface-2",
  ghost: "text-text hover:bg-surface-2",
  danger: "border border-line bg-surface text-danger hover:bg-danger-soft",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-9 min-w-9 px-2.5 text-sm" : "h-11 px-4 text-[15px]",
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export const buttonClass = (variant: Variant = "secondary", extra?: string) =>
  cx(
    "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-[15px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    VARIANTS[variant],
    extra,
  );

const fieldBase =
  "w-full rounded-lg border border-line bg-surface px-3 text-text placeholder:text-muted/70 focus:border-accent focus:outline-2 focus:outline-accent/30 disabled:opacity-60";

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldBase, "h-11", className)} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldBase, "min-h-20 py-2", className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(fieldBase, "h-11 appearance-auto", className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-text">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-2xl border border-line bg-surface", className)}>{children}</section>;
}

type Tone = "neutral" | "accent" | "warn" | "danger" | "ok";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  ok: "bg-accent-soft text-ok",
};
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone])}>
      {children}
    </span>
  );
}

/** A row of big tappable choices (instead of a <select>). */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-10 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent",
            o.value === value ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-text hover:bg-surface-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toast({ message, action, onAction, onClose }: { message: ReactNode; action?: string; onAction?: () => void; onClose: () => void }) {
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-text px-4 py-3 text-sm text-bg shadow-lg lg:bottom-6"
    >
      <span className="min-w-0 flex-1">{message}</span>
      {action && (
        <button type="button" onClick={onAction} className="font-semibold underline-offset-2 hover:underline">
          {action}
        </button>
      )}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex cursor-pointer items-center gap-3 py-1 text-left text-sm focus-visible:outline-none"
    >
      <span
        className={cx(
          "relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors group-focus-visible:outline-2 group-focus-visible:outline-accent",
          checked ? "bg-accent" : "bg-line",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}
