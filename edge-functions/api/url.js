/**
 * Edge Function: /api/url
 * 根据 subdomain 参数返回对应国内版的 eo_token 和 eo_time
 * 前端自行拼接目标 URL
 *
 * 约定：subdomain 直接对应 EO Pages 项目名
 *   axiomlab → axiomlab.zh-cn.edgeone.cool
 *
 * 请求示例：
 *   GET /api/url?subdomain=axiomlab
 *
 * 响应示例：
 *   { "domain": "axiomlab.zh-cn.edgeone.cool", "token": "xxx", "timestamp": 1234567890 }
 *
 * 环境变量：
 *   EO_API_TOKEN  EO Pages API Token
 *
 * KV 绑定（变量名：KV）
 *   key 格式：eo_token:<subdomain>
 */

const CACHE_TTL = 60 * 60 * 2;
const CN_SUFFIX = '.zh-cn.edgeone.cool';

function kvKey(subdomain) {
  return 'eo_token:' + subdomain;
}

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

async function getTokenData(apiToken, subdomain) {
  const domain = subdomain + CN_SUFFIX;
  const key    = kvKey(subdomain);

  if (KV) {
    try {
      const cached = await KV.get(key);
      if (cached) {
        const data = JSON.parse(cached);
        if (Math.floor(Date.now() / 1000) - data.cachedAt < CACHE_TTL) return { domain, ...data };
      }
    } catch (e) {}
  }

  const tokenData = await fetchToken(apiToken, domain);

  if (KV) {
    try { await KV.put(key, JSON.stringify(tokenData), { expirationTtl: CACHE_TTL }); }
    catch (e) {}
  }

  return { domain, ...tokenData };
}

export async function onRequest({ request, env }) {
  const url       = new URL(request.url);
  const subdomain = url.searchParams.get('subdomain');

  if (!subdomain || !/^[a-z0-9-]+$/.test(subdomain)) {
    return new Response(JSON.stringify({ error: '缺少或非法的 subdomain 参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { domain, token, timestamp } = await getTokenData(env.EO_API_TOKEN, subdomain);
    return new Response(JSON.stringify({ domain, token, timestamp }), {
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
