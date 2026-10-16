import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'THE GAME',
  description: 'An investigation game: case files, markets and a locked phone.',
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='4' fill='%230b0a0a'/%3E%3Cpath d='M3 12c3-4.6 6-6.5 9-6.5s6 1.9 9 6.5c-3 4.6-6 6.5-9 6.5s-6-1.9-9-6.5z' fill='none' stroke='%23e8dccb' stroke-width='1.3'/%3E%3Ccircle cx='12' cy='12' r='1.6' fill='%23b3282b'/%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = { themeColor: '#0b0a0a', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Special+Elite&family=Stardos+Stencil:wght@700&family=Permanent+Marker&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" />
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
