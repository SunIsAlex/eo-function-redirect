/**
 * Edge Function: /refresh
 * 强制刷新指定 subdomain 的 KV 缓存 token
 * 不传 subdomain 则刷新所有已配置的项目（通过 EO_SUBDOMAINS 环境变量）
 *
 * 环境变量：
 *   EO_API_TOKEN    EO Pages API Token
 *   EO_SUBDOMAINS   逗号分隔的 subdomain 列表，如 axiomlab,cn-sunisalex-pages
 *   REFRESH_SECRET  鉴权密钥
 *
 * 调用示例：
 *   curl "https://go.sunisalex.org/refresh?secret=xxx"               # 刷新全部
 *   curl "https://go.sunisalex.org/refresh?secret=xxx&subdomain=axiomlab"  # 刷新单个
 */

const CACHE_TTL = 60 * 60 * 2;
const CN_SUFFIX = '.zh-cn.edgeone.cool';

async function refreshOne(apiToken, subdomain) {
  const domain = subdomain + CN_SUFFIX;
  const res = await fetch('https://pages-api.edgeone.ai/v1', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Action: 'DescribePagesEncipherToken', Text: domain }),
  });
  const data = await res.json();
  if (data.Code !== 0) throw new Error(JSON.stringify(data));

  const tokenData = {
    token:     data.Data.Response.Token,
    timestamp: data.Data.Response.Timestamp,
    cachedAt:  Math.floor(Date.now() / 1000),
  };

  if (KV) await KV.put('eo_token:' + subdomain, JSON.stringify(tokenData), { expirationTtl: CACHE_TTL });

  return { subdomain, timestamp: tokenData.timestamp };
}

export async function onRequest({ request, env }) {
  const url    = new URL(request.url);
  const secret = env.REFRESH_SECRET;

  if (secret && url.searchParams.get('secret') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const apiToken   = env.EO_API_TOKEN;
  const subdomains = url.searchParams.get('subdomain')
    ? [url.searchParams.get('subdomain')]
    : (env.EO_SUBDOMAINS || '').split(',').map(s => s.trim()).filter(Boolean);

  if (subdomains.length === 0) {
    return new Response(JSON.stringify({ error: '未指定 subdomain，且 EO_SUBDOMAINS 环境变量为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const results = await Promise.allSettled(
    subdomains.map(s => refreshOne(apiToken, s))
  );

  const body = results.map((r, i) =>
    r.status === 'fulfilled'
      ? { subdomain: subdomains[i], ok: true,  timestamp: r.value.timestamp }
      : { subdomain: subdomains[i], ok: false, error: r.reason?.message }
  );

  const allOk = body.every(r => r.ok);
  return new Response(JSON.stringify(body), {
    status: allOk ? 200 : 207,
    headers: { 'Content-Type': 'application/json' },
  });
}
