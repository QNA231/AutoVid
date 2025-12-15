import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'; // Import thêm SchemaType
import ffmpeg from 'fluent-ffmpeg';
import * as googleTTS from 'google-tts-api';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// --- CONFIG ---
dotenv.config();
// ffmpeg.setFfmpegPath("D:\\Quan\\autovid\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe"); // Bỏ comment nếu cần

const app = express();
app.use(cors());
app.use(express.json());
app.use('/output', express.static(path.join(__dirname, 'output')));

// Tạo thư mục
['temp', 'output'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Cấu hình Model trả về JSON (Quan trọng để tách kịch bản)
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", // Dùng bản Flash cho nhanh theo yêu cầu
    generationConfig: {
        responseMimeType: "application/json", // Ép buộc trả về JSON
        responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
                narration: { type: SchemaType.STRING, description: "Lời dẫn truyện để đọc (Tiếng Việt), không chứa mô tả cảnh." },
                visual_prompt: { type: SchemaType.STRING, description: "Mô tả hình ảnh chi tiết (Tiếng Anh) để vẽ minh họa." }
            }
        }
    }
});

// Hàm tải file
async function downloadFile(url: string, outputPath: string) {
    const writer = fs.createWriteStream(outputPath);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// Hàm TTS (Text to Speech)
async function generateLongAudio(text: string, outputPath: string) {
    // google-tts-api không hỗ trợ chỉnh tốc độ trực tiếp xuống 1.5 ở API, 
    // chúng ta sẽ dùng FFmpeg để tua nhanh (atempo) ở bước render.
    const results = await googleTTS.getAllAudioBase64(text, {
        lang: 'vi', slow: false, host: 'https://translate.google.com', timeout: 10000, splitPunct: ',.?!'
    });
    const buffers = results.map(r => Buffer.from(r.base64, 'base64'));
    fs.writeFileSync(outputPath, Buffer.concat(buffers));
}

// API 1: Tạo nội dung (JSON Mode)
app.post('/api/generate', async (req: Request, res: Response): Promise<any> => {
    const { topic } = req.body;
    try {
        const prompt = `Viết kịch bản TikTok kinh dị về: "${topic}". 
        Hãy tách biệt rõ ràng lời dẫn truyện (để đọc) và mô tả hình ảnh.
        Lời dẫn phải rùng rợn, liền mạch.`;
        
        const result = await model.generateContent(prompt);
        // Vì đã cấu hình JSON mode, ta parse trực tiếp
        const jsonResponse = JSON.parse(result.response.text());

        res.json({ 
            script: jsonResponse.narration, // Chỉ lấy lời thoại
            imagePrompt: jsonResponse.visual_prompt // Chỉ lấy mô tả ảnh
        });
    } catch (error) { 
        console.error(error);
        res.status(500).json({ error: 'Lỗi AI: ' + error }); 
    }
});

// API 2: Render Video (Chỉnh tốc độ và Volume)
app.post('/api/render', async (req: Request, res: Response): Promise<any> => {
    const { script, imageUrl } = req.body;
    const timestamp = Date.now();
    
    const imagePath = path.join(__dirname, 'temp', `img_${timestamp}.jpg`);
    const voicePath = path.join(__dirname, 'temp', `voice_${timestamp}.mp3`);
    const bgMusicPath = path.join(__dirname, 'temp', `bg-music.mp3`);
    const videoPath = path.join(__dirname, 'output', `video_${timestamp}.mp4`);

    try {
        console.log('--- Đang Render (Custom Settings) ---');
        
        await downloadFile(imageUrl, imagePath);
        await generateLongAudio(script, voicePath); // Tạo giọng đọc gốc (tốc độ 1.0)

        const hasMusic = fs.existsSync(bgMusicPath);
        let command = ffmpeg();

        command.input(imagePath).loop();
        command.input(voicePath);
        if (hasMusic) command.input(bgMusicPath);

        let complexFilter = [];
        
        // 1. Video Effect (Giữ nguyên hiệu ứng Zoom nhẹ cho sang)
        complexFilter.push(`[0:v]zoompan=z='min(zoom+0.0015,1.2)':d=700:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920[v_out]`);

        // 2. Audio Processing (QUAN TRỌNG: Chỉnh tốc độ và Volume tại đây)
        // - [1:a] là Voice: dùng atempo=1.5 (Tăng tốc gấp rưỡi)
        // - [2:a] là Nhạc nền: dùng volume=0.8 (To gần bằng giọng đọc)
        
        if (hasMusic) {
            // Xử lý Voice: Tăng tốc 1.5
            // Lưu ý: atempo chỉ hỗ trợ tối đa 2.0, nên 1.5 là an toàn.
            // Nếu giọng bị méo, hãy thử giảm xuống 1.3
            complexFilter.push(`[1:a]atempo=1.5[voice_fast]`); 
            
            // Xử lý Nhạc nền: Volume 0.8 + Fade out cuối
            complexFilter.push(`[2:a]volume=0.8,afade=t=out:st=10:d=3[bg_adjusted]`);
            
            // Trộn lại (amix)
            // duration=first: Độ dài video theo độ dài của giọng đọc (sau khi đã tua nhanh)
            complexFilter.push(`[voice_fast][bg_adjusted]amix=inputs=2:duration=first[a_out]`);
        } else {
            // Nếu không có nhạc thì chỉ tua nhanh giọng
            complexFilter.push(`[1:a]atempo=1.5[a_out]`);
        }

        command
            .complexFilter(complexFilter)
            .outputOptions([
                '-c:v libx264', '-tune stillimage', '-preset medium',
                '-c:a aac', '-b:a 192k', '-pix_fmt yuv420p',
                '-shortest',
                '-map [v_out]', 
                '-map [a_out]'
            ])
            .save(videoPath)
            .on('end', () => {
                console.log('✅ Render Xong!');
                res.json({ videoUrl: `http://localhost:3001/output/video_${timestamp}.mp4` });
            })
            .on('error', (err) => {
                console.error(err);
                res.status(500).json({ error: 'Lỗi Render' });
            });

    } catch (error) { 
        console.error(error);
        res.status(500).json({ error: 'Lỗi Server' }); 
    }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Server Custom Audio chạy tại port ${PORT}`));