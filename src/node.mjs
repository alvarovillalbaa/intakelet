import { crawlWebsite } from './research.mjs';
import { secureRead, networkURL } from './transport.mjs';
import { exact } from './values.mjs';
export async function researchWebsite(url, options = {}) {
  exact(options, [], ['maxPages', 'timeoutMs', 'signal']); networkURL(url);
  return crawlWebsite(url, secureRead, options);
}
