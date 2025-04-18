import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProductInfo } from "./types.js";

// Load products list
let productsCache: ProductInfo[] | null = null;

/**
 * Load products from products.json
 * @return {Promise<Array>} Array of product objects
 */
export async function loadProducts(): Promise<ProductInfo[]> {
  if (productsCache) {
    return productsCache;
  }

  try {
    const productsPath = join(__dirname, "../../assets", "products.json");
    const data = await readFile(productsPath, "utf8");
    productsCache = JSON.parse(data) as ProductInfo[];
    console.info(`Loaded ${productsCache.length} products from products.json`);
    return productsCache;
  } catch (error) {
    console.warn("Failed to load products.json:", (error as Error).message);
    return [];
  }
}

/**
 * Find product info for a repository
 * @param {string} fullRepo - Full repository name (org/repo)
 * @return {Object|null} Product info or null if not found
 */
export async function findProductInfo(fullRepo: string): Promise<ProductInfo | null> {
  const products = await loadProducts();
  const product = products.find((p: ProductInfo) => p.repo === fullRepo);

  if (product) {
    console.info(`Found product info for ${fullRepo}: ${product.repo}`);

    if (product.store) {
      if (product.private) {
        const productPath = join(__dirname, "../../assets", `${product.repo.split("/")[1]}.md`);
        product.intro = await readFile(productPath, "utf8");
      } else {
        const url = new URL(product.store);
        const jsonUrl = `${url.origin}/api/${url.pathname}/blocklet.json?source=webapp`;
        const infoUrl = `${url.origin}/api/${url.pathname}/info?url=${encodeURIComponent(jsonUrl)}`;
        const [jsonResponse, infoResponse] = await Promise.all([fetch(jsonUrl), fetch(infoUrl)]);
        const jsonData = await jsonResponse.json();
        const infoData = await infoResponse.json();
        product.description = jsonData.description;
        product.intro = infoData.readme.en;
        product.community = jsonData.community || "https://community.arcblock.io";
      }
    }
  }

  return product || null;
}
