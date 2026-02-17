/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    async headers() {
        return [
            {
                source: "/api/:path*",
                headers: [
                    {
                        key: "Content-Type",
                        value: "application/json",
                    },
                ],
            },
        ];
    },
};

export default nextConfig;
