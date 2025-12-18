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
ffmpeg.setFfmpegPath("D:\\Quan\\autovid\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe");
// ffmpeg.setFfmpegPath("D:\\HTML+CSS\\Node\\AutoVid\\ffmpeg\\bin\\ffmpeg.exe");

// Tốc độ tua nhanh audio (1.2 là vừa đẹp cho phim kinh dị)
const AUDIO_SPEED = 1.2; 

// 🔥 HỆ SỐ CHỈNH LỆCH PHỤ ĐỀ (QUAN TRỌNG)
// 0.95 nghĩa là ép phụ đề kết thúc sớm hơn 5% so với tính toán lý thuyết
// Giúp phụ đề luôn "chạy trước" một xíu để không bị tụt lại phía sau
const SYNC_CORRECTION = 0.98; 

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

// --- GOM NHÓM TEXT (GIẢM REQUEST) ---
function splitTextBatch(text: string): string[] {
    // Tách theo dấu câu
    const rawSentences = text.match(/[^.?!,;:]+[.?!,;:]?/g) || [text];
    const batchedChunks: string[] = [];
    let currentBatch = "";

    for (const sentence of rawSentences) {
        const trimmed = sentence.trim();
        if (!trimmed) continue;
        
        // Google TTS giới hạn 200 ký tự một lần đọc rất tốt
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

function formatTime(seconds: number): string {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const iso = date.toISOString().substr(11, 12);
    return iso.replace('.', ',');
}

// --- HÀM GOOGLE TTS (CHÍNH) ---
async function generateGoogleAudio(text: string, outputPath: string) {
    try {
        const url = googleTTS.getAudioUrl(text, {
            lang: 'vi',
            slow: false,
            host: 'https://translate.google.com',
        });
        
        const writer = fs.createWriteStream(outputPath);
        const response = await axios({ 
            url, 
            method: 'GET', 
            responseType: 'stream', 
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' } // Giả lập trình duyệt
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

// --- HÀM EDGE TTS (DỰ PHÒNG - NẾU CẦN THÌ BẬT LẠI) ---
async function generateEdgeAudio(text: string, outputPath: string, voice: string) {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const result = await tts.toStream(text);
    const writer = fs.createWriteStream(outputPath);
    result.audioStream.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// --- HÀM LẤY NHẠC ---
function getRandomBgMusic() {
    const musicDir = path.join(__dirname, 'assets', 'music');
    if (!fs.existsSync(musicDir)) return null;
    const files = fs.readdirSync(musicDir).filter(f => f.endsWith('.mp3'));
    if (files.length === 0) return null;
    return path.join(musicDir, files[Math.floor(Math.random() * files.length)]);
}

// --- HÀM TẠO AUDIO & SRT (CHẾ ĐỘ GOOGLE MẶC ĐỊNH) ---
async function generateAudioAndSubtitles(fullText: string, baseFileName: string) {
    const chunks = splitTextBatch(fullText); 
    let currentTime = 0;
    let srtContent = "";
    const audioFiles: string[] = [];
    
    // Mặc định dùng Google TTS vì Edge đang bị chặn
    // Nếu bạn muốn thử vận may với Edge, đổi biến này thành true
    const USE_EDGE = false; 

    console.log(`🎤 Chế độ: ${USE_EDGE ? 'Edge TTS (Rủi ro cao)' : 'Google TTS (An toàn)'} | Tổng batch: ${chunks.length}`);

    for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i].trim();
        if (!chunkText) continue;

        const chunkPath = path.join(__dirname, 'temp', `${baseFileName}_part_${i}.mp3`);
        let success = false;
        
        // --- LOGIC TẠO AUDIO ---
        try {
            if (USE_EDGE) {
                // Thử Edge
                await generateEdgeAudio(chunkText, chunkPath, "vi-VN-NamMinhNeural");
            } else {
                // Dùng Google (Mặc định)
                await generateGoogleAudio(chunkText, chunkPath);
            }
            success = true;
            process.stdout.write(`✅ Batch ${i+1} OK. `);
            
            // DELAY QUAN TRỌNG: Nghỉ 2.5 giây để Google không chặn
            await new Promise(res => setTimeout(res, 2500)); 

        } catch (error) {
            console.log(`\n❌ Lỗi batch ${i+1}, thử lại với Google...`);
            try {
                await generateGoogleAudio(chunkText, chunkPath);
                success = true;
                await new Promise(res => setTimeout(res, 3000));
            } catch (e) {
                console.error("Bó tay đoạn này.");
            }
        }

        if (!success) continue;

        // --- TÍNH TOÁN SRT (ĐÃ FIX LỆCH) ---
        try {
            const buffer = fs.readFileSync(chunkPath);
            const originalDuration = getMP3Duration(buffer) / 1000;
            
            // 🔥 CÔNG THỨC FIX LỆCH:
            // Thời gian hiển thị = (Thời gian gốc / Tốc độ tua) * Hệ số sửa lỗi
            const displayDuration = (originalDuration / AUDIO_SPEED) * SYNC_CORRECTION;

            const startTime = formatTime(currentTime);
            const endTime = formatTime(currentTime + displayDuration);
            
            srtContent += `${i + 1}\n${startTime} --> ${endTime}\n${chunkText}\n\n`;
            
            // Cộng dồn thời gian cho câu tiếp theo
            currentTime += displayDuration;
            audioFiles.push(chunkPath);
        } catch (e) {}
    }

    // Lưu file
    const srtPath = path.join(__dirname, 'temp', `${baseFileName}.srt`);
    fs.writeFileSync(srtPath, srtContent);

    const finalAudioPath = path.join(__dirname, 'temp', `${baseFileName}_final.mp3`);
    if (audioFiles.length > 0) {
        const finalBuffer = Buffer.concat(audioFiles.map(f => fs.readFileSync(f)));
        fs.writeFileSync(finalAudioPath, finalBuffer);
        audioFiles.forEach(f => { try { fs.unlinkSync(f) } catch(e){} });
    } else {
        throw new Error("Không tạo được audio nào!");
    }

    return { audioPath: finalAudioPath, srtPath, totalDuration: currentTime };
}

// --- DOWNLOAD IMAGE ---
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
    Bạn là đạo diễn phim kinh dị. Viết kịch bản về: "${topic}".
    YÊU CẦU JSON RESPONSE (RAW JSON ONLY):
    {
      "narration": "Lời dẫn truyện tiếng Việt (khoảng 1000-1500 từ), viết liền mạch.",
      "visual_prompts": [
         "Prompt 1 (English): Cảnh mở đầu của '${topic}', rùng rợn, 8k, cinematic lighting.",
         "Prompt 2 (English): Cảnh cao trào của '${topic}', đáng sợ, 8k, photorealistic.",
         "Prompt 3 (English): Cảnh kết thúc của '${topic}', ám ảnh, 8k, dark masterpiece."
      ]
    }
    Phong cách: ${style}.
    `;
    
    const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?json=true&model=openai&seed=${Math.floor(Math.random()*1000)}`;
    const response = await axios.get(url, { timeout: 300000 });
    let data = response.data;
    if (typeof data === 'string') {
         const cleanJson = data.replace(/```json/g, '').replace(/```/g, '').trim();
         try { data = JSON.parse(cleanJson); } catch (e) { throw new Error("Lỗi JSON AI"); }
    }
    if (typeof data.visual_prompts === 'string') {
        data.visual_prompts = [data.visual_prompts, data.visual_prompts, data.visual_prompts];
    }
    return data;
}

function fixPath(p: string) { return p.replace(/\\/g, '/').replace(':', '\\:'); }

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
        console.log('--- Render Survival Mode (Fix Sync & Google TTS) ---');
        
        const imagePaths = await downloadImages(visual_prompts, timestamp);
        if (imagePaths.length < 3) throw new Error("Lỗi tải ảnh");

        // Gọi hàm tạo audio (Mặc định dùng Google)
        const { audioPath, srtPath, totalDuration } = await generateAudioAndSubtitles(script, baseName);
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
                      `zoompan=z='min(zoom+0.0005,1.2)':d=${Math.ceil(durationPerImage*30 + 60)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30[v${i}];`;
            inputMap += `[v${i}]`;
        }
        
        filter += `${inputMap}concat=n=${imagePaths.length}:v=1:a=0[v_base];`;
        
        const srtFixed = fixPath(srtPath);
        // Style phụ đề
        const subStyle = "FontName=Arial,FontSize=13,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=50,Alignment=2,Bold=1";
        filter += `[v_base]subtitles='${srtFixed}':force_style='${subStyle}'[v_out];`;

        if (bgMusic) {
            const audioIdx = imagePaths.length;
            const musicIdx = imagePaths.length + 1;
            // Áp dụng tốc độ tua cho cả giọng Google
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
const server = app.listen(PORT, () => console.log(`Server Survival Running on ${PORT}`));
server.setTimeout(1800000);