import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_LAYERS = new Set(["common", "domain", "private"]);

function validateLayer(layer) {
  const normalized = String(layer || "").trim().toLowerCase();
  if (!SUPPORTED_LAYERS.has(normalized)) {
    throw new Error(`Unsupported wiki layer: ${layer}`);
  }
  return normalized;
}

export class WikiWorkspaceWriterService {
  constructor(options = {}) {
    this.docsRoot = options.docsRoot;
  }

  async writeDocument({ layer, slug, markdown }) {
    const normalizedLayer = validateLayer(layer);
    const safeSlug = String(slug || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!safeSlug || safeSlug.startsWith("../") || safeSlug.includes("/../")) {
      throw new Error("slug 非法，禁止路径穿越");
    }

    const flattenedName = safeSlug.replace(/\//g, "_");
    const jsonFileName = flattenedName.toLowerCase().endsWith(".json")
      ? flattenedName
      : `${path.posix.parse(flattenedName).name}.json`;
    const filePath = path.resolve(this.docsRoot, normalizedLayer, jsonFileName);
    const layerRoot = path.resolve(this.docsRoot, normalizedLayer);
    if (!filePath.startsWith(layerRoot)) {
      throw new Error("slug 非法，目标路径越界");
    }

    await mkdir(path.dirname(filePath), { recursive: true });
    const payload = {
      content: String(markdown || ""),
    };
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return {
      status: "success",
      path: filePath,
      ref: `${normalizedLayer}:${safeSlug}`,
    };
  }
}
