import { useEffect, useState } from 'react';
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

function AppRouter() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  if (hash === '#/licenses') return <Attributions />;
  if (hash === '#/updates') return <Updates />;
  if (hash === '#/offline') return <Offline />;
  if (hash === '#/privacy') return <Privacy />;
  if (hash === '#/personal') return <Personal />;
  return hash.startsWith('#/') && hash !== '#/' ? <Library route={hash} /> : <Home />;
}
createRoot(document.getElementById('root')!).render(<AppRouter />);
