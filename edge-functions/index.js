/**
 * EdgeOne Pages Edge Function
 * 功能：从 KV 读取缓存 token，实时调用 EO API 刷新，302 跳转到国内版
 *
 * 目录结构：
 *   edge-functions/
 *   └── index.js   ← 本文件，拦截所有请求
 *
 * 环境变量（在 EO Pages 控制台 → 项目设置 → 环境变量 中配置）：
 *   EO_API_TOKEN  你的 EO Pages API Token
 *   EO_DOMAIN     国内版域名，如 cn-sunisalex-pages.zh-cn.edgeone.cool
 *
 * KV 绑定（在 EO Pages 控制台 → 项目设置 → KV Storage 中绑定）：
 *   变量名：KV
 */

const KV_KEY    = 'eo_preview_token';
const CACHE_TTL = 60 * 60 * 2; // 2小时，token 有效期 3 小时，留 1 小时余量

// 调用 EO API 获取新 token
async function fetchToken(apiToken, domain) {
  const res = await fetch('https://pages-api.edgeone.ai/v1', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      Action: 'DescribePagesEncipherToken',
      Text: domain,
    }),
  });

  const data = await res.json();
  if (data.Code !== 0) {
    throw new Error('EO API 错误: ' + JSON.stringify(data));
  }

  return {
    token:     data.Data.Response.Token,
    timestamp: data.Data.Response.Timestamp,
    cachedAt:  Math.floor(Date.now() / 1000),
  };
}

// 从 KV 读缓存，过期则重新获取
async function getTokenData(env) {
  const apiToken = env.EO_API_TOKEN;
  const domain   = env.EO_DOMAIN;

  // 尝试读 KV 缓存
  if (KV) {
    try {
      const cached = await KV.get(KV_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        const age  = Math.floor(Date.now() / 1000) - data.cachedAt;
        if (age < CACHE_TTL) {
          return data; // 缓存有效，直接返回
        }
      }
    } catch (e) {
      // KV 读取失败，继续走实时获取
    }
  }

  // 重新获取 token
  const tokenData = await fetchToken(apiToken, domain);

  // 写入 KV 缓存
  if (KV) {
    try {
      await KV.put(KV_KEY, JSON.stringify(tokenData), {
        expirationTtl: CACHE_TTL,
      });
    } catch (e) {
      // KV 写入失败不影响主流程
    }
  }

  return tokenData;
}

// 主处理函数，拦截所有请求
export async function onRequest({ request, env }) {
  if (new URL(request.url).searchParams.has('debug')) {
    return new Response(JSON.stringify({
      hasKV:       !!KV,
      hasToken:    !!env.EO_API_TOKEN,
      hasDomain:   !!env.EO_DOMAIN,
      kvType:      typeof KV,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  try {
    const url      = new URL(request.url);
    const domain   = env.EO_DOMAIN;
    const tokenData = await getTokenData(env);

    // 透传路径和查询参数，拼接 token
    const eoUrl    = new URL(`https://${domain}${url.pathname}`);

    // 保留原始查询参数
    url.searchParams.forEach((value, key) => {
      eoUrl.searchParams.set(key, value);
    });

    // 注入鉴权参数
    eoUrl.searchParams.set('eo_token', tokenData.token);
    eoUrl.searchParams.set('eo_time',  tokenData.timestamp);

    return Response.redirect(eoUrl.toString(), 302);

  } catch (err) {
    return new Response('获取预览链接失败: ' + err.message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
