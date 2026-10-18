import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
      },
    },
  },

  build: {
    /**
     * The app previously shipped as a single ~2.9MB chunk, so the public SOS
     * page downloaded Mapbox GL and Recharts before a citizen could tap the
     * emergency button. That page is mobile-first and often reached on a poor
     * connection, so the heavy libraries are split out and only fetched by the
     * routes that actually render a map or a chart.
     */
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mapbox': ['mapbox-gl'],
          'vendor-charts': ['recharts'],
          'vendor-motion': ['framer-motion'],
        },
      },
    },
    // The map and chart vendor chunks are legitimately large; the warning
    // threshold is raised so it still flags genuinely unexpected growth.
    chunkSizeWarningLimit: 900,
  },
})
