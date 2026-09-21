# Qiskit Fall Fest 2026 at Keio

Route: `/events/qiskit-fall-fest-2026`. Anonymous, server-rendered Japanese
information on a fixed light theme. Each visit starts in Japanese regardless of
the main site's locale cookie. The event header switches Japanese/English in
page state without changing that cookie; reloading restores Japanese. Document
language follows the visible content, while canonical metadata stays Japanese.
`copy.ts` holds the English translations of the owner-supplied Japanese copy.
The light theme is set on the server and maintained without overwriting the
visitor's saved theme for other surfaces.

Both days' five planned speakers appear directly after the hero, before the
overview and timetable. Company names, supplied speaker names, provisional talk
titles, and day assignments remain visible without operating the day selector.
The day selector switches only the timetable. On desktop, shared grid rows keep
the two speaker columns and their dividing lines aligned; mobile stacks the days. Speaker names retain
their supplied Japanese spelling in both languages.
The owner supplied the content and authorized the design, registration activation,
and production merge in this conversation on 2026-09-08.

## Content and registration

October 17–18, 2026; AIC Lounge, 2F, Kyoseikan, Hiyoshi; in person;
beginners welcome; planned capacity 40–50.
Attendance is free, as stated in the owner-supplied registration form. The five
speakers are marked planned and the supplied talk title provisional. The venue
is confirmed as 日吉協生館２階 AICラウンジ. Directions, map, and detailed PC
preparation remain explicitly pending.
The Code of Conduct is final at the owner's request. Contact and conduct reports:
`rei.watanabe@keio.jp`.

Keio University and IBM Quantum co-organize. 鈴木類 and 渡邉黎 are listed with
the organizers. Leona Quantum, Quanmatic, and Blueqat support the event. The
host and supporter artwork is grouped separately.

`app/events/qiskit-fall-fest-2026/event.ts` centralizes operational configuration.
Registration is enabled at the owner's explicit request with
https://forms.gle/Fir3TT1umiuWGnGu9. The public form responds without sign-in and
includes name, affiliation, email, experience, attendance day, photo consent
(including a decline option), and optional comments. The page itself collects no
personal information.

**Submission and confirmation-email receipt have not been tested.** The owner
explicitly requested enabling the button after being told these checks were
pending. `registrationEnabled` means activation, not verification. The remaining
handoff is to submit with an authorized test identity, confirm that the response
and receipt email arrive, and record the result. No response or email success is
invented.

Publication enables indexing and adds the concrete event URL to the sitemap.
The public-path change covers only this event subtree, with a regression check
that other event routes and similarly named attendee routes stay gated.

## Design and artwork

Scoped tokens in `packages/ts/ui/tokens.css`, Instrument Sans from the shared root
document, and the supplied Qiskit pictogram form the event's poster layout. The
header uses the supplied monochrome IBM Quantum artwork as a mask, following the
page's light/dark ink. Logos sit on white in both themes. The site's primary
navigation and shared styles are unchanged.

Asset provenance (official source artwork, not redrawn):

- Qiskit: supplied `Pictogram/SVG/qiskit_purple-60.svg`, copied unchanged.
- IBM: supplied `IBM_Quantum/Raster/RGB/IBM_Quantum_logotype_pos_RGB.png`;
  the header derivative trims transparent outer canvas only.
- Keio: https://www.keio.ac.jp/logos/keio-ja.svg
- Quanmatic: owner-supplied `Quanmatic Black Transparent (1).png`, copied unchanged
  to `/events/qiskit-fall-fest-2026/quanmatic.png`; CSS frames its transparent padding.
- Blueqat: https://blueqat.co.jp/assets/images/logo.png
- Leona: existing `/brand/leona-quantum-wordmark.png` through `LeonaWordmark`.

## Review

Local preview: `pnpm --dir apps/web dev --port 3001`.
Desktop and mobile screenshots live in `screenshots/qiskit-fall-fest-2026/`.
The publication branch is `feature/qiskit-fall-fest-keio-publish`, based on current
`origin/dev`. Unrelated About/landing edits and local-only commits in the original
checkout are preserved and excluded from this change.


## Timed program supplied by the owner

The owner's latest schedule supersedes the broad-period program from the earlier
planning PDF. October 17 has 17 entries from check-in at 09:30 to the 18:00
checkpoint close: Quanmatic and Blueqat talks, Qiskit 101, SQD hands-on work,
challenge briefing, an optimization hands-on workshop, team formation, explicit
hackathon preparation, and the hackathon.

October 18 has 11 entries, beginning at 09:30 with 小山 尚彦, followed by
IBM Quantum's 渡邉 毅 at 09:55 and 田中 宗 at 10:20. The speaker section follows
these updated day assignments and presentation order. The final submission
deadline is 16:30 for the notebook, project URL, and presentation slides.
Presentations and Q&A run 16:35–17:15: up to 10 teams, four minutes each.
Judging runs for 15 minutes, from 17:15–17:30. Awards, the closing ceremony,
and the group photo have their own 17:30–18:00 slot.

Blank detail cells in the supplied schedule remain blank. Times are displayed in
both language versions, and the page retains a notice that the schedule may change.
