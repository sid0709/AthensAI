import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function originFromApiUrl(apiUrl: string): string {
  try {
    const u = new URL(apiUrl)
    return `${u.protocol}//${u.host}`
  } catch {
    return apiUrl.replace(/\/api\/?$/, '')
  }
}

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.VITE_BACKEND_PORT || '8980'
  const proxyTarget =
    env.VITE_DEV_PROXY_TARGET ||
    (env.SERVER_API_URL ? originFromApiUrl(env.SERVER_API_URL) : '') ||
    (env.VITE_API_URL ? originFromApiUrl(env.VITE_API_URL) : '') ||
    `http://127.0.0.1:${backendPort}`
  const devHost = env.DEV_HOST === '127.0.0.1' ? '127.0.0.1' : (env.DEV_HOST || true)

  return {
    envPrefix: ['VITE_', 'SERVER_'],
    plugins: [
      figmaAssetResolver(),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    assetsInclude: ['**/*.svg', '**/*.csv'],
    server: {
      host: devHost,
      allowedHosts: true,
      port: Number(env.VITE_DEV_PORT || 9030) || 9030,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          // Large streamed downloads can take several minutes.
          timeout: 0,
          proxyTimeout: 0,
        },
      },
      fs: {
        allow: [path.resolve(__dirname, '..')],
      },
    },
  }
})
