export interface LLMConfig {
  provider: 'openai' | 'huggingface';
  model: string;
  apiKey: string;
  /** Override the API base URL. Defaults to the provider's standard endpoint. */
  baseUrl?: string;
}

/** JSON Schema object for constraining LLM output. Passed as the third argument to invokeLLM. */
export type LLMSchema = Record<string, any>;

function resolveBaseUrl(config: LLMConfig): string {
  return config.baseUrl
    ?? (config.provider === 'huggingface'
      ? `https://api-inference.huggingface.co/models/${config.model}/v1`
      : 'https://api.openai.com/v1');
}

async function callLLM(config: LLMConfig, prompt: string, schema?: LLMSchema): Promise<string> {
  const baseUrl = resolveBaseUrl(config);

  const body: Record<string, any> = {
    model: config.model,
    messages: [{ role: 'user', content: prompt }],
  };
  if (schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'response', schema, strict: true },
    };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// --- Disk-backed LLM response cache ---
// Stored at .reactive-cache/llm.json in the working directory.
// Keyed by provider:model:prompt:responseFormat — API key intentionally excluded
// so cache works across key rotations.

const CACHE_DIR = '.reactive-cache';
const CACHE_FILE = 'llm.json';
let diskCache: Record<string, string> | null = null;
import { getNodeRequire } from './nodecompat';

async function loadCache(): Promise<Record<string, string>> {
  if (diskCache) return diskCache;
  try {
    const req = await getNodeRequire();
    const fs = req('fs') as typeof import('fs');
    const path = req('path') as typeof import('path');
    const filePath = path.join(process.cwd(), CACHE_DIR, CACHE_FILE);
    if (fs.existsSync(filePath)) {
      diskCache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return diskCache!;
    }
  } catch {}
  diskCache = {};
  return diskCache;
}

async function saveCache(): Promise<void> {
  if (!diskCache) return;
  try {
    const req = await getNodeRequire();
    const fs = req('fs') as typeof import('fs');
    const path = req('path') as typeof import('path');
    const dirPath = path.join(process.cwd(), CACHE_DIR);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, CACHE_FILE), JSON.stringify(diskCache, null, 2));
  } catch {}
}

export async function invokeLLM(config: LLMConfig, prompt: string, schema?: LLMSchema): Promise<string> {
  const formatKey = schema ? JSON.stringify(schema) : '';
  const cacheKey = `${config.provider}:${config.model}:${prompt}:${formatKey}`;
  const cache = await loadCache();

  let text = cache[cacheKey];
  if (!text) {
    text = await callLLM(config, prompt, schema);
    cache[cacheKey] = text;
    await saveCache();
  }

  return text;
}
