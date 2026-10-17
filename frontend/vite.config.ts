import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Awake",
        short_name: "Awake",
        description: "Accendi i tuoi dispositivi da ovunque",
        theme_color: "#f8f9fb",
        background_color: "#f8f9fb",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The API, live events and the agent gateway never go through the cache.
        navigateFallbackDenylist: [/^\/api\//, /^\/agent/],
      },
    }),
  ],
  server: {
    port: 5173,
    // On the LAN, not just localhost: board agents and phones reach the dev server at the PC's address.
    host: true,
    proxy: {
      "/api": "http://localhost:8080",
      "/agent": { target: "ws://localhost:8080", ws: true },
    },
  },
});
