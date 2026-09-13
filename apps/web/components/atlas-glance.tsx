/**
 * The at-a-glance strip under an Atlas figure: a row of small tiles, each a
 * label over a value, some of them links to the section that says more.
 *
 * It draws what it is handed and nothing else. Every caller builds its items
 * from fields the record or the method actually carries, and leaves an item out
 * when the field is absent — a tile reading "—" would be a claim that somebody
 * looked and found nothing, which is not what an absent field means.
 *
 * No hooks and no directive, so a server page renders it as plain HTML and a
 * client view can import it too.
 */
export interface AtlasGlanceItem {
  readonly key: string;
  readonly label: string;
  readonly value?: string;
  readonly href?: string;
  readonly tone?: "accent" | "ok" | "warn" | "neutral";
  /** Longer wording for the hover title, when the tile has to be terse. */
  readonly title?: string;
}

export function AtlasGlance({
  items,
  label,
}: {
  items: readonly AtlasGlanceItem[];
  label: string;
}): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <ul className="mj-atlas-glance" aria-label={label}>
      {items.map((item) => {
        const body = (
          <>
            <span className="mj-atlas-glance-label">{item.label}</span>
            {item.value !== undefined ? <strong className="mj-atlas-glance-value">{item.value}</strong> : null}
          </>
        );
        return (
          <li key={item.key} className="mj-atlas-glance-item" data-tone={item.tone} data-glance={item.key}>
            {item.href ? (
              <a href={item.href} title={item.title}>
                {body}
              </a>
            ) : (
              <span title={item.title}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
