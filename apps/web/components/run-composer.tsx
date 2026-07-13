"use client";

import type { FormEvent } from "react";
import { ChevronIcon, PaperclipIcon } from "./icons";

export type ComposerMode = "execute" | "ideate" | "explain";
export type ComposerFramework = "qiskit" | "pennylane" | "cirq";

export function RunComposer({
  value,
  mode,
  framework,
  pending,
  error,
  onChange,
  onModeChange,
  onFrameworkChange,
  onSubmit,
  onAttach,
}: {
  value: string;
  mode: ComposerMode;
  framework: ComposerFramework;
  pending: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onModeChange: (mode: ComposerMode) => void;
  onFrameworkChange: (framework: ComposerFramework) => void;
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
          placeholder="Ask a question, describe a circuit, or paste code to review…"
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
                <option value="execute">Execute</option>
                <option value="ideate">Learn</option>
                <option value="explain">Explain</option>
              </select>
              <ChevronIcon size={14} />
            </label>
            <label className="mj-composer-select">
              <span className="sr-only">Framework</span>
              <select value={framework} onChange={(event) => onFrameworkChange(event.target.value as ComposerFramework)} disabled={pending}>
                <option value="qiskit">Qiskit</option>
                <option value="pennylane">PennyLane</option>
                <option value="cirq">Cirq</option>
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
