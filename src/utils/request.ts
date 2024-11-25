const BACKEND_URL = "";

export async function post(endpoint: string, body: object | FormData) {
  if (body instanceof FormData) {
    return await fetch(`${BACKEND_URL}${endpoint}`, {
      method: 'POST',
      body,
    });
  } else {
    return fetch(`${BACKEND_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}

export async function get(endpoint: string) {
  const res = await fetch(`${BACKEND_URL}${endpoint}`);
  return res;
}

export async function getJson(endpoint: string) {
  return await (await get(endpoint)).json();
}