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
  direction: {
    label: string;
    title: string;
    paragraphs: string[];
    audiences: string[];
  };
  team: {
    label: string;
    title: string;
    body: string;
    /** Accessible name for a founder's focus-tag list, composed as
     *  `${member.name} — ${focusLabel}`. It exists because the label used to be
     *  the hardcoded English word "focus", which a Japanese screen-reader user
     *  heard read out in English beside a Japanese name. */
    focusLabel: string;
    portraitAlt: string;
    members: Array<{
      number: "01" | "02" | "03";
      name: string;
      romanName?: string;
      role: string;
      affiliation: string;
      bio: string;
      focus: string[];
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
      label: "LEONA QUANTUM / ABOUT",
      title: "Quantum technology,\nfor more minds.",
      body: "Leona Quantum is building a next-generation quantum operating system that carries a problem from natural language through algorithm design, execution, and verification.",
      signal: ["DESIGN", "EXECUTE", "VERIFY", "REUSE"],
    },
    why: {
      label: "02 / WHY",
      title: "Quantum work is still divided across too many layers.",
      paragraphs: [
        "The promise of quantum computing is real. Reaching it, however, still means moving between quantum hardware, cloud services, SDKs, algorithm design, implementation, and verification.",
        "That fragmentation leaves domain experts in chemistry, finance, optimization, and other fields with a high barrier between the problem they understand and the quantum tools that may help them explore it.",
        "We are building Leona Quantum to make that path coherent: one environment for turning a question into work that can be run, inspected, and used again.",
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
    direction: {
      label: "04 / DIRECTION",
      title: "Make quantum computing a foundation people can keep building on.",
      paragraphs: [
        "Our aim is to lower three barriers at once: specialist knowledge, implementation, and verification.",
        "Domain researchers should be able to explore their own questions with quantum methods. Independent researchers should be able to move faster without losing rigor. Learners should be able to understand quantum computing through circuits that actually run.",
      ],
      audiences: ["Domain R&D", "Independent research", "Learning & education"],
    },
    team: {
      label: "01 / TEAM",
      title: "Different disciplines. One system.",
      body: "Leona Quantum was founded by three builders working across computer science, physical informatics, quantum machine learning, robotics, and AI for science.",
      focusLabel: "Focus areas",
      portraitAlt: "Portrait of {name}",
      members: [
        {
          number: "01",
          name: "鈴木類",
          role: "CEO",
          affiliation: "Keio University · Information and Computer Science",
          bio: "Rui has researched multiple zeta functions and worked on robotics competitions, AI companion robots, and Vision-Language-Action research, with a focus on carrying theory into systems that work in the physical world.",
          focus: ["Robotics", "VLA", "Engineering"],
        },
        {
          number: "02",
          name: "Lê Quang Tuấn (渡邉黎)",
          role: "COO",
          affiliation: "Keio University · Applied Physics and Physico-Informatics",
          bio: "Rei researches spintronics and topological insulators, and has also worked in machine-learning education and learning support for displaced communities.",
          focus: ["Quantum materials", "Machine learning", "Education"],
        },
        {
          number: "03",
          name: "Eshaan Mistry",
          role: "CTO",
          affiliation: "UC Berkeley · Physics, Computer Science, and Chemistry",
          bio: "Eshaan has applied AI to physical simulation, life science, and quantum machine learning through work at Lawrence Berkeley National Laboratory, NASA Ames Research Center, and research teams at Berkeley and Keio.",
          focus: ["AI for science", "Quantum ML", "Life science"],
        },
      ],
    },
    cta: {
      label: "BUILD WITH US",
      title: "Bring us the quantum question you want to make real.",
      body: "Talk with us about research, product access, or a problem worth exploring together.",
      primary: "Talk to us",
      secondary: "Open the workspace",
    },
  },
  ja: {
    hero: {
      label: "LEONA QUANTUM / ABOUT",
      title: "量子技術を、\n限られた\n専門家だけの\nものにしない。",
      body: "Leona Quantumは、自然言語で伝えた課題から、量子アルゴリズムの設計、実行、検証までを一貫して支援する、次世代の量子OSを開発しています。",
      signal: ["設計", "実行", "検証", "再利用"],
    },
    why: {
      label: "02 / WHY",
      title: "量子開発は、まだ\n多くの専門領域に\n分断されています。",
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
    direction: {
      label: "04 / DIRECTION",
      title: "量子コンピューティングを、\n使い続けられる基盤へ。",
      paragraphs: [
        "私たちが目指すのは、専門知識、実装、検証という三つの壁を下げることです。",
        "他分野の研究開発者が、自分の課題へ量子技術を試せる。個人研究者が、確かさを失わずに開発を進められる。学習者が、実際に動く回路から理解を深められる。そんな入口をつくり、量子技術に取り組める人を増やしていきます。",
      ],
      audiences: ["他分野の研究開発", "個人研究", "学習・教育"],
    },
    team: {
      label: "01 / TEAM",
      title: "異なる専門性を、\nひとつのシステムに。",
      body: "Leona Quantumは、情報工学、物理情報工学、量子機械学習、ロボティクス、生命科学AIなど、異なる領域で研究と開発に取り組んできた3人によって立ち上げられました。",
      focusLabel: "注力領域",
      portraitAlt: "{name}のポートレート",
      members: [
        {
          number: "01",
          name: "鈴木類",
          role: "CEO",
          affiliation: "慶應義塾大学 理工学部 情報工学科",
          bio: "多重ゼータ関数の研究に取り組み、ロボット競技やAI対話ロボット、Vision-Language-Actionモデルの研究開発を通じて、理論を実際に動くシステムへ落とし込んできました。",
          focus: ["ロボティクス", "VLA", "エンジニアリング"],
        },
        {
          number: "02",
          name: "Lê Quang Tuấn (渡邉黎)",
          role: "COO",
          affiliation: "慶應義塾大学 理工学部 物理情報工学科",
          bio: "スピントロニクスとトポロジカル絶縁体を研究しながら、機械学習教育や難民の学習支援にも携わっています。",
          focus: ["量子材料", "機械学習", "教育"],
        },
        {
          number: "03",
          name: "Eshaan Mistry",
          role: "CTO",
          affiliation: "カリフォルニア大学バークレー校 物理学・情報科学・化学",
          bio: "ローレンス・バークレー国立研究所やNASA Ames Research Centerなどで、物理シミュレーション、生命科学、量子機械学習へのAI応用に取り組んできました。",
          focus: ["AI for Science", "量子機械学習", "生命科学"],
        },
      ],
    },
    cta: {
      label: "BUILD WITH US",
      title: "量子技術で解きたい問いを、\n聞かせてください。",
      body: "研究、プロダクト利用、共同で探求したい課題について、Leona Quantumにご相談ください。",
      primary: "相談する",
      secondary: "ワークスペースを開く",
    },
  },
};
