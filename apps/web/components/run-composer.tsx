"use client";

import type { FormEvent } from "react";
import { ChevronIcon, PaperclipIcon } from "./icons";
import type { PublicLocale } from "../lib/public-locale";

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
  locale = "en",
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
  locale?: PublicLocale;
}) {
  const labels = locale === "ja"
    ? { task: "問い", mode: "モード", framework: "フレームワーク", attach: "コンテキストを添付", model: "計画駆動モデル", quota: "本日の実行 3/5", pending: "開始中", run: "実行", execute: "実行", learn: "学習", explain: "説明" }
    : { task: "Task prompt", mode: "Mode", framework: "Framework", attach: "Attach context", model: "Plan-driven model", quota: "3/5 runs today", pending: "Starting", run: "Run", execute: "Execute", learn: "Learn", explain: "Explain" };
  return (
    <div className="mj-composer-dock">
      <form className="mj-composer" onSubmit={onSubmit}>
        <textarea
          className="mj-composer-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={locale === "ja" ? "問い、回路、レビューするコードを入力…" : "Ask a question, describe a circuit, or paste code to review…"}
          aria-label={labels.task}
          rows={2}
          disabled={pending}
        />
        <div className="mj-composer-controls">
          <div className="mj-composer-left">
            <button className="mj-icon-button" type="button" aria-label={labels.attach} title={labels.attach} onClick={onAttach}>
              <PaperclipIcon size={16} />
            </button>
            <label className="mj-composer-select">
              <span className="sr-only">{labels.mode}</span>
              <select value={mode} onChange={(event) => onModeChange(event.target.value as ComposerMode)} disabled={pending}>
                <option value="execute">{labels.execute}</option>
                <option value="ideate">{labels.learn}</option>
                <option value="explain">{labels.explain}</option>
              </select>
              <ChevronIcon size={14} />
            </label>
            <label className="mj-composer-select">
              <span className="sr-only">{labels.framework}</span>
              <select value={framework} onChange={(event) => onFrameworkChange(event.target.value as ComposerFramework)} disabled={pending}>
                <option value="qiskit">Qiskit</option>
                <option value="pennylane">PennyLane</option>
                <option value="cirq">Cirq</option>
              </select>
              <ChevronIcon size={14} />
            </label>
            <span className="mj-composer-model">{labels.model}</span>
          </div>
          <div className="mj-composer-right">
            {error ? <span className="mj-composer-error" role="alert">{error}</span> : null}
            <span className="mj-composer-quota">{labels.quota}</span>
            <button className="mj-primary-button" type="submit" disabled={pending || !value.trim()}>
              {pending ? labels.pending : labels.run}
              <span className="mj-command-hint">⌘↵</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
