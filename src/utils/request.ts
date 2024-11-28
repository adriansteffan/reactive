const BACKEND_ROUTE = "/backend";

export async function post(endpoint: string, body: object | FormData) {
  if (body instanceof FormData) {
    return await fetch(`${BACKEND_ROUTE}${endpoint}`, {
      method: 'POST',
      body,
    });
  } else {
    return fetch(`${BACKEND_ROUTE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}

export async function get(endpoint: string) {
  const res = await fetch(`${BACKEND_ROUTE}${endpoint}`);
  return res;
}

export async function getJson(endpoint: string) {
  return await (await get(endpoint)).json();
}