import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './client/theme.css';
import './styles.css';
import { App } from './app';
import { applyBrand, brand } from './client/brand';

applyBrand();
document.title = `Try ${brand.product} live`;

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<StrictMode><App /></StrictMode>);
