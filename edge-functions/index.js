/**
 * EdgeOne Pages Edge Function
 * 功能：从 KV 读取缓存 token，内联到 loading 页后 JS 跳转，消除白屏
 *
 * 目录结构：
 *   edge-functions/
 *   └── index.js   ← 本文件，拦截所有请求
 *
 * 环境变量（在 EO Pages 控制台 → 项目设置 → 环境变量 中配置）：
 *   EO_API_TOKEN  你的 EO Pages API Token
 *   EO_DOMAIN     国内版域名，如 axiomlab.zh-cn.edgeone.cool
 *   REFRESH_SECRET  /refresh 接口鉴权密钥
 *
 * KV 绑定（在 EO Pages 控制台 → 项目设置 → KV Storage 中绑定）：
 *   变量名：KV
 */

const KV_KEY    = 'eo_preview_token';
const CACHE_TTL = 60 * 60 * 2; // 2小时，token 有效期 3 小时，留 1 小时余量

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
      await KV.put(KV_KEY, JSON.stringify(tokenData), { expirationTtl: CACHE_TTL });
    } catch (e) {}
  }

  return tokenData;
}

function buildTargetUrl(domain, pathname, searchParams, tokenData) {
  const eoUrl = new URL(`https://${domain}${pathname}`);
  searchParams.forEach((value, key) => eoUrl.searchParams.set(key, value));
  eoUrl.searchParams.set('eo_token', tokenData.token);
  eoUrl.searchParams.set('eo_time',  tokenData.timestamp);
  return eoUrl.toString();
}

// 微信提示页（execCommand 降级复制，无 navigator.clipboard）
function wechatPage(targetUrl) {
  // 转义防止 XSS
  const escaped = targetUrl.replace(/'/g, "\\'").replace(/</g, '&lt;');
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>请在浏览器中打开</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
     min-height:100vh;background:#f5f5f5}
.box{text-align:center;padding:28px 20px;background:#fff;border-radius:14px;
     box-shadow:0 2px 16px rgba(0,0,0,.08);max-width:320px;width:90%}
.tip{color:#888;font-size:13px;margin-bottom:16px;line-height:1.5}
.url{word-break:break-all;font-size:11px;background:#f7f7f7;padding:10px;
     border-radius:8px;margin-bottom:16px;color:#555;text-align:left}
button{background:#07c160;color:#fff;border:none;padding:13px;border-radius:10px;
       font-size:15px;cursor:pointer;width:100%}
</style>
</head>
<body>
<div class="box">
  <p class="tip">微信内无法直接访问<br>请复制链接到浏览器打开</p>
  <div class="url" id="u">${escaped}</div>
  <button onclick="copy(this)">📋 复制链接</button>
</div>
<script>
function copy(btn){
  var ta=document.createElement('textarea');
  ta.value=document.getElementById('u').textContent;
  ta.style.cssText='position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);ta.focus();ta.select();
  try{document.execCommand('copy');btn.textContent='✅ 已复制！'}
  catch(e){btn.textContent='请手动复制上方链接'}
  document.body.removeChild(ta);
}
</script>
</body>
</html>`;
}

// loading 跳转页：token 内联，JS replace 跳转，无白屏无历史记录
function loadingPage(targetUrl) {
  const escaped = targetUrl.replace(/'/g, "\\'").replace(/</g, '&lt;');
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>加载中…</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:#0f0f0f}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
.ring{width:36px;height:36px;border:3px solid #333;border-top-color:#fff;
      border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.text{color:#666;font-size:13px;font-family:sans-serif;letter-spacing:.05em}
</style>
</head>
<body>
<div class="wrap">
  <div class="ring"></div>
  <span class="text">正在跳转…</span>
</div>
<script>window.location.replace('${escaped}');</script>
</body>
</html>`;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  // debug 接口
  if (url.searchParams.has('debug')) {
    return new Response(JSON.stringify({
      hasKV:     !!KV,
      hasToken:  !!env.EO_API_TOKEN,
      hasDomain: !!env.EO_DOMAIN,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // /refresh 接口：强制刷新 KV 缓存（供 GitHub Actions 调用）
  if (url.pathname === '/refresh') {
    const secret = env.REFRESH_SECRET;
    if (secret && url.searchParams.get('secret') !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
    try {
      const tokenData = await fetchToken(env.EO_API_TOKEN, env.EO_DOMAIN);
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

  try {
    const domain    = env.EO_DOMAIN;
    const ua        = request.headers.get('User-Agent') || '';
    const tokenData = await getTokenData(env);
    const targetUrl = buildTargetUrl(domain, url.pathname, url.searchParams, tokenData);

    const html = /MicroMessenger/i.test(ua)
      ? wechatPage(targetUrl)
      : loadingPage(targetUrl);

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

  } catch (err) {
    return new Response('获取预览链接失败: ' + err.message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
