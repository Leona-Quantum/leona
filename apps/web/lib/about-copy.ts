import type { PublicLocale } from "./public-locale";

type AboutCopy = {
  hero: {
    label: string;
    title: string;
    body: string;
    signal: string[];
  };
  why: {
    label: string;
    title: string;
    paragraphs: string[];
  };
  build: {
    label: string;
    title: string;
    body: string;
    steps: Array<{ number: string; title: string; body: string }>;
  };
  /**
   * The company's ambition, read after the people (owner, 2026-09-10) and
   * rewritten to reach past the workspace (owner, 2026-09-12): a heading, a
   * lede, six numbered ambitions drawn from the Atlas north star and the
   * staged roadmap, and a closing line.
   */
  vision: {
    label: string;
    title: string;
    lede: string;
    items: Array<{ title: string; body: string }>;
    close: string;
  };
  team: {
    label: string;
    title: string;
    portraitAlt: string;
    members: Array<{
      number: "01" | "02" | "03";
      name: string;
      romanName?: string;
      role: string;
      affiliation: string;
      bio: string;
    }>;
  };
  cta: {
    label: string;
    title: string;
    body: string;
    primary: string;
    secondary: string;
  };
};

export const ABOUT_COPY: Record<PublicLocale, AboutCopy> = {
  en: {
    hero: {
      label: "About Leona",
      title: "Quantum software for research and learning.",
      body: "Leona Quantum brings quantum code generation, execution, and verification into one workspace.",
      signal: ["DESIGN", "EXECUTE", "VERIFY", "REUSE"],
    },
    why: {
      label: "Why we build",
      title: "Quantum work is still divided across too many layers.",
      paragraphs: [
        "Quantum development involves hardware, cloud services, SDKs, algorithm design, implementation, and verification.",
        "Researchers in chemistry, finance, and optimization need to connect the problems they know to quantum methods they can evaluate.",
        "Leona brings these steps together so researchers can develop a circuit, inspect the result, and continue their work.",
      ],
    },
    build: {
      label: "03 / WHAT WE BUILD",
      title: "From a question to a quantum circuit you can inspect.",
      body: "Leona keeps the development loop together. The AI plans and builds, the simulator returns evidence, and the result becomes reusable knowledge instead of disappearing into a one-off experiment.",
      steps: [
        { number: "01", title: "Describe", body: "Express the problem and constraints in natural language." },
        { number: "02", title: "Design & run", body: "Turn the plan into quantum code and execute it in a supported environment." },
        { number: "03", title: "Verify", body: "Review the result, its checks, and the conditions that produced it." },
        { number: "04", title: "Keep & reuse", body: "Preserve the circuit and evidence so the work can be revisited and extended." },
      ],
    },
    vision: {
      label: "Where we are going",
      title: "Beyond the workspace.",
      lede: "The workspace is the first thing we built. The system we are building toward reads the literature for you, keeps an honest record of what has actually been shown, and gets a working, checked implementation into your hands faster than you could manage alone.",
      items: [
        {
          title: "An Atlas that keeps growing",
          body: "Thousands of papers, each method traced from input to output with its cost and its source. Nothing enters without a citation, and when the literature does not fit the map, the map changes.",
        },
        {
          title: "Cost you can follow end to end",
          body: "Resource estimates composed along a whole pathway rather than one gate at a time, so two routes to the same answer can be compared before anyone writes code.",
        },
        {
          title: "From a pathway to your Studio",
          body: "Pick a route through the Atlas, or let the assistant suggest one, and open it as a working assembly with its assumptions, interfaces and evidence carried along. Export it, or keep extending it there.",
        },
        {
          title: "An assistant that has read the code",
          body: "Models trained on real implementations that can propose a workflow, write the circuit, and say which hardware could run it. Each suggestion carries the sources it came from, so you can open them.",
        },
        {
          title: "Real machines, honestly reported",
          body: "Runs on quantum hardware next to the simulation, a lane for the large statevector jobs, circuit compression and annealing, each with its evidence attached the same way.",
        },
        {
          title: "A system that improves itself",
          body: "It should be able to say what it does not yet know, go and read for it, and restructure when a paper does not fit. Every one of those loops stays behind a human gate, because a well-formed wrong answer breaks no rule.",
        },
      ],
      close: "Each step rests on the one before it, and nothing reaches the record without a source.",
    },
    team: {
      label: "Our team",
      title: "Meet the founders",
      portraitAlt: "Portrait of {name}",
      members: [
        {
          number: "01",
          name: "鈴木類",
          role: "CEO",
          affiliation: "Keio University · Information and Computer Science",
          bio: "Rui has researched multiple zeta functions and worked on robotics competitions, AI companion robots, and Vision-Language-Action research, with a focus on carrying theory into systems that work in the physical world.",
        },
        {
          number: "02",
          name: "Lê Quang Tuấn (渡邉黎)",
          role: "COO",
          affiliation: "Keio University · Applied Physics and Physico-Informatics",
          bio: "Rei researches spintronics and topological insulators, and has also worked in machine-learning education and learning support for displaced communities.",
        },
        {
          number: "03",
          name: "Eshaan Mistry",
          role: "CTO",
          affiliation: "UC Berkeley · Physics, Computer Science, and Chemistry",
          bio: "Eshaan has applied AI to physical simulation, life science, and quantum machine learning through work at Lawrence Berkeley National Laboratory, NASA Ames Research Center, and research teams at Berkeley and Keio.",
        },
      ],
    },
    cta: {
      label: "Work with us",
      title: "Tell us about your research.",
      body: "Contact us about a research project, product access, or collaboration.",
      primary: "Talk to us",
      secondary: "Open the workspace",
    },
  },
  ja: {
    hero: {
      label: "Leonaについて",
      title: "研究と学びのための量子ソフトウェア。",
      body: "Leona Quantumは、量子コードの生成、実行、検証をひとつのワークスペースにまとめます。",
      signal: ["設計", "実行", "検証", "再利用"],
    },
    why: {
      label: "開発の背景",
      title: "量子開発には、複数の専門領域が関わります。",
      paragraphs: [
        "量子コンピューティングには大きな可能性があります。一方で、実際の開発には、量子ハードウェアやクラウド、SDK、アルゴリズム、実装、検証と、いくつもの専門領域をまたぐ必要があります。",
        "この複雑さが、化学や金融、最適化などの知見を持つ人と量子技術の間に、まだ高い壁をつくっています。",
        "私たちは、問いを実行できる形へ変え、確かめ、もう一度使える知識として残すまでを、ひとつの環境でつなごうとしています。",
      ],
    },
    build: {
      label: "03 / WHAT WE BUILD",
      title: "問いから、\n検証できる量子回路へ。",
      body: "Leonaは、量子開発のループを分断しません。AIによる設計と実装、シミュレーション、結果の検証、リポジトリへの保存までをつなぎ、一度きりの実験を再利用できる知識へ変えていきます。",
      steps: [
        { number: "01", title: "問いを伝える", body: "解きたい課題と条件を、自然言語で入力します。" },
        { number: "02", title: "設計し、実行する", body: "AIが計画を量子コードへ落とし込み、対応する環境で実行します。" },
        { number: "03", title: "結果を確かめる", body: "結果だけでなく、検証内容と実行条件まで確認できます。" },
        { number: "04", title: "知識として残す", body: "回路と根拠を保存し、後から参照、再利用できる形にします。" },
      ],
    },
    vision: {
      label: "目指す場所",
      title: "ワークスペースの先へ。",
      lede: "ワークスペースは、私たちが最初に作ったものです。目指しているのは、文献を代わりに読み、実際に示されたことだけを正直に記録し、動作を確認した実装をひとりで進めるより早く手元に届けるシステムです。",
      items: [
        {
          title: "育ち続けるアトラス",
          body: "数千本の論文から、各手法を入力から出力まで、コストと出典つきでたどれるようにします。出典のないものは収録せず、文献が地図に収まらないときは地図の側を変えます。",
        },
        {
          title: "経路全体で追えるコスト",
          body: "ゲート単位ではなく経路全体でリソース見積もりを合成し、同じ答えに至る二つの経路をコードを書く前に比べられるようにします。",
        },
        {
          title: "経路からスタジオへ",
          body: "アトラスで経路を選ぶか、アシスタントに提案させて、前提・入出力・根拠を引き継いだ作業用の組み立てとして開きます。書き出すことも、そのまま広げていくこともできます。",
        },
        {
          title: "コードを読んだアシスタント",
          body: "実際の実装で学習したモデルが、ワークフローを提案し、回路を書き、どのハードウェアで動くかを示します。提案にはもとになった出典が添えられ、その場で開いて確かめられます。",
        },
        {
          title: "実機での結果を正直に",
          body: "シミュレーションと並べて量子ハードウェアで実行し、大規模な状態ベクトル計算のレーン、回路圧縮、アニーリングにも同じ形で根拠を添えます。",
        },
        {
          title: "自ら良くなるシステム",
          body: "まだ知らないことを自分で言えて、そのために文献を読みに行き、論文が収まらなければ構造を変える。そのどの循環も人の承認を通します。形の整った誤答は、どの規則にも引っかからないからです。",
        },
      ],
      close: "各段階は前の段階の上に立ち、出典のないものは記録に入りません。",
    },
    team: {
      label: "チーム",
      title: "創業者を紹介します",
      portraitAlt: "{name}のポートレート",
      members: [
        {
          number: "01",
          name: "鈴木類",
          role: "CEO",
          affiliation: "慶應義塾大学 理工学部 情報工学科",
          bio: "多重ゼータ関数の研究に取り組み、ロボット競技やAI対話ロボット、Vision-Language-Actionモデルの研究開発を通じて、理論を実際に動くシステムへ落とし込んできました。",
        },
        {
          number: "02",
          name: "Lê Quang Tuấn (渡邉黎)",
          role: "COO",
          affiliation: "慶應義塾大学 理工学部 物理情報工学科",
          bio: "スピントロニクスとトポロジカル絶縁体を研究しながら、機械学習教育や難民の学習支援にも携わっています。",
        },
        {
          number: "03",
          name: "Eshaan Mistry",
          role: "CTO",
          affiliation: "カリフォルニア大学バークレー校 物理学・情報科学・化学",
          bio: "ローレンス・バークレー国立研究所やNASA Ames Research Centerなどで、物理シミュレーション、生命科学、量子機械学習へのAI応用に取り組んできました。",
        },
      ],
    },
    cta: {
      label: "お問い合わせ",
      title: "取り組んでいる研究を教えてください。",
      body: "研究、プロダクト利用、共同で探求したい課題について、Leona Quantumにご相談ください。",
      primary: "相談する",
      secondary: "ワークスペースを開く",
    },
  },
};
