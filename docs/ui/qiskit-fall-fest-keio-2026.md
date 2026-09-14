# Qiskit Fall Fest 2026 at Keio

Route: `/events/qiskit-fall-fest-2026`. Anonymous, server-rendered Japanese
information on a fixed light theme. Each visit starts in Japanese regardless of
the main site's locale cookie. The event header switches Japanese/English in
page state without changing that cookie; reloading restores Japanese. Document
language follows the visible content, while canonical metadata stays Japanese.
`copy.ts` holds the English translations of the owner-supplied Japanese copy.
The light theme is set on the server and maintained without overwriting the
visitor's saved theme for other surfaces.

Both days' four planned speakers appear directly after the hero, before the
overview and timetable. Company names, supplied speaker names, provisional talk
titles, and day assignments remain visible without operating the day selector.
The day selector switches only the timetable. On desktop, shared grid rows keep
the two speaker columns and their dividing lines aligned; mobile stacks the days. Speaker names retain
their supplied Japanese spelling in both languages.
The owner supplied the content and authorized the design, registration activation,
and production merge in this conversation on 2026-09-08.

## Content and registration

October 17–18, 2026; Keio AIC; in person; beginners welcome; planned capacity 40–50.
Attendance is free, as stated in the owner-supplied registration form. The four
speakers are marked planned and the supplied talk title provisional. Campus,
room, map, session times, and detailed PC preparation remain explicitly pending.
The Code of Conduct is final at the owner's request. Contact and conduct reports:
`admin@leonaquantum.com`.

Keio University and IBM Quantum co-organize. Leona Quantum, Quanmatic, and Blueqat
support the event. The host and supporter artwork is grouped separately.

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
- Quanmatic: https://www.quanmatic.com/wp-content/themes/quanmatic/images/common/logo.svg
- Blueqat: https://blueqat.co.jp/assets/images/logo.png
- Leona: existing `/brand/leona-quantum-wordmark.png` through `LeonaWordmark`.

## Review

Local preview: `pnpm --dir apps/web dev --port 3001`.
Desktop and mobile screenshots live in `screenshots/qiskit-fall-fest-2026/`.
The publication branch is `feature/qiskit-fall-fest-keio-publish`, based on current
`origin/dev`. Unrelated About/landing edits and local-only commits in the original
checkout are preserved and excluded from this change.


## Expanded program from the owner-supplied plan

Source: `QFF-Keio.docx - Google ドキュメント.pdf`, pages 1–2, supplied locally.
The private planning PDF is not published. Day one now describes Quantum/Qiskit
101, lectures, SQD instruction and paired hands-on work, team formation, and the
start of the mini hackathon. Day two describes lectures, mentored implementation,
Notebook submission, presentations, and feedback/awards. A shared brief covers
4–5-person teams and the two candidate courses: SQD experiments and optimization.
The planned talk topics are quantum annealing and quantum machine learning.

The source explicitly says timings are provisional; the page uses broad day
periods and marks the program planned rather than publishing exact clock times.
The red annotation on page 1 disagrees with the speaker table and detailed agenda
about day assignments. Clarification was requested; the existing published
assignments are retained until confirmed. Host/contact/conduct facts continue to
follow the owner's newer explicit instructions, not the older planning draft.
