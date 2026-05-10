/**
 * Edge Function: /api/url
 * 根据 path + qs 返回带 eo_token 的国内版跳转 URL
 *
 * 环境变量：
 *   EO_API_TOKEN  EO Pages API Token
 *   EO_DOMAIN     国内版域名，如 axiomlab.zh-cn.edgeone.cool
 *
 * KV 绑定（变量名：KV）
 */

const KV_KEY    = 'eo_preview_token';
const CACHE_TTL = 60 * 60 * 2;

async function fetchToken(apiToken, domain) {
  const res = await fetch('https://pages-api.edgeone.ai/v1', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Action: 'DescribePagesEncipherToken', Text: domain }),
  });
  const data = await res.json();
  if (data.Code !== 0) throw new Error('EO API 错误: ' + JSON.stringify(data));
  return {
    token:     data.Data.Response.Token,
    timestamp: data.Data.Response.Timestamp,
    cachedAt:  Math.floor(Date.now() / 1000),
  };
}

async function getTokenData(env) {
  if (KV) {
    try {
      const cached = await KV.get(KV_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        if (Math.floor(Date.now() / 1000) - data.cachedAt < CACHE_TTL) return data;
      }
    } catch (e) {}
  }
  const tokenData = await fetchToken(env.EO_API_TOKEN, env.EO_DOMAIN);
  if (KV) {
    try { await KV.put(KV_KEY, JSON.stringify(tokenData), { expirationTtl: CACHE_TTL }); }
    catch (e) {}
  }
  return tokenData;
}

export async function onRequest({ request, env }) {
  const url       = new URL(request.url);
  const path      = url.searchParams.get('path') || '/';
  const qs        = url.searchParams.get('qs')   || '';

  try {
    const tokenData = await getTokenData(env);
    const eoUrl     = new URL(`https://${env.EO_DOMAIN}${path}`);

    new URLSearchParams(qs).forEach((v, k) => eoUrl.searchParams.set(k, v));
    eoUrl.searchParams.set('eo_token', tokenData.token);
    eoUrl.searchParams.set('eo_time',  tokenData.timestamp);

    return new Response(JSON.stringify({ url: eoUrl.toString() }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
