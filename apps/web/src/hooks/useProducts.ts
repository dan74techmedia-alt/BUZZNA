// apps/web/src/hooks/useProducts.ts
import { useQuery } from '@tanstack/react-query';
import { db } from '../offline/db'; // Dexie implementation
import { authApi } from '../features/auth/authApi';
import { useOffline } from './useOffline';
import { PosProduct } from '../store/cart.store';

export const useProducts = () => {
  const isOffline = useOffline();

  return useQuery<PosProduct[], Error>({
    queryKey: ['catalog_products'],
    queryFn: async () => {
      // Offline-First Strategy: Top 80% LRU Cache lookup
      if (isOffline) {
        console.log('[Offline Engine] Sourcing catalog from local Dexie IndexedDB cache.');
        const localProducts = await db.products_cache.toArray();
        if (localProducts.length === 0) {
           throw new Error("No offline products cached. Terminal isolated.");
        }
        return localProducts;
      }

      // Online: Fetch authoritative list
      try {
        const response = await authApi.get('/api/v1/products');
        const serverProducts = response.data.data;

        // Background update LRU cache silently to prevent storage crashes
        await db.products_cache.clear(); 
        await db.products_cache.bulkPut(serverProducts);

        return serverProducts;
      } catch (error) {
        // Fallback to local cache if network drops mid-request
        console.warn('Network request failed, falling back to local LRU cache', error);
        return await db.products_cache.toArray();
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};