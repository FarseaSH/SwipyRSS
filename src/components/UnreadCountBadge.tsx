type UnreadCountBadgeProps = {
  count: number;
  className?: string;
};

/**
 * Display unread counts consistently across scopes; hide zero counts and retain full tooltips for
 * large values.
 * 统一展示列表范围的未读数量；零计数不占位，超大计数保留完整提示。
 */
export function UnreadCountBadge({ count, className = "" }: UnreadCountBadgeProps) {
  if (count <= 0) return null;

  const label = `${count} 篇未读`;

  return (
    <span className={`count-badge unread-count-badge ${className}`.trim()} aria-label={label} title={label}>
      {count > 9999 ? "9999+" : count}
    </span>
  );
}

/**
 * Show the number of newly read articles in this list session; zero counts do not occupy title
 * space.
 * 展示当前列表会话中新增加的已读数；零计数不占用标题空间。
 */
export function SessionReadCountBadge({ count, className = "" }: UnreadCountBadgeProps) {
  if (count <= 0) return null;

  const label = `本次已读 ${count} 篇`;

  return (
    <span className={`count-badge session-read-count-badge ${className}`.trim()} aria-label={label} title={label}>
      +{count > 9999 ? "9999+" : count}
    </span>
  );
}

/**
 * Show the number of newly starred articles in this list session.
 * 展示当前列表会话中新增加的收藏数。
 */
export function SessionStarredCountBadge({ count, className = "" }: UnreadCountBadgeProps) {
  if (count <= 0) return null;

  const label = `本次收藏 ${count} 篇`;

  return (
    <span className={`count-badge session-starred-count-badge ${className}`.trim()} aria-label={label} title={label}>
      +{count > 9999 ? "9999+" : count}
    </span>
  );
}
