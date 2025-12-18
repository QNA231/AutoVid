import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import * as googleTTS from 'google-tts-api'; 
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
const getMP3Duration = require('get-mp3-duration');

// --- CẤU HÌNH ---
dotenv.config();
// ffmpeg.setFfmpegPath("D:\\Quan\\autovid\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe");
ffmpeg.setFfmpegPath("D:\\HTML+CSS\\Node\\AutoVid\\ffmpeg\\bin\\ffmpeg.exe");

// Tốc độ tua nhanh audio
const AUDIO_SPEED = 1.2; 

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/output', express.static(path.join(__dirname, 'output')));

['temp', 'output', 'assets/music'].forEach(dir => {
    const p = path.join(__dirname, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// --- MENU GIA VỊ ---
const STYLES = [
    "Nhật ký tuyệt vọng", "Góc nhìn thứ nhất", "Found Footage", 
    "Lời thú tội", "Creepypasta", "Truyền thuyết đô thị"
];

function getRandomItem(arr: string[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// --- GOM NHÓM TEXT ---
function splitTextBatch(text: string): string[] {
    const rawSentences = text.match(/[^.?!,;:]+[.?!,;:]?/g) || [text];
    const batchedChunks: string[] = [];
    let currentBatch = "";

    for (const sentence of rawSentences) {
        const trimmed = sentence.trim();
        if (!trimmed) continue;
        if ((currentBatch + " " + trimmed).length < 180) {
            currentBatch += " " + trimmed;
        } else {
            if (currentBatch) batchedChunks.push(currentBatch.trim());
            currentBatch = trimmed;
        }
    }
    if (currentBatch) batchedChunks.push(currentBatch.trim());
    return batchedChunks;
}

// --- GOOGLE TTS ---
async function generateGoogleAudio(text: string, outputPath: string) {
    try {
        const url = googleTTS.getAudioUrl(text, {
            lang: 'vi',
            slow: false,
            host: 'https://translate.google.com',
        });
        const writer = fs.createWriteStream(outputPath);
        const response = await axios({ 
            url, method: 'GET', responseType: 'stream', timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (e: any) {
        throw new Error(`Google TTS Error: ${e.message}`);
    }
}

// --- LẤY NHẠC ---
function getRandomBgMusic() {
    const musicDir = path.join(__dirname, 'assets', 'music');
    if (!fs.existsSync(musicDir)) return null;
    const files = fs.readdirSync(musicDir).filter(f => f.endsWith('.mp3'));
    if (files.length === 0) return null;
    return path.join(musicDir, files[Math.floor(Math.random() * files.length)]);
}

// --- TẠO AUDIO ---
async function generateAudioOnly(fullText: string, baseFileName: string) {
    const chunks = splitTextBatch(fullText); 
    const audioFiles: string[] = [];
    
    console.log(`🎤 Tạo giọng Google TTS | Số đoạn: ${chunks.length}`);

    for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i].trim();
        if (!chunkText) continue;

        const chunkPath = path.join(__dirname, 'temp', `${baseFileName}_part_${i}.mp3`);
        
        try {
            await generateGoogleAudio(chunkText, chunkPath);
            process.stdout.write(`✅ Part ${i+1} `);
            await new Promise(res => setTimeout(res, 2000)); 
            audioFiles.push(chunkPath);
        } catch (error) {
            console.log(`❌ Lỗi part ${i+1}`);
        }
    }

    const finalAudioPath = path.join(__dirname, 'temp', `${baseFileName}_final.mp3`);
    if (audioFiles.length > 0) {
        const finalBuffer = Buffer.concat(audioFiles.map(f => fs.readFileSync(f)));
        fs.writeFileSync(finalAudioPath, finalBuffer);
        
        const totalDurationOriginal = getMP3Duration(finalBuffer) / 1000;
        const totalDurationFinal = totalDurationOriginal / AUDIO_SPEED;

        audioFiles.forEach(f => { try { fs.unlinkSync(f) } catch(e){} });
        return { audioPath: finalAudioPath, totalDuration: totalDurationFinal };
    } else {
        throw new Error("Không tạo được audio nào!");
    }
}

// --- TẢI ẢNH ---
async function downloadImages(prompts: string[], baseTimestamp: number) {
    const imagePaths: string[] = [];
    for (let i = 0; i < prompts.length; i++) {
        const imgPath = path.join(__dirname, 'temp', `img_${baseTimestamp}_${i}.jpg`);
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompts[i])}?width=1080&height=1920&nologo=true&seed=${Math.floor(Math.random()*1000)}`;
                const writer = fs.createWriteStream(imgPath);
                const response = await axios({ 
                    url, method: 'GET', responseType: 'stream', timeout: 30000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                response.data.pipe(writer);
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
                imagePaths.push(imgPath);
                break; 
            } catch (e) {
                await new Promise(res => setTimeout(res, 2000));
            }
        }
    }
    return imagePaths;
}

// --- GENERATE SCRIPT ---
async function generateScriptAndVisuals(topic: string) {
    const style = getRandomItem(STYLES);
    const prompt = `
    Bạn là biên kịch phim kinh dị. Viết kịch bản về chủ đề: "${topic}".
    
    YÊU CẦU JSON RESPONSE (RAW JSON ONLY):
    {
      "narration": "Lời dẫn truyện tiếng Việt (khoảng 1500 từ). Viết thật cuốn hút, đáng sợ.",
      "visual_descriptions": [
         "Mô tả ngắn gọn cảnh 1 (Tiếng Anh, tập trung vào sự vật chính)",
         "Mô tả ngắn gọn cảnh 2 (Tiếng Anh)",
         "Mô tả ngắn gọn cảnh 3 (Tiếng Anh)",
         "Mô tả ngắn gọn cảnh 4 (Tiếng Anh)",
         "Mô tả ngắn gọn cảnh 5 (Tiếng Anh)",
         "Mô tả ngắn gọn cảnh 6 (Tiếng Anh)",
         "Mô tả ngắn gọn cảnh 7 (Tiếng Anh)",
         "Mô tả ngắn gọn cảnh 8 (Tiếng Anh)"
      ]
    }
    `;
    
    const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?json=true&model=openai&seed=${Math.floor(Math.random()*1000)}`;
    const response = await axios.get(url, { timeout: 300000 });
    let data = response.data;
    
    if (typeof data === 'string') {
         const cleanJson = data.replace(/```json/g, '').replace(/```/g, '').trim();
         try { data = JSON.parse(cleanJson); } catch (e) { throw new Error("Lỗi JSON AI"); }
    }
    
    let rawPrompts = data.visual_descriptions || data.visual_prompts || [];
    if (!Array.isArray(rawPrompts) || rawPrompts.length === 0) {
        rawPrompts = ["horror scene", "dark place", "scary face", "ghost", "blood", "knife", "shadow", "moon"];
    }

    const enhancedPrompts = rawPrompts.map((desc: string) => {
        return `${topic}, ${desc}, cinematic lighting, 8k, photorealistic, horror movie style, dark atmosphere, highly detailed`;
    });

    data.visual_prompts = enhancedPrompts;
    return data;
}

// --- API ---
app.post('/api/generate', async (req: Request, res: Response): Promise<any> => {
    try {
        const data = await generateScriptAndVisuals(req.body.topic);
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/render', async (req: Request, res: Response): Promise<any> => {
    const { script, visual_prompts } = req.body;
    const timestamp = Date.now();
    const videoPath = path.join(__dirname, 'output', `video_${timestamp}.mp4`);
    const baseName = `content_${timestamp}`;

    try {
        console.log('--- Render: Chữ Trắng To & Viền Đen ---');
        
        const imagePaths = await downloadImages(visual_prompts, timestamp);
        if (imagePaths.length === 0) throw new Error("Lỗi tải ảnh");

        const { audioPath, totalDuration } = await generateAudioOnly(script, baseName);
        console.log(`\n🔊 Audio: ${Math.round(totalDuration)}s`);

        const bgMusic = getRandomBgMusic();
        let command = ffmpeg();
        
        imagePaths.forEach(img => command.input(img));
        command.input(audioPath);
        if (bgMusic) command.input(bgMusic).inputOptions(['-stream_loop -1']);

        const durationPerImage = totalDuration / imagePaths.length;
        let filter = "";
        let inputMap = "";
        
        for (let i = 0; i < imagePaths.length; i++) {
            filter += `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,` +
                      `zoompan=z='min(zoom+0.0005,1.2)':d=${Math.ceil(durationPerImage*30 + 30)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30[v${i}];`;
            inputMap += `[v${i}]`;
        }
        
        filter += `${inputMap}concat=n=${imagePaths.length}:v=1:a=0[v_base];`;
        
        // 🔥 CẬP NHẬT FILTER CHỮ:
        // fontcolor=white : Chữ trắng
        // fontsize=60     : Chữ to rõ (gấp đôi cũ)
        // borderw=4       : Viền dày 4px
        // bordercolor=black : Viền đen
        // y=h-120         : Nâng cao lên một chút để không sát đáy quá
        const textFilter = `drawtext=text='Chúc bạn nghe truyện vui vẻ':fontfile='C\\:/Windows/Fonts/arial.ttf':fontcolor=white:fontsize=60:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h-120`;
        
        filter += `[v_base]${textFilter}[v_out];`;

        if (bgMusic) {
            const audioIdx = imagePaths.length;
            const musicIdx = imagePaths.length + 1;
            filter += `[${audioIdx}:a]atempo=${AUDIO_SPEED}[voice];`;
            filter += `[${musicIdx}:a]volume=0.3[music];`;
            filter += `[voice][music]amix=inputs=2:duration=first:dropout_transition=2[a_out]`;
        } else {
            const audioIdx = imagePaths.length;
            filter += `[${audioIdx}:a]atempo=${AUDIO_SPEED}[a_out]`;
        }

        command
            .complexFilter(filter)
            .outputOptions([
                '-c:v libx264', '-preset ultrafast', '-tune stillimage',
                '-c:a aac', '-b:a 128k', '-pix_fmt yuv420p', '-r 30', 
                '-map [v_out]', '-map [a_out]'
            ])
            .save(videoPath)
            .on('end', () => {
                console.log('✅ Render Xong!');
                res.json({ videoUrl: `http://localhost:3001/output/video_${timestamp}.mp4` });
                imagePaths.forEach(p => fs.unlinkSync(p));
            })
            .on('error', (err) => {
                console.error("❌ Render Fail:", err.message);
                if (!res.headersSent) res.status(500).json({ error: err.message });
            });

    } catch (e: any) { 
        if (!res.headersSent) res.status(500).json({ error: e.message }); 
    }
});

const PORT = 3001;
const server = app.listen(PORT, () => console.log(`Server White Text & Big Font running on ${PORT}`));
server.setTimeout(1800000);