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
  workspace: string;
  displayName: string;
  yourName: string;
  saveName: string;
  saving: string;
  profileSaved: string;
  profileSaveFailed: string;
  personalWorkspace: string;
  personalWorkspaceHelp: string;
  artifacts: string;
  runs: string;
  access: string;
  privateAccess: string;
  workspaceBoundaries: string;
  library: string;
  libraryHelp: string;
  repositoryExport: string;
  repositoryExportHelp: string;
  collaboration: string;
  collaborationHelp: string;
  loading: string;
  unavailable: string;
  requestFailed: string;
}> = {
  en: {
    title: "Settings",
    lede: "Your identity, private Library, personal workspace data, and display preferences.",
    signOut: "Sign out",
    preferences: "Preferences",
    language: "Language",
    languageHelp: "Choose the language used for shared navigation and account settings.",
    identity: "Identity",
    email: "Email",
    workspace: "Workspace",
    displayName: "Display name",
    yourName: "Your name",
    saveName: "Save name",
    saving: "Saving…",
    profileSaved: "Profile saved.",
    profileSaveFailed: "Profile could not be saved",
    personalWorkspace: "Personal workspace",
    personalWorkspaceHelp: "This workspace belongs only to you. Collaboration and shared workspaces are planned, but not enabled yet.",
    artifacts: "Artifacts",
    runs: "Runs",
    access: "Access",
    privateAccess: "Private",
    workspaceBoundaries: "Workspace boundaries",
    library: "Library",
    libraryHelp: "Saved runs and public references stay in your personal Library.",
    repositoryExport: "Repository export",
    repositoryExportHelp: "Sign in to copy a public entry into this workspace and open it in Studio.",
    collaboration: "Collaboration",
    collaborationHelp: "Deferred until shared access, invitations, and permissions are productized.",
    loading: "Loading workspace data…",
    unavailable: "Workspace data is unavailable.",
    requestFailed: "Request failed",
  },
  ja: {
    title: "設定",
    lede: "本人情報、非公開ライブラリ、個人ワークスペースのデータ、表示設定を管理します。",
    signOut: "サインアウト",
    preferences: "表示設定",
    language: "言語",
    languageHelp: "共通ナビゲーションとアカウント設定で使用する言語を選択します。",
    identity: "本人情報",
    email: "メールアドレス",
    workspace: "ワークスペース",
    displayName: "表示名",
    yourName: "名前",
    saveName: "名前を保存",
    saving: "保存中…",
    profileSaved: "プロフィールを保存しました。",
    profileSaveFailed: "プロフィールを保存できませんでした",
    personalWorkspace: "個人ワークスペース",
    personalWorkspaceHelp: "このワークスペースはあなただけが利用できます。共同利用と共有ワークスペースは今後対応予定です。",
    artifacts: "アーティファクト",
    runs: "実行",
    access: "アクセス",
    privateAccess: "非公開",
    workspaceBoundaries: "ワークスペースの範囲",
    library: "ライブラリ",
    libraryHelp: "保存した実行と公開リファレンスは、個人ライブラリに保持されます。",
    repositoryExport: "リポジトリから保存",
    repositoryExportHelp: "サインインすると、公開エントリをこのワークスペースへコピーしてStudioで開けます。",
    collaboration: "共同利用",
    collaborationHelp: "共有アクセス、招待、権限の正式対応まで利用できません。",
    loading: "ワークスペースデータを読み込んでいます…",
    unavailable: "ワークスペースデータを取得できません。",
    requestFailed: "リクエストに失敗しました",
  },
};
