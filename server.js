const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS 설정 강화
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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

    // URL 유효성 검사
    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch (error) {
      return res.status(400).json({ error: '올바른 URL이 아닙니다' });
    }

    console.log('프록시 요청:', url);

    // 다양한 헤더로 요청 시도
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
      'Upgrade-Insecure-Requests': '1'
    };

    const response = await axios.get(url, {
      headers,
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
      responseType: 'text'
    });

    // Content-Type 설정
    const contentType = response.headers['content-type'] || 'text/html';
    res.set('Content-Type', contentType);
    
    // 캐시 방지 헤더
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    let content = response.data;

    // HTML 콘텐츠인 경우 링크 수정
    if (contentType.includes('text/html')) {
      const baseUrl = `${targetUrl.protocol}//${targetUrl.host}`;
      
      // 상대 링크를 절대 링크로 변환
      content = content.replace(/href="\/([^"]*)"/g, `href="${baseUrl}/$1"`);
      content = content.replace(/src="\/([^"]*)"/g, `src="${baseUrl}/$1"`);
      content = content.replace(/action="\/([^"]*)"/g, `action="${baseUrl}/$1"`);
      
      // 프록시를 통한 링크 처리를 위한 스크립트 주입
      const proxyScript = `
        <script>
          // 모든 링크를 프록시를 통해 처리
          document.addEventListener('DOMContentLoaded', function() {
            const links = document.querySelectorAll('a[href]');
            links.forEach(link => {
              const href = link.getAttribute('href');
              if (href && (href.startsWith('http') || href.startsWith('//'))) {
                link.addEventListener('click', function(e) {
                  e.preventDefault();
                  const proxyUrl = '/proxy?url=' + encodeURIComponent(href);
                  window.location.href = proxyUrl;
                });
              }
            });
            
            // 폼 제출도 프록시를 통해 처리
            const forms = document.querySelectorAll('form');
            forms.forEach(form => {
              form.addEventListener('submit', function(e) {
                const action = form.getAttribute('action');
                if (action && !action.includes('/proxy')) {
                  e.preventDefault();
                  const fullUrl = action.startsWith('http') ? action : '${baseUrl}' + action;
                  window.location.href = '/proxy?url=' + encodeURIComponent(fullUrl);
                }
              });
            });
          });
        </script>
      `;
      
      // </body> 태그 앞에 스크립트 삽입
      content = content.replace('</body>', proxyScript + '</body>');
    }

    res.send(content);

  } catch (error) {
    console.error('프록시 에러:', error.message);
    
    // 구체적인 에러 메시지 제공
    let errorMessage = '알 수 없는 오류가 발생했습니다.';
    let statusCode = 500;

    if (error.code === 'ENOTFOUND') {
      errorMessage = '웹사이트를 찾을 수 없습니다. URL을 확인해주세요.';
      statusCode = 404;
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = '웹사이트가 연결을 거부했습니다.';
      statusCode = 503;
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = '요청 시간이 초과되었습니다.';
      statusCode = 408;
    } else if (error.response && error.response.status) {
      statusCode = error.response.status;
      errorMessage = `웹사이트에서 ${statusCode} 오류를 반환했습니다.`;
    }

    res.status(statusCode).json({ 
      error: errorMessage,
      url: req.query.url,
      details: error.message 
    });
  }
});

// 이미지, CSS, JS 등 리소스 프록시
app.get('/resource', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL이 필요합니다' });
    }

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(response.data);

  } catch (error) {
    console.error('리소스 프록시 에러:', error.message);
    res.status(500).json({ error: '리소스를 가져올 수 없습니다' });
  }
});

// 기본 라우트
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`프록시 서버가 포트 ${PORT}에서 실행 중입니다`);
  console.log(`접속 URL: http://localhost:${PORT}`);
});
