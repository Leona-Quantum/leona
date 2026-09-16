"use client";

import { useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { eventText } from "./copy";
import { getEventDays } from "./event";
import s from "./page.module.css";

export function Program({ locale }: { locale: PublicLocale }) {
  const [selected, setSelected] = useState(0);
  const days = getEventDays(locale);
  const day = days[selected];
  const t = (text: Parameters<typeof eventText>[1]) => eventText(locale, text);
  return (
    <div className={s.program}>
      <div className={s.dayButtons} aria-label={t("表示する開催日")}>
        {days.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected === index}
            aria-controls="day-program"
            onClick={() => setSelected(index)}
          >
            <span>{item.date}<small> ({item.weekday})</small></span>
            <span>{item.english}</span>
          </button>
        ))}
      </div>
      <div id="day-program" className={s.dayPanel} aria-live="polite" aria-atomic="true">
        <h3>
          {locale === "ja"
            ? `${day.date}（${day.weekday}）のプログラム（予定）`
            : `${day.date} · ${day.english} program (planned)`}
        </h3>
        <p className={s.dayIntro}>{day.description}</p>
        <ol className={s.schedule} aria-label={t("当日の流れ")}>
          {day.schedule.map((session) => (
            <li key={`${session.period}-${session.title}`}>
              <p className={s.sessionPeriod}>{session.period}</p>
              <div>
                <h4>{session.title}</h4>
                {session.description && <p>{session.description}</p>}
              </div>
            </li>
          ))}
        </ol>
        <p className={s.programNote}>
          {t("スケジュールは変更になる場合があります。")}
        </p>
      </div>
    </div>
  );
}
