"use client";

import { useDraggable } from "@dnd-kit/core";
import { cx } from "../ui";
import { BLOCK_INFO, type BlockType } from "./SettingsPanel";

export const BLOCK_TYPES: BlockType[] = ["number", "dropdown", "result", "fixed"];

export function PaletteCard({ type, floating, className }: { type: BlockType; floating?: boolean; className?: string }) {
  const { name, hint, Icon } = BLOCK_INFO[type];
  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-xl border bg-surface p-3 text-left",
        floating ? "w-60 rotate-2 border-accent shadow-2xl" : "border-line",
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Icon />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{name}</span>
        <span className="block text-xs leading-snug text-muted">{hint}</span>
      </span>
    </div>
  );
}

/** Desktop: drag a card onto the calculator, or click it to add at the end. */
export function Palette({ onAdd }: { onAdd: (t: BlockType) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold tracking-wider text-muted uppercase">Add to calculator</h2>
      {BLOCK_TYPES.map((t) => (
        <DraggableCard key={t} type={t} onAdd={onAdd} />
      ))}
      <p className="px-1 text-xs text-muted">Drag onto the calculator, or click to add.</p>
    </div>
  );
}

function DraggableCard({ type, onAdd }: { type: BlockType; onAdd: (t: BlockType) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `new:${type}` });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onAdd(type)}
      aria-label={`Add ${BLOCK_INFO[type].name}`}
      className={cx("cursor-grab rounded-xl text-left transition-transform hover:-translate-y-0.5 active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <PaletteCard type={type} className="hover:border-accent" />
    </button>
  );
}

/** Mobile: a sheet of big buttons (tap to add). */
export function AddSheet({ onAdd, onClose }: { onAdd: (t: BlockType) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal aria-label="Add to calculator">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 rounded-t-3xl bg-bg p-4 pb-8 shadow-2xl">
        <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-line" />
        <h2 className="px-1 font-semibold">Add to calculator</h2>
        {BLOCK_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              onAdd(t);
              onClose();
            }}
            className="text-left"
          >
            <PaletteCard type={t} className="active:border-accent" />
          </button>
        ))}
      </div>
    </div>
  );
}
