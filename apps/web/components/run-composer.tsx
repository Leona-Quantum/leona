"use client";

import type { FormEvent } from "react";
import { ChevronIcon, PaperclipIcon } from "./icons";

export type ComposerMode = "execute" | "ideate" | "explain";

export function RunComposer({
  value,
  mode,
  pending,
  error,
  onChange,
  onModeChange,
  onSubmit,
  onAttach,
}: {
  value: string;
  mode: ComposerMode;
  pending: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onModeChange: (mode: ComposerMode) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAttach?: () => void;
}) {
  return (
    <div className="mj-composer-dock">
      <form className="mj-composer" onSubmit={onSubmit}>
        <textarea
          className="mj-composer-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Describe the circuit or problem…"
          aria-label="Task prompt"
          rows={2}
          disabled={pending}
        />
        <div className="mj-composer-controls">
          <div className="mj-composer-left">
            <button className="mj-icon-button" type="button" aria-label="Attach context" onClick={onAttach}>
              <PaperclipIcon size={16} />
            </button>
            <label className="mj-composer-select">
              <span className="sr-only">Mode</span>
              <select value={mode} onChange={(event) => onModeChange(event.target.value as ComposerMode)} disabled={pending}>
                <option value="execute">Build</option>
                <option value="ideate">Ideate</option>
                <option value="explain">Explain</option>
              </select>
              <ChevronIcon size={14} />
            </label>
            <span className="mj-composer-model">Plan-driven model</span>
          </div>
          <div className="mj-composer-right">
            {error ? <span className="mj-composer-error" role="alert">{error}</span> : null}
            <span className="mj-composer-quota">3/5 runs today</span>
            <button className="mj-primary-button" type="submit" disabled={pending || !value.trim()}>
              {pending ? "Starting" : "Run"}
              <span className="mj-command-hint">⌘↵</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
