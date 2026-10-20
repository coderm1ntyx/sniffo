import { useEffect, useState } from 'react';
import { getHealth } from '../../lib/api';
export function ApiStatus() {
  const [state, setState] = useState<'checking' | 'online' | 'offline'>(
    'checking',
  );
  useEffect(() => {
    let active = true;
    getHealth()
      .then(() => {
        if (active) setState('online');
      })
      .catch(() => {
        if (active) setState('offline');
      });
    return () => {
      active = false;
    };
  }, []);
  const labels = {
    checking: 'Checking API…',
    online: 'API connected',
    offline: 'API unavailable',
  };
  return (
    <span className={`api-status api-status--${state}`} role="status">
      <span className="status-dot" />
      {labels[state]}
    </span>
  );
}
