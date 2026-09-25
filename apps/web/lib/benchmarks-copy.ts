import type { PublicLocale } from "./public-locale";

/**
 * Static prose for `/benchmarks` (ai-ops 372). Every number that appears on
 * that page is NOT here — it comes from `lib/benchmarks/qiskit-humaneval.ts`
 * and is formatted by `lib/benchmarks/qiskit-humaneval-view.ts`. This file
 * holds only the sentences around those numbers, so a copy edit can never
 * accidentally change what the page claims to have measured.
 *
 * `{token}` placeholders are filled by `formatTemplate()`
 * (`lib/benchmarks/qiskit-humaneval-view.ts`) with values read from the data
 * file, the same pattern `about-copy.ts`'s `portraitAlt.replace("{name}", …)`
 * already uses on this site.
 */
export const BENCHMARKS_COPY: Record<PublicLocale, {
  hero: { label: string; title: string; body: string };
  headline: {
    scoreTemplate: string;
    gradableTemplate: string;
    pendingTitle: string;
    pendingBodyTemplate: string;
  };
  what: { title: string; body: string };
  how: { title: string; body: string };
  ceiling: { titleTemplate: string; bodyTemplate: string };
  controls: { title: string; bodyTemplate: string };
  history: {
    title: string;
    body: string;
    columns: { run: string; date: string; model: string; passed: string; ofGradableTemplate: string; spend: string; wallTime: string; changed: string };
    pendingStatus: string;
    notAvailable: string;
    change: string;
  };
  limits: { title: string; items: string[] };
  source: { title: string; body: string; linkLabel: string };
}> = {
  en: {
    hero: {
      label: "Benchmarks",
      title: "Qiskit HumanEval",
      body: "Nala's score on IBM's public benchmark for writing Qiskit code, and exactly how we measured it.",
    },
    headline: {
      scoreTemplate: "{passed} of {total} tasks passed ({pct}%)",
      gradableTemplate: "{passedOfGradable} of the {gradable} tasks that can pass in our sandbox ({pct}%)",
      pendingTitle: "Re-run in progress",
      pendingBodyTemplate:
        "The re-run after the review-step fix started {date}. This page will update once it finishes.",
    },
    what: {
      title: "What this benchmark is",
      body: "Qiskit HumanEval is a public benchmark of 151 short Qiskit programming tasks, each with its own correctness test. It measures whether a model can write quantum code that actually runs and gives the right answer, not how fast or how elegant that code is.",
    },
    how: {
      title: "How Leona ran it",
      body: "We ran Nala the same way a user does: the production model, one attempt per task, through Nala's full plan, generate, run and review loop. A task counts as passed only if Nala actually delivered code that passes the benchmark's own test. A candidate that never reached delivery is scored as failed, whatever it contains.",
    },
    ceiling: {
      titleTemplate: "Why {gradableTasks}, not {totalTasks}",
      bodyTemplate:
        "The sandbox that runs generated code has no internet access, on purpose. {blockedTasks} of the {totalTasks} tasks' own reference solutions need something the sandbox blocks: {blockedNeedsIbmCloud} need IBM's cloud runtime library, and {blockedNeedsFileWrite} more needs to write a file to disk. Those {blockedTasks} cannot pass no matter how good the generated code is, so {gradableTasks} is the highest score physically possible in this sandbox.",
    },
    controls: {
      title: "Before we spent anything",
      bodyTemplate:
        "We ran two free checks against the harness itself first: submitting each task's own correct answer, and submitting deliberately wrong code. The correct answers passed {stubCanonicalPassed} of {stubCanonicalTotal} ({stubCanonicalPassed} is the same {gradableTasks}-task ceiling above); the wrong code passed {stubGarbagePassed}. Both matched what was already on record, so the harness had not drifted before we spent anything.",
    },
    history: {
      title: "Two runs",
      body: "The first run measured Nala before the review-step fix (PR 1010). We re-ran the full benchmark after the fix merged, so the table below shows what actually changed, not what we expected to change.",
      columns: {
        run: "Run",
        date: "Date",
        model: "Model",
        passed: "Passed",
        ofGradableTemplate: "Of the {gradableTasks} gradable",
        spend: "Spend",
        wallTime: "Wall time",
        changed: "What changed",
      },
      pendingStatus: "Re-run in progress",
      notAvailable: "—",
      change:
        "PR 1010 fixed three checks in Nala's review step that were treating code as failed for reasons that did not apply to how the task was written, even when the code had already passed the benchmark's own test. A real failure still blocks delivery after the fix.",
    },
    limits: {
      title: "What this score does not show",
      items: [
        "Each score above comes from one run. We have not yet run the benchmark twice to see how much the score moves on its own.",
        "Model output varies between runs of the same code. In one internal check, a task that had passed in an earlier run failed on a later run with nothing about the code changed.",
        "{gradableTasks} is the highest score physically possible in this sandbox, not the highest score physically possible for the model. See \"Why {gradableTasks}, not {totalTasks}\" above.",
      ],
    },
    source: {
      title: "How we measured it",
      body: "The code that runs this benchmark is part of the public repository.",
      linkLabel: "View the harness on GitHub",
    },
  },
  ja: {
    hero: {
      label: "ベンチマーク",
      title: "Qiskit HumanEval",
      body: "NalaがIBMの公開ベンチマークQiskit HumanEvalで記録したスコアと、その測定方法です。",
    },
    headline: {
      scoreTemplate: "{total}件中{passed}件のタスクに合格（{pct}%）",
      gradableTemplate: "サンドボックス内で合格しうる{gradable}件中{passedOfGradable}件に合格（{pct}%）",
      pendingTitle: "再実行中",
      pendingBodyTemplate: "レビュー段階の修正後の再実行は{date}に開始しました。完了次第、このページを更新します。",
    },
    what: {
      title: "このベンチマークについて",
      body: "Qiskit HumanEvalは、151件の短いQiskitプログラミング課題からなる公開ベンチマークで、課題ごとに正誤判定用のテストが用意されています。コードの速さや美しさではなく、実際に動作して正しい答えを返す量子コードを書けるかどうかを測定します。",
    },
    how: {
      title: "Leonaでの実行方法",
      body: "実際のユーザーと同じ方法でNalaを実行しました。本番と同じモデルを使い、各課題につき1回、Nalaのプラン作成・生成・実行・レビューの流れをそのまま通しています。ベンチマーク自身のテストに合格するコードをNalaが実際に届けた場合のみ合格として数えます。レビューを通過せず届かなかった候補は、内容にかかわらず不合格として扱います。",
    },
    ceiling: {
      titleTemplate: "{totalTasks}件中{gradableTasks}件である理由",
      bodyTemplate:
        "生成したコードを実行するサンドボックスは、意図的にインターネットへ接続できません。{totalTasks}件中{blockedTasks}件は、正解となるコード自体がサンドボックスで禁止されているものを必要とします。{blockedNeedsIbmCloud}件はIBMのクラウド上のライブラリを、さらに{blockedNeedsFileWrite}件はファイルへの書き込みを必要とします。この{blockedTasks}件は、どれだけ良いコードを生成してもこのサンドボックスでは合格できず、{gradableTasks}件が物理的に到達しうる上限です。",
    },
    controls: {
      title: "実行前に行った確認",
      bodyTemplate:
        "実際に費用が発生する前に、ハーネス自体を確認する無料のチェックを2つ実行しました。各課題の正解をそのまま提出すると{stubCanonicalTotal}件中{stubCanonicalPassed}件が合格し（上記の{gradableTasks}件の上限と一致します）、意図的に誤ったコードを提出すると{stubGarbagePassed}件が合格しました。どちらも既存の記録と一致しており、実際の実行を始める前にハーネス自体がずれていないことを確認できました。",
    },
    history: {
      title: "2回の実行",
      body: "1回目の実行は、レビュー段階の修正（PR 1010）前のNalaを測定したものです。修正のマージ後にベンチマーク全体を再実行しました。下の表には、想定ではなく実際に変わった内容を記録しています。",
      columns: {
        run: "実行",
        date: "日付",
        model: "モデル",
        passed: "合格数",
        ofGradableTemplate: "合格しうる{gradableTasks}件中",
        spend: "費用",
        wallTime: "所要時間",
        changed: "変更点",
      },
      pendingStatus: "再実行中",
      notAvailable: "—",
      change:
        "PR 1010は、Nalaのレビュー段階にあった3つのチェックを修正しました。これらは、コードがベンチマーク自身のテストに合格していても、課題の書き方とは無関係の理由で不合格として扱っていました。修正後も、実際に誤っているコードは引き続き不合格になります。",
    },
    limits: {
      title: "このスコアが示さないこと",
      items: [
        "上記のスコアはいずれも1回の実行によるものです。ベンチマークを2回実行してスコア自体がどれだけ変動するかは、まだ確認していません。",
        "同じコードでも、モデルの出力は実行のたびに変わります。社内での確認では、あるタスクが前回の実行では合格していたにもかかわらず、コードを変更しないまま再実行すると不合格になったことがありました。",
        "{gradableTasks}という数字は、このサンドボックスで物理的に到達しうる最高点であり、モデルの限界を示すものではありません。詳細は上記「{totalTasks}件中{gradableTasks}件である理由」をご覧ください。",
      ],
    },
    source: {
      title: "測定方法の公開",
      body: "このベンチマークを実行するコードは、公開リポジトリの一部です。",
      linkLabel: "GitHubでハーネスのコードを見る",
    },
  },
};

/** Public GitHub URL for the harness that produced every run on this page. */
export const BENCHMARKS_HARNESS_URL =
  "https://github.com/Leona-Quantum/leona/tree/dev/evals/harness/src/majorana_evals/public_benchmarks";
