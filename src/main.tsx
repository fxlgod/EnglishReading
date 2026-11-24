import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from './Home';
import { Library } from './Library';
import { Personal } from './Personal';
import { Privacy } from './Privacy';
import { Offline } from './Offline';
import { Attributions } from './Attributions';
import { Updates } from './Updates';
import { startOfflineApp } from './offline-client';

startOfflineApp();

const GrammarPage = lazy(() => import('./GrammarPreview'));
const NovelPage = lazy(() => import('./Novel'));

function AppRouter() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const grammar = /^#\/grammar(?:\/([a-z0-9-]+))?$/.exec(hash);
  if (grammar) return <Suspense fallback={<p role="status">正在打开练习…</p>}><GrammarPage key={hash} id={grammar[1]} /></Suspense>;
  const novel = /^#\/novel\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(hash);
  if (hash === '#/novels' || novel) return <Suspense fallback={<p role="status">正在打开小说…</p>}>
    <NovelPage key={hash} workId={novel?.[1]} chapterId={novel?.[2]} />
  </Suspense>;
  if (hash === '#/licenses') return <Attributions />;
  if (hash === '#/updates') return <Updates />;
  if (hash === '#/offline') return <Offline />;
  if (hash === '#/privacy') return <Privacy />;
  if (hash === '#/personal') return <Personal />;
  return hash.startsWith('#/') && hash !== '#/' ? <Library route={hash} /> : <Home />;
}
createRoot(document.getElementById('root')!).render(<AppRouter />);
