import { useSyncExternalStore } from 'react';
import type { Entry } from './core/content/types';

type InstallPrompt = Event & { prompt(): Promise<unknown> };
let prompt: InstallPrompt | undefined;
let notice = '';
let cacheRevision = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => navigator.onLine;
export function useOnline() {
  return useSyncExternalStore(subscribe, snapshot);
}
export function useOfflineApp() {
  const install = useSyncExternalStore(subscribe, () => prompt);
  const message = useSyncExternalStore(subscribe, () => notice);
  const controller = useSyncExternalStore(subscribe, () => navigator.serviceWorker?.controller);
  const revision = useSyncExternalStore(subscribe, () => cacheRevision);
  return {install, message, controller, revision};
}
export async function installApp() {
  const request = prompt;
  prompt = undefined;
  notify();
  await request?.prompt();
}
export async function syncOfflineApp() {
  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration && navigator.onLine) await registration.update();
}

window.addEventListener('online', notify);
window.addEventListener('offline', notify);

export function startOfflineApp() {
  if (!import.meta.env.PROD || !window.isSecureContext || !navigator.serviceWorker) return;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    prompt = event as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => { prompt = undefined; notify(); });
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data === 'reading-cache-change') {
      cacheRevision++;
      notify();
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
  const directory = new URL(import.meta.env.BASE_URL, document.baseURI);
  const setNotice = (value: string) => { notice = value; notify(); };
  void navigator.serviceWorker.register(new URL('sw.js', directory), {updateViaCache: 'none'}).then(registration => {
    const observe = () => {
      const worker = registration.installing;
      if (!worker) return;
      setNotice('正在准备离线资源…');
      worker.addEventListener('statechange', () => {
        if (worker.state === 'redundant') setNotice('离线更新未完成。请联网后重试。');
      });
    };
    registration.addEventListener('updatefound', observe);
    observe();
    const update = () => {
      if (navigator.onLine && document.visibilityState === 'visible') {
        void syncOfflineApp().catch(() => setNotice('暂时无法检查离线更新。'));
      }
    };
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
  }).catch(() => setNotice('此浏览器暂时无法准备离线资源。'));
}

export async function offlineCache(action: 'list' | 'clear' | 'remove', path?: string) {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) throw new Error('Offline application is unavailable');
  const channel = new MessageChannel();
  try {
    return await new Promise<{saved: Entry[]; limit: number; maxMiB: number}>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Offline cache timed out')), 5000);
      channel.port1.onmessage = ({data}) => {
        clearTimeout(timer);
        if (data.error) reject(new Error('Offline cache is unavailable'));
        else resolve(data);
      };
      worker.postMessage({action, path: path && 'content/' + path}, [channel.port2]);
    });
  } finally {
    channel.port1.close();
  }
}
