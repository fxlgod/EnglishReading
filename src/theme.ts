import { all, put } from './storage';

export async function getTheme() {
  return (await all('settings')).some(setting => setting.id === 'theme' && setting.value === 'dark');
}

export function setSiteTheme(dark: boolean) {
  return put('settings', { id: 'theme', value: dark ? 'dark' : 'light', updatedAt: new Date().toISOString() });
}
