import React from 'react';
import { createRoot } from 'react-dom/client';
import '@mobilerun/react/styles.css';
import './styles.css';
import { App } from './app';
import { applyBrand } from './client/brand';
import { brand } from './shared/brand';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

applyBrand(brand, document.documentElement);

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
