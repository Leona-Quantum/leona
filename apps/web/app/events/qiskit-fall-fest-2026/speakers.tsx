import type { CSSProperties } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { eventText } from "./copy";
import { getEventDays } from "./event";
import s from "./page.module.css";

/** Both days stay visible independently of the interactive timetable. */
export function Speakers({ locale }: { locale: PublicLocale }) {
  const t = (text: Parameters<typeof eventText>[1]) => eventText(locale, text);
  const eventDays = getEventDays(locale);
  // One row for the date header plus the longer day's speaker count, so a lineup
  // change on either day only edits `event.ts` — the shared subgrid rows below
  // follow the data instead of a span hard-coded to today's two-speaker lineup.
  const speakerRows = 1 + Math.max(...eventDays.map((day) => day.speakers.length));
  return (
    <section id="speakers" className={s.speakers} aria-labelledby="speakers-title">
      <div className={s.sectionHeading}>
        <h2 id="speakers-title">{t("登壇予定の講演者")}</h2>
        <p>{t("研究や産業応用に携わる4名が、2日間にわたって講演する予定です。")}</p>
      </div>
      <div className={s.speakerDays} style={{ "--speaker-rows": speakerRows } as CSSProperties}>
        {eventDays.map((day) => (
          <div className={s.speakerDay} key={day.id}>
            <h3 className={s.speakerDate}>
              <time dateTime={day.id === "saturday" ? "2026-10-17" : "2026-10-18"}>{day.date}</time>
              <span>{locale === "ja" ? `${day.weekday}曜日` : day.english}</span>
            </h3>
            {day.speakers.map((speaker) => {
              const academic = ["教授", "先生", "Professor", "Guest speaker"].includes(speaker.affiliation);
              return (
              <article className={s.speaker} key={speaker.name}>
                <div>
                  {!academic && <p className={s.affiliation}>{speaker.affiliation}</p>}
                  {/* Keep supplied names rather than guessing their romanization. */}
                  <h4><span lang="ja">{speaker.name}</span>{academic && <small>{speaker.affiliation}</small>}</h4>
                </div>
                <div>
                  <p className={s.talkTitle}>{speaker.title}</p>
                  <p className={s.pending}>{speaker.note}</p>
                </div>
              </article>
              );
            })}
          </div>
        ))}
      </div>
      <p className={s.programNote}>
        {t("登壇者・講演内容は変更になる場合があります。確定次第、このページでお知らせします。")}
      </p>
    </section>
  );
}
