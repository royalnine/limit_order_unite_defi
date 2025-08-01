import path from 'path';
/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    webpack: (config) => {
        config.resolve.fallback = {
            ...config.resolve.fallback,
            fs: false,
            os: false,
            path: false,
            crypto: false,
        };
        
        // Ignore optional dependencies that cause build issues
        config.resolve.alias = {
            ...config.resolve.alias,
            'pino-pretty': false,
        };
        
        return config;
    },
};
export default nextConfig;
