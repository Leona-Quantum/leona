import {createNewsHandler} from './server.mjs';

let handler;
export default function serve(req, res) {
  // A hosted deployment can never enable the local editor or sample mode.
  handler ??= createNewsHandler({
    mode: 'published', token: undefined, host: '0.0.0.0',
    noindex: process.env.VERCEL_ENV !== 'production',
  });
  return handler(req, res);
}
