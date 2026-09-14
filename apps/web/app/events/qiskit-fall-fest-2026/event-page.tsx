"use client";

import { useEffect, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { eventText } from "./copy";
import { Speakers } from "./speakers";
import Image from "next/image";
import { LeonaWordmark } from "../../../components/leona-wordmark";
import { event } from "./event";
import { Program } from "./program";
import s from "./page.module.css";

const experiences = [
  [
    "回路をつくる",
    "Qiskitで量子ビットとゲートを組み合わせ、自分の量子回路を作成します。",
  ],
  [
    "動かして、確かめる",
    "IBM Quantum PlatformやGoogle Colabを使う演習を予定しています。実行環境は事前にご案内します。",
  ],
  [
    "チームで試す",
    "ガイド付き演習のあとはミニハッカソンへ。仲間とアイデアを持ち寄り、コードにします。",
  ],
  ["成果を共有する", "取り組んだテーマや実装、そこから得た発見を発表します。"],
] as const;
const faqs = [
  [
    "量子コンピュータを初めて学びます。参加できますか？",
    "初心者歓迎です。ガイド付きのQiskit演習を予定しています。必要なPythonや数学の知識、事前学習については準備が整い次第ご案内します。",
  ],
  [
    "慶應義塾大学以外の学生や、社会人も参加できますか？",
    "参加対象は調整中です。確定次第、このページでお知らせします。",
  ],
  [
    "どちらか1日だけでも参加できますか？",
    "1日だけの参加が可能かどうかは調整中です。登録フォームでは、参加を希望する日をお伺いする予定です。",
  ],
  ["参加費はいくらですか？", "参加費は無料です。"],
  [
    "チームを組んでから申し込む必要がありますか？",
    "ミニハッカソンはチームでの参加を予定しています。事前にチームを組む必要があるかなど、詳しい参加方法は確定次第ご案内します。",
  ],
  [
    "会場で写真や動画の撮影はありますか？",
    "参加登録時に、写真・動画の撮影に同意するかをお伺いする予定です。撮影の範囲や利用目的、撮影を希望しない方への対応は、登録フォームでご案内します。",
  ],
] as const;

export default function EventPage() {
  const [locale, setLocale] = useState<PublicLocale>("ja");
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const t = (text: Parameters<typeof eventText>[1]) => eventText(locale, text);
  const registrationOpen =
    event.registrationEnabled && Boolean(event.registrationUrl);
  return (
    <div className={s.page} data-surface="qff-keio" lang={locale}>
      <a className={s.skip} href="#main">
        {t("本文へ移動")}
      </a>
      <header className={s.header}>
        <a
          className={s.ibmBrand}
          href="#event-title"
          aria-label={t("IBM Quantum — イベントの先頭へ")}
        >
          <span aria-hidden="true" />
        </a>
        <nav aria-label={t("イベント内ナビゲーション")}>
          <a href="#about">{t("イベント概要")}</a>
          <a href="#speakers">{t("講演者")}</a>
          <a href="#program">{t("プログラム")}</a>
          <a href="#access">{t("会場")}</a>
        </nav>
        <div className={s.languageToggle}>
          <div className="mj-language-toggle" role="group" aria-label={t("言語")}>
            {(["en", "ja"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={locale === option} onClick={() => setLocale(option)}>
                {option === "en" ? "EN" : "日本語"}
              </button>
            ))}
          </div>
        </div>
        <a className={s.headerCta} href="#register">
          {t("参加登録")}<span aria-hidden="true">↗</span>
        </a>
      </header>
      <main id="main">
        <section className={s.hero} aria-labelledby="event-title">
          <div className={s.heroCopy}>
            <h1 id="event-title">
              <span>Qiskit</span>
              <span>Fall Fest</span>
              <span className={s.titleLast}>
                2026 <em>@ Keio</em>
              </span>
            </h1>
            <p className={s.heroMessage}>
              {t("量子コンピュータを、")}
              <br />
              {t("自分の手で動かす週末。")}
            </p>
            <div className={s.heroDate}>
              <time dateTime="2026-10-17">
                10.17<small>{t("土")}</small>
              </time>
              <span className={s.dateSeparator}>/</span>
              <time dateTime="2026-10-18">
                18<small>{t("日")}</small>
              </time>
            </div>
            <p className={s.heroVenue}>
              {t("慶應義塾大学 AIC")}<span>{t("対面開催")}</span>
            </p>
            <a className={s.button} href="#register">
              {t("参加登録")}<span aria-hidden="true">↗</span>
            </a>
            <p className={s.registrationHint}>
              {registrationOpen
                ? t("参加条件をご確認のうえ、お申し込みください。")
                : t("参加登録は準備中です。")}
            </p>
          </div>
          <div className={s.heroArt} aria-hidden="true">
            <div className={s.artTop}>
              <span>Qiskit Fall Fest</span>
              <span>Keio / 2026</span>
            </div>
            <Image
              src="/events/qiskit-fall-fest-2026/qiskit.svg"
              alt=""
              width={480}
              height={480}
              priority
              className={s.pictogram}
            />
            <div className={s.artBottom}>
              <span>
                October
                <br />
                17 & 18
              </span>
              <span>
                {t("つくる。試す。")}
                <br />
                {t("量子で考える。")}
              </span>
            </div>
          </div>
        </section>
        <Speakers locale={locale} />
        <section id="about" className={s.about} aria-labelledby="about-title">
          <div>
            <h2 id="about-title">
              {t("はじめの一歩から、")}
              <br />
              {t("ひとつのアイデアへ。")}
            </h2>
            <p>
              {t("量子コンピューティングに興味がある。")}
              <br />
              {t("そんな方に向けた、2日間のイベントです。")}
            </p>
          </div>
          <div className={s.aboutBody}>
            <p>
              {t("講演で量子計算の研究や活用事例を知り、Qiskitの実習でコードを書きます。ミニハッカソンではチームで課題に取り組み、成果を発表します。慶應義塾大学AICで、一緒に量子計算を体験しましょう。")}
            </p>
            <dl className={s.facts}>
              <div>
                <dt>{t("開催形式")}</dt>
                <dd>{t("対面")}</dd>
              </div>
              <div>
                <dt>{t("必要な経験")}</dt>
                <dd>{t("初心者歓迎")}</dd>
              </div>
              <div>
                <dt>{t("定員")}</dt>
                <dd>
                  {t("40〜50名")}<small>{t("予定")}</small>
                </dd>
              </div>
            </dl>
          </div>
        </section>
        <section
          id="program"
          className={s.section}
          aria-labelledby="program-title"
        >
          <div className={s.sectionHeading}>
            <h2 id="program-title">{t("2日間のプログラム")}</h2>
            <p>{t("基礎講義からハンズオン、チームでの制作と成果発表まで。")}</p>
          </div>
          <Program locale={locale} />
          <div className={s.hackathonBrief}>
            <div>
              <h3>{t("ガイド付きミニハッカソン")}</h3>
              <p>
                {t("1チーム4〜5名、最大10チームでの実施を予定しています。講義や実習で学んだことを生かし、メンターに相談しながらコードを動かして、結果と考察をノートブックにまとめます。")}
              </p>
            </div>
            <div>
              <p className={s.challengeLabel}>
                {t("課題候補 · どちらか1つを選択")}
              </p>
              <dl className={s.challengeCourses}>
                <div>
                  <dt>{t("SQD実験")}</dt>
                  <dd>
                    {t("サンプル数などの条件を変え、推定結果や計算量の違いを比較します。結果をグラフで示し、考察とあわせてノートブックにまとめます。")}
                  </dd>
                </div>
                <div>
                  <dt>{t("最適化への応用")}</dt>
                  <dd>
                    {t("小規模な配送や割り当てを題材に、仮想の問題を数式で表し、解法を比較します。目的関数、制約条件、比較結果をノートブックに整理します。")}
                  </dd>
                </div>
              </dl>
              <p className={s.programNote}>
                {t("課題の詳細と提出方法は当日ご案内します。内容は変更になる場合があります。")}
              </p>
            </div>
          </div>
        </section>
        <section className={s.experience} aria-labelledby="experience-title">
          <div className={s.experienceHeading}>
            <h2 id="experience-title">
              {t("学ぶだけで、")}
              <br />
              {t("終わらない。")}
            </h2>
            <p>
              {t("Qiskitで回路をつくり、")}
              <br />
              {t("実行結果から次のアイデアへ。")}
            </p>
            <div className={s.technology}>
              <span>{t("演習で使用予定")}</span>
              <Image
                src="/events/qiskit-fall-fest-2026/ibm-quantum.png"
                width={200}
                height={77}
                loading="eager"
                unoptimized
                alt="IBM Quantum"
              />
            </div>
          </div>
          <ol className={s.experienceList}>
            {experiences.map(([title, body], index) => (
              <li key={title}>
                <span className={s.stepNumber}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{t(title)}</h3>
                  <p>{t(body)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section
          id="access"
          className={s.section}
          aria-labelledby="access-title"
        >
          <div className={s.sectionHeading}>
            <h2 id="access-title">{t("会場と参加の準備")}</h2>
          </div>
          <div className={s.accessGrid}>
            <div className={s.venue}>
              <span className={s.venueMonogram} aria-hidden="true">
                AIC
              </span>
              <h3>{t("慶應義塾大学 AIC")}</h3>
              <p>
                {event.venueDetails ??
                  t("キャンパス・建物・部屋番号、会場までの経路は、確定次第ご案内します。")}
              </p>
              {event.venueMapUrl && (
                <a href={event.venueMapUrl} className={s.textLink}>
                  {t("アクセスを見る")}
                </a>
              )}
            </div>
            <div className={s.preparation}>
              <h3>{t("持ち物・パソコンの準備")}</h3>
              <ul>
                <li>{t("ノートパソコンと充電器")}</li>
                <li>{t("演習に使うブラウザー")}</li>
                <li>{t("必要に応じて筆記用具")}</li>
              </ul>
              <p>
                {t("対応OSや必要なソフトウェア、アカウントなど、事前に準備していただく内容は後日ご案内します。")}
              </p>
            </div>
          </div>
        </section>
        <section
          id="register"
          className={s.registration}
          aria-labelledby="register-title"
        >
          <div>
            <h2 id="register-title">
              {t("この秋は、")}
              <br />
              {t("量子計算に挑戦。")}
            </h2>
            <p>
              {t("2026年10月17日（土）・18日（日）")}
              <br />
              {t("慶應義塾大学 AIC / 定員40〜50名（予定）")}
            </p>
          </div>
          <div className={s.registrationBody}>
            <h3>{t("参加登録")}</h3>
            {registrationOpen ? (
              <>
                <p>{t("参加条件をご確認のうえ、登録フォームへお進みください。")}</p>
                <a className={s.button} href={event.registrationUrl!}>
                  {t("参加登録フォームへ")}<span aria-hidden="true">↗</span>
                </a>
              </>
            ) : (
              <>
                <p className={s.registrationStatus}>{t("登録受付は準備中です")}</p>
                <p>{t("受付開始まで、もうしばらくお待ちください。")}</p>
                <button className={s.button} disabled>
                  {t("受付開始をお待ちください")}
                </button>
              </>
            )}
            <p className={s.formNote}>
              {t("登録フォームでは、氏名、所属、メールアドレス、経験、参加希望日をご記入のうえ、撮影に同意するかどうかをお選びください。")}
            </p>
          </div>
        </section>
        <section id="faq" className={s.faq} aria-labelledby="faq-title">
          <h2 id="faq-title">{t("よくある質問")}</h2>
          <div>
            {faqs.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {t(question)}
                  <span aria-hidden="true">＋</span>
                </summary>
                <p>{t(answer)}</p>
              </details>
            ))}
          </div>
        </section>
        <section className={s.closing} aria-label={t("行動指針とお問い合わせ")}>
          <div>
            <h2>Code of Conduct</h2>
            <p>{t("行動指針")}</p>
            <p>
              {t("背景や経験の違いを尊重し、互いの学びを支える場を目指します。ハラスメント、差別的な言動、同意のない撮影や情報公開は認めません。困ったことがあれば、当日の運営スタッフにご相談ください。")}
            </p>
            <details>
              <summary>{t("行動指針の詳細")}</summary>
              <p>
                {t("参加者・登壇者・運営スタッフを含む、本イベントに関わるすべての方に、この行動指針を守っていただきます。相手の発言や作業を尊重してください。")}
              </p>
              <p>
                {t("不適切な行為を見聞きした際や、対応に困った際は、当日の運営スタッフ、または以下のメールアドレスへご相談ください。")}
                <br />
                <a className={s.textLink} href={`mailto:${event.contactEmail}`}>
                  {event.contactEmail}
                </a>
              </p>
            </details>
          </div>
          <div>
            <h2>{t("お問い合わせ")}</h2>
            {event.contactEmail ? (
              <a className={s.textLink} href={`mailto:${event.contactEmail}`}>
                {event.contactEmail}
              </a>
            ) : (
              <p>
                {t("イベント専用の問い合わせ先は準備中です。")}
                <br />
                {t("確定次第、こちらに掲載します。")}
              </p>
            )}
          </div>
        </section>
        <section className={s.organizations} aria-label={t("主催・協力")}>
          <div className={s.host}>
            <h2>{t("主催")}</h2>
            <ul className={s.hostLogos}>
              <li>
                <Image
                  src="/events/qiskit-fall-fest-2026/keio.svg"
                  alt={t("慶應義塾大学")}
                  width={204}
                  height={48}
                  unoptimized
                />
              </li>
              <li>
                <Image
                  src="/events/qiskit-fall-fest-2026/ibm-quantum-header.png"
                  alt={event.organizers[1]}
                  width={190}
                  height={27}
                  unoptimized
                />
              </li>
            </ul>
          </div>
          <div className={s.supporters}>
            <h2>{t("協力")}</h2>
            <ul className={s.partnerLogos}>
              <li>
                <span role="img" aria-label={event.supporters[0]}>
                  <LeonaWordmark className={s.partnerLeona} />
                </span>
              </li>
              <li>
                <Image
                  src="/events/qiskit-fall-fest-2026/quanmatic.svg"
                  alt={event.supporters[1]}
                  width={190}
                  height={23}
                  unoptimized
                />
              </li>
              <li>
                <Image
                  src="/events/qiskit-fall-fest-2026/blueqat.png"
                  alt={event.supporters[2]}
                  width={148}
                  height={37}
                  unoptimized
                />
              </li>
            </ul>
          </div>
        </section>
      </main>
      <footer className={s.footer}>
        <a href="/" className={s.brand} aria-label={t("Leona Quantum ホーム")}>
          <LeonaWordmark className={s.footerLeona} />
        </a>
        <p>Qiskit Fall Fest 2026 @ Keio</p>
        <a href="#event-title">{t("ページの先頭へ ↑")}</a>
      </footer>
    </div>
  );
}
