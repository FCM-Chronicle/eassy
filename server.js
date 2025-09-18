const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 강화된 CORS 설정
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['*'],
  credentials: false
}));

app.use(express.static('public'));
app.use(express.json());

// 헬스체크
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: '서버 정상 작동 중! 🚀' });
});

// 메인 프록시 엔드포인트
app.get('/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' });
    }

    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch (error) {
      return res.status(400).json({ error: '올바른 URL이 아닙니다' });
    }

    console.log('프록시 요청:', url);

    // 강화된 헤더 설정
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'DNT': '1'
    };

    const response = await axios.get(url, {
      headers,
      timeout: 30000,
      maxRedirects: 10,
      validateStatus: (status) => status < 500,
      responseType: 'text'
    });

    // 모든 CORS 헤더 설정
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Credentials', 'false');
    
    // Content Security Policy 제거
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Frame-Options');
    res.removeHeader('X-Content-Type-Options');
    
    const contentType = response.headers['content-type'] || 'text/html';
    res.set('Content-Type', contentType);
    
    // 캐시 방지
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    let content = response.data;

    if (contentType.includes('text/html')) {
      const baseUrl = `${targetUrl.protocol}//${targetUrl.host}`;
      
      // URL 변환을 더 적극적으로
      content = content.replace(/href="\/([^"]*)"/g, `href="/proxy?url=${encodeURIComponent(baseUrl)}/$1"`);
      content = content.replace(/src="\/([^"]*)"/g, `src="/resource?url=${encodeURIComponent(baseUrl)}/$1"`);
      content = content.replace(/action="\/([^"]*)"/g, `action="/proxy?url=${encodeURIComponent(baseUrl)}/$1"`);
      
      // 절대 URL도 프록시를 통해 처리
      content = content.replace(/href="(https?:\/\/[^"]*)"/g, `href="/proxy?url=$1"`);
      content = content.replace(/src="(https?:\/\/[^"]*)"/g, (match, fullUrl) => {
        // 이미지, CSS, JS는 resource 엔드포인트로
        if (fullUrl.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)(\?.*)?$/i)) {
          return `src="/resource?url=${encodeURIComponent(fullUrl)}"`;
        }
        return `src="/proxy?url=${encodeURIComponent(fullUrl)}"`;
      });

      // X-Frame-Options와 CSP 제거
      content = content.replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
      content = content.replace(/<meta[^>]*http-equiv="X-Frame-Options"[^>]*>/gi, '');
      
      // 간단하고 안전한 프록시 처리 스크립트
      const proxyScript = `
        <script>
          // 전역 프록시 함수
          function proxyUrl(url) {
            if (!url || url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('mailto:')) {
              return url;
            }
            if (url.startsWith('/')) {
              return '/proxy?url=' + encodeURIComponent('${baseUrl}' + url);
            }
            if (url.startsWith('http')) {
              return '/proxy?url=' + encodeURIComponent(url);
            }
            return '/proxy?url=' + encodeURIComponent('${baseUrl}/' + url);
          }

          // 안전한 DOM 처리
          function processLinks() {
            try {
              const links = document.querySelectorAll('a[href]:not([data-proxied])');
              links.forEach(link => {
                const href = link.getAttribute('href');
                if (href && !href.includes('/proxy?url=')) {
                  link.addEventListener('click', function(e) {
                    e.preventDefault();
                    window.location.href = proxyUrl(href);
                  });
                  link.setAttribute('data-proxied', 'true');
                }
              });
            } catch (e) {
              console.log('Link processing error:', e);
            }
          }

          // 간단한 AJAX 인터셉트 (선택적)
          if (window.fetch) {
            const originalFetch = window.fetch;
            window.fetch = function(url, options) {
              try {
                if (typeof url === 'string' && url.startsWith('http') && !url.includes('render.com')) {
                  return originalFetch('/resource?url=' + encodeURIComponent(url), options);
                }
              } catch (e) {
                console.log('Fetch proxy error:', e);
              }
              return originalFetch.call(this, url, options);
            };
          }

          // DOM 로드 후 실행
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', processLinks);
          } else {
            processLinks();
          }

          // 주기적으로 새 링크 처리 (MutationObserver 대신)
          setInterval(processLinks, 2000);
        </script>
      `;
      
      // Head에 스크립트 추가
      content = content.replace('</head>', proxyScript + '</head>');
      if (!content.includes('</head>')) {
        content = proxyScript + content;
      }
    }

    res.send(content);

  } catch (error) {
    console.error('프록시 에러:', error.message);
    
    let errorMessage = '알 수 없는 오류가 발생했습니다.';
    let statusCode = 500;

    if (error.code === 'ENOTFOUND') {
      errorMessage = '웹사이트를 찾을 수 없습니다.';
      statusCode = 404;
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = '연결이 거부되었습니다.';
      statusCode = 503;
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = '요청 시간이 초과되었습니다.';
      statusCode = 408;
    } else if (error.response) {
      statusCode = error.response.status;
      errorMessage = `서버에서 ${statusCode} 오류를 반환했습니다.`;
    }

    res.status(statusCode).json({ 
      error: errorMessage,
      url: req.query.url
    });
  }
});

// 리소스 프록시 (이미지, CSS, JS, API 등)
app.get('/resource', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' });
    }

    console.log('리소스 요청:', url);

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': url,
        'Origin': new URL(url).origin
      },
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });

    // CORS 헤더 설정
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', '*');
    res.set('Access-Control-Allow-Headers', '*');
    
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    
    res.send(response.data);

  } catch (error) {
    console.error('리소스 프록시 에러:', error.message);
    res.status(500).json({ error: '리소스를 가져올 수 없습니다' });
  }
});

// POST 요청 처리
app.post('/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' });
    }

    const response = await axios.post(url, req.body, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Accept': '*/*'
      },
      timeout: 30000,
      maxRedirects: 5
    });

    res.set('Access-Control-Allow-Origin', '*');
    res.json(response.data);

  } catch (error) {
    console.error('POST 프록시 에러:', error.message);
    res.status(500).json({ error: 'POST 요청 처리 중 오류 발생' });
  }
});

// OPTIONS 요청 처리 (CORS preflight)
app.options('*', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', '*');
  res.set('Access-Control-Max-Age', '86400');
  res.status(200).end();
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`프록시 서버가 포트 ${PORT}에서 실행 중입니다`);
});
