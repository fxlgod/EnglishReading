# EnglishReading

EnglishReading 是面向英语学习者的免费分级阅读网站，支持点词、句译、朗读、生词本和本机阅读进度。

- 在网站页脚打开「更新日志」和「来源与许可」。
- 公开仓库只收录正式文章的阅读版及作品署名。每篇作品的许可见网站署名页。
- 从具备本机正式库的工作目录运行 `npm run content:export`。此命令先核验入库与审核记录，再生成可提交的 `release-content/`。提交并推送该目录的变更至 `main` 后，GitHub Actions 自动构建并发布。
- 公网确认新版本已发布后，在 `src/updates-data.ts` 顶部增加一条记录。填写实际发布日期及发布时的文章数量，保留历史条目。
- 公开仓库可运行 `npm ci` 及 `npm run build:pages`。本机正式库的检查和构建使用 `npm run content:validate` 及 `npm run build`。
