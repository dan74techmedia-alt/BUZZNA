// apps/web/src/hooks/useOffline.ts
import { useEffect, useState } from 'react';

/**
 * Reactive hook that reports whether the terminal is currently offline.
 * Listens to the browser's native connectivity transition events so the whole
 * PWA can degrade gracefully into local-first mode.
 */
export const useOffline = (): boolean => {
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOffline;
};

export default useOffline;
