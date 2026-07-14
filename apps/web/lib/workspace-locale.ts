import type { PublicLocale } from "./public-locale";

export const WORKSPACE_COPY: Record<PublicLocale, {
  /* Nameko is the branded exception to nav-config's generic Run label. */
  surfaces: { brandedRun: string; preview: string };
  sidebar: {
    newChat: string;
    recent: string;
    folders: string;
    synced: string;
    localOnly: string;
    noFolder: string;
    folderName: string;
    allChats: string;
    viewAll: string;
    settings: string;
    workspaceNav: string;
    readOnlyData: string;
    personalWorkspace: string;
    yesterday: string;
    daysAgo: (days: number) => string;
    publicPreview: string;
    localDeveloper: string;
    workspaceOptions: string;
    recentChats: string;
    moveToFolder: (title: string) => string;
    chatFolders: string;
    createChatFolder: string;
    saveFolder: string;
    cancelFolder: string;
  };
}> = {
  en: {
    surfaces: { brandedRun: "Nameko Run", preview: "Public preview" },
    sidebar: {
      newChat: "New chat",
      recent: "Recent",
      folders: "Folders",
      synced: "Synced",
      localOnly: "Local only",
      noFolder: "No folder",
      folderName: "Folder name",
      allChats: "All chats",
      viewAll: "View all",
      settings: "Settings",
      workspaceNav: "Workspace",
      readOnlyData: "Read-only fixture data",
      personalWorkspace: "Personal workspace",
      yesterday: "Yesterday",
      daysAgo: (days) => `${days}d ago`,
      publicPreview: "Public preview",
      localDeveloper: "Local developer",
      workspaceOptions: "Workspace options",
      recentChats: "Recent chats",
      moveToFolder: (title) => `Move ${title} to folder`,
      chatFolders: "Chat folders",
      createChatFolder: "Create chat folder",
      saveFolder: "Save folder",
      cancelFolder: "Cancel folder creation",
    },
  },
  ja: {
    surfaces: { brandedRun: "Nameko 実行", preview: "公開プレビュー" },
    sidebar: {
      newChat: "新しいチャット",
      recent: "最近",
      folders: "フォルダ",
      synced: "同期済み",
      localOnly: "ローカルのみ",
      noFolder: "フォルダなし",
      folderName: "フォルダ名",
      allChats: "すべてのチャット",
      viewAll: "すべて表示",
      settings: "設定",
      workspaceNav: "ワークスペース",
      readOnlyData: "読み取り専用データ",
      personalWorkspace: "個人ワークスペース",
      yesterday: "昨日",
      daysAgo: (days) => `${days}日前`,
      publicPreview: "公開プレビュー",
      localDeveloper: "ローカル開発者",
      workspaceOptions: "ワークスペース設定",
      recentChats: "最近のチャット",
      moveToFolder: (title) => `${title}をフォルダへ移動`,
      chatFolders: "チャットフォルダ",
      createChatFolder: "チャットフォルダを作成",
      saveFolder: "フォルダを保存",
      cancelFolder: "フォルダ作成をキャンセル",
    },
  },
};

export const ACCOUNT_COPY: Record<PublicLocale, {
  title: string;
  lede: string;
  signOut: string;
  preferences: string;
  language: string;
  languageHelp: string;
  identity: string;
  email: string;
  name: string;
  notSet: string;
  workspace: string;
  workspaceData: string;
  artifacts: string;
  runs: string;
  members: string;
  workspaceMembers: string;
  sharedAccess: string;
  collaboratorEmail: string;
  collaboratorRole: string;
  member: string;
  viewer: string;
  addMember: string;
  adding: string;
  loading: string;
  unavailable: string;
  memberAddFailed: string;
  requestFailed: string;
  memberAdded: (email: string) => string;
}> = {
  en: {
    title: "Settings",
    lede: "Identity, workspace access, and preferences for your Majorana workspace.",
    signOut: "Sign out",
    preferences: "Preferences",
    language: "Language",
    languageHelp: "Choose the language used for shared navigation and account settings.",
    identity: "Identity",
    email: "Email",
    name: "Name",
    notSet: "Not set",
    workspace: "Workspace",
    workspaceData: "Workspace data",
    artifacts: "Artifacts",
    runs: "Runs",
    members: "Members",
    workspaceMembers: "Workspace members",
    sharedAccess: "shared access",
    collaboratorEmail: "Collaborator email",
    collaboratorRole: "Collaborator role",
    member: "Member",
    viewer: "Viewer",
    addMember: "Add member",
    adding: "Adding…",
    loading: "Loading workspace data…",
    unavailable: "Workspace data is unavailable.",
    memberAddFailed: "Member could not be added",
    requestFailed: "Request failed",
    memberAdded: (email) => `${email} can now use this workspace.`,
  },
  ja: {
    title: "設定",
    lede: "Majoranaワークスペースの本人情報、アクセス権、表示設定を管理します。",
    signOut: "サインアウト",
    preferences: "表示設定",
    language: "言語",
    languageHelp: "共通ナビゲーションとアカウント設定で使用する言語を選択します。",
    identity: "本人情報",
    email: "メールアドレス",
    name: "名前",
    notSet: "未設定",
    workspace: "ワークスペース",
    workspaceData: "ワークスペースデータ",
    artifacts: "アーティファクト",
    runs: "実行",
    members: "メンバー",
    workspaceMembers: "ワークスペースメンバー",
    sharedAccess: "共有アクセス",
    collaboratorEmail: "共同利用者のメールアドレス",
    collaboratorRole: "共同利用者の権限",
    member: "メンバー",
    viewer: "閲覧者",
    addMember: "メンバーを追加",
    adding: "追加中…",
    loading: "ワークスペースデータを読み込んでいます…",
    unavailable: "ワークスペースデータを取得できません。",
    memberAddFailed: "メンバーを追加できませんでした",
    requestFailed: "リクエストに失敗しました",
    memberAdded: (email) => `${email} がこのワークスペースを利用できるようになりました。`,
  },
};
