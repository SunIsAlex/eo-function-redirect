/**
 * Edge Function: /refresh
 * 强制刷新 KV 缓存中的 token（供 GitHub Actions 定时调用）
 *
 * 环境变量：
 *   EO_API_TOKEN    EO Pages API Token
 *   EO_DOMAIN       国内版域名
 *   REFRESH_SECRET  鉴权密钥
 *
 * 调用方式：
 *   curl "https://go.sunisalex.org/refresh?secret=YOUR_SECRET"
 */

const KV_KEY    = 'eo_preview_token';
const CACHE_TTL = 60 * 60 * 2;

export async function onRequest({ request, env }) {
  const url    = new URL(request.url);
  const secret = env.REFRESH_SECRET;

  if (secret && url.searchParams.get('secret') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const res = await fetch('https://pages-api.edgeone.ai/v1', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.EO_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ Action: 'DescribePagesEncipherToken', Text: env.EO_DOMAIN }),
    });
    const data = await res.json();
    if (data.Code !== 0) throw new Error(JSON.stringify(data));

    const tokenData = {
      token:     data.Data.Response.Token,
      timestamp: data.Data.Response.Timestamp,
      cachedAt:  Math.floor(Date.now() / 1000),
    };

    if (KV) await KV.put(KV_KEY, JSON.stringify(tokenData), { expirationTtl: CACHE_TTL });

    return new Response(JSON.stringify({ ok: true, timestamp: tokenData.timestamp }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
