import brandFile from '../../brand.json';
import { brandSchema } from './contracts';

/** The one brand of this deployment. Edit `brand.json` to rebrand. */
export const brand = brandSchema.parse(brandFile);
