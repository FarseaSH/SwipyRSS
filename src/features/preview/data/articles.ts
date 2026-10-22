import { formatListPublishedTime } from "@/features/article-list/publishedTime";
import type { Article } from "@/types";
import { buildMockContent } from "./articleContent";

type PreviewArticleSeed = {
  id: string;
  feed: string;
  feedColor: string;
  published: string;
  title: string;
  summary: string;
  tags?: string[];
  isRead: boolean;
  isStarred: boolean;
};

// Relative dates keep the preview useful on any day. Deliberately out-of-order entries in
// the first and second batches exercise suffix grouping and the frozen append boundary.
const PREVIEW_NOW = Date.now();
const PREVIEW_HOURS_AGO = [0, 26, 1, 2, 4, 5, 7, 10, 25, 28, 0.5, 29, 32, 36, 41, 49, 56, 72, 80, 96, 110, 125, 140, 150, 170, 180, 190, 200, 240, 260];

const blueGrayFeedColors: Record<string, string> = {
  "#438A57": "#3B78B8",
  "#E8A43B": "#557FA9",
  "#788BD2": "#6F8FB4",
  "#55A988": "#4F7FAF",
  "#E26A50": "#365F8D",
  "#7563C7": "#7187A4",
  "#D8A133": "#7896B5",
  "#4B91A7": "#39739F",
  "#E86950": "#52789F",
  "#B54A4A": "#294F79",
  "#6A72C9": "#607FA6",
  "#9A6B4D": "#8499AE",
  "#2D3130": "#263E5B",
  "#4C9B72": "#4778A7",
  "#E083A3": "#7A91AC",
  "#D56D32": "#416B96",
  "#327D69": "#315F8C",
  "#6A7A6D": "#687E96",
  "#C94D55": "#345A82",
  "#7857A6": "#667F9F",
};

const mockAuthors: Record<string, string> = {
  "1": "林知远",
  "2": "Sarah Perez",
  "3": "Emily Gosling",
  "5": "Rebecca Solnit",
  "8": "Kate Moran",
  "13": "Brian Lovin",
  "18": "Kevin Purdy",
  "27": "Page Laubheimer",
};

const previewArticleSeeds: PreviewArticleSeed[] = [
  { id: "1", feed: "Smashing Magazine", feedColor: "#438A57", published: "今天 09:18", title: "设计师如何在 AI 时代重新理解界面与用户的关系", summary: "当产品开始预测用户的下一步行为，界面设计就不再只是组织按钮和信息。", tags: ["产品设计", "AI"], isRead: false, isStarred: false },
  { id: "2", feed: "The Verge", feedColor: "#E8A43B", published: "今天 08:54", title: "Apple 为开发者推出新的跨平台界面设计工具", summary: "新工具将设计语言、资产和多平台预览集成在同一个工作流中。", isRead: false, isStarred: true },
  { id: "3", feed: "It's Nice That", feedColor: "#438A57", published: "今天 08:41", title: "Five Independent Brand Identities Worth Studying This Week", summary: "From a neighborhood publisher to a civic wayfinding system, these projects show how small studios build distinct voices with limited means.", isRead: true, isStarred: false },
  { id: "4", feed: "Product Hunt", feedColor: "#788BD2", published: "今天 08:35", title: "从零开始构建一个专注阅读的产品：我们学到的六件事", summary: "一个小团队分享如何通过取舍、排版和交互节奏让阅读重新变得安静。", tags: ["独立开发", "阅读器"], isRead: false, isStarred: false },
  { id: "5", feed: "Aeon Essays", feedColor: "#55A988", published: "今天 08:30", title: "在快速世界里慢慢阅读，为什么仍然是一种重要的能力", summary: "注意力不只是一种个人资源，它也影响我们如何认识世界、理解他人。", isRead: false, isStarred: false },
  { id: "6", feed: "The Brand Identity", feedColor: "#E26A50", published: "今天 07:45", title: "一套好的品牌系统，应该为变化留出多少空间？", summary: "品牌规范不应是一份封闭的手册，而是一套能随产品生长的设计原则。", isRead: false, isStarred: false },
  { id: "7", feed: "UX Collective", feedColor: "#7563C7", published: "昨天 23:20", title: "为什么我们需要重新设计“已读”这个状态", summary: "阅读不是简单的完成或未完成，产品应该承认人们在回顾中的不同需求。", isRead: false, isStarred: false },
  { id: "8", feed: "Nielsen Norman Group", feedColor: "#D8A133", published: "昨天 19:08", title: "用户为什么会忽略看起来最明显的那个按钮", summary: "界面中的视觉显著性并不等于认知显著性，上下文和用户预期更重要。", isRead: true, isStarred: false },
  { id: "9", feed: "A List Apart", feedColor: "#4B91A7", published: "昨天 16:40", title: "Responsive Design Beyond Screen Size", summary: "Modern interfaces need to respond not only to width, but also to input methods, viewing distance, connectivity, and task context.", isRead: false, isStarred: true },
  { id: "10", feed: "Dense Discovery", feedColor: "#438A57", published: "昨天 12:15", title: "每周灵感清单：好用的工具、安静的网站与一本好书", summary: "本期收录了一款专注时间的小工具、一个互联网花园，以及对日常生活的观察。", isRead: false, isStarred: false },
  { id: "11", feed: "CSS-Tricks", feedColor: "#E86950", published: "昨天 10:42", title: "现代 CSS 布局中容易被忽略的五个小细节", summary: "从容器查询到逻辑属性，这些细节能让响应式界面更稳定，也更容易维护。", isRead: false, isStarred: false },
  { id: "12", feed: "MIT Technology Review", feedColor: "#B54A4A", published: "昨天 09:18", title: "生成式人工智能正在怎样改变个人知识管理", summary: "当搜索、整理和写作逐渐融合，知识工具需要重新思考信息来源与可信度。", isRead: true, isStarred: false },
  { id: "13", feed: "Design Details", feedColor: "#6A72C9", published: "昨天 08:05", title: "Small Transitions That Make Apps Feel Faster", summary: "Perceived speed depends on feedback timing and motion paths as much as it depends on raw loading time.", isRead: false, isStarred: true },
  { id: "14", feed: "The Marginalian", feedColor: "#9A6B4D", published: "前天 22:36", title: "阅读、记忆与我们选择反复回到的句子", summary: "一本书真正留下来的部分，往往不是完整论证，而是在不同阶段被重新理解的片段。", isRead: false, isStarred: false },
  { id: "15", feed: "Wired", feedColor: "#2D3130", published: "前天 20:14", title: "Why the Boundaries Between Personal Devices Are Disappearing", summary: "Phones, computers, and wearables are beginning to share task context instead of merely synchronizing files.", isRead: false, isStarred: false },
  { id: "16", feed: "UX Planet", feedColor: "#4C9B72", published: "前天 18:02", title: "设计一个不会打断用户的通知系统", summary: "通知的价值取决于时机、优先级和退出机制，而不是发送数量。", isRead: true, isStarred: false },
  { id: "17", feed: "Creative Boom", feedColor: "#E083A3", published: "前天 15:47", title: "小型设计工作室如何建立自己的视觉声音", summary: "一致性并不意味着重复，一套成熟语言应该允许团队针对不同语境做出变化。", isRead: false, isStarred: false },
  { id: "18", feed: "Ars Technica", feedColor: "#D56D32", published: "前天 13:21", title: "Why Local-First Software Is Having a Comeback", summary: "Offline resilience, data ownership, and instant feedback are bringing local-first architecture back into product conversations.", isRead: false, isStarred: true },
  { id: "19", feed: "Sidebar", feedColor: "#327D69", published: "前天 11:08", title: "关于工具栏位置、拇指热区和单手操作的观察", summary: "移动界面的底部操作区并非万能答案，它仍需要结合任务频率与内容结构。", isRead: false, isStarred: false },
  { id: "20", feed: "Offscreen", feedColor: "#6A7A6D", published: "08月10日 21:42", title: "独立软件为什么需要一种更慢的增长方式", summary: "不依赖无限扩张的产品，往往能把更多注意力重新放回用户和长期维护。", isRead: true, isStarred: false },
  { id: "21", feed: "Fast Company Design", feedColor: "#C94D55", published: "08月10日 18:16", title: "公共空间中的数字界面应该如何保持克制", summary: "当屏幕进入街道、车站和商场，信息密度需要服从环境，而不是争夺注意力。", isRead: false, isStarred: false },
  { id: "22", feed: "Smashing Magazine", feedColor: "#438A57", published: "08月10日 14:35", title: "为触摸、鼠标与键盘同时设计同一个组件", summary: "多输入方式并不是添加三个事件监听器，而是建立共享状态和清晰的冲突处理规则。", isRead: false, isStarred: false },
  { id: "23", feed: "The Verge", feedColor: "#E8A43B", published: "08月10日 09:12", title: "Tablets Are Blurring the Line Between Mobile and Desktop", summary: "Touch, keyboards, and trackpads now coexist on one device, forcing applications to adapt without losing continuity.", isRead: false, isStarred: true },
  { id: "24", feed: "A List Apart", feedColor: "#4B91A7", published: "08月09日 22:08", title: "内容优先并不意味着视觉设计只能保持简单", summary: "好的内容界面可以拥有鲜明个性，关键是让表达服务于阅读顺序。", isRead: true, isStarred: false },
  { id: "25", feed: "Product Coalition", feedColor: "#7857A6", published: "08月09日 16:24", title: "产品原型应该验证细节还是验证方向", summary: "不同阶段的原型承担不同问题，过早追求完整会掩盖真正需要验证的假设。", isRead: false, isStarred: false },
  { id: "26", feed: "Aeon Essays", feedColor: "#55A988", published: "08月09日 10:50", title: "无聊为何可能是创造力不可缺少的一部分", summary: "当注意力暂时没有明确对象，大脑反而有机会重新组织经验并形成新的连接。", isRead: false, isStarred: false },
  { id: "27", feed: "Nielsen Norman Group", feedColor: "#D8A133", published: "08月08日 19:30", title: "How Progressive Disclosure Reduces Initial Complexity", summary: "Show what people need for the current task first, then reveal advanced capabilities when the context makes them relevant.", isRead: false, isStarred: false },
  { id: "28", feed: "Dense Discovery", feedColor: "#438A57", published: "08月08日 13:15", title: "一组值得收藏的独立出版、字体与效率工具", summary: "从一本小型杂志到一款不追踪用户的笔记应用，本期关注安静而持久的作品。", isRead: true, isStarred: true },
  { id: "29", feed: "It's Nice That", feedColor: "#438A57", published: "08月08日 08:42", title: "Illustration in Digital Products Should Do More Than Decorate", summary: "Illustration can explain system states, guide unfamiliar workflows, and give abstract product concepts an emotional register.", isRead: false, isStarred: false },
  { id: "30", feed: "The Brand Identity", feedColor: "#E26A50", published: "08月07日 17:26", title: "从编辑设计中学习如何组织复杂的信息层级", summary: "版面中的比例、节奏和留白，同样适用于需要承载大量内容的数字界面。", isRead: false, isStarred: false },
];

/**
 * Convert manually maintained preview seeds to the standard Article model. Sharing Article between
 * preview and live connections prevents the UI from depending on mock-only feed, summary, or
 * structured-content fields.
 *
 * 将便于人工维护的预览种子转换为正式文章模型。
 *
 * 预览和真实连接共用 `Article`，可以确保 UI 不会悄悄依赖只有 mock 才有
 * 的 `feed`、`summary` 或结构化正文等字段。
 */
export const initialArticles: Article[] = previewArticleSeeds.map((seed, index) => {
  const content = buildMockContent(seed.id, seed.title, seed.summary);
  const publishedAt = PREVIEW_NOW - PREVIEW_HOURS_AGO[index] * 3_600_000;

  return {
    id: seed.id,
    feedId: createPreviewFeedId(seed.feed),
    feedTitle: seed.feed,
    feedColor: blueGrayFeedColors[seed.feedColor] ?? "#4f78a3",
    publishedAt,
    publishedLabel: formatListPublishedTime(publishedAt, PREVIEW_NOW).label,
    author: mockAuthors[seed.id],
    title: seed.title,
    summaryText: seed.summary,
    contentHtml: content.html,
    articleUrl: `https://example.com/swipyrss-preview/${seed.id}`,
    language: content.language,
    tags: seed.tags ?? [],
    isRead: seed.isRead,
    isStarred: seed.isStarred,
  };
});

/**
 * Generate a stable, repeatable preview ID for feeds with the same title.
 * 为同名 Feed 生成稳定、可重复的预览 ID。
 */
export function createPreviewFeedId(feedTitle: string): string {
  let hash = 2166136261;

  for (const character of feedTitle) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return `feed/preview-${(hash >>> 0).toString(16)}`;
}
