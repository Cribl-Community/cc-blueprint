import { defineConfig, type IndexHtmlTransformContext, type IndexHtmlTransformResult, type ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'path'
import react from '@vitejs/plugin-react'
// @ts-ignore
import { servePackageTgz } from '@cribl/apps/package'
// @ts-ignore
import { backendPreviewPlugin, backendWatchPlugin } from '@cribl/apps/preview'

const packageEndpointPlugin = () => ({
  name: 'vite-plugin-package-endpoint',
  configureServer(server: ViteDevServer) {
    server.middlewares.use('/package.tgz', (req: IncomingMessage, res: ServerResponse) => {
      void servePackageTgz(req, res, server.config.root)
    })
  },
})

const WATCHED_CONFIG_FILES = ['package.json', 'config/proxies.yml', 'config/policies.yml', 'config/schedules.yml', 'config/backend.yml'];
const CONFIG_CHANGED_HMR_EVENT = 'cribl:config-changed';

const CONFIG_CHANGED_BRIDGE = `
import { createHotContext } from '/@vite/client';
const hot = createHotContext('cribl:config-watcher');
hot.on('${CONFIG_CHANGED_HMR_EVENT}', (data) => {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'CRIBL_APP_CONFIG_CHANGED', file: data && data.file }, '*');
  }
  window.location.reload();
});
`;

const injectScriptFromQueryPlugin = () => {
  let initScriptUrl: string | null = null;
  return {
    name: 'inject-script-from-query',
    configureServer(server: ViteDevServer) {
      const root = server.config.root;
      const watched = WATCHED_CONFIG_FILES.map((rel) => join(root, rel));
      server.watcher.add(watched);
      server.watcher.on('change', (file) => {
        const idx = watched.indexOf(file);
        if (idx === -1) return;
        server.ws.send(CONFIG_CHANGED_HMR_EVENT, { file: WATCHED_CONFIG_FILES[idx] });
      });
    },
    transformIndexHtml(html: string, ctx: IndexHtmlTransformContext): IndexHtmlTransformResult{
      const url = new URL(ctx.originalUrl ?? '/', 'https://localhost');
      initScriptUrl = initScriptUrl || url.searchParams.get('init');
      const root = process.cwd();
      let appName;
      try {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { name?: string };
        appName = pkg.name;
      } catch {
        /* ignore missing or invalid package.json */
      }
      appName = appName || 'unknown';
      const tags: Array<{ tag: string; attrs?: Record<string, string>; children?: string; injectTo: 'head-prepend' }> = [];
      tags.push({
        tag: 'script',
        children: `window.CRIBL_APP_ID = '__dev__${appName}';`,
        injectTo: 'head-prepend' as const,
      });
      if (ctx.server) {
        tags.push({
          tag: 'script',
          attrs: { type: 'module' },
          children: CONFIG_CHANGED_BRIDGE,
          injectTo: 'head-prepend' as const,
        });
      }
      if (initScriptUrl) {
        tags.push({
          tag: 'script',
          attrs: { src: initScriptUrl, type: 'text/javascript' },
          injectTo: 'head-prepend' as const,
        });
      }
      return { html, tags };
    },
  };
};

// Shown in the app footer. CI tags are only pushed after package.json is bumped to match, and the
// build runs before the packager stamps the tag's version, so this is the version being released.
const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react(), packageEndpointPlugin(), injectScriptFromQueryPlugin(), backendWatchPlugin(), backendPreviewPlugin()],
  base: './',
  server: {
    cors: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
})
