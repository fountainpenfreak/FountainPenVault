/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/app/:path*',
        headers: [
          { key: 'Theme-Color', value: '#7c3aed' }
        ]
      }
    ];
  }
};

export default nextConfig;
