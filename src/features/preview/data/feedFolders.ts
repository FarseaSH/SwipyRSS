import type { Feed, FeedFolder } from "@/types";
import { createPreviewFeedId, initialArticles } from "./articles";

type PreviewFolderSeed = {
  id: string;
  name: string;
  feedTitles: string[];
};

const previewFolderSeeds: PreviewFolderSeed[] = [
  {
    id: "design-product",
    name: "设计与产品",
    feedTitles: [
      "Smashing Magazine",
      "It's Nice That",
      "A List Apart",
      "UX Collective",
      "Nielsen Norman Group",
      "The Brand Identity",
      "Design Details",
      "UX Planet",
      "Creative Boom",
      "Fast Company Design",
      "Product Coalition",
    ],
  },
  {
    id: "technology-business",
    name: "科技与商业",
    feedTitles: [
      "The Verge",
      "Product Hunt",
      "MIT Technology Review",
      "Wired",
      "Ars Technica",
    ],
  },
];

/**
 * Preview feed metadata also uses stable IDs to associate feeds with folders.
 * 预览模式下的 Feed 元数据，同样使用稳定 ID 与文件夹关联。
 */
export const previewFeeds: Feed[] = Array.from(
  new Map(initialArticles.map((article) => [article.feedId, article])).values(),
).map((article) => ({
  id: article.feedId,
  title: article.feedTitle,
  folderIds: previewFolderSeeds
    .filter((folder) => folder.feedTitles.includes(article.feedTitle))
    .map((folder) => folder.id),
  unreadCount: initialArticles.filter(
    (candidate) => candidate.feedId === article.feedId && !candidate.isRead,
  ).length,
}));

/**
 * Preview folders store only feed IDs so title changes do not break selection.
 * 预览文件夹只保存 Feed ID，避免标题改变后破坏选中状态。
 */
export const feedFolders: FeedFolder[] = previewFolderSeeds.map((folder) => ({
  id: folder.id,
  name: folder.name,
  feedIds: folder.feedTitles.map(createPreviewFeedId),
  unreadCount: folder.feedTitles.reduce(
    (count, title) => count + initialArticles.filter(
      (article) => article.feedTitle === title && !article.isRead,
    ).length,
    0,
  ),
}));

/**
 * Find a feed's first folder; FreshRSS currently usually returns only one folder.
 * 查找一个 Feed 的首个所属文件夹；当前 FreshRSS 通常只返回一个文件夹。
 */
export function findFolderForFeed(feedId: string): FeedFolder | null {
  return feedFolders.find((folder) => folder.feedIds.includes(feedId)) ?? null;
}
