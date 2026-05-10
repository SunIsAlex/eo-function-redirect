/**
 * EdgeOne Pages Edge Function
 * 功能：从 KV 读取缓存 token，实时调用 EO API 刷新，302 跳转到国内版
 *
 * 目录结构：
 *   edge-functions/
 *   ├── index.js        ← 处理根路径 /
 *   └── [[default]].js  ← 处理其他所有路径（内容相同）
 *
 * 环境变量：
 *   EO_API_TOKEN  你的 EO Pages API Token
 *   EO_DOMAIN     国内版域名
 *   REFRESH_SECRET  /refresh 接口的鉴权密钥（随意设置一个随机字符串）
 *
 * KV 绑定变量名：KV
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

async function getTokenData(env) {
  const apiToken = env.EO_API_TOKEN;
  const domain   = env.EO_DOMAIN;

  if (KV) {
    try {
      const cached = await KV.get(KV_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        const age  = Math.floor(Date.now() / 1000) - data.cachedAt;
        if (age < CACHE_TTL) return data;
      }
    } catch (e) {}
  }

  const tokenData = await fetchToken(apiToken, domain);

  if (KV) {
    try {
      await KV.put(KV_KEY, JSON.stringify(tokenData), {
        expirationTtl: CACHE_TTL,
      });
    } catch (e) {}
  }

  return tokenData;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  // /refresh?secret=xxx 供 GitHub Actions 定时暖机 + 强制刷新 token
  if (url.pathname === '/refresh') {
    const secret = url.searchParams.get('secret');
    if (!secret || secret !== env.REFRESH_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
    try {
      const tokenData = await fetchToken(env.EO_API_TOKEN, env.EO_DOMAIN);
      if (KV) {
        await KV.put(KV_KEY, JSON.stringify(tokenData), {
          expirationTtl: CACHE_TTL,
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        token:     tokenData.token,
        timestamp: tokenData.timestamp,
        cachedAt:  tokenData.cachedAt,
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  try {
    const domain    = env.EO_DOMAIN;
    const ua        = request.headers.get('User-Agent') || '';
    const tokenData = await getTokenData(env);

    const eoUrl = new URL(`https://${domain}${url.pathname}`);
    url.searchParams.forEach((value, key) => eoUrl.searchParams.set(key, value));
    eoUrl.searchParams.set('eo_token', tokenData.token);
    eoUrl.searchParams.set('eo_time',  tokenData.timestamp);

    // 微信浏览器：返回提示页
    if (/MicroMessenger/i.test(ua)) {
      const targetUrl = eoUrl.toString();
      return new Response(`<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>请在浏览器中打开</title>
  <style>
    body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5}
    .box{text-align:center;padding:24px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:320px}
    .tip{color:#888;font-size:13px;margin-bottom:16px}
    .url{word-break:break-all;font-size:12px;background:#f0f0f0;padding:10px;border-radius:6px;margin-bottom:16px;color:#333}
    button{background:#07c160;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:15px;cursor:pointer;width:100%}
  </style>
</head>
<body>
<script>
function copyToClipboard(text,btn){
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){btn.textContent='✅ 已复制！'}).catch(function(){fallbackCopy(text,btn)});
  } else { fallbackCopy(text,btn); }
}
function fallbackCopy(text,btn){
  var ta=document.createElement('textarea');
  ta.value=text;ta.style.cssText='position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);ta.focus();ta.select();
  try{document.execCommand('copy');btn.textContent='✅ 已复制！';}
  catch(e){btn.textContent='请手动复制上方链接';}
  document.body.removeChild(ta);
}
</script>
<div class="box">
  <p class="tip">微信内无法直接访问，请复制链接到浏览器打开</p>
  <div class="url">${targetUrl}</div>
  <button onclick="copyToClipboard('${targetUrl}',this)">📋 复制链接</button>
</div>
</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return Response.redirect(eoUrl.toString(), 302);

  } catch (err) {
    return new Response('获取预览链接失败: ' + err.message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
