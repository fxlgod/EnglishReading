export const exactGrammarPolicy = {
  id: 'exact-v1',
  instructions: '无提示词的空填一个单词。有提示词的空使用提示词的正确形式，可以加结构所需的助动词、不定式标记或比较级标记，不另加主语或并列连词。',
  matching: '只给本题已核准的写法计分。评分时忽略首尾空白，统一等价的 Unicode 写法，保留大小写和词间空白。',
  normalize: (answer: string) => answer.trim().normalize('NFC'),
} as const;
