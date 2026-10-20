import type { ReactNode } from "react";
import type { ToolbarPosition } from "@/types";

/**
 * Position the side toolbar independently of its changing capsule height.
 * 固定侧边工具栏的定位层，避免居中位移依赖正在变化的胶囊高度。
 */
export function ToolbarAnchor({ position, children }: { position: ToolbarPosition; children: ReactNode }) {
  return <div className={`toolbar-anchor ${position === "bottom" ? "" : "side-toolbar-anchor"}`} data-toolbar-position={position}>
    {children}
  </div>;
}
