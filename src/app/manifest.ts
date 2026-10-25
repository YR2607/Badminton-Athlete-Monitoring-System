import type { MetadataRoute } from "next";

/**
 * PWA manifest — lets athletes "install" the app to their home screen
 * (no App Store / Play Market needed): standalone window, own icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RallyMonitor",
    short_name: "RallyMonitor",
    description: "Мониторинг состояния и нагрузки бадминтонистов",
    lang: "ru",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#080d18",
    theme_color: "#080d18",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
