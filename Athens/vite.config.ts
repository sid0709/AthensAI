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

function originFromServiceUrl(serviceUrl: string): string {
  try {
    const u = new URL(serviceUrl)
    return `${u.protocol}//${u.host}`
  } catch {
    return serviceUrl.replace(/\/+$/, '')
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
  const backendPort = env.VITE_BACKEND_PORT || '8979'
  const proxyTarget =
    env.VITE_DEV_PROXY_TARGET ||
    (env.SERVER_API_URL ? originFromApiUrl(env.SERVER_API_URL) : '') ||
    (env.VITE_API_URL ? originFromApiUrl(env.VITE_API_URL) : '') ||
    `http://127.0.0.1:${backendPort}`
  const avalonPort = env.VITE_AVALON_PORT || '3847'
  const avalonTarget =
    env.VITE_DEV_AVALON_PROXY_TARGET ||
    (env.VITE_AVALON_SERVER ? originFromServiceUrl(env.VITE_AVALON_SERVER) : '') ||
    `http://127.0.0.1:${avalonPort}`
  const aiBffTarget =
    env.VITE_DEV_AI_BFF_PROXY_TARGET ||
    (env.VITE_AI_BFF_URL ? originFromServiceUrl(env.VITE_AI_BFF_URL) : '') ||
    'http://127.0.0.1:3920'
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
        },
        '/avalon': {
          target: avalonTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
        '/ai-bff': {
          target: aiBffTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/ai-bff/, ''),
        },
      },
      fs: {
        allow: [path.resolve(__dirname, '..')],
      },
    },
  }
})
