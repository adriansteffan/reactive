// The experiment's server: its routes on the page's own origin, or the simulation's server while simulating
let backendUrl = '/backend';

/** The address of the experiment's server, for components that talk to its routes. */
export function getBackendUrl() {
  return backendUrl;
}

export function setBackendUrl(url: string) {
  backendUrl = url;
}

/** Sends JSON to one of the server's routes. */
export function post(endpoint: string, body: object) {
  return fetch(`${backendUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
