import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// D2: одобренный design-system слой (--dl-*, AppFrame/Sidebar/ChatView/…)
// подключается ПОСЛЕ index.css: классы уникальны (dl-префикс), а
// элемент-сбросы layout.css специфичностью (0,0,1) не перекрывают
// legacy-классы. Порядок импортов важен: App тянет index.css первым.
import './design/typography.css';
import './design/layout.css';
import './design/components.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('renderer: #root element missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
