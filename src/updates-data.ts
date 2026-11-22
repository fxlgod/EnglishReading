type Update = {
  version: string;
  date: string;
  title: string;
  body: string;
  articleCount: number;
};

// Add entries after verifying a public deployment, newest first.
export const updates: readonly Update[] = [];
