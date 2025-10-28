require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs-extra');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json({ limit: '50mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;

fs.ensureDirSync('./audio');

app.get('/webhook', (req, res) => {
  const verify_token = "translationbot2025";
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === verify_token) {
    console.log("Webhook verified");
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'audio') {
      return res.sendStatus(200);
    }

    const from = message.from;
    const audioId = message.audio.id;

    console.log(`Audio received from ${from}`);

    const audioUrl = `https://graph.facebook.com/v20.0/${audioId}`;
    const audioPath = await downloadAudio(audioUrl, `./audio/${audioId}.ogg`);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1'
    });
    const textX = transcription.text;

    const targetLang = 'es'; // CHANGE THIS: 'es' = Spanish, 'fr' = French, etc.
    const translationRes = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: `Translate to ${getLangName(targetLang)} only. No explanation.` },
        { role: 'user', content: textX }
      ]
    });
    const textY = translationRes.choices[0].message.content.trim();

    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: textY
    });
    const ttsPath = `./audio/translated_${Date.now()}.mp3`;
    const buffer = Buffer.from(await mp3.arrayBuffer());
    await fs.writeFile(ttsPath, buffer);

    const mediaId = await uploadMedia(ttsPath);
    await sendAudioMessage(from, mediaId);

    fs.removeSync(audioPath);
    fs.removeSync(ttsPath);

    res.sendStatus(200);
  } catch (err) {
    console.error("Error:", err.message);
    res.sendStatus(500);
  }
});

async function downloadAudio(url, dest) {
  const response = await axios.get(url, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
    responseType: 'arraybuffer'
  });
  await fs.writeFile(dest, response.data);
  return dest;
}

async function uploadMedia(filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('type', 'audio/mpeg');
  form.append('messaging_product', 'whatsapp');

  const res = await axios.post(
    `https://graph.facebook.com/v20.0/${PHONE_ID}/media`,
    form,
    { headers: { ...form.getHeaders(), Authorization: `Bearer ${TOKEN}` } }
  );
  return res.data.id;
}

async function sendAudioMessage(to, mediaId) {
  await axios.post(
    `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: to,
      type: 'audio',
      audio: { id: mediaId }
    },
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
}

function getLangName(code) {
  const map = { 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'hi': 'Hindi', 'zh': 'Chinese', 'en': 'English' };
  return map[code] || 'English';
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`);
});
