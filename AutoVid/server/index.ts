import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
const getMP3Duration = require('get-mp3-duration');

// --- CẤU HÌNH CHUNG ---
dotenv.config();
// ffmpeg.setFfmpegPath("D:\\Quan\\autovid\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe");
ffmpeg.setFfmpegPath("D:\\HTML+CSS\\Node\\AutoVid\\ffmpeg\\bin\\ffmpeg.exe");

// 🔥 QUAN TRỌNG: Cài đặt tốc độ đồng bộ ở đây
// Nếu bạn sửa ở đây, code sẽ tự động tính lại cả Audio lẫn Phụ đề cho khớp
const AUDIO_SPEED = 1.5; 

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/output', express.static(path.join(__dirname, 'output')));

['temp', 'output'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// --- MENU "GIA VỊ" ---
const STYLES = [
    "Kể lại dưới dạng nhật ký tuyệt vọng của nạn nhân.",
    "Kể dưới góc nhìn thứ nhất dồn dập, nghẹt thở.",
    "Kể như một đoạn ghi âm tìm thấy tại hiện trường (Found Footage).",
    "Kể như lời thú tội lạnh lùng của kẻ thủ ác.",
    "Kể theo phong cách truyền thuyết đô thị (Creepypasta).",
    "Kể chậm rãi, ma mị, tập trung vào tiếng động lạ."
];

function getRandomItem(arr: string[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// --- HÀM 1: CHUẨN BỊ TEXT ---
function splitTextIntoChunks(text: string): string[] {
    // Tách câu thông minh hơn, tránh câu quá ngắn
    return text.match(/[^.?!,]+[.?!,]?/g) || [text];
}

// --- HÀM 2: FORMAT THỜI GIAN SRT ---
function formatTime(seconds: number): string {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const iso = date.toISOString().substr(11, 12);
    return iso.replace('.', ',');
}

// --- HÀM 3: TẠO AUDIO + FILE SRT (ĐÃ FIX SYNC) ---
async function generateAudioAndSubtitles(fullText: string, baseFileName: string) {
    const tts = new MsEdgeTTS();
    const voices = ["vi-VN-NamMinhNeural", "vi-VN-HoaiMyNeural"];
    const randomVoice = voices[Math.floor(Math.random() * voices.length)];
    await tts.setMetadata(randomVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    console.log(`🎤 Đang xử lý Audio & Phụ đề (${randomVoice})...`);

    const chunks = splitTextIntoChunks(fullText);
    let currentTime = 0;
    let srtContent = "";
    const audioFiles: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i].trim();
        if (!chunkText) continue;

        const chunkPath = path.join(__dirname, 'temp', `${baseFileName}_part_${i}.mp3`);
        
        // Tạo file audio gốc (Tốc độ 1.0)
        const result = await tts.toStream(chunkText);
        const writer = fs.createWriteStream(chunkPath);
        result.audioStream.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        
        // Đo độ dài gốc (ms)
        const buffer = fs.readFileSync(chunkPath);
        const originalDurationSec = getMP3Duration(buffer) / 1000;

        // 🔥 FIX SYNC: Tính lại thời gian hiển thị phụ đề dựa trên tốc độ tua
        // Nếu tua nhanh 1.5 lần, thì thời gian hiển thị phải ngắn đi 1.5 lần
        const displayDurationSec = originalDurationSec / AUDIO_SPEED;

        const startTime = formatTime(currentTime);
        const endTime = formatTime(currentTime + displayDurationSec);
        
        // Ghi SRT
        srtContent += `${i + 1}\n${startTime} --> ${endTime}\n${chunkText}\n\n`;

        // Cộng dồn thời gian (đã chia cho speed)
        currentTime += displayDurationSec;
        audioFiles.push(chunkPath);
    }

    const srtPath = path.join(__dirname, 'temp', `${baseFileName}.srt`);
    fs.writeFileSync(srtPath, srtContent);

    const finalAudioPath = path.join(__dirname, 'temp', `${baseFileName}_final.mp3`);
    const finalBuffer = Buffer.concat(audioFiles.map(f => fs.readFileSync(f)));
    fs.writeFileSync(finalAudioPath, finalBuffer);

    audioFiles.forEach(f => fs.unlinkSync(f));

    return { audioPath: finalAudioPath, srtPath: srtPath };
}

// --- HÀM 4: CÁC TIỆN ÍCH KHÁC ---
function fixPathForFFmpeg(filePath: string) {
    return filePath.replace(/\\/g, '/').replace(':', '\\:');
}

async function downloadFile(url: string, outputPath: string, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const writer = fs.createWriteStream(outputPath);
            const response = await axios({ 
                url, method: 'GET', responseType: 'stream', timeout: 30000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            response.data.pipe(writer);
            return new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
        } catch (error: any) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
}

async function generateTextWithPollinations(topic: string) {
    const randomStyle = getRandomItem(STYLES);
    const randomSeed = Math.floor(Math.random() * 1000000);
    const prompt = `
    Bạn là biên kịch. Viết kịch bản về: "${topic}".
    YÊU CẦU:
    - Phong cách: ${randomStyle}
    - Độ dài: 1000-1500 từ.
    - Output: JSON Raw.
    - Format: {"narration": "Lời dẫn (Tiếng Việt)", "visual_prompt": "Mô tả ảnh (Tiếng Anh)"}
    `;
    const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?json=true&seed=${randomSeed}&model=openai`;
    const response = await axios.get(url, { timeout: 300000 });
    let data = response.data;
    if (typeof data === 'string') {
         const cleanJson = data.replace(/```json/g, '').replace(/```/g, '').trim();
         try { data = JSON.parse(cleanJson); } catch (e) { throw new Error("Lỗi JSON"); }
    }
    return data;
}

function getRandomVisualEffect() {
    const PRE = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1";
    const effects = [
        { name: "Classic_Zoom", filter: [PRE, `zoompan=z='min(zoom+0.0008,1.2)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30`] },
        { name: "Heartbeat_Pulse", filter: [PRE, `zoompan=z='1.1+0.05*sin(on/30)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30`] }
    ];
    return effects[Math.floor(Math.random() * effects.length)];
}

// --- API ROUTES ---
app.post('/api/generate', async (req: Request, res: Response): Promise<any> => {
    const { topic } = req.body;
    try {
        const data = await generateTextWithPollinations(topic);
        if (!data.narration || !data.visual_prompt) throw new Error("Thiếu dữ liệu");
        res.json({ script: data.narration, imagePrompt: data.visual_prompt });
    } catch (error: any) { res.status(500).json({ error: 'Lỗi: ' + error.message }); }
});

app.post('/api/render', async (req: Request, res: Response): Promise<any> => {
    const { script, imageUrl } = req.body;
    const timestamp = Date.now();
    const imagePath = path.join(__dirname, 'temp', `img_${timestamp}.jpg`);
    const bgMusicPath = path.join(__dirname, 'temp', `bg-music.mp3`);
    const videoPath = path.join(__dirname, 'output', `video_${timestamp}.mp4`);
    const baseName = `content_${timestamp}`;

    try {
        console.log('--- Bắt đầu Render (Fix Sync & Size) ---');
        
        await downloadFile(imageUrl, imagePath);
        
        // Bước này tạo Audio gốc và SRT đã được tính toán thời gian chia cho 1.5
        const { audioPath, srtPath } = await generateAudioAndSubtitles(script, baseName);

        const hasMusic = fs.existsSync(bgMusicPath);
        const effect = getRandomVisualEffect();

        let command = ffmpeg();
        command.input(imagePath).loop();
        command.input(audioPath);
        if (hasMusic) command.input(bgMusicPath).inputOptions(['-stream_loop -1']);

        let complexFilter = [];
        const srtPathFixed = fixPathForFFmpeg(srtPath);
        
        // 🔥 FIX STYLE SUBTITLE:
        // FontSize=13: Nhỏ gọn hơn (cũ là 18).
        // Alignment=2: Căn giữa đáy màn hình.
        // Outline=1: Viền mỏng lại cho tinh tế.
        const subStyle = "FontName=Arial,FontSize=13,PrimaryColour=&H00FFFF&,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=50,Alignment=2,Bold=1";
        
        complexFilter.push(`[0:v]${effect.filter.join(',')}[effected]`);
        complexFilter.push(`[effected]subtitles='${srtPathFixed}':force_style='${subStyle}'[v_out]`);

        if (hasMusic) {
            // 🔥 Audio cũng được tăng tốc 1.5 để khớp với file SRT đã tính toán
            complexFilter.push(`[1:a]atempo=${AUDIO_SPEED}[voice_fast]`); 
            complexFilter.push(`[2:a]volume=0.4[bg_adjusted]`);
            complexFilter.push(`[voice_fast][bg_adjusted]amix=inputs=2:duration=first:dropout_transition=2[a_out]`);
        } else {
            complexFilter.push(`[1:a]atempo=${AUDIO_SPEED}[a_out]`);
        }

        command
            .complexFilter(complexFilter)
            .outputOptions([
                '-c:v libx264', '-preset ultrafast', '-tune stillimage',
                '-c:a aac', '-b:a 128k', '-pix_fmt yuv420p', '-r 30', 
                '-shortest', 
                '-map [v_out]', '-map [a_out]'
            ])
            .save(videoPath)
            .on('end', () => {
                console.log('✅ Render Xong (Đã khớp phụ đề)!');
                res.json({ videoUrl: `http://localhost:3001/output/video_${timestamp}.mp4` });
            })
            .on('error', (err) => {
                console.error("❌ Lỗi Render:", err.message);
                if (!res.headersSent) res.status(500).json({ error: err.message });
            });

    } catch (error: any) { 
        console.error(error);
        if (!res.headersSent) res.status(500).json({ error: error.message });
    }
});

const PORT = 3001;
const server = app.listen(PORT, () => console.log(`Server Final Sync chạy tại port ${PORT}`));
server.setTimeout(1800000);