import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { uploadRoutes } from '../src/server';

const send = (routes: ReturnType<typeof uploadRoutes>, body: object) =>
  routes['/backend/data'].POST(
    new Request('http://localhost/backend/data', { method: 'POST', body: JSON.stringify(body) }),
  );

const file = (filename: string) => ({ filename, content: 'AA==', encoding: 'base64' });

test("a session's files and the recordings uploaded during it end up in one folder", async () => {
  const data = mkdtempSync(join(tmpdir(), 'reactive-data-'));
  const routes = uploadRoutes(data);
  // Recordings wait in a folder named after the upload id, which is the session's own by default
  await send(routes, { sessionId: 'a', files: [file('recording.webm')] });
  await send(routes, { sessionId: 'a', files: [file('a.csv')] });
  // With a parent folder, or a session id of its own, the session takes the recordings along
  await send(routes, { sessionId: 'b', files: [file('recording.webm')] });
  await send(routes, { sessionId: 'b', parentFolder: 'pilot', files: [file('b.csv')] });
  await send(routes, { sessionId: 'c', files: [file('recording.webm')] });
  await send(routes, { sessionId: 'custom', uploadId: 'c', files: [file('c.csv')] });

  expect(readdirSync(join(data, 'a')).sort()).toEqual(['a.csv', 'recording.webm']);
  expect(readdirSync(join(data, 'pilot', 'b')).sort()).toEqual(['b.csv', 'recording.webm']);
  expect(readdirSync(join(data, 'custom')).sort()).toEqual(['c.csv', 'recording.webm']);
  expect(existsSync(join(data, 'b')) || existsSync(join(data, 'c'))).toBe(false);
});

test('names that would leave the data folder are rejected', async () => {
  const routes = uploadRoutes(mkdtempSync(join(tmpdir(), 'reactive-data-')));
  const response = await send(routes, { sessionId: 'x', parentFolder: '../outside', files: [file('a.csv')] });
  expect(response.status).toBe(400);
});
