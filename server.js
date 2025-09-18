const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

// 프록시 API
app.get('/proxy', async (req, res) => {
  try {
    const response = await axios.get(req.query.url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    res.send(response.data);
  } catch (error) {
    res.status(500).send('에러: ' + error.message);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`서버 실행: http://0.0.0.0:${PORT}`);
  console.log(`외부 접속: http://218.147.194.380:${PORT}`);
});
