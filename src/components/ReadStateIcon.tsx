type Props = {
  isRead: boolean;
  size?: number;
  className?: string;
};

/**
 * Use consistent geometry for the unread circular indicator and read-state icon.
 * 用同一套几何语言展示未读圆环和已读状态。
 */
export function ReadStateIcon({ isRead, size = 20, className = "" }: Props) {
  return (
    <svg className={`read-state-icon ${isRead ? "is-read" : "is-unread"} ${className}`.trim()} width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle className="read-state-ring" cx="10" cy="10" r="8"/>
      <circle className="read-state-dot" cx="10" cy="10" r="5"/>
    </svg>
  );
}
