import { useLayoutEffect, useState } from "react";

/** Keep a notice's contents and dimensions stable while its exit animation runs. */
export function useRetainedNoticeText(message: string): string {
  const [text, setText] = useState(message);
  useLayoutEffect(() => {
    if (message) setText(message);
  }, [message]);
  return text;
}
