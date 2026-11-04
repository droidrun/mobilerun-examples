import React from 'react';
import { createRoot } from 'react-dom/client';
import '@mobilerun/react/styles.css';
import './styles.css';
import { App } from './app';
import { applyBrand } from './brand';

applyBrand();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
