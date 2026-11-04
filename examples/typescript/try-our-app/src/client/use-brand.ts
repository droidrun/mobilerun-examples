import { useEffect, useState } from 'react';
import type { Brand } from '@/shared/contracts';
import { demoApi } from './api-client';
import { applyBrand } from './brand';

export function useBrand(): Brand | null {
  const [brand, setBrand] = useState<Brand | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    demoApi
      .brand(controller.signal)
      .then((loaded) => {
        applyBrand(loaded, document.documentElement);
        setBrand(loaded);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return brand;
}
