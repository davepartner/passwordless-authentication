/** Shared page shell + styles for the server-rendered screens. */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
  :root {
    color-scheme: light dark;
    --accent: #1f6feb; --danger: #b3261e; --ok: #1a7f37;
    --line: #e3e5e8; --muted: #5b616e; --bg: #f6f7f9; --card: #fff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 1.5rem 1rem 5rem; min-height: 100vh;
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #1a1a1a; background: var(--bg);
  }
  @media (prefers-color-scheme: dark) {
    :root { --line: #2c2c36; --muted: #a0a6b3; --bg: #0f0f14; --card: #17171d; }
    body { color: #e8e8e8; }
    input, select { background: #101014 !important; color: inherit; }
    .btn-secondary { color: inherit; }
    .badge { background: #23232c; }
  }
  .page { width: 100%; max-width: 46rem; margin: 0 auto; }
  .page.wide { max-width: 68rem; }
  header.top {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    margin: 0 auto 1.5rem; padding-bottom: .8rem; border-bottom: 1px solid var(--line);
  }
  header.top .brand { font-weight: 700; }
  header.top nav { display: flex; gap: .9rem; align-items: center; font-size: .9rem; }
  h1 { font-size: 1.45rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.05rem; margin: 0 0 .2rem; }
  h3 { font-size: .95rem; margin: 1.25rem 0 .4rem; }
  p { margin: 0 0 .75rem; }
  .muted { color: var(--muted); font-size: .88rem; }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 1.25rem; margin: 0 0 1rem;
  }
  .card > header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: .75rem; }
  .grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); }
  .field { display: block; font-weight: 600; font-size: .86rem; margin: .6rem 0 .35rem; }
  input, select {
    width: 100%; padding: .7rem .8rem; font: inherit; border: 1px solid #cfd3d8;
    border-radius: 10px; background: #fff; min-height: 44px;
  }
  input[type=checkbox] { width: 1.15rem; height: 1.15rem; min-height: 0; accent-color: var(--accent); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: .4rem;
    padding: .65rem 1rem; min-height: 44px; font: inherit; font-weight: 600; cursor: pointer;
    color: #fff; background: var(--accent); border: 0; border-radius: 10px;
  }
  .btn[disabled] { opacity: .5; cursor: not-allowed; }
  .btn-secondary { background: transparent; color: inherit; border: 1px solid var(--line); }
  .btn-danger { background: transparent; color: var(--danger); border: 1px solid currentColor; }
  .btn-small { padding: .35rem .7rem; min-height: 36px; font-size: .85rem; }
  .row { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
  .badge { display: inline-block; padding: .15rem .55rem; border-radius: 999px; background: #eceef1; font-size: .78rem; font-weight: 600; }
  .badge.ok { color: var(--ok); }
  .badge.warn { color: #9a6700; }
  .error { color: var(--danger); font-size: .88rem; margin: .5rem 0 0; min-height: 1.2em; }
  .ok { color: var(--ok); }
  table { width: 100%; border-collapse: collapse; font-size: .88rem; }
  th, td { text-align: left; padding: .55rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; color: var(--muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .03em; }
  .stack > * + * { margin-top: .6rem; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; word-break: break-all; }
  .notice { border: 1px solid var(--line); border-radius: 10px; padding: .7rem .8rem; font-size: .88rem; }
  .danger-zone { border-color: var(--danger); }
  details > summary { cursor: pointer; font-weight: 600; font-size: .88rem; }
  .hidden { display: none !important; }
`;

export interface LayoutOptions {
  title: string;
  body: string;
  /** Links shown in the header. */
  nav?: Array<{ href: string; label: string }>;
  wide?: boolean;
  script?: string;
}

export function layout(options: LayoutOptions): string {
  const { title, body, nav = [], wide = false, script = '' } = options;
  const links = nav
    .map((n) => `<a href="${escapeHtml(n.href)}">${escapeHtml(n.label)}</a>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${CSS}</style>
</head>
<body>
<header class="top page${wide ? ' wide' : ''}">
  <span class="brand">Passwordless Auth</span>
  <nav>${links}</nav>
</header>
<main class="page${wide ? ' wide' : ''}">
${body}
</main>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

/** Shared client helper: JSON POST with the session token attached. */
export const CLIENT_HELPERS = `
const sessionToken = () => sessionStorage.getItem('sessionToken') || '';
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sessionToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
function fmtTime(ms) {
  try { return new Date(ms).toLocaleString(); } catch { return String(ms); }
}
`;
