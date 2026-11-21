"use client";

import { useEffect, useRef, useState } from "react";
import type { ReuploadDiff } from "@/lib/excel/mergeReupload";
import { IconCopy, IconUpload, IconX } from "../icons";
import { Button, Field as FormField, TextInput, Toggle } from "../ui";

export type Meta = {
  title: string;
  slug: string;
  description: string;
  currency: string;
  published: boolean;
  source_filename: string | null;
};

type Props = {
  meta: Meta;
  onMeta: (patch: Partial<Meta>, key?: string) => void;
  onSlugTouched: () => void;
  saved: boolean;
  onClose: () => void;
  onExcel: (file: File) => void;
  uploadError: string | null;
  pending: { diff: ReuploadDiff; file: string } | null;
  onApply: () => void;
  onCancelPending: () => void;
};

export function ShareSheet(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const path = `/c/${p.meta.slug}`;
  const url = `${origin}${path}`;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal aria-label="Share and settings">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={p.onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col gap-5 overflow-y-auto rounded-t-3xl bg-bg p-5 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Share &amp; settings</h2>
          <button type="button" onClick={p.onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2">
            <IconX />
          </button>
        </div>

        <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
          <span className="text-sm font-medium">Link for customers</span>
          <div className="flex gap-2">
            <div className="flex h-11 min-w-0 flex-1 items-center truncate rounded-lg bg-surface-2 px-3 text-sm">{url || path}</div>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard blocked: the link is visible to copy by hand */
                }
              }}
            >
              <IconCopy size={16} /> {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {p.saved ? (
            <a href={path} target="_blank" rel="noreferrer" className="self-start text-sm text-accent hover:underline">
              Open the customer page ↗
            </a>
          ) : (
            <p className="text-xs text-muted">Press Save first, then the link works.</p>
          )}
          <Toggle
            checked={p.meta.published}
            onChange={(v) => p.onMeta({ published: v })}
            label={p.meta.published ? "Live: anyone with the link can use it" : "Draft: only you can see it"}
          />
        </section>

        <FormField label="Link name" htmlFor="slug" hint="Only lowercase letters, numbers and dashes.">
          <div className="flex items-center rounded-lg border border-line bg-surface focus-within:border-accent">
            <span className="pl-3 text-sm text-muted">/c/</span>
            <input
              id="slug"
              value={p.meta.slug}
              onChange={(e) => {
                p.onSlugTouched();
                p.onMeta({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }, "slug");
              }}
              className="h-11 w-full min-w-0 bg-transparent px-1 outline-none"
            />
          </div>
        </FormField>

        <FormField label="Money sign" htmlFor="currency" hint="Shown before money amounts, e.g. Rs. or $">
          <TextInput id="currency" value={p.meta.currency} maxLength={10} placeholder="Rs." onChange={(e) => p.onMeta({ currency: e.target.value }, "currency")} />
        </FormField>

        <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <div>
            <span className="text-sm font-medium">Update from Excel</span>
            <p className="text-xs text-muted">
              {p.meta.source_filename ? `Last imported from ${p.meta.source_filename}. ` : ""}
              Upload a newer sheet: your names and settings are kept, and you see the changes before anything is applied.
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) p.onExcel(file);
            }}
          />
          <Button className="self-start" onClick={() => fileRef.current?.click()}>
            <IconUpload size={16} /> Choose Excel file
          </Button>
          {p.uploadError && <p className="text-sm text-danger">{p.uploadError}</p>}
          {p.pending && (
            <div className="flex flex-col gap-3 rounded-xl border border-accent p-3">
              <span className="font-medium">Changes from {p.pending.file}</span>
              <DiffList diff={p.pending.diff} />
              <div className="flex gap-2">
                <Button variant="primary" onClick={p.onApply}>
                  Apply changes
                </Button>
                <Button onClick={p.onCancelPending}>Cancel</Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function DiffList({ diff }: { diff: ReuploadDiff }) {
  const none = !diff.added.length && !diff.removed.length && !diff.changed.length;
  if (none) return <p className="text-sm text-muted">No changes found. The sheet matches this calculator.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {diff.added.map((l) => (
        <li key={`a-${l}`} className="text-ok">
          + New: {l}
        </li>
      ))}
      {diff.changed.map((c) => (
        <li key={`c-${c.label}`} className="text-warn">
          ~ {c.label}: {c.what}
        </li>
      ))}
      {diff.removed.map((l) => (
        <li key={`r-${l}`} className="text-danger">
          − Removed: {l}
        </li>
      ))}
    </ul>
  );
}
