import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  publicDir: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  build: {
    target: 'es2022',
    outDir: 'public/build',
    emptyOutDir: true,
    lib: {
      entry: {
        'cuts-overlays-view': fileURLToPath(new URL('./public/components/cuts-overlays-view.ts', import.meta.url)),
        'connections-view': fileURLToPath(new URL('./public/components/connections-view.ts', import.meta.url)),
        'requests-view': fileURLToPath(new URL('./public/components/requests-view.ts', import.meta.url)),
        'editorial-view': fileURLToPath(new URL('./public/components/editorial-view.ts', import.meta.url)),
        'youtube-channels-view': fileURLToPath(new URL('./public/components/youtube-channels-view.ts', import.meta.url)),
        'workspace-view': fileURLToPath(new URL('./public/components/workspace-view.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, name) => name + '.js',
    },
  },
});
