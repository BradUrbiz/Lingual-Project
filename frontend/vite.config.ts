import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

const cubismSdkPath = path.resolve(__dirname, '../CubismSdkForWeb-5-r.4/Framework/dist')
const hasCubismSdk = fs.existsSync(cubismSdkPath)

function manualChunks(id: string): string | undefined {
  if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react-router')) {
    return 'react-vendor'
  }

  if (id.includes('/node_modules/firebase/')) {
    return 'firebase-vendor'
  }

  if (id.includes('/node_modules/framer-motion/') || id.includes('/node_modules/motion/')) {
    return 'motion-vendor'
  }

  if (id.includes('/node_modules/lucide-react/')) {
    return 'icons-vendor'
  }

  if (
    id.includes('/node_modules/@radix-ui/') ||
    id.includes('/node_modules/class-variance-authority/') ||
    id.includes('/node_modules/clsx/') ||
    id.includes('/node_modules/tailwind-merge/') ||
    id.includes('/node_modules/sonner/')
  ) {
    return 'ui-vendor'
  }

  if (id.includes('/node_modules/axios/')) {
    return 'network-vendor'
  }

  if (id.includes('/node_modules/recharts/')) {
    return 'charts-vendor'
  }

  if (id.includes('/node_modules/microsoft-cognitiveservices-speech-sdk/')) {
    return 'speech-vendor'
  }

  if (id.includes('/node_modules/three/examples/')) {
    return 'three-examples-vendor'
  }

  if (id.includes('/node_modules/three/')) {
    return 'three-vendor'
  }

  if (id.includes('/node_modules/@pixiv/three-vrm/')) {
    return 'three-vrm-vendor'
  }

  if (
    id.includes('/CubismSdkForWeb-5-r.4/') ||
    id.includes('/node_modules/pixi-live2d-display/') ||
    id.includes('/node_modules/pixi.js/')
  ) {
    return 'avatar-runtime-vendor'
  }

  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  define: {
    __CUBISM_SDK_AVAILABLE__: JSON.stringify(hasCubismSdk),
  },
  build: {
    // The remaining chunk above Vite's default 500 kB warning is the isolated
    // Three.js vendor bundle used by the avatar renderer. We keep it split
    // from the app shell and raise the warning limit slightly above its size.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      ...(hasCubismSdk
        ? { '@cubism': cubismSdkPath }
        : {
            // Provide a full stub namespace so Vite can resolve Cubism imports
            // during dependency scanning when the SDK folder is not checked out.
            '@cubism': path.resolve(__dirname, './src/stubs/cubism'),
            // Stub out Live2DAvatarPanel so the build succeeds without the Cubism SDK.
            // The panel is behind LIVE2D_CHAT_ENABLED (false) so the stub never renders.
            '@/components/avatar/Live2DAvatarPanel': path.resolve(__dirname, './src/stubs/live2d-panel-stub.ts'),
          }),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: true,
    fakeTimers: {
      shouldAdvanceTime: true,
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        ws: true,
      },
    },
    headers: {
      // Allow Google OAuth popup to work properly
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
  },
})
