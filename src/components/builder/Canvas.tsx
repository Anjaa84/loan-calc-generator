"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { EvalResult } from "@/lib/engine/evaluate";
import { formatValue } from "@/lib/engine/format";
import type { CalcSchema, Field } from "@/lib/schema/types";
import { zoneOf, zonesOf, type Zone } from "@/lib/schema/zones";
import { BigResult, NumberBox, ResultRow, SelectBox, selectRaw, toRaw } from "../calculator/parts";
import { IconEye, IconEyeOff, IconGrip, IconStar, IconWarn } from "../icons";
import { cx } from "../ui";
import { PaletteCard } from "./Palette";
import type { BlockType } from "./SettingsPanel";

const NEW = "new:";
const ZONE = "zone:";
export const zoneForType = (t: BlockType): Zone => (t === "number" || t === "dropdown" ? "inputs" : t === "result" ? "results" : "hidden");

// ---------------------------------------------------------------- drag & drop

export function BuilderDnd({
  schema,
  onReorder,
  onInsert,
  children,
}: {
  schema: CalcSchema;
  onReorder: (zone: Zone, from: number, to: number) => void;
  onInsert: (type: BlockType, index?: number) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragNew, setDragNew] = useState<BlockType | null>(null);
  const dndId = useId(); // stable ids so server and browser HTML match
  const zoneById = new Map(schema.fields.map((f) => [f.id, zoneOf(f)]));

  const collision: CollisionDetection = (args) => {
    const id = String(args.active.id);
    if (!id.startsWith(NEW)) {
      // Moving an existing block: only blocks in the same area are targets.
      const zone = zoneById.get(id);
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => zoneById.get(String(c.id)) === zone) });
    }
    const hits = pointerWithin(args);
    const blocks = hits.filter((c) => !String(c.id).startsWith(ZONE));
    if (blocks.length) return blocks;
    return hits.length ? hits : closestCenter(args);
  };

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setDragNew(id.startsWith(NEW) ? (id.slice(NEW.length) as BlockType) : null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragNew(null);
    const id = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over) return;
    const zones = zonesOf(schema.fields);
    if (id.startsWith(NEW)) {
      const type = id.slice(NEW.length) as BlockType;
      const target = zoneForType(type);
      const overZone = over.startsWith(ZONE) ? (over.slice(ZONE.length) as Zone) : zoneById.get(over);
      const idx = overZone === target && !over.startsWith(ZONE) ? zones[target].findIndex((f) => f.id === over) : undefined;
      onInsert(type, idx === -1 ? undefined : idx);
      return;
    }
    const zone = zoneById.get(id);
    if (!zone || zoneById.get(over) !== zone || over === id) return;
    const list = zones[zone];
    onReorder(
      zone,
      list.findIndex((f) => f.id === id),
      list.findIndex((f) => f.id === over),
    );
  };

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragNew(null)}
      accessibility={{
        screenReaderInstructions: { draggable: "To pick up a block, press space or enter. Use the arrow keys to move it, then press space or enter to drop it." },
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>{dragNew && <PaletteCard type={dragNew} floating />}</DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------- canvas

type CanvasProps = {
  schema: CalcSchema;
  currency: string;
  title: string;
  description: string;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
  sampleRaw: Record<string, string>;
  result: EvalResult;
  selectedId: string | null;
  onSelect: (id: string) => void;
  problems: Record<string, string>;
  onRename: (id: string, label: string) => void;
  onToggleHidden: (id: string) => void;
  onToggleHighlight: (id: string) => void;
  onAddTap: (type: BlockType) => void;
};

export function Canvas(p: CanvasProps) {
  const z = zonesOf(p.schema.fields);
  const big = z.results.filter((f) => f.highlight);
  const rows = z.results.filter((f) => !f.highlight);
  const byId = new Map(p.schema.fields.map((f) => [f.id, f]));

  return (
    <div className="flex flex-col gap-5">
      <div className="px-1">
        <InlineText
          value={p.title}
          onChange={p.onTitle}
          placeholder="Name your calculator"
          ariaLabel="Calculator name"
          className="text-xl font-semibold tracking-tight"
        />
        <InlineText
          value={p.description}
          onChange={p.onDescription}
          placeholder="Add a short description (optional)"
          ariaLabel="Description"
          className="text-sm text-muted"
        />
      </div>

      <ZoneArea zone="inputs" title="Customer fills in" empty="Drag a Number box or Dropdown here" onEmptyTap={() => p.onAddTap("number")} items={z.inputs}>
        {z.inputs.length > 0 && (
          <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-2">
            {z.inputs.map((f) => {
              const err = p.result.errors[f.id];
              const minField = f.min?.field ? byId.get(f.min.field) : undefined;
              const minVal = minField ? p.result.values[minField.id] : null;
              const value = f.inputType === "select" ? selectRaw(f, p.sampleRaw[f.id]) : (p.sampleRaw[f.id] ?? toRaw(f, f.defaultValue));
              return (
                <Block key={f.id} field={f} {...p} badge={f.hidden ? "Hidden · uses the starting value" : undefined}>
                  <div className="flex flex-col gap-1.5 p-2">
                    <InlineText value={f.label} onChange={(v) => p.onRename(f.id, v)} ariaLabel={`Name of ${f.label}`} className="text-sm font-medium" onFocusSelect={() => p.onSelect(f.id)} />
                    {f.inputType === "select" ? (
                      <SelectBox id={`cv-${f.id}`} field={f} value={value} inert />
                    ) : (
                      <NumberBox id={`cv-${f.id}`} field={f} value={value} currency={p.currency} error={!!err} inert />
                    )}
                    {err ? (
                      <p className="text-sm text-danger">{err}</p>
                    ) : (
                      (f.helpText || (minField && minVal != null)) && (
                        <p className="text-xs text-muted">
                          {f.helpText}
                          {f.helpText && minField && minVal != null ? " · " : ""}
                          {minField && minVal != null && <>Minimum: {formatValue(minVal, minField, p.currency)}</>}
                        </p>
                      )
                    )}
                  </div>
                </Block>
              );
            })}
          </div>
        )}
      </ZoneArea>

      <ZoneArea zone="results" title="Customer sees" empty="Drag a Result here" onEmptyTap={() => p.onAddTap("result")} items={z.results}>
        {big.length > 0 && (
          // Same border + padding as the cards around it so handles and edges line up.
          <div className="flex flex-col gap-1 border border-transparent p-2">
            {big.map((f) => (
              <Block key={f.id} field={f} {...p} badge={f.hidden ? "Hidden from customers" : undefined} actions>
                <BigResult
                  compact
                  label={<InlineText value={f.label} onChange={(v) => p.onRename(f.id, v)} ariaLabel={`Name of ${f.label}`} className="text-sm" onFocusSelect={() => p.onSelect(f.id)} />}
                  value={valueText(f, p)}
                />
              </Block>
            ))}
          </div>
        )}
        {rows.length > 0 && (
          <div className="flex flex-col rounded-2xl border border-line bg-surface p-2">
            {rows.map((f) => (
              <Block key={f.id} field={f} {...p} badge={f.hidden ? "Hidden from customers" : undefined} actions>
                <dl className="px-2">
                  <ResultRow
                    label={<InlineText value={f.label} onChange={(v) => p.onRename(f.id, v)} ariaLabel={`Name of ${f.label}`} className="text-sm text-muted" onFocusSelect={() => p.onSelect(f.id)} />}
                    value={valueText(f, p)}
                  />
                </dl>
              </Block>
            ))}
          </div>
        )}
      </ZoneArea>

      {(z.hidden.length > 0 || p.schema.fields.some((f) => f.kind === "constant")) && (
        <ZoneArea zone="hidden" title="Hidden numbers" subtitle="Used in calculations, not shown to customers" items={z.hidden} empty="Drag a Fixed number here">
          <div className="flex flex-col gap-1 rounded-2xl border border-dashed border-line p-2">
            {z.hidden.map((f) => (
              <Block key={f.id} field={f} {...p}>
                <dl className="px-2">
                  <ResultRow label={<span className="text-text">{f.label}</span>} value={formatValue(f.value ?? null, f, p.currency)} />
                </dl>
              </Block>
            ))}
          </div>
        </ZoneArea>
      )}
    </div>
  );
}

function valueText(f: Field, p: CanvasProps) {
  if (p.problems[f.id]) return "—";
  return formatValue(p.result.values[f.id], f, p.currency);
}

function ZoneArea({
  zone,
  title,
  subtitle,
  empty,
  onEmptyTap,
  items,
  children,
}: {
  zone: Zone;
  title: string;
  subtitle?: string;
  empty: string;
  onEmptyTap?: () => void;
  items: Field[];
  children: ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id: `${ZONE}${zone}` });
  const draggingNew = !!active && String(active.id).startsWith(NEW) && zoneForType(String(active.id).slice(NEW.length) as BlockType) === zone;
  return (
    <section ref={setNodeRef} aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">{title}</h3>
        {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
      </div>
      <SortableContext items={items.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <div className={cx("flex flex-col gap-3 rounded-2xl transition-colors", draggingNew && "ring-2 ring-accent/40 ring-offset-4 ring-offset-bg", isOver && draggingNew && "bg-accent-soft/40")}>
          {items.length === 0 ? (
            <button
              type="button"
              onClick={onEmptyTap}
              className={cx(
                "rounded-2xl border-2 border-dashed p-6 text-center text-sm transition-colors",
                isOver && draggingNew ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-accent hover:text-accent",
              )}
            >
              {empty}
              {onEmptyTap && <span className="block text-xs">or tap here to add one</span>}
            </button>
          ) : (
            children
          )}
        </div>
      </SortableContext>
    </section>
  );
}

function Block({
  field: f,
  selectedId,
  onSelect,
  problems,
  onToggleHidden,
  onToggleHighlight,
  badge,
  actions,
  children,
}: CanvasProps & { field: Field; badge?: string; actions?: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: f.id });
  const selected = selectedId === f.id;
  const problem = problems[f.id];
  const showActions = actions && f.kind !== "constant";
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-field={f.id}
      onClick={() => onSelect(f.id)}
      className={cx(
        "group relative flex cursor-pointer items-stretch gap-1 rounded-xl transition-shadow",
        selected ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-accent/50",
        problem && !selected && "ring-1 ring-danger/60",
        isDragging && "z-20 shadow-xl ring-2 ring-accent",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Move ${f.label}`}
        onClick={(e) => e.stopPropagation()}
        className="flex w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text active:cursor-grabbing"
      >
        <IconGrip />
      </button>
      <div className={cx("min-w-0 flex-1", f.hidden && f.kind !== "constant" && "opacity-55")}>
        {children}
        {(badge || problem) && (
          <div className="flex flex-wrap gap-1.5 px-2 pb-2">
            {problem && (
              <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                <IconWarn size={12} /> {problem}
              </span>
            )}
            {badge && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{badge}</span>}
          </div>
        )}
      </div>
      {showActions && (
        <div className={cx("flex shrink-0 flex-col justify-center gap-0.5 transition-opacity", selected ? "opacity-100" : "opacity-100 lg:opacity-0 lg:group-hover:opacity-100")}>
          <QuickButton
            label={f.highlight ? "Show as a normal row" : "Show big at the top"}
            active={f.highlight}
            onClick={() => onToggleHighlight(f.id)}
          >
            <IconStar size={16} filled={f.highlight} />
          </QuickButton>
          <QuickButton label={f.hidden ? "Show to customers" : "Hide from customers"} active={f.hidden} onClick={() => onToggleHidden(f.id)}>
            {f.hidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          </QuickButton>
        </div>
      )}
      {!showActions && f.kind === "input" && (
        <div className={cx("flex shrink-0 flex-col justify-center transition-opacity", selected ? "opacity-100" : "opacity-100 lg:opacity-0 lg:group-hover:opacity-100")}>
          <QuickButton label={f.hidden ? "Let customers change this" : "Hide from customers"} active={f.hidden} onClick={() => onToggleHidden(f.id)}>
            {f.hidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          </QuickButton>
        </div>
      )}
    </div>
  );
}

function QuickButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={!!active}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cx("flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-2", active ? "text-accent" : "text-muted hover:text-text")}
    >
      {children}
    </button>
  );
}

/** Text that turns into an input when clicked. */
export function InlineText({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
  onFocusSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  onFocusSelect?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  if (editing)
    return (
      <span className={cx("block", className)}>
        <input
          ref={ref}
          aria-label={ariaLabel}
          value={text}
          placeholder={placeholder}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (text !== value) onChange(text);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setText(value);
              setEditing(false);
            }
          }}
          className="-mx-1 w-full rounded-md bg-surface px-1 text-text outline-2 outline-accent"
          // at least 16px so phones don't zoom in
          style={{ fontSize: "max(16px, 1em)" }}
        />
      </span>
    );
  return (
    <button
      type="button"
      title="Click to rename"
      aria-label={`${ariaLabel}: ${value || "empty"}. Click to rename`}
      onClick={(e) => {
        e.stopPropagation();
        onFocusSelect?.();
        setText(value);
        setEditing(true);
      }}
      className={cx(
        "-mx-1 block max-w-full cursor-text rounded-md px-1 text-left decoration-dashed underline-offset-4 hover:bg-surface-2/60 hover:underline",
        !value && "text-muted italic",
        className,
      )}
    >
      {value || placeholder}
    </button>
  );
}
