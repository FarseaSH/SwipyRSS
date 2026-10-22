/** Both shortcut positions share typography; only the star state changes the color. */
export function ArticleShortcutNumber({ number }: { number: number }) {
  return <span className="article-shortcut-number" aria-hidden="true">{number}</span>;
}
