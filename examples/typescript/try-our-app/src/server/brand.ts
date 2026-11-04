import { readFileSync } from 'node:fs';
import { brandSchema, type Brand } from '@/shared/contracts';

export function parseBrand(source: string): Brand {
  return brandSchema.parse(JSON.parse(source));
}

export function loadBrand(path: string): Brand {
  return parseBrand(readFileSync(path, 'utf8'));
}
