import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OmniRouter — Multi-Provider AI Chat',
  description:
    'Chat with any AI model. Automatic failover when one provider is down.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

