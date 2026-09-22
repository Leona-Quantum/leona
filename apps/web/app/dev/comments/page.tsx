import { notFound } from "next/navigation";
import { AccountPanes } from "../../(app)/account/account-panes";
import { CommentsPanel } from "../../../components/comments-panel";
import { MentionsList } from "../../../components/mentions-list";
import { Shell } from "../../../components/shell";
import type { Comment, CommentPerson } from "../../../lib/comments";
import type { PublicLocale } from "../../../lib/public-locale";
import { ACCOUNT_COPY, COMMENTS_COPY, SHARING_COPY, TOURS_COPY, WORKSPACE_COPY } from "../../../lib/workspace-locale";

export const metadata = { title: "Comments fixtures" };

/**
 * The comments panel and the Mentions list, rendered with fixture data and no
 * control plane, for the screenshots a UI PR attaches (proposal 9).
 *
 * `?view=run` (default), `viewer` or `mentions`; `?locale=ja` for Japanese.
 * Dev/CI only, the same gate as `/dev/ui`: 404 in a production build.
 */
export default async function CommentsFixturesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; locale?: string }>;
}) {
  if (process.env.NODE_ENV === "production" && process.env.MAJORANA_UI_FIXTURES !== "1") {
    notFound();
  }
  const params = await searchParams;
  const locale: PublicLocale = params.locale === "ja" ? "ja" : "en";
  const view = params.view === "viewer" || params.view === "mentions" ? params.view : "run";
  const text = FIXTURE_TEXT[locale];
  return (
    <Shell accountName="Rui Costa" accountTier="developer" locale={locale} workspaceName="Ion trap group">
      {view === "mentions" ? (
        // Where the list lives: a pane of Settings, reached as `/account#mentions`,
        // in the same wrappers `app/(app)/account/page.tsx` uses. The other panes
        // are labels only here; their panels need a session.
        <div className="mj-library-page">
        <div className="mj-library-scroll">
        <div className="mj-workspace-content">
          <header className="mj-page-header">
            <div>
              <h1 className="mj-page-title">{ACCOUNT_COPY[locale].title}</h1>
              <p className="mj-page-lede">{ACCOUNT_COPY[locale].lede}</p>
            </div>
          </header>
          <AccountPanes
            navLabel={ACCOUNT_COPY[locale].sectionsLabel}
            panes={[
              { id: "preferences", label: ACCOUNT_COPY[locale].preferences, panel: null },
              { id: "tours", label: TOURS_COPY[locale].settings.label, panel: null },
              { id: "identity", label: ACCOUNT_COPY[locale].profile, panel: null },
              { id: "usage", label: ACCOUNT_COPY[locale].usageTitle, panel: null },
              { id: "workspaces", label: SHARING_COPY[locale].workspacesTitle, panel: null },
              { id: "mentions", label: COMMENTS_COPY[locale].mentionsTitle, panel: <MentionsList locale={locale} initial={mentions(locale)} /> },
              { id: "archived", label: WORKSPACE_COPY[locale].sidebar.archive, panel: null },
              { id: "qpu", label: ACCOUNT_COPY[locale].qpuTitle, panel: null },
              { id: "billing", label: ACCOUNT_COPY[locale].billingTitle, panel: null },
            ]}
          />
        </div>
        </div>
        </div>
      ) : (
        // The run page's own structure (`app/(app)/run/[taskId]/live-run.tsx`),
        // so the panel is shown where it lives: collapsed under the
        // conversation, opened here as a Mentions link opens it.
        <div className="mj-run-task">
          <div className="mj-run-task-scroll">
            <div className="mj-chat-content">
              <header className="mj-chat-header">
                <div>
                  <h1>{text.runTitle}</h1>
                  <span className="mj-chat-subtitle">{text.runLede}</span>
                </div>
              </header>
              <div className="mj-chat-thread">
                <div className="mj-chat-turn">
                  <div className="mj-chat-message mj-chat-message--user"><p>{text.prompt}</p></div>
                </div>
              </div>
              <CommentsPanel
                targetType="run"
                targetId={RUN_ID}
                locale={locale}
                collapsible
                defaultOpen
                initial={{ items: thread(locale, view === "viewer"), canComment: view !== "viewer", people: MENTIONABLE }}
              />
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

const RUN_ID = "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3a40";
const WORKSPACE_ID = "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3a00";

const PEOPLE: CommentPerson[] = [
  { user_id: "0199a7c2-0000-7000-8000-000000000001", display_name: "Aiko Tanaka", handle: "aiko", current_member: true },
  { user_id: "0199a7c2-0000-7000-8000-000000000002", display_name: "Rui Costa", handle: "rui", current_member: true },
  { user_id: "0199a7c2-0000-7000-8000-000000000003", display_name: "Sam Okafor", handle: "sam.okafor", current_member: true },
  { user_id: "0199a7c2-0000-7000-8000-000000000004", display_name: "Jun Park", handle: "jun", current_member: true },
];
const [AIKO, RUI, SAM] = PEOPLE;
/** What `GET /v1/comments/people` gives Rui: everyone but Rui. */
const MENTIONABLE = PEOPLE.filter((person) => person.user_id !== RUI.user_id);

const FIXTURE_TEXT: Record<PublicLocale, {
  runTitle: string;
  runLede: string;
  prompt: string;
  first: string;
  reply: string;
  afterDeleted: string;
  edited: string;
  mentionNotebook: string;
  mentionCircuit: string;
}> = {
  en: {
    runTitle: "Prepare a Bell pair and measure both qubits",
    runLede: "Conversation",
    prompt: "Prepare a Bell pair on two qubits, measure both, and show me the counts at 1,000 shots.",
    first: "The counts look lopsided for a Bell pair: 612 against 388 at 1,000 shots. @rui was the seed fixed on this one?",
    reply: "It was not, so part of that is shot noise. I reran it with seed 7 and the split comes out 503 to 497.\nNotes on the simulator settings: https://qiskit.github.io/qiskit-aer/",
    afterDeleted: "Moving the readout-noise question to the lab notebook so it stays with the model.",
    edited: "Added the ideal distribution to the Summary tab so the two can be compared side by side.",
    mentionNotebook: "@rui the check in cell 4 still expects the old basis order. Can you look before Thursday's class?",
    mentionCircuit: "This version drops two CNOTs. @rui does it still pass the equivalence check?",
  },
  ja: {
    runTitle: "ベルペアを作って2量子ビットを測定する",
    runLede: "会話",
    prompt: "2量子ビットでベルペアを作り、両方を測定して、1,000ショットのカウントを見せてください。",
    first: "ベルペアにしてはカウントが偏っています。1,000ショットで612対388です。@rui この実行ではシードは固定されていましたか？",
    reply: "固定していなかったので、ショットノイズの影響もあります。シード7で再実行すると503対497になりました。\nシミュレーターの設定はこちら: https://qiskit.github.io/qiskit-aer/",
    afterDeleted: "読み出しノイズの話は、モデルと一緒に残せるようにラボのノートブックに移します。",
    edited: "比較しやすいように、理想分布をSummaryタブに追加しました。",
    mentionNotebook: "@rui セル4のチェックが古い基底の順番のままです。木曜の授業までに見てもらえますか？",
    mentionCircuit: "この版ではCNOTが2つ減っています。@rui 等価性チェックはまだ通りますか？",
  },
};

function comment(overrides: Partial<Comment> & Pick<Comment, "id">): Comment {
  return {
    workspace_id: WORKSPACE_ID,
    target_type: "run",
    target_id: RUN_ID,
    parent_id: null,
    author: AIKO,
    body: "",
    mentions: [],
    created_at: "2026-09-22T09:12:00Z",
    edited_at: null,
    deleted_at: null,
    can_edit: false,
    can_delete: false,
    ...overrides,
  };
}

/** Read as Rui (a member): Rui's own comments can be edited and deleted. As a viewer, nothing can. */
function thread(locale: PublicLocale, viewer: boolean): Comment[] {
  const text = FIXTURE_TEXT[locale];
  const own = viewer ? {} : { can_edit: true, can_delete: true };
  return [
    comment({ id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3b01", author: AIKO, body: text.first, mentions: [RUI], created_at: "2026-09-22T09:12:00Z" }),
    comment({ id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3b02", parent_id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3b01", author: RUI, body: text.reply, created_at: "2026-09-22T09:31:00Z", ...own }),
    comment({ id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3b03", author: null, body: "", deleted_at: "2026-09-22T10:02:00Z", created_at: "2026-09-22T09:40:00Z" }),
    comment({ id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3b04", parent_id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3b03", author: AIKO, body: text.afterDeleted, created_at: "2026-09-22T10:05:00Z" }),
    comment({ id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3b05", author: SAM, body: text.edited, created_at: "2026-09-22T11:20:00Z", edited_at: "2026-09-22T11:24:00Z", ...(viewer ? {} : { can_delete: false }) }),
  ];
}

function mentions(locale: PublicLocale): Comment[] {
  const text = FIXTURE_TEXT[locale];
  return [
    comment({ id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3c03", target_type: "artifact", target_id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3a42", author: SAM, body: text.mentionCircuit, mentions: [RUI], created_at: "2026-09-22T13:05:00Z" }),
    comment({ id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3c02", target_type: "notebook", target_id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3a41", author: { ...PEOPLE[3] }, body: text.mentionNotebook, mentions: [RUI], created_at: "2026-09-22T12:10:00Z" }),
    comment({ id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3b01", author: AIKO, body: text.first, mentions: [RUI], created_at: "2026-09-22T09:12:00Z" }),
  ];
}
