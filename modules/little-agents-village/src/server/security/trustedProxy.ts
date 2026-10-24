export function isTrustedProxyRequest(request: Request) {
  if (process.env.LITTLE_AGENTS_LIVE_TRUSTED_PROXY !== 'true') return false;
  const identityHeader = process.env.LITTLE_AGENTS_LIVE_TRUSTED_HEADER ?? 'x-authenticated-user';
  return Boolean(request.headers.get(identityHeader)?.trim());
}
