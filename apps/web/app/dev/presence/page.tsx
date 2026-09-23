import { notFound } from "next/navigation";
import { PresenceBar } from "../../../components/presence-bar";
import type { PresenceViewer } from "../../../lib/presence";
import type { PublicLocale } from "../../../lib/public-locale";

export const metadata = { title: "Presence fixtures" };

/**
 * The presence bar, rendered with fixture data and no control plane, for the
 * screenshots a UI PR attaches (proposal 9, second slice).
 *
 * `?view=run` (default), `notebook` or `artifact`; `?locale=ja` for Japanese.
 * Each surface's own header markup (`mj-chat-header`, `mj-notebook-workspace-actions`,
 * `mj-studio-actions`) is reproduced here so the bar renders with the real
 * spacing it has in production, without needing a signed-in session or a run
 * that exists on the server. Dev/CI only, the same gate as `/dev/ui` and
 * `/dev/comments`: 404 in a production build.
 */
export default async function PresenceFixturesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; locale?: string }>;
}) {
  if (process.env.NODE_ENV === "production" && process.env.MAJORANA_UI_FIXTURES !== "1") {
    notFound();
  }
  const params = await searchParams;
  const locale: PublicLocale = params.locale === "ja" ? "ja" : "en";
  const view = params.view === "notebook" || params.view === "artifact" ? params.view : "run";
  const text = FIXTURE_TEXT[locale];

  return (
    <div className="mj-workspace-content" style={{ padding: "var(--sp-6)" }}>
      {view === "run" ? (
        <div className="mj-run-task">
          <div className="mj-chat-content">
            <header className="mj-chat-header">
              <div>
                <h1>{text.runTitle}</h1>
                <span className="mj-chat-subtitle">{text.conversation}</span>
              </div>
              <div className="mj-run-task-actions">
                <PresenceBar targetType="run" targetId={RUN_ID} locale={locale} initial={TWO_VIEWERS} />
                <span className="mj-run-home-status">
                  <span className="mj-status-dot" aria-hidden="true" />
                  {text.ready}
                </span>
              </div>
            </header>
          </div>
        </div>
      ) : null}

      {view === "notebook" ? (
        <header className="mj-notebook-workspace-header">
          <div className="mj-notebook-workspace-title">
            <h1>{text.notebookTitle}</h1>
          </div>
          <div className="mj-notebook-workspace-actions">
            <PresenceBar targetType="notebook" targetId={NOTEBOOK_ID} locale={locale} initial={OVERFLOW_VIEWERS} />
            <button className="mj-secondary-button" type="button" disabled>
              {text.edit}
            </button>
          </div>
        </header>
      ) : null}

      {view === "artifact" ? (
        <div className="mj-studio-main">
          <div className="mj-studio-main-head">
            <div className="mj-studio-title-block">
              <input className="mj-studio-title-input" value={text.circuitTitle} readOnly />
            </div>
            <div className="mj-studio-actions">
              <PresenceBar targetType="artifact" targetId={ARTIFACT_ID} locale={locale} initial={ONE_VIEWER} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const RUN_ID = "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3a40";
const NOTEBOOK_ID = "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3a41";
const ARTIFACT_ID = "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3a42";

const VIEWERS: PresenceViewer[] = [
  { user_id: "0199a7c2-0000-7000-8000-000000000001", display_name: "Aiko Tanaka", handle: "aiko" },
  { user_id: "0199a7c2-0000-7000-8000-000000000002", display_name: "Sam Okafor", handle: "sam.okafor" },
  { user_id: "0199a7c2-0000-7000-8000-000000000003", display_name: "Jun Park", handle: "jun" },
  { user_id: "0199a7c2-0000-7000-8000-000000000004", display_name: null, handle: "member-7c2a" },
  { user_id: "0199a7c2-0000-7000-8000-000000000005", display_name: "Rui Costa", handle: "rui" },
];
const [AIKO, SAM] = VIEWERS;
const ONE_VIEWER = [AIKO];
const TWO_VIEWERS = [AIKO, SAM];
const OVERFLOW_VIEWERS = VIEWERS;

const FIXTURE_TEXT: Record<PublicLocale, {
  runTitle: string;
  conversation: string;
  ready: string;
  notebookTitle: string;
  edit: string;
  circuitTitle: string;
}> = {
  en: {
    runTitle: "Prepare a Bell pair and measure both qubits",
    conversation: "Conversation",
    ready: "Ready",
    notebookTitle: "Superposition and measurement",
    edit: "Edit",
    circuitTitle: "Bell pair v3",
  },
  ja: {
    runTitle: "ベルペアを作って2量子ビットを測定する",
    conversation: "会話",
    ready: "準備完了",
    notebookTitle: "重ね合わせと測定",
    edit: "編集",
    circuitTitle: "ベルペア v3",
  },
};
