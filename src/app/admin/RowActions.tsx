"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui";
import { deleteCalculator } from "./actions";

export function RowActions({ id, slug, title }: { id: string; slug: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/c/${slug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link", `${window.location.origin}/c/${slug}`);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={copy}>
        {copied ? "Copied ✓" : "Copy link"}
      </Button>
      <Link href={`/c/${slug}`} target="_blank" className={buttonClass("secondary", "h-9 px-2.5 text-sm")}>
        Open
      </Link>
      <Link href={`/admin/${id}/edit`} className={buttonClass("secondary", "h-9 px-2.5 text-sm")}>
        Edit
      </Link>
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (confirm(`Delete "${title}"? Its public link will stop working.`)) start(() => deleteCalculator(id));
        }}
      >
        Delete
      </Button>
    </div>
  );
}
