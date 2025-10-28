const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
app.use(express.json());

// === VERIFY WEBHOOK (GET REQUEST) ===
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === 'translationbot2025') {
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// === HANDLE MESSAGES (POST) ===
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const message = body.entry[0].changes[0].value.messages[0];
        const from = message.from;
        const phoneId = process.env.PHONE_ID;

        // Handle voice message
        if (message.type === 'audio') {
          const audioId = message.audio.id;
          const audioUrl = `https://graph.facebook.com/v20.0/${audioId}`;

          // Download audio
          const audioResponse = await axios.get(audioUrl, {
            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
          });

          const mimeType = audioResponse.data.mime_type;
          const audioFileUrl = audioResponse.data.url;

          const audioData = await axios.get(audioFileUrl, {
            responseType: 'arraybuffer',
            headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
          });

          // Transcribe with OpenAI
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const transcription = await openai.audio.transcriptions.create({
            file: {
              data: audioData.data,
              name: `audio.${mimeType.split('/')[1]}`,
              type: mimeType,
            },
            model: 'whisper-1',
          });

          const text = transcription.text;

          // Translate to English
          const translation = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: `Translate to English: ${text}` }],
          });

          const translatedText = translation.choices[0].message.content;

          // Generate female voice reply
          const speech = await openai.audio.speech.create({
            model: 'tts-1',
            voice: 'nova',
            input: translatedText,
          });

          const buffer = Buffer.from(await speech.arrayBuffer());
          const base64Audio = buffer.toString('base64');

          // Send audio reply
          await axios.post(
            `https://graph.facebook.com/v20.0/${phoneId}/messages`,
            {
              messaging_product: 'whatsapp',
              to: from,
              type: 'audio',
              audio: {
                provider: { name: 'openai' },
                link: `data:audio/mp3;base64,${base64Audio}`,
              },
            },
            { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
          );
        }
      }
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error('Error:', error.message);
    res.sendStatus(500);
  }
});

// Root route
app.get('/', (req, res) => {
  res.send('GROKMADE WhatsApp Translation Bot is LIVE!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`);
});
