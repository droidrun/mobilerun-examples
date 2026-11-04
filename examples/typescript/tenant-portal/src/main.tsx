import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@mobilerun/react/styles.css';
import './client/theme.css';
import './styles.css';
import { App } from './app';
import { applyBrand, brand } from './client/brand';

applyBrand();
document.title = brand.product;

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<StrictMode><App /></StrictMode>);
