import type { MetadataRoute } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://openai-json-schema-validator.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: "2026-07-30",
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
