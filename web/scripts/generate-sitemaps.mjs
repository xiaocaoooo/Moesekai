/**
 * Sitemap Generator Script
 * 
 * 生成两种 sitemap:
 * 1. sitemap-main.xml - 主页面和一级路由
 * 2. sitemap-details.xml - 详细页面 (cards, music, events, gacha)
 * 3. sitemap.xml - 索引文件，指向上述两个 sitemap
 * 
 * 使用方法: node scripts/generate-sitemaps.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://snowyviewer.exmeaning.com';
const MASTER_DATA_URL = 'https://sekaimaster.exmeaning.com/master';
const OUT_DIR = path.join(__dirname, '..', 'out');

/**
 * Fetch master data from remote server
 */
async function fetchMasterData(filename) {
    const url = `${MASTER_DATA_URL}/${filename}`;
    console.log(`Fetching ${filename}...`);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${filename}: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching ${filename}:`, error.message);
        return [];
    }
}

/**
 * Format date to ISO string for sitemap
 */
function formatDate(timestamp) {
    if (!timestamp) return new Date().toISOString();
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/**
 * Generate XML for a single URL entry
 */
function generateUrlEntry(url, lastmod, changefreq = 'weekly', priority = 0.5) {
    return `  <url>
    <loc>${url}</loc>
    <lastmod>${formatDate(lastmod)}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

/**
 * Wrap URL entries in sitemap XML
 */
function wrapInSitemap(urlEntries) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.join('\n')}
</urlset>`;
}

/**
 * Generate sitemap index XML
 */
function generateSitemapIndex(sitemaps) {
    const entries = sitemaps.map(name => `  <sitemap>
    <loc>${BASE_URL}/${name}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
  </sitemap>`);

    return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</sitemapindex>`;
}

/**
 * Generate main sitemap (homepage + first-level routes)
 */
function generateMainSitemap() {
    const routes = [
        { path: '', priority: 1.0, changefreq: 'daily' },
        { path: '/about', priority: 0.8, changefreq: 'monthly' },
        { path: '/cards', priority: 0.9, changefreq: 'daily' },
        { path: '/music', priority: 0.9, changefreq: 'daily' },
        { path: '/events', priority: 0.9, changefreq: 'daily' },
        { path: '/gacha', priority: 0.8, changefreq: 'daily' },
        { path: '/sticker', priority: 0.7, changefreq: 'weekly' },
        { path: '/comic', priority: 0.7, changefreq: 'weekly' },
        { path: '/live', priority: 0.7, changefreq: 'weekly' },
        { path: '/character', priority: 0.8, changefreq: 'weekly' },
        { path: '/mysekai', priority: 0.7, changefreq: 'weekly' },
        { path: '/prediction', priority: 0.6, changefreq: 'daily' },
    ];

    const entries = routes.map(route =>
        generateUrlEntry(
            `${BASE_URL}${route.path}`,
            new Date(),
            route.changefreq,
            route.priority
        )
    );

    return wrapInSitemap(entries);
}

/**
 * Generate details sitemap (all detail pages)
 */
async function generateDetailsSitemap() {
    const entries = [];

    // Fetch all master data in parallel
    const [cards, musics, events, gachas] = await Promise.all([
        fetchMasterData('cards.json'),
        fetchMasterData('musics.json'),
        fetchMasterData('events.json'),
        fetchMasterData('gachas.json'),
    ]);

    // Card routes
    if (Array.isArray(cards)) {
        console.log(`  - Adding ${cards.length} card pages`);
        for (const card of cards) {
            entries.push(generateUrlEntry(
                `${BASE_URL}/cards/${card.id}`,
                card.releaseAt,
                'weekly',
                0.6
            ));
        }
    }

    // Music routes
    if (Array.isArray(musics)) {
        console.log(`  - Adding ${musics.length} music pages`);
        for (const music of musics) {
            entries.push(generateUrlEntry(
                `${BASE_URL}/music/${music.id}`,
                music.publishedAt,
                'weekly',
                0.6
            ));
        }
    }

    // Event routes
    if (Array.isArray(events)) {
        console.log(`  - Adding ${events.length} event pages`);
        for (const event of events) {
            entries.push(generateUrlEntry(
                `${BASE_URL}/events/${event.id}`,
                event.startAt,
                'weekly',
                0.7
            ));
        }
    }

    // Gacha routes
    if (Array.isArray(gachas)) {
        console.log(`  - Adding ${gachas.length} gacha pages`);
        for (const gacha of gachas) {
            entries.push(generateUrlEntry(
                `${BASE_URL}/gacha/${gacha.id}`,
                gacha.startAt,
                'weekly',
                0.6
            ));
        }
    }

    return wrapInSitemap(entries);
}

/**
 * Main execution
 */
async function main() {
    console.log('=== Sitemap Generator ===\n');
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Output directory: ${OUT_DIR}\n`);

    // Ensure output directory exists
    if (!fs.existsSync(OUT_DIR)) {
        console.error('Error: Output directory does not exist. Run `npm run build` first.');
        process.exit(1);
    }

    // Generate main sitemap
    console.log('Generating main sitemap...');
    const mainSitemap = generateMainSitemap();
    const mainPath = path.join(OUT_DIR, 'sitemap-main.xml');
    fs.writeFileSync(mainPath, mainSitemap, 'utf-8');
    console.log(`  Created: sitemap-main.xml\n`);

    // Generate details sitemap
    console.log('Generating details sitemap...');
    const detailsSitemap = await generateDetailsSitemap();
    const detailsPath = path.join(OUT_DIR, 'sitemap-details.xml');
    fs.writeFileSync(detailsPath, detailsSitemap, 'utf-8');
    console.log(`  Created: sitemap-details.xml\n`);

    // Generate sitemap index
    console.log('Generating sitemap index...');
    const indexSitemap = generateSitemapIndex(['sitemap-main.xml', 'sitemap-details.xml']);
    const indexPath = path.join(OUT_DIR, 'sitemap.xml');
    fs.writeFileSync(indexPath, indexSitemap, 'utf-8');
    console.log(`  Created: sitemap.xml\n`);

    // Remove old sitemap directory if exists
    const oldSitemapDir = path.join(OUT_DIR, 'sitemap');
    if (fs.existsSync(oldSitemapDir)) {
        console.log('Removing old sitemap directory...');
        fs.rmSync(oldSitemapDir, { recursive: true });
    }

    console.log('=== Sitemap generation complete! ===');
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
