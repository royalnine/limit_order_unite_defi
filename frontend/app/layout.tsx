import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
    title: 'AAVE Liquidation guard',
    description: 'Protect your Aave positions from liquidation',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="en">
            <body className="">
                <Providers>
                    {children}
                </Providers>
            </body>
        </html>
    );
}
