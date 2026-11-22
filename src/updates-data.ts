type Update = {
  version: string;
  date: string;
  title: string;
  body: string;
  articleCount: number;
};

// Add entries after verifying a public deployment, newest first.
export const updates: readonly Update[] = [{
  version: 'v0.1.0 Beta',
  date: '2026-11-22',
  title: 'EnglishReading 初始公测版上线！',
  body: 'EnglishReading 正式开启公开测试啦！目前网站已经收录42篇经过审核的英语分级阅读文章，覆盖A1至B2难度。你可以使用点词翻译、句子翻译、朗读、生词本和阅读进度等功能。接下来会持续增加文章、修复问题并优化阅读体验。感谢体验，祝阅读愉快！',
  articleCount: 42,
}];
