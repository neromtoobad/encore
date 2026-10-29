// Render tweet-card.html to tweet-card.png (1600x900 at 2x) with the system Chrome.
//   node render.mjs
import puppeteer from '/Users/mac/Documents/Hacks/tote/video/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--force-color-profile=srgb', '--allow-file-access-from-files'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
await page.goto('file://' + path.join(here, 'tweet-card.html'), { waitUntil: 'networkidle0' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: path.join(here, 'tweet-card.png') })
await browser.close()
process.exit(0)
