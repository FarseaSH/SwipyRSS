type ArticleSection = {
  heading: string;
  paragraphs: string[];
  quote?: string;
};

type ArticleContent = {
  language: "zh-CN" | "en";
  sections: ArticleSection[];
  closing: string;
};

export type PreviewArticleContent = {
  language: "zh-CN" | "en";
  html: string;
};

type ContentProfile = {
  language?: "zh-CN" | "en";
  topic: string;
  context: string;
  example: string;
  tension: string;
  practice: string;
  takeaway: string;
};

const profiles: Record<string, ContentProfile> = {
  "1": { topic: "AI 参与界面决策后的用户关系", context: "一款会主动整理阅读队列的新闻应用", example: "系统在用户停顿时提供解释，而不是立刻弹出建议", tension: "预测越准确，用户越需要知道决定是怎样产生的", practice: "让自动化可撤销、可解释，并在不需要时退回背景", takeaway: "真正可靠的智能界面，不是替用户做完所有事情，而是让用户始终知道自己仍握有方向" },
  "2": { topic: "跨平台设计工具如何改变协作", context: "同一套界面需要同时落到手机、平板和桌面端", example: "设计令牌、组件状态和设备预览被放进同一个工作区", tension: "统一能减少重复劳动，却也可能抹平不同平台的使用习惯", practice: "共享视觉语言，同时为输入方式和窗口环境保留平台差异", takeaway: "跨平台系统的价值不在于让所有界面一样，而在于让不同界面拥有同一种逻辑" },
  "3": { language: "en", topic: "independent brand systems", context: "five studios working with limited budgets and small teams", example: "a neighborhood publisher built its identity around one variable typeface and a restrained color system", tension: "consistency can easily become repetition when every surface follows the same template", practice: "define a small set of recognizable rules, then leave room for local expression", takeaway: "A memorable identity behaves less like a locked template and more like a clear voice." },
  "4": { topic: "专注阅读产品的取舍", context: "一个只有三名成员的团队从原型走向长期维护", example: "团队删除了活跃度排行榜，把空间重新留给文章和阅读位置", tension: "产品需要足够多的能力留住用户，又不能让功能抢走注意力", practice: "用真实阅读任务评估每个入口，而不是用功能数量衡量完整度", takeaway: "专注不是缺少功能，而是所有功能都清楚自己什么时候应该安静" },
  "5": { topic: "慢速阅读在快速信息环境中的价值", context: "人们每天在多个短内容流之间频繁切换", example: "读者重新阅读同一段文字时，往往会发现第一次略过的论证", tension: "效率工具鼓励更快处理内容，理解却需要停顿、回看和遗忘", practice: "为阅读保留重叠、书签和无惩罚的回退路径", takeaway: "阅读的价值并不总能用完成数量衡量，很多理解只在速度降下来之后出现" },
  "6": { topic: "可生长的品牌系统", context: "品牌需要覆盖产品、活动、编辑内容和线下空间", example: "核心网格保持稳定，而字体比例与图像语言根据场景变化", tension: "规范太松会失去辨识度，太紧又会让团队只能机械复制", practice: "明确不可改变的骨架，并记录允许变化的参数与边界", takeaway: "成熟的品牌规范不是封闭答案，而是一套帮助团队持续做出一致判断的方法" },
  "7": { topic: "重新理解已读状态", context: "用户会略读、收藏、回看，也会在多台设备之间继续阅读", example: "一篇已经打开的文章仍可能因为没有读完而留在当前队列", tension: "数据库需要明确布尔值，真实阅读却存在许多中间状态", practice: "区分系统记录与用户意图，并避免状态变化造成列表突然跳动", takeaway: "已读不是内容关系的终点，它只是用户与文章发生过接触的一条线索" },
  "8": { topic: "视觉显著性与认知显著性的差异", context: "一个结算页面不断放大主按钮却没有改善转化", example: "当文案说明了下一步会发生什么，普通尺寸的按钮反而更容易被点击", tension: "更亮、更大能够吸引目光，却不一定能消除用户的不确定感", practice: "先修正上下文、顺序和反馈，再决定是否需要增强视觉重量", takeaway: "用户忽略的往往不是按钮本身，而是按钮背后尚未被回答的问题" },
  "9": { language: "en", topic: "responsive design beyond breakpoints", context: "products used with touch, keyboards, trackpads, and split-screen windows", example: "the same tablet layout exposed different controls when a pointer and keyboard became available", tension: "screen width is easy to measure, while intent and input context are less stable", practice: "treat size, input, network quality, and viewing distance as separate signals", takeaway: "Responsive design is becoming a response to situations, not merely to rectangles." },
  "10": { topic: "安静而持久的数字工具", context: "一份每周通讯筛选独立软件、网站和书籍", example: "一款不要求注册的专注计时器通过本地数据保持了极低负担", tension: "推荐需要足够鲜明才能被记住，又不能变成新的信息噪声", practice: "减少条目数量，解释选择理由，并让读者可以快速离开", takeaway: "好的清单不是把更多东西推给读者，而是替读者完成一次克制的筛选" },
  "11": { topic: "现代 CSS 布局的稳定细节", context: "一个组件需要被放进多种未知宽度的容器", example: "使用容器查询和逻辑属性后，卡片不再依赖页面级断点", tension: "新能力可以减少补丁代码，也可能在缺少约束时增加调试难度", practice: "优先建立内容尺寸和溢出规则，再逐步引入容器级响应", takeaway: "稳定布局来自清楚的边界条件，而不是不断增加更具体的选择器" },
  "12": { topic: "生成式 AI 与个人知识管理", context: "搜索、摘录、整理和写作开始出现在同一个界面里", example: "系统在生成摘要时同时保留原文段落和来源位置", tension: "生成能够加快回顾，但也可能让未经验证的推断混入个人知识库", practice: "让来源始终可追溯，并把生成内容与用户原始笔记明确区分", takeaway: "知识工具可以帮助形成连接，但不应该替用户隐藏连接是如何形成的" },
  "13": { language: "en", topic: "motion that improves perceived speed", context: "mobile interfaces where network work and local transitions happen at different times", example: "a list item began moving immediately while its detail data continued loading in place", tension: "animation can explain continuity, but decorative motion often makes waiting feel longer", practice: "start feedback early, keep paths short, and let motion describe a real state change", takeaway: "The fastest-feeling transition is the one that makes the system's next state obvious." },
  "14": { topic: "阅读与记忆中的重复回访", context: "读者在不同人生阶段重新打开同一本书", example: "多年前被忽略的一句话，因为新的经历而获得完全不同的重量", tension: "数字阅读强调保存全部内容，人的记忆却依靠选择与遗忘工作", practice: "允许标记随时间变化，并保留重新发现旧内容的温和入口", takeaway: "真正留下来的句子并不静止，它会随着读者的变化不断获得新的含义" },
  "15": { language: "en", topic: "continuity across personal devices", context: "phones, laptops, watches, and tablets sharing the same task state", example: "a draft moved from a phone to a desktop without reopening the app or locating the file", tension: "seamless handoff is useful, but invisible synchronization can make data movement hard to understand", practice: "show what moved, where it is stored, and how the user can stop the handoff", takeaway: "The future of multi-device design is task continuity with visible boundaries." },
  "16": { topic: "不打断用户的通知系统", context: "协作产品同时承载紧急提醒和低优先级更新", example: "系统把可延迟消息聚合到工作段落结束后再统一呈现", tension: "更及时的通知看似更有价值，却会持续破坏用户的任务上下文", practice: "根据可行动性、紧迫程度和用户状态决定出现时机", takeaway: "通知的质量取决于它尊重了多少注意力，而不是成功送达了多少消息" },
  "17": { topic: "小型工作室的视觉声音", context: "成员有限的团队需要在多个客户项目中保持辨识度", example: "工作室把大胆留白和手工图形作为方法，而不是固定样式", tension: "鲜明风格有助于被看见，也可能让客户内容变成工作室自己的背景", practice: "坚持工作方法的一致性，同时让每个项目从真实语境中长出形式", takeaway: "视觉声音不是重复某种外观，而是反复展现团队如何看待问题" },
  "18": { language: "en", topic: "the return of local-first software", context: "apps expected to work instantly across unreliable networks", example: "a writing tool saved every edit locally and synchronized conflicts only when connectivity returned", tension: "local ownership improves speed and resilience, while collaboration still requires shared state", practice: "make offline behavior the default and treat synchronization as a visible, recoverable process", takeaway: "Local-first design turns the network from a dependency into a collaboration layer." },
  "19": { topic: "底部工具栏与单手操作", context: "移动设备越来越高，而常用操作仍集中在屏幕顶部", example: "阅读器把低风险高频操作移到底部，并让导航在滚动时自动收缩", tension: "靠近拇指能够提高效率，却也容易遮挡内容或造成误触", practice: "结合任务频率、内容安全区和唤醒机制决定工具栏位置", takeaway: "拇指热区是一项约束，不是一条要求所有操作都放到底部的规则" },
  "20": { topic: "独立软件的慢增长", context: "不依赖风险投资的小团队需要同时照顾产品和生活", example: "开发者把稳定续费和低支持成本放在用户总量之前", tension: "快速曝光能够带来收入，也会带来团队无法消化的承诺和维护负担", practice: "选择清晰用户群，控制功能边界，并把可靠性当作增长的一部分", takeaway: "可持续的增长不是拒绝扩大，而是让产品规模始终不超过维护关系的能力" },
  "21": { topic: "公共空间中的数字界面", context: "车站、街道和商场的屏幕同时争夺路人的注意力", example: "导视系统降低动画频率后，紧急信息反而更容易被发现", tension: "屏幕需要被看见，但公共环境不能被持续闪动和高对比占据", practice: "按照距离、停留时间和信息优先级控制密度与运动", takeaway: "公共界面的克制不是缺少表达，而是承认空间中的注意力属于所有人" },
  "22": { topic: "多输入方式下的同一组件", context: "一个文章卡片同时接受触摸、鼠标、键盘和触控笔", example: "组件先判断移动方向和距离，再决定捕获指针还是保留点击", tension: "为每种输入分别增加监听器很容易造成状态冲突和重复触发", practice: "共享业务状态，为不同输入保留各自阈值，并明确手势优先级", takeaway: "多输入设计的目标不是让事件代码变多，而是让不同操作得到同样可靠的结果" },
  "23": { language: "en", topic: "tablets as hybrid computers", context: "devices that switch between touch, keyboard, pointer, and external displays", example: "a creative app changed tool density when the keyboard detached without replacing the document view", tension: "tablet interfaces must remain direct for touch without becoming sparse when used at a desk", practice: "adapt controls to the active input while preserving the user's spatial memory", takeaway: "Hybrid devices need interfaces that change posture without changing identity." },
  "24": { topic: "内容优先与视觉个性", context: "一份长篇编辑网站希望建立鲜明品牌，同时维持阅读清晰度", example: "版面把个性放在标题比例和章节节奏中，而不是给每段内容增加装饰", tension: "过度简化会让产品失去声音，过度表达又会打断阅读顺序", practice: "把视觉变化放在结构节点，让正文区域保持稳定和可预测", takeaway: "内容优先不是要求界面没有个性，而是要求个性理解内容出现的次序" },
  "25": { topic: "原型应该验证的问题", context: "团队在概念阶段就投入大量时间制作完整交互", example: "一个低保真流程先证明用户不理解入口，从而避免继续打磨错误方向", tension: "细节原型能够获得真实反馈，却可能让团队过早依恋某种解决方案", practice: "先写清未知问题，再选择能以最低成本回答它的原型精度", takeaway: "原型的完成度没有统一标准，它只需要足够清楚地回答当前最重要的问题" },
  "26": { topic: "无聊与创造力之间的空白", context: "人们习惯在每个等待间隙立刻打开信息流", example: "散步中没有明确任务的十分钟，让一个停滞数日的问题重新组合", tension: "持续刺激减少了不适感，也减少了经验自由连接的时间", practice: "有意识地保留没有输入和产出目标的短暂空档", takeaway: "无聊不自动产生创意，但它为尚未成形的想法留下了可以出现的空间" },
  "27": { language: "en", topic: "progressive disclosure in complex products", context: "enterprise tools with hundreds of settings and multiple user roles", example: "an analytics screen revealed advanced controls only after a user selected a comparison mode", tension: "hiding complexity lowers the initial burden but can make expert capabilities harder to discover", practice: "reveal options at the moment they become relevant and preserve predictable paths back to them", takeaway: "Progressive disclosure works when it follows the task, not when it merely hides the interface." },
  "28": { topic: "独立出版与工具的筛选", context: "读者面对越来越多相似的产品推荐和收藏列表", example: "编辑只保留真正使用过的工具，并说明它不适合哪些人", tension: "推荐需要表达判断，商业合作又可能削弱判断的可信度", practice: "公开选择标准、使用时间和利益关系，让缺点与优点同时出现", takeaway: "值得收藏的推荐不是最全面的目录，而是一份能够被读者检验的个人判断" },
  "29": { language: "en", topic: "illustration as a product language", context: "digital products using images to explain abstract states and unfamiliar workflows", example: "a banking app used a small sequence of drawings to clarify why identity verification was delayed", tension: "illustration can build warmth, but generic decoration often competes with the information hierarchy", practice: "give every image a communication job and test whether the message survives without accompanying copy", takeaway: "Product illustration earns its place when it explains, guides, or changes how a state feels." },
  "30": { topic: "从编辑设计学习信息层级", context: "数字产品需要在有限空间里呈现标题、注释、数据和操作", example: "页面通过比例、列宽和重复节奏建立层级，而不是依赖更多分割线", tension: "信息越复杂，团队越容易用边框和色块继续切碎界面", practice: "先用排版和空间组织阅读顺序，再为真正需要区分的状态增加容器", takeaway: "清晰的层级往往来自关系，而不是来自更多视觉边界" },
};

/**
 * Generate a Chinese preview article with a consistent structure from the topic material.
 * 根据主题资料生成一篇结构稳定的中文预览正文。
 */
function buildChineseContent(title: string, summary: string, profile: ContentProfile): ArticleContent {
  return {
    language: "zh-CN",
    sections: [
      {
        heading: `重新理解${profile.topic}`,
        paragraphs: [
          `围绕《${title}》，真正值得关注的并不只是一个新的功能或趋势。${summary} 当它进入日常使用，问题会从“能不能做到”转向“它会怎样改变人的判断与节奏”。`,
          `这篇文章从${profile.context}切入。具体场景让抽象讨论变得可见：界面中的顺序、反馈和默认值，都会悄悄决定用户先注意什么，又会忽略什么。`,
          `核心矛盾是${profile.tension}。如果只追求单一指标，产品很容易在短期内显得有效，却把理解成本和不确定感留给长期使用的人。`,
        ],
      },
      {
        heading: "把判断放进真实场景",
        paragraphs: [
          `一个有代表性的例子是${profile.example}。它没有依赖更强烈的提醒，而是通过改变信息出现的时机，让用户更容易理解系统正在做什么。`,
          `从设计角度看，细节不能脱离前后关系单独评估。同一个按钮、动画或状态，在首次使用、重复使用和出错恢复时，承担的责任并不相同。`,
          `更可靠的做法是${profile.practice}。这样做不会让所有问题立刻消失，但能让产品在变化时仍保持可预测，也让团队知道应该在哪里继续迭代。`,
        ],
        quote: profile.takeaway,
      },
      {
        heading: "从局部细节走向长期体验",
        paragraphs: [
          `这种变化通常不会通过一次大版本完成。它更像一系列小决定：删掉一个不必要的入口，延后一次打断，或者在状态变化后保留用户刚才的位置。`,
          `对团队来说，真正困难的是持续观察这些决定如何相互作用。局部优化如果破坏了整体节奏，即使数据短期上升，也可能让产品逐渐失去原本的方向。`,
          `最终可以回到一个简单的判断：${profile.takeaway} 当这条原则能在不同页面和输入方式中成立时，设计才真正从样式变成了系统。`,
        ],
      },
    ],
    closing: `本文为 ${profile.topic} 的原型阅读样稿，用于验证长文排版、连续滚动与跨文章导航。`,
  };
}

/**
 * Generate an English preview article from the same section model to validate bilingual typography.
 * 根据同一章节模型生成英文预览正文，用于验证双语排版。
 */
function buildEnglishContent(title: string, summary: string, profile: ContentProfile): ArticleContent {
  return {
    language: "en",
    sections: [
      {
        heading: `Reframing ${profile.topic}`,
        paragraphs: [
          `${summary} The interesting part of “${title}” is not the novelty alone, but what happens after the idea becomes part of an ordinary workflow.`,
          `The story begins with ${profile.context}. In that setting, small choices about timing, hierarchy, and defaults shape what people understand before they make a decision.`,
          `The central tension is that ${profile.tension}. Optimizing one visible metric can make a product look successful while moving uncertainty somewhere users cannot easily see.`,
        ],
      },
      {
        heading: "What Changes in Practice",
        paragraphs: [
          `Consider this example: ${profile.example}. The result did not come from adding more interface, but from making the system's behavior easier to read.`,
          `A component also changes meaning across contexts. What feels efficient during a repeated task may feel abrupt during onboarding or recovery from an error.`,
          `A more durable approach is to ${profile.practice}. This gives teams room to adapt without making the experience feel arbitrary from one surface to the next.`,
        ],
        quote: profile.takeaway,
      },
      {
        heading: "A Longer View",
        paragraphs: [
          `Progress usually arrives through a sequence of modest decisions: removing an unnecessary prompt, delaying an interruption, or preserving a person's place after a state change.`,
          `The difficult work is observing how those decisions interact over time. A local improvement can still damage the larger rhythm if every team optimizes its own surface in isolation.`,
          `The broader lesson is straightforward: ${profile.takeaway} When that principle survives different screens and input methods, it becomes part of the product rather than a temporary style.`,
        ],
      },
    ],
    closing: `This prototype article explores ${profile.topic} and provides long-form content for testing typography, continuous scrolling, and article navigation.`,
  };
}

/**
 * Build an HTML preview article matching the shape of actual FreshRSS content. Generate prototype
 * data from structured sections to keep all 30 samples consistent, then convert it to HTML so
 * preview and API data share the same rendering path.
 *
 * 构造一篇与真实 FreshRSS 正文形态一致的 HTML 预览文章。
 *
 * 原型数据先按结构化章节生成，以便保持 30 篇样稿的内容质量；随后统一
 * 转成 HTML，让预览模式和正式 API 数据走同一条正文渲染路径。
 */
export function buildMockContent(id: string, title: string, summary: string): PreviewArticleContent {
  const profile = profiles[id] ?? profiles["1"];
  const content = profile.language === "en"
    ? buildEnglishContent(title, summary, profile)
    : buildChineseContent(title, summary, profile);

  return {
    language: content.language,
    html: renderContentHtml(content),
  };
}

/**
 * Convert the internal section structure to HTML containing only tags allowed in article content.
 * 将内部章节结构转换为只包含正文允许标签的 HTML。
 */
function renderContentHtml(content: ArticleContent): string {
  const sections = content.sections.map((section) => {
    const paragraphs = section.paragraphs
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join("");
    const quote = section.quote
      ? `<blockquote>${escapeHtml(section.quote)}</blockquote>`
      : "";

    return `<section><h2>${escapeHtml(section.heading)}</h2>${paragraphs}${quote}</section>`;
  }).join("");

  return `${sections}<hr><p>${escapeHtml(content.closing)}</p>`;
}

/**
 * Escape mock text so preview data cannot bypass the security assumptions used for live content.
 * 转义 mock 文本，保证预览数据不会绕过正式正文的安全假设。
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
