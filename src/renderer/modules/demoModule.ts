/**
 * M3 built-in demo module — the ONE reference module that proves the whole
 * registration cycle. It is pure declarative data (SPECIFICATION §5: dynamic
 * untrusted JS is not part of 1.0); the core renders it through the generic
 * ModuleTabView contract with no per-module patching.
 */
import { MODULE_API_VERSION } from '../../shared/m3Protocol';

export const DEMO_MODULE_MANIFEST: Record<string, unknown> = {
  id: 'demo',
  version: '1.0.0',
  apiVersion: MODULE_API_VERSION,
  capabilities: ['runtime', 'notifications'],
  ui: [
    {
      kind: 'tab',
      id: 'welcome',
      title: 'Демо-модуль',
      blocks: [
        {
          type: 'text',
          value: 'Встроенный модуль M3: подтверждает цикл регистрации, включения и отключения без изменения ядра приложения.',
        },
        {
          type: 'kv',
          entries: [
            { key: 'Манифест', value: 'demo@1.0.0' },
            { key: 'API', value: String(MODULE_API_VERSION) },
            { key: 'Capabilities', value: 'runtime, notifications' },
          ],
        },
        {
          type: 'list',
          items: [
            'Регистрация в реестре модулей',
            'Вкладка через общий контракт',
            'Включение и отключение из раздела «Модули»',
            'Ошибки модуля не роняют приложение',
          ],
        },
      ],
    },
  ],
};
