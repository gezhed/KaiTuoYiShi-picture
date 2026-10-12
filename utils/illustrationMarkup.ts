/**
 * 内联插图文法（`<image>…</image>`）的识别与剥离。
 *
 * 为什么单独放一个模块：这套语法**同时被两个互不相关的层需要**。
 *   - 渲染层（`services/ai/imageGen`）：要从正文里认出插图块、取出提示词与挂载点；
 *   - 消息层（`hooks/useGame/tavernMessageChainBuilder`）：必须在发给模型前把它剥掉。
 *
 * 如果把它留在 `services/ai/imageGen` 里，消息层就得反向依赖文生图插件；
 * 而这套语法本身与「用哪个后端出图」无关，只是记号，所以放 `utils` 更合适。
 *
 * 语义来源：st-chatu8 `imageInserter`，`<image>` 块内的 `regex:` 行是可选锚点，
 * 没有它时用**块前最后一个非空行**当挂载点（L17376-L17388）。
 */

/** 内联插图块。 */
export const 内联插图模式 = /<image>([\s\S]*?)<\/image>/gi;

export interface 内联插图 {
  /** 块在原文中的起始下标。 */
  起始: number;
  /** 块结束下标（不含）。 */
  结束: number;
  /** 块**前面**最后一个非空行；来源用它当挂载点。 */
  上文行: string;
  /** 块内去掉 `regex:` 行之后剩下的提示词。 */
  提示词: string;
  /** 块内显式声明的 `regex:` 锚点；没有则为空串。 */
  显式锚点: string;
}

/** 取上文最后一个非空行；来源同样按「从后往前找第一个非空行」处理。 */
export function 取上文最后非空行(上文: string): string {
  const 行列表 = 上文.split('\n');
  for (let i = 行列表.length - 1; i >= 0; i -= 1) {
    const 裁 = 行列表[i].trim();
    if (裁) return 裁;
  }
  return '';
}

/**
 * 提取正文行间的 `<image>` 块。
 *
 * 与「块内必须写 `regex:`」的旧假设的差别：社区预设是让正文模型把
 * `<image>提示词</image>` **直接写进正文**，块前那一行就是插入位置。
 * 只认块内 `regex:` 会让这种写法一张图都插不进去。
 */
export function 提取内联插图(正文: string): 内联插图[] {
  const 命中: 内联插图[] = [];
  // 带 g 的正则对象是共享状态，必须复位，否则第二次调用会从上次位置继续。
  内联插图模式.lastIndex = 0;
  for (;;) {
    const 匹配 = 内联插图模式.exec(正文);
    if (!匹配) break;
    const 块内 = 匹配[1];
    const 显示 = 块内.match(/regex:\s*(.+?)(?:\n|$)/i);
    命中.push({
      起始: 匹配.index,
      结束: 匹配.index + 匹配[0].length,
      上文行: 取上文最后非空行(正文.slice(0, 匹配.index)),
      提示词: 块内.replace(/regex:.*?(?:\n|$)/g, '').trim(),
      显式锚点: 显示 ? 显示[1].trim() : '',
    });
  }
  return 命中;
}

function 转义正则(文本: string): string {
  return 文本.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 去掉正文里的插图文法，得到「给模型看」的干净正文。
 *
 * 这一步是**必需**的：插图文法只是给渲染层用的中间产物，一旦留在消息里，
 * 后续的变量更新、记忆总结、正文续写都会读到它们，既浪费 token 又可能被模型模仿。
 * 同时清掉 heredoc 标记与 `<images>` 容器（老方言），避免漏网。
 */
export function 剥掉内联插图(正文: string, 开始标记 = 'image###', 结束标记 = '###'): string {
  if (!正文 || typeof 正文 !== 'string') return 正文 ?? '';
  return 正文
    .replace(/<image>[\s\S]*?<\/image>/gi, '')
    .replace(new RegExp(`${转义正则(开始标记)}[\\s\\S]*?${转义正则(结束标记)}`, 'g'), '')
    .replace(/<images>[\s\S]*?<\/images>/gi, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
