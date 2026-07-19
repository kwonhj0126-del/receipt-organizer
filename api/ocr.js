module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { image, mediaType } = req.body;
  if (!image || !mediaType) {
    return res.status(400).json({ error: 'image와 mediaType이 필요합니다.' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: image }
            },
            {
              type: 'text',
              text: '이 영수증 이미지에서 다음 정보를 추출해줘. 반드시 아래 JSON 형식으로만 응답해. 다른 말은 하지 마.\n\n{\n  "date": "YYYY-MM-DD 형식 날짜, 없으면 빈 문자열",\n  "vendor": "가게명 또는 상호명, 없으면 빈 문자열",\n  "amount": 최종 결제 금액 숫자만,\n  "category": "식비/교통/사무용품/숙박/접대비/기타 중 하나"\n}'
            }
          ]
        }]
      })
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: 'Claude API 오류', detail: err });
    }
    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json({
      date: parsed.date || '',
      vendor: parsed.vendor || '',
      amount: Number(parsed.amount) || 0,
      category: parsed.category || '기타'
    });
  } catch (err) {
    console.error('OCR 오류:', err);
    return res.status(500).json({ error: '인식 중 오류가 발생했습니다.' });
  }
}
